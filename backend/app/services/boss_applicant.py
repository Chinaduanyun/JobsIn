"""Boss直聘 自动投递: 打开岗位页 → 点击沟通 → 输入文案 → 发送"""

import asyncio
import logging
import random
from datetime import datetime, timezone

from sqlmodel import select, func

from app.database import async_session
from app.models import Job, Application, SystemConfig
from app.services.browser import boss_browser

logger = logging.getLogger(__name__)


async def get_today_applied() -> int:
    """获取今日已投递数量"""
    async with async_session() as session:
        from datetime import datetime, timezone
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        result = await session.execute(
            select(func.count()).select_from(Application).where(
                Application.status == "sent",
                Application.applied_at >= today_start,
            )
        )
        return result.scalar() or 0


async def get_daily_limit() -> int:
    """获取每日投递上限"""
    async with async_session() as session:
        cfg = await session.get(SystemConfig, "daily_apply_limit")
        return int(cfg.value) if cfg else 100


async def apply_to_job(job_id: int, greeting_text: str | None = None) -> Application:
    """对指定岗位发起沟通"""
    if not boss_browser.launched or not boss_browser.logged_in:
        raise RuntimeError("浏览器未启动或未登录")

    # 检查每日限额
    today_count = await get_today_applied()
    limit = await get_daily_limit()
    if today_count >= limit:
        raise RuntimeError(f"今日已投递 {today_count} 个，已达上限 {limit}")

    async with async_session() as session:
        job = await session.get(Job, job_id)
        if not job:
            raise ValueError(f"岗位 {job_id} 不存在")

        # 如果没传文案，用已有的分析结果
        if not greeting_text:
            from app.services.ai_service import generate_greeting
            greeting_text = await generate_greeting(job_id)

        # 创建投递记录
        application = Application(
            job_id=job.id,
            greeting_text=greeting_text,
            status="pending",
        )
        session.add(application)
        await session.commit()
        await session.refresh(application)
        app_id = application.id

    # 在浏览器中执行投递
    try:
        page = boss_browser.page
        if not page:
            raise RuntimeError("浏览器页面不可用")

        # 打开岗位页面
        await page.goto(job.url, wait_until="domcontentloaded", timeout=15000)
        await asyncio.sleep(random.uniform(1, 2))

        # 找到"立即沟通"按钮并点击
        chat_btn = page.locator('.btn-startchat, .op-btn-chat')
        if await chat_btn.count() == 0:
            # 尝试其他选择器
            chat_btn = page.get_by_role("link", name="立即沟通")
        if await chat_btn.count() == 0:
            chat_btn = page.get_by_role("button", name="立即沟通")

        if await chat_btn.count() == 0:
            raise RuntimeError("未找到沟通按钮，可能已投递或页面变化")

        await chat_btn.first.click()
        await asyncio.sleep(random.uniform(1.5, 3))

        # 在聊天输入框输入文案
        chat_input = page.locator('.chat-input textarea, .chat-input [contenteditable], #chat-input')
        if await chat_input.count() > 0:
            await chat_input.first.fill(greeting_text)
            await asyncio.sleep(random.uniform(0.5, 1))

            # 点击发送按钮
            send_btn = page.locator('.btn-send, .chat-op .send-btn')
            if await send_btn.count() == 0:
                send_btn = page.get_by_role("button", name="发送")
            if await send_btn.count() > 0:
                await send_btn.first.click()
            else:
                # 尝试 Enter 发送
                await chat_input.first.press("Enter")

            await asyncio.sleep(random.uniform(1, 2))

        # 更新投递记录为成功
        async with async_session() as session:
            app = await session.get(Application, app_id)
            if app:
                app.status = "sent"
                app.applied_at = datetime.now(timezone.utc)
                await session.commit()
                await session.refresh(app)
                return app

    except Exception as e:
        # 更新投递记录为失败
        async with async_session() as session:
            app = await session.get(Application, app_id)
            if app:
                app.status = "failed"
                await session.commit()
        raise RuntimeError(f"投递失败: {e}")

    return application
