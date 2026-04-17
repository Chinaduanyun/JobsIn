from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models import SystemConfig

router = APIRouter()

DEFAULTS = {
    "ai_api_key": "",
    "ai_base_url": "https://api.openai.com/v1",
    "ai_model": "gpt-4o-mini",
    "daily_apply_limit": "100",
    "today_applied": "0",
    "scrape_page_delay": "3-8",
    "scrape_detail_delay": "1-3",
    "apply_delay": "5-15",
}


@router.get("")
async def get_config(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(SystemConfig))
    rows = {r.key: r.value for r in result.scalars().all()}
    # 返回时合并默认值
    return {k: rows.get(k, v) for k, v in DEFAULTS.items()}


@router.put("")
async def update_config(data: dict, session: AsyncSession = Depends(get_session)):
    for key, value in data.items():
        if key not in DEFAULTS:
            continue
        existing = await session.get(SystemConfig, key)
        if existing:
            existing.value = str(value)
        else:
            session.add(SystemConfig(key=key, value=str(value)))
    await session.commit()
    return {"ok": True}
