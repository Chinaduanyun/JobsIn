from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_session

router = APIRouter()


class AnalyzeRequest(BaseModel):
    job_id: int


class GenerateGreetingRequest(BaseModel):
    job_id: int


@router.post("/analyze")
async def analyze_job(data: AnalyzeRequest, session: AsyncSession = Depends(get_session)):
    """AI 分析岗位匹配度 — Step 5 实现"""
    return {"message": "AI 分析功能将在 Step 5 实现", "job_id": data.job_id}


@router.post("/greeting")
async def generate_greeting(data: GenerateGreetingRequest, session: AsyncSession = Depends(get_session)):
    """AI 生成沟通文案 — Step 5 实现"""
    return {"message": "AI 文案生成将在 Step 5 实现", "job_id": data.job_id}
