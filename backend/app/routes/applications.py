from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from pydantic import BaseModel

from app.database import get_session
from app.models import Application, Job
from app.services.boss_applicant import apply_to_job, batch_apply, get_today_applied

router = APIRouter()


class ApplyRequest(BaseModel):
    job_id: int
    greeting_text: str | None = None


class BatchApplyRequest(BaseModel):
    job_ids: list[int]
    greeting_texts: dict[int, str] | None = None


@router.post("/apply")
async def apply(data: ApplyRequest):
    try:
        application = await apply_to_job(data.job_id, data.greeting_text)
        return application
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"投递失败: {e}")


@router.post("/batch-apply")
async def batch_apply_endpoint(data: BatchApplyRequest):
    """批量投递岗位 — 在后台异步执行，带随机延迟"""
    if not data.job_ids:
        raise HTTPException(status_code=400, detail="请选择至少一个岗位")

    # 异步执行，立即返回
    task = asyncio.create_task(batch_apply(data.job_ids, data.greeting_texts))
    return {
        "message": f"批量投递已启动，共 {len(data.job_ids)} 个岗位",
        "total": len(data.job_ids),
    }


@router.get("")
async def list_applications(
    page: int = 1,
    size: int = 20,
    session: AsyncSession = Depends(get_session),
):
    stmt = (
        select(Application)
        .order_by(Application.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    result = await session.execute(stmt)
    apps = result.scalars().all()

    items = []
    for app in apps:
        job = await session.get(Job, app.job_id)
        items.append({
            **app.model_dump(),
            "job_title": job.title if job else "",
            "job_company": job.company if job else "",
        })

    return {"items": items, "page": page, "size": size}


@router.get("/today")
async def today_count():
    count = await get_today_applied()
    return {"count": count}
