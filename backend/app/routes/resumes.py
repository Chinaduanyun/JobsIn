from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from pydantic import BaseModel

from app.database import get_session
from app.models import Resume

router = APIRouter()


class ResumeUpdate(BaseModel):
    name: str = "默认简历"
    content: str


@router.get("")
async def list_resumes(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Resume).order_by(Resume.updated_at.desc()))
    return result.scalars().all()


@router.get("/active")
async def get_active_resume(session: AsyncSession = Depends(get_session)):
    stmt = select(Resume).where(Resume.is_active == True)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


@router.post("")
async def create_resume(data: ResumeUpdate, session: AsyncSession = Depends(get_session)):
    # 新简历默认激活，其余设为非激活
    existing = await session.execute(select(Resume))
    for r in existing.scalars().all():
        r.is_active = False
    resume = Resume(name=data.name, content=data.content, is_active=True)
    session.add(resume)
    await session.commit()
    await session.refresh(resume)
    return resume


@router.put("/{resume_id}")
async def update_resume(resume_id: int, data: ResumeUpdate, session: AsyncSession = Depends(get_session)):
    resume = await session.get(Resume, resume_id)
    if not resume:
        return {"error": "not found"}
    resume.name = data.name
    resume.content = data.content
    resume.updated_at = datetime.utcnow()
    await session.commit()
    return resume


@router.delete("/{resume_id}")
async def delete_resume(resume_id: int, session: AsyncSession = Depends(get_session)):
    resume = await session.get(Resume, resume_id)
    if resume:
        await session.delete(resume)
        await session.commit()
    return {"ok": True}
