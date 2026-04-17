import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from pydantic import BaseModel

from app.database import get_session
from app.models import CollectionTask
from app.services.browser import boss_browser
from app.services.boss_scraper import boss_scraper, CITY_CODES, resolve_city_code

router = APIRouter()


class TaskCreate(BaseModel):
    keyword: str
    city: str = "全国"
    salary: str = ""
    max_pages: int = 5


@router.get("")
async def list_tasks(session: AsyncSession = Depends(get_session)):
    stmt = select(CollectionTask).order_by(CollectionTask.created_at.desc())
    result = await session.execute(stmt)
    return result.scalars().all()


@router.post("")
async def create_task(data: TaskCreate, session: AsyncSession = Depends(get_session)):
    city_code = resolve_city_code(data.city)
    task = CollectionTask(
        keyword=data.keyword,
        city=data.city,
        city_code=city_code,
        salary=data.salary,
        max_pages=data.max_pages,
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

    if not boss_browser.launched:
        raise HTTPException(status_code=400, detail="请先启动浏览器")
    if not boss_browser.logged_in:
        raise HTTPException(status_code=400, detail="请先扫码登录")

    # 后台启动采集
    asyncio.create_task(boss_scraper.run_task(task_id))
    return {"message": "采集任务已启动", "task_id": task_id}


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(CollectionTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    await boss_scraper.cancel_task(task_id)
    task.status = "cancelled"
    await session.commit()
    return {"message": "任务已取消"}


@router.delete("/{task_id}")
async def delete_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(CollectionTask, task_id)
    if task:
        await session.delete(task)
        await session.commit()
    return {"ok": True}


@router.get("/cities")
async def list_cities():
    """返回支持的城市列表"""
    return CITY_CODES
