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


class TaskCreate(BaseModel):
    platform: str = "boss"
    keyword: str
    city: str = "杭州"
    salary: str = ""
    max_pages: int = 5
    target_new_jobs: int = 0
    stop_after_stale_pages: int = 2
    start_page: Optional[int] = None


@router.get("")
async def list_tasks(session: AsyncSession = Depends(get_session)):
    stmt = select(CollectionTask).order_by(CollectionTask.created_at.desc())
    result = await session.execute(stmt)
    return result.scalars().all()


@router.post("")
async def create_task(data: TaskCreate, session: AsyncSession = Depends(get_session)):
    scraper = get_scraper(data.platform)
    city_code = scraper.resolve_city_code(data.city)

    start_page = data.start_page or 1
    if data.platform == "boss" and data.start_page is None:
        latest_similar = (
            await session.execute(
                select(CollectionTask)
                .where(CollectionTask.platform == data.platform)
                .where(CollectionTask.keyword == data.keyword)
                .where(CollectionTask.city == data.city)
                .where(CollectionTask.salary == data.salary)
                .order_by(CollectionTask.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if latest_similar and latest_similar.last_page_reached > 0:
            start_page = latest_similar.last_page_reached + 1

    task = CollectionTask(
        platform=data.platform,
        keyword=data.keyword,
        city=data.city,
        city_code=city_code,
        salary=data.salary,
        max_pages=data.max_pages,
        target_new_jobs=data.target_new_jobs,
        stop_after_stale_pages=data.stop_after_stale_pages,
        start_page=start_page,
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
