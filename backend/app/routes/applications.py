from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select, func
from pydantic import BaseModel

from app.database import get_session
from app.models import Application, ApplicationBatch, Job, JobAnalysis
from app.services.boss_applicant import (
    apply_to_job, batch_apply, get_today_applied,
    pause_batch, resume_batch, pause_single,
)

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
    """批量投递岗位 — 在后台异步执行，返回 batch_id"""
    if not data.job_ids:
        raise HTTPException(status_code=400, detail="请选择至少一个岗位")

    batch_id = await batch_apply(data.job_ids, data.greeting_texts)
    return {
        "message": f"批量投递已启动，共 {len(data.job_ids)} 个岗位",
        "total": len(data.job_ids),
        "batch_id": batch_id,
    }


# ── 批次操作 ──────────────────────────────────

@router.get("/batches")
async def list_batches(session: AsyncSession = Depends(get_session)):
    """获取所有投递批次"""
    result = await session.execute(
        select(ApplicationBatch).order_by(ApplicationBatch.created_at.desc())
    )
    batches = result.scalars().all()
    items = []
    for b in batches:
        # 统计批次内的投递数量
        count_result = await session.execute(
            select(func.count()).select_from(Application).where(Application.batch_id == b.id)
        )
        actual_total = count_result.scalar() or 0
        items.append({
            **b.model_dump(),
            "actual_total": actual_total,
        })
    return {"items": items}


@router.get("/batches/{batch_id}")
async def get_batch(batch_id: int, session: AsyncSession = Depends(get_session)):
    """获取批次详情和其中的投递列表"""
    batch = await session.get(ApplicationBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")

    result = await session.execute(
        select(Application)
        .where(Application.batch_id == batch_id)
        .order_by(Application.created_at.asc())
    )
    apps = result.scalars().all()
    app_items = []
    for app in apps:
        job = await session.get(Job, app.job_id)
        app_items.append({
            **app.model_dump(),
            "job_title": job.title if job else "",
            "job_company": job.company if job else "",
            "job_salary": job.salary if job else "",
        })

    return {
        "batch": batch.model_dump(),
        "applications": app_items,
    }


@router.post("/batches/{batch_id}/pause")
async def pause_batch_endpoint(batch_id: int):
    try:
        await pause_batch(batch_id)
        return {"message": "批次已暂停"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/batches/{batch_id}/resume")
async def resume_batch_endpoint(batch_id: int):
    try:
        await resume_batch(batch_id)
        return {"message": "批次已恢复"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── 单个投递操作 ──────────────────────────────────

@router.post("/{app_id}/pause")
async def pause_application(app_id: int):
    await pause_single(app_id)
    return {"message": "投递已暂停"}


# ── 列表与统计 ──────────────────────────────────

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
        analysis_result = await session.execute(
            select(JobAnalysis)
            .where(JobAnalysis.job_id == app.job_id)
            .order_by(JobAnalysis.created_at.desc())
            .limit(1)
        )
        analysis = analysis_result.scalar_one_or_none()
        items.append({
            **app.model_dump(),
            "job_title": job.title if job else "",
            "job_company": job.company if job else "",
            "job_salary": job.salary if job else "",
            "job_city": job.city if job else "",
            "job_url": job.url if job else "",
            "job_experience": job.experience if job else "",
            "job_education": job.education if job else "",
            "job_tags": job.tags if job else "",
            "overall_score": analysis.overall_score if analysis else None,
            "suggestion": analysis.suggestion if analysis else "",
            "ai_greeting": analysis.greeting_text if analysis else "",
        })

    return {"items": items, "page": page, "size": size}


@router.get("/today")
async def today_count():
    count = await get_today_applied()
    return {"count": count}
