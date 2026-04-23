from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models import Job, JobAnalysis
from app.services import ai_service
from app.services.extension_bridge import extension_bridge

logger = logging.getLogger(__name__)

router = APIRouter()


class ResultReport(BaseModel):
    command_id: str
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None
    security_check: Optional[bool] = False


class CompanionSaveRequest(BaseModel):
    """陪伴模式：保存单个岗位"""

    title: str
    company: str = ""
    salary: str = ""
    city: str = ""
    experience: str = ""
    education: str = ""
    description: str = ""
    url: str = ""
    hr_name: str = ""
    hr_title: str = ""
    hr_active: str = ""
    company_size: str = ""
    company_industry: str = ""
    tags: str = ""


JOB_FIELD_NAMES = (
    "title",
    "company",
    "salary",
    "city",
    "experience",
    "education",
    "description",
    "url",
    "hr_name",
    "hr_title",
    "hr_active",
    "company_size",
    "company_industry",
    "tags",
)


def _apply_job_fields(job: Job, data: CompanionSaveRequest) -> bool:
    changed = False
    for field in JOB_FIELD_NAMES:
        new_value = getattr(data, field, "")
        if not new_value:
            continue
        if getattr(job, field) != new_value:
            setattr(job, field, new_value)
            changed = True
    return changed


async def _find_job_by_url(session: AsyncSession, url: str) -> Optional[Job]:
    if not url:
        return None
    return (
        await session.execute(select(Job).where(Job.url == url))
    ).scalar_one_or_none()


async def _get_latest_analysis(session: AsyncSession, job_id: int) -> Optional[JobAnalysis]:
    return (
        await session.execute(
            select(JobAnalysis)
            .where(JobAnalysis.job_id == job_id)
            .order_by(JobAnalysis.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _get_or_create_job_from_page(
    data: CompanionSaveRequest,
    session: AsyncSession,
) -> tuple[Job, bool]:
    existing = await _find_job_by_url(session, data.url)
    if existing:
        if _apply_job_fields(existing, data):
            session.add(existing)
            await session.commit()
            await session.refresh(existing)
        return existing, False

    job = Job(platform="boss", task_id=None)
    _apply_job_fields(job, data)
    session.add(job)
    await session.commit()
    await session.refresh(job)
    logger.info("[Extension] 保存岗位并生成文案: %s @ %s (id=%d)", data.title, data.company, job.id)
    return job, True


@router.get("/command")
async def get_command():
    """扩展轮询：获取下一个待执行命令（long-poll，最多等5秒）"""
    cmd = await extension_bridge.get_pending_command()
    if cmd:
        return cmd
    return {}


@router.post("/result")
async def report_result(report: ResultReport):
    """扩展报告：命令执行结果"""
    result = {
        "success": report.success,
        "data": report.data,
        "error": report.error,
        "security_check": report.security_check,
    }
    disposition = extension_bridge.report_result(report.command_id, result)
    return {"received": disposition == "received", "disposition": disposition}


@router.get("/status")
async def extension_status():
    """扩展连接状态"""
    return extension_bridge.get_status()


@router.post("/companion-save")
async def companion_save(data: CompanionSaveRequest, session: AsyncSession = Depends(get_session)):
    """陪伴模式：保存用户手动浏览到的岗位"""
    if not data.title:
        return {"saved": False, "reason": "缺少岗位标题"}

    if data.url:
        existing = await _find_job_by_url(session, data.url)
        if existing:
            return {"saved": False, "reason": "duplicate", "job_id": existing.id}

    job = Job(
        platform="boss",
        title=data.title,
        company=data.company,
        salary=data.salary,
        city=data.city,
        experience=data.experience,
        education=data.education,
        description=data.description,
        url=data.url,
        hr_name=data.hr_name,
        hr_title=data.hr_title,
        hr_active=data.hr_active,
        company_size=data.company_size,
        company_industry=data.company_industry,
        tags=data.tags,
        task_id=None,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    logger.info("[Companion] 保存岗位: %s @ %s (id=%d)", data.title, data.company, job.id)
    return {"saved": True, "job_id": job.id}


@router.post("/generate-greeting")
async def generate_greeting_from_page(
    data: CompanionSaveRequest,
    session: AsyncSession = Depends(get_session),
):
    """扩展页面内：根据当前详情页直接生成沟通文案"""
    if not data.title:
        raise HTTPException(status_code=400, detail="缺少岗位标题")
    if not data.url:
        raise HTTPException(status_code=400, detail="缺少岗位链接")
    if not data.description:
        raise HTTPException(status_code=400, detail="未提取到岗位描述，请等待页面加载完成后重试")

    try:
        job, job_created = await _get_or_create_job_from_page(data, session)
        analysis_created = False

        analysis = await _get_latest_analysis(session, job.id)
        if not analysis:
            await ai_service.analyze_job(job.id)
            analysis_created = True

        greeting = await ai_service.generate_greeting(job.id)
        return {
            "job_id": job.id,
            "greeting_text": greeting,
            "job_created": job_created,
            "analysis_created": analysis_created,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"扩展生成沟通文案失败: {e}")
