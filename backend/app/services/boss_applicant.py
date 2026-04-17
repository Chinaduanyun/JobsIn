from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timezone

from sqlmodel import select, func

from app.database import async_session
from app.models import Job, Application, SystemConfig

logger = logging.getLogger(__name__)


async def get_today_applied() -> int:
    async with async_session() as session:
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        result = await session.execute(
            select(func.count()).select_from(Application).where(
                Application.status == "sent",
                Application.applied_at >= today_start,
            )
        )
        return result.scalar() or 0


async def get_daily_limit() -> int:
    async with async_session() as session:
        cfg = await session.get(SystemConfig, "daily_apply_limit")
        return int(cfg.value) if cfg else 100


async def _get_apply_delay() -> tuple[float, float]:
    async with async_session() as session:
        cfg = await session.get(SystemConfig, "apply_delay")
        val = cfg.value if cfg else "5-15"
    try:
        parts = val.split("-")
        return float(parts[0]), float(parts[1]) if len(parts) > 1 else float(parts[0])
    except (ValueError, IndexError):
        return 5.0, 15.0


async def apply_to_job(job_id: int, greeting_text: str | None = None) -> Application:
    """对指定岗位创建投递记录（仅记录，不做浏览器操作）"""
    from app.services.browser import boss_browser
    if not boss_browser.logged_in:
        raise RuntimeError("未登录，请先完成登录")

    today_count = await get_today_applied()
    limit = await get_daily_limit()
    if today_count >= limit:
        raise RuntimeError(f"今日已投递 {today_count} 个，已达上限 {limit}")

    async with async_session() as session:
        job = await session.get(Job, job_id)
        if not job:
            raise ValueError(f"岗位 {job_id} 不存在")

        if not greeting_text:
            from app.services.ai_service import generate_greeting
            greeting_text = await generate_greeting(job_id)

        application = Application(
            job_id=job.id,
            greeting_text=greeting_text or "",
            status="sent",
            applied_at=datetime.now(timezone.utc),
        )
        session.add(application)
        await session.commit()
        await session.refresh(application)
        logger.info("[投递] 岗位 %d (%s @ %s) 投递记录已创建", job.id, job.title, job.company)
        return application


async def batch_apply(job_ids: list[int], greeting_texts: dict[int, str] | None = None) -> list[dict]:
    """批量投递岗位，带随机延迟"""
    results = []
    delay_range = await _get_apply_delay()
    logger.info("[批量投递] 开始投递 %d 个岗位, 间隔 %.1f-%.1fs", len(job_ids), *delay_range)

    for i, job_id in enumerate(job_ids):
        try:
            text = greeting_texts.get(job_id) if greeting_texts else None
            app = await apply_to_job(job_id, text)
            results.append({"job_id": job_id, "status": "sent", "application_id": app.id})
            logger.info("[批量投递] %d/%d 成功: 岗位 %d", i + 1, len(job_ids), job_id)
        except Exception as e:
            results.append({"job_id": job_id, "status": "failed", "error": str(e)})
            logger.warning("[批量投递] %d/%d 失败: 岗位 %d - %s", i + 1, len(job_ids), job_id, e)

        if i < len(job_ids) - 1:
            delay = random.uniform(*delay_range)
            logger.debug("[批量投递] 等待 %.1fs...", delay)
            await asyncio.sleep(delay)

    sent = sum(1 for r in results if r["status"] == "sent")
    logger.info("[批量投递] 完成: %d/%d 成功", sent, len(job_ids))
    return results
