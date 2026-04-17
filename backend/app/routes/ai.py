from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from sqlmodel import select

from app.database import get_session
from app.models import JobAnalysis
from app.services import ai_service

router = APIRouter()


class AnalyzeRequest(BaseModel):
    job_id: int


class GenerateGreetingRequest(BaseModel):
    job_id: int


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
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=404, detail="该岗位尚未进行 AI 分析")
    return analysis
