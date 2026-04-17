from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select, func

from app.database import get_session
from app.models import Job, JobAnalysis

router = APIRouter()


@router.get("")
async def list_jobs(
    status: str = Query(None, description="筛选: analyzed / unapplied"),
    keyword: str = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Job).order_by(Job.collected_at.desc())
    if keyword:
        stmt = stmt.where(Job.title.contains(keyword) | Job.company.contains(keyword))
    stmt = stmt.offset((page - 1) * size).limit(size)
    result = await session.execute(stmt)
    jobs = result.scalars().all()

    count_stmt = select(func.count()).select_from(Job)
    total = (await session.execute(count_stmt)).scalar()

    return {"items": jobs, "total": total, "page": page, "size": size}


@router.get("/{job_id}")
async def get_job(job_id: int, session: AsyncSession = Depends(get_session)):
    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="岗位不存在")

    # 附带分析结果
    analysis_stmt = select(JobAnalysis).where(JobAnalysis.job_id == job_id)
    analysis = (await session.execute(analysis_stmt)).scalar_one_or_none()

    return {"job": job, "analysis": analysis}


@router.delete("/{job_id}")
async def delete_job(job_id: int, session: AsyncSession = Depends(get_session)):
    job = await session.get(Job, job_id)
    if job:
        await session.delete(job)
        await session.commit()
    return {"ok": True}


class BatchDeleteRequest(BaseModel):
    job_ids: list[int]


@router.post("/batch-delete")
async def batch_delete_jobs(data: BatchDeleteRequest, session: AsyncSession = Depends(get_session)):
    deleted = 0
    for jid in data.job_ids:
        job = await session.get(Job, jid)
        if job:
            await session.delete(job)
            deleted += 1
    await session.commit()
    return {"deleted": deleted}
