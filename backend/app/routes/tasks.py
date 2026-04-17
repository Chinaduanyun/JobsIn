from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from pydantic import BaseModel

from app.database import get_session
from app.models import CollectionTask

router = APIRouter()


class TaskCreate(BaseModel):
    keyword: str
    city: str = "全国"
    city_code: str = "100010000"
    salary: str = ""
    max_pages: int = 5


@router.get("")
async def list_tasks(session: AsyncSession = Depends(get_session)):
    stmt = select(CollectionTask).order_by(CollectionTask.created_at.desc())
    result = await session.execute(stmt)
    return result.scalars().all()


@router.post("")
async def create_task(data: TaskCreate, session: AsyncSession = Depends(get_session)):
    task = CollectionTask(**data.model_dump())
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


@router.post("/{task_id}/start")
async def start_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(CollectionTask, task_id)
    if not task:
        return {"error": "not found"}
    # 实际采集逻辑在 Step 4 实现
    task.status = "running"
    await session.commit()
    return {"ok": True, "task_id": task_id}


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(CollectionTask, task_id)
    if task and task.status == "running":
        task.status = "cancelled"
        await session.commit()
    return {"ok": True}


@router.delete("/{task_id}")
async def delete_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(CollectionTask, task_id)
    if task:
        await session.delete(task)
        await session.commit()
    return {"ok": True}
