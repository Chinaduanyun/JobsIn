from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from pydantic import BaseModel

from app.database import get_session
from app.models import Application, Job
from app.services.boss_applicant import apply_to_job, get_today_applied

router = APIRouter()


class ApplyRequest(BaseModel):
    job_id: int
    greeting_text: str | None = None


@router.post("/apply")
async def apply(data: ApplyRequest):
    """投递岗位"""
    try:
        application = await apply_to_job(data.job_id, data.greeting_text)
        return application
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"投递失败: {e}")


@router.get("")
async def list_applications(
    page: int = 1,
    size: int = 20,
    session: AsyncSession = Depends(get_session),
):
    """投递记录列表"""
    stmt = (
        select(Application)
        .order_by(Application.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    result = await session.execute(stmt)
    apps = result.scalars().all()

    # 附带岗位信息
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
    """今日投递数"""
    count = await get_today_applied()
    return {"count": count}
