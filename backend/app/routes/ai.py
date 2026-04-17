from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from sqlmodel import select

import asyncio
import logging

from app.database import get_session, async_session
from app.models import JobAnalysis, SystemConfig
from app.services import ai_service

router = APIRouter()
logger = logging.getLogger(__name__)

# 批量任务进度追踪
_batch_progress: dict[str, dict] = {}


async def _get_concurrency() -> int:
    """从数据库读取 LLM 并发数配置"""
    try:
        async with async_session() as session:
            cfg = await session.get(SystemConfig, "ai_concurrency")
            if cfg and cfg.value.isdigit():
                return max(1, min(int(cfg.value), 10))
    except Exception:
        pass
    return 1


class AnalyzeRequest(BaseModel):
    job_id: int


class GenerateGreetingRequest(BaseModel):
    job_id: int


class BatchAnalyzeRequest(BaseModel):
    job_ids: list[int]


class BatchGreetingRequest(BaseModel):
    job_ids: list[int]


@router.post("/analyze")
async def analyze_job(data: AnalyzeRequest):
    """AI 分析岗位匹配度"""
    try:
        analysis = await ai_service.analyze_job(data.job_id)
        return analysis
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 分析失败: {e}")


@router.post("/greeting")
async def generate_greeting(data: GenerateGreetingRequest):
    """AI 生成沟通文案"""
    try:
        greeting = await ai_service.generate_greeting(data.job_id)
        return {"greeting_text": greeting}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文案生成失败: {e}")


@router.get("/analysis/{job_id}")
async def get_analysis(job_id: int, session: AsyncSession = Depends(get_session)):
    """获取岗位的最新 AI 分析结果"""
    result = await session.execute(
        select(JobAnalysis)
        .where(JobAnalysis.job_id == job_id)
        .order_by(JobAnalysis.created_at.desc())
        .limit(1)
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=404, detail="该岗位尚未进行 AI 分析")
    return analysis


@router.post("/batch-analyze")
async def batch_analyze(data: BatchAnalyzeRequest):
    """批量异步 AI 分析"""
    if not data.job_ids:
        raise HTTPException(status_code=400, detail="请选择要分析的岗位")

    batch_id = f"analyze-{id(data)}"
    _batch_progress[batch_id] = {
        "total": len(data.job_ids),
        "completed": 0,
        "failed": 0,
        "status": "running",
        "errors": [],
    }

    async def run_batch():
        progress = _batch_progress[batch_id]
        concurrency = await _get_concurrency()
        sem = asyncio.Semaphore(concurrency)

        async def analyze_one(job_id: int):
            async with sem:
                try:
                    await ai_service.analyze_job(job_id)
                    progress["completed"] += 1
                except Exception as e:
                    progress["failed"] += 1
                    progress["errors"].append(f"岗位{job_id}: {str(e)[:50]}")
                    logger.warning("批量分析 job %d 失败: %s", job_id, e)

        await asyncio.gather(*[analyze_one(jid) for jid in data.job_ids])
        progress["status"] = "completed"

    asyncio.create_task(run_batch())
    return {"batch_id": batch_id, "total": len(data.job_ids), "message": "批量分析已启动"}


@router.post("/batch-greeting")
async def batch_greeting(data: BatchGreetingRequest):
    """批量异步生成沟通文案"""
    if not data.job_ids:
        raise HTTPException(status_code=400, detail="请选择要生成文案的岗位")

    batch_id = f"greeting-{id(data)}"
    _batch_progress[batch_id] = {
        "total": len(data.job_ids),
        "completed": 0,
        "failed": 0,
        "status": "running",
        "errors": [],
    }

    async def run_batch():
        progress = _batch_progress[batch_id]
        concurrency = await _get_concurrency()
        sem = asyncio.Semaphore(concurrency)

        async def greeting_one(job_id: int):
            async with sem:
                try:
                    await ai_service.generate_greeting(job_id)
                    progress["completed"] += 1
                except Exception as e:
                    progress["failed"] += 1
                    progress["errors"].append(f"岗位{job_id}: {str(e)[:50]}")
                    logger.warning("批量文案 job %d 失败: %s", job_id, e)

        await asyncio.gather(*[greeting_one(jid) for jid in data.job_ids])
        progress["status"] = "completed"

    asyncio.create_task(run_batch())
    return {"batch_id": batch_id, "total": len(data.job_ids), "message": "批量文案生成已启动"}


@router.get("/batch-status/{batch_id}")
async def batch_status(batch_id: str):
    """查询批量任务进度"""
    progress = _batch_progress.get(batch_id)
    if not progress:
        raise HTTPException(status_code=404, detail="批量任务不存在")
    return progress
