from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select, func

from app.database import get_session
from app.models import Job, JobAnalysis, Application

router = APIRouter()


@router.get("")
async def list_jobs(
    status: str = Query(None, description="筛选: analyzed / unapplied"),
    keyword: str = Query(None),
    hr_active: str = Query(None, description="HR活跃筛选: active(近期活跃) / inactive(不活跃) / online(在线)"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Job).order_by(Job.collected_at.desc())
    if keyword:
        stmt = stmt.where(Job.title.contains(keyword) | Job.company.contains(keyword))

    # HR 活跃度筛选
    if hr_active == "online":
        # 仅在线
        stmt = stmt.where(Job.hr_active.in_(["在线", "刚刚活跃"]))
    elif hr_active == "active":
        # 近期活跃：在线、刚刚活跃、今日活跃、3日内活跃、本周活跃
        active_values = ["在线", "刚刚活跃", "今日活跃", "3日内活跃", "本周活跃"]
        stmt = stmt.where(Job.hr_active.in_(active_values))
    elif hr_active == "inactive":
        # 不活跃：无活跃信息 或 超过一周
        active_values = ["在线", "刚刚活跃", "今日活跃", "3日内活跃", "本周活跃"]
        stmt = stmt.where(~Job.hr_active.in_(active_values))
    stmt = stmt.offset((page - 1) * size).limit(size)
    result = await session.execute(stmt)
    jobs = result.scalars().all()

    count_stmt = select(func.count()).select_from(Job)
    total = (await session.execute(count_stmt)).scalar()

    # 批量查询所有 job 的最新分析和投递状态
    job_ids = [j.id for j in jobs]
    analyses_map: dict[int, JobAnalysis] = {}
    app_map: dict[int, str] = {}
    if job_ids:
        for jid in job_ids:
            a_stmt = (
                select(JobAnalysis)
                .where(JobAnalysis.job_id == jid)
                .order_by(JobAnalysis.created_at.desc())
                .limit(1)
            )
            a = (await session.execute(a_stmt)).scalar_one_or_none()
            if a:
                analyses_map[jid] = a

            app_stmt = (
                select(Application)
                .where(Application.job_id == jid)
                .order_by(Application.created_at.desc())
                .limit(1)
            )
            app = (await session.execute(app_stmt)).scalar_one_or_none()
            if app:
                app_map[jid] = app.status

    items = []
    for j in jobs:
        d = {
            "id": j.id, "task_id": j.task_id, "platform": j.platform,
            "title": j.title, "company": j.company, "salary": j.salary,
            "city": j.city, "experience": j.experience, "education": j.education,
            "description": j.description, "url": j.url,
            "hr_name": j.hr_name, "hr_title": j.hr_title, "hr_active": j.hr_active,
            "company_size": j.company_size, "company_industry": j.company_industry,
            "tags": j.tags, "collected_at": j.collected_at.isoformat() if j.collected_at else "",
        }
        analysis = analyses_map.get(j.id)
        if analysis:
            d["analysis"] = {
                "id": analysis.id,
                "job_id": analysis.job_id,
                "overall_score": analysis.overall_score,
                "scores_json": analysis.scores_json,
                "suggestion": analysis.suggestion,
                "greeting_text": analysis.greeting_text,
                "created_at": analysis.created_at.isoformat() if analysis.created_at else "",
            }
        else:
            d["analysis"] = None
        d["apply_status"] = app_map.get(j.id)
        items.append(d)

    return {"items": items, "total": total, "page": page, "size": size}


@router.get("/recommendations")
async def list_recommendations(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    """AI 推荐列表：只返回有分析结果的岗位，按 overall_score 降序"""
    from sqlalchemy import desc

    latest_analysis = (
        select(
            JobAnalysis.job_id,
            func.max(JobAnalysis.id).label("latest_id"),
        )
        .group_by(JobAnalysis.job_id)
        .subquery()
    )

    stmt = (
        select(Job, JobAnalysis)
        .join(latest_analysis, Job.id == latest_analysis.c.job_id)
        .join(JobAnalysis, JobAnalysis.id == latest_analysis.c.latest_id)
        .order_by(desc(JobAnalysis.overall_score))
        .offset((page - 1) * size)
        .limit(size)
    )
    result = await session.execute(stmt)
    rows = result.all()

    count_stmt = (
        select(func.count())
        .select_from(Job)
        .where(Job.id.in_(select(JobAnalysis.job_id).distinct()))
    )
    total = (await session.execute(count_stmt)).scalar()

    job_ids = [j.id for j, _ in rows]
    app_map: dict[int, str] = {}
    for jid in job_ids:
        app_stmt = (
            select(Application)
            .where(Application.job_id == jid)
            .order_by(Application.created_at.desc())
            .limit(1)
        )
        app = (await session.execute(app_stmt)).scalar_one_or_none()
        if app:
            app_map[jid] = app.status

    items = []
    for j, analysis in rows:
        d = {
            "id": j.id, "task_id": j.task_id, "platform": j.platform,
            "title": j.title, "company": j.company, "salary": j.salary,
            "city": j.city, "experience": j.experience, "education": j.education,
            "description": j.description, "url": j.url,
            "hr_name": j.hr_name, "hr_title": j.hr_title, "hr_active": j.hr_active,
            "company_size": j.company_size, "company_industry": j.company_industry,
            "tags": j.tags, "collected_at": j.collected_at.isoformat() if j.collected_at else "",
            "analysis": {
                "id": analysis.id, "job_id": analysis.job_id,
                "overall_score": analysis.overall_score,
                "scores_json": analysis.scores_json,
                "suggestion": analysis.suggestion,
                "greeting_text": analysis.greeting_text,
                "created_at": analysis.created_at.isoformat() if analysis.created_at else "",
            },
            "apply_status": app_map.get(j.id),
        }
        items.append(d)

    return {"items": items, "total": total, "page": page, "size": size}


@router.get("/{job_id}")
async def get_job(job_id: int, session: AsyncSession = Depends(get_session)):
    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="岗位不存在")

    # 附带分析结果 — 取最新一条
    analysis_stmt = (
        select(JobAnalysis)
        .where(JobAnalysis.job_id == job_id)
        .order_by(JobAnalysis.created_at.desc())
        .limit(1)
    )
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
