from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models import Job
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
    ok = extension_bridge.report_result(report.command_id, result)
    return {"received": ok}


@router.get("/status")
async def extension_status():
    """扩展连接状态"""
    return extension_bridge.get_status()


@router.post("/companion-save")
async def companion_save(data: CompanionSaveRequest, session: AsyncSession = Depends(get_session)):
    """陪伴模式：保存用户手动浏览到的岗位"""
    if not data.title:
        return {"saved": False, "reason": "缺少岗位标题"}

    # URL 去重
    if data.url:
        existing = (await session.execute(
            select(Job).where(Job.url == data.url)
        )).scalar_one_or_none()
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
