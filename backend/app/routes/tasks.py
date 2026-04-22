from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from pydantic import BaseModel

from app.database import get_session
from app.models import CollectionTask
from app.services.browser import boss_browser
from app.services.extension_bridge import extension_bridge
from app.services.scraper_factory import get_scraper, list_platforms

router = APIRouter()


def build_config_key(platform: str, keyword: str, city: str, salary: str) -> str:
    return "::".join([
        (platform or "").strip().lower(),
        (keyword or "").strip().lower(),
        (city or "").strip().lower(),
        (salary or "").strip().lower(),
    ])


class TaskCreate(BaseModel):
    platform: str = "boss"
    mode: Optional[str] = None
    keyword: str
    city: str = "杭州"
    salary: str = ""
    max_pages: int = 5
    target_new_jobs: int = 20
    stop_after_stale_pages: int = 2
    start_page: Optional[int] = None
    refresh_pages: int = 3


@router.get("")
async def list_tasks(session: AsyncSession = Depends(get_session)):
    stmt = select(CollectionTask).order_by(CollectionTask.created_at.desc())
    result = await session.execute(stmt)
    return result.scalars().all()


@router.post("")
async def create_task(data: TaskCreate, session: AsyncSession = Depends(get_session)):
    scraper = get_scraper(data.platform)
    city_code = scraper.resolve_city_code(data.city)
    config_key = build_config_key(data.platform, data.keyword, data.city, data.salary)

    mode = (data.mode or ("smart" if data.platform == "boss" else "manual")).strip().lower()
    if mode not in {"manual", "smart"}:
        mode = "smart" if data.platform == "boss" else "manual"

    refresh_pages = max(data.refresh_pages or 0, 0)
    start_page = max(data.start_page or 1, 1)
    resume_from_page = start_page

    if data.platform == "boss":
        history = (
            await session.execute(
                select(CollectionTask)
                .where(CollectionTask.config_key == config_key)
                .order_by(CollectionTask.created_at.desc())
            )
        ).scalars().all()
        historical_last_page = max((task.last_page_reached or 0) for task in history) if history else 0
        historical_resume_page = max((task.resume_from_page or 1) for task in history) if history else 1

        if mode == "smart":
            start_page = 1
            resume_from_page = max(historical_last_page + 1, historical_resume_page, 1)
        else:
            resume_from_page = max(start_page, historical_last_page + 1 if historical_last_page > 0 else 1)

    task = CollectionTask(
        platform=data.platform,
        mode=mode,
        config_key=config_key,
        keyword=data.keyword,
        city=data.city,
        city_code=city_code,
        salary=data.salary,
        max_pages=data.max_pages,
        target_new_jobs=data.target_new_jobs,
        stop_after_stale_pages=data.stop_after_stale_pages,
        start_page=start_page,
        resume_from_page=resume_from_page,
        refresh_pages=refresh_pages,
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


@router.post("/{task_id}/start")
async def start_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(CollectionTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status == "running":
        raise HTTPException(status_code=400, detail="任务已在运行中")

    running_task = (
        await session.execute(
            select(CollectionTask)
            .where(CollectionTask.platform == task.platform)
            .where(CollectionTask.status == "running")
            .where(CollectionTask.id != task_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if running_task:
        raise HTTPException(status_code=400, detail=f"已有运行中的 {task.platform} 任务（#{running_task.id}），请先暂停或停止它")

    if not extension_bridge.connected:
        raise HTTPException(status_code=400, detail="Chrome 扩展未连接，请安装并启用 FindJobs 助手扩展")

    if not boss_browser.logged_in:
        raise HTTPException(status_code=400, detail="请先登录 Boss 直聘")

    scraper = get_scraper(task.platform)
    asyncio.create_task(scraper.run_task(task_id))
    return {"message": "采集任务已启动", "task_id": task_id}


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(CollectionTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    scraper = get_scraper(task.platform)
    await scraper.cancel_task(task_id)
    task.status = "cancelled"
    await session.commit()
    return {"message": "任务已取消"}


@router.post("/{task_id}/pause")
async def pause_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(CollectionTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status != "running":
        raise HTTPException(status_code=400, detail="只有运行中的任务可以暂停")
    scraper = get_scraper(task.platform)
    await scraper.cancel_task(task_id)
    task.status = "paused"
    await session.commit()
    return {"message": "任务已暂停"}


@router.post("/{task_id}/resume")
async def resume_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(CollectionTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status != "paused":
        raise HTTPException(status_code=400, detail="只有已暂停的任务可以恢复")

    running_task = (
        await session.execute(
            select(CollectionTask)
            .where(CollectionTask.platform == task.platform)
            .where(CollectionTask.status == "running")
            .where(CollectionTask.id != task_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if running_task:
        raise HTTPException(status_code=400, detail=f"已有运行中的 {task.platform} 任务（#{running_task.id}），请先暂停或停止它")

    if not extension_bridge.connected:
        raise HTTPException(status_code=400, detail="Chrome 扩展未连接")
    if not boss_browser.logged_in:
        raise HTTPException(status_code=400, detail="请先登录 Boss 直聘")

    scraper = get_scraper(task.platform)
    asyncio.create_task(scraper.run_task(task_id))
    return {"message": "任务已恢复运行"}


@router.delete("/{task_id}")
async def delete_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(CollectionTask, task_id)
    if task:
        await session.delete(task)
        await session.commit()
    return {"ok": True}


@router.get("/cities")
async def list_cities(platform: str = "boss"):
    """返回指定平台支持的城市列表"""
    scraper = get_scraper(platform)
    return scraper.get_city_codes()


@router.get("/platforms")
async def get_platforms():
    """返回所有支持的平台列表"""
    return list_platforms()
