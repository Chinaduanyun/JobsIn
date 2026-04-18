from __future__ import annotations

import asyncio
import logging
import random

from sqlmodel import select, func

from app.database import async_session
from app.models import Job, Application, ApplicationBatch, SystemConfig, now_shanghai

logger = logging.getLogger(__name__)

# 全局跟踪正在运行的批次，用于暂停控制
_running_batches: dict[int, bool] = {}  # batch_id -> is_running
_running_singles: dict[int, bool] = {}  # application_id -> is_running


async def get_today_applied() -> int:
    async with async_session() as session:
        today_start = now_shanghai().replace(hour=0, minute=0, second=0, microsecond=0)
        result = await session.execute(
            select(func.count()).select_from(Application).where(
                Application.status.in_(["sent", "recorded", "sending"]),
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


async def _send_via_extension(job: Job, greeting_text: str) -> dict:
    """通过 Chrome 扩展发送投递"""
    from app.services.extension_bridge import extension_bridge

    if not extension_bridge.connected:
        raise RuntimeError("Chrome 扩展未连接")

    result = await extension_bridge.send_command(
        "apply_job",
        timeout=30,
        url=job.url,
        greeting_text=greeting_text,
    )

    if not result.get("success"):
        error = result.get("error", "未知错误")
        if "security_check" in str(error):
            raise RuntimeError("安全验证触发，请在浏览器中完成验证")
        raise RuntimeError(f"投递失败: {error}")

    # background.js 返回 { success, data: contentResponse }
    # contentResponse 是 content.js 的 sendResponse 值: { success, data: { sent, message } }
    content_response = result.get("data", {})
    inner_data = content_response.get("data", {}) if isinstance(content_response, dict) else {}
    # 兼容两种结构: 直接 sent 或嵌套在 data 里
    if isinstance(inner_data, dict) and "sent" in inner_data:
        return inner_data
    return content_response


async def apply_to_job(job_id: int, greeting_text: str | None = None) -> Application:
    """对指定岗位执行投递（通过 Chrome 扩展实际发送）"""
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

        # 创建投递记录
        application = Application(
            job_id=job.id,
            greeting_text=greeting_text or "",
            status="sending",
            applied_at=now_shanghai(),
        )
        session.add(application)
        await session.commit()
        await session.refresh(application)

    # 尝试通过扩展发送
    try:
        result = await _send_via_extension(job, greeting_text or "")
        sent = result.get("sent", False) if isinstance(result, dict) else False
        status = "sent" if sent else "recorded"
    except Exception as e:
        logger.warning("[投递] 岗位 %d 扩展发送失败: %s, 标记为 recorded", job_id, e)
        status = "recorded"

    async with async_session() as session:
        app = await session.get(Application, application.id)
        if app:
            app.status = status
            await session.commit()
            await session.refresh(app)

    logger.info("[投递] 岗位 %d (%s @ %s) 状态=%s", job.id, job.title, job.company, status)
    return application


async def batch_apply(job_ids: list[int], greeting_texts: dict[int, str] | None = None) -> int:
    """批量投递岗位，返回 batch_id"""
    # 创建批次
    async with async_session() as session:
        batch = ApplicationBatch(
            status="running",
            total=len(job_ids),
        )
        session.add(batch)
        await session.commit()
        await session.refresh(batch)
        batch_id = batch.id

    # 预创建所有投递记录
    app_ids = []
    async with async_session() as session:
        for job_id in job_ids:
            text = greeting_texts.get(job_id) if greeting_texts else None
            app = Application(
                job_id=job_id,
                batch_id=batch_id,
                greeting_text=text or "",
                status="pending",
            )
            session.add(app)
            await session.commit()
            await session.refresh(app)
            app_ids.append(app.id)

    # 启动异步执行
    _running_batches[batch_id] = True
    asyncio.create_task(_run_batch(batch_id, app_ids, greeting_texts))
    return batch_id


async def _run_batch(batch_id: int, app_ids: list[int], greeting_texts: dict[int, str] | None):
    """异步执行批量投递"""
    delay_range = await _get_apply_delay()
    logger.info("[批量投递] 批次 %d 开始，共 %d 个岗位", batch_id, len(app_ids))

    completed = 0
    failed = 0

    for i, app_id in enumerate(app_ids):
        # 检查是否被暂停或取消
        if not _running_batches.get(batch_id, False):
            logger.info("[批量投递] 批次 %d 已暂停/取消", batch_id)
            break

        async with async_session() as session:
            app = await session.get(Application, app_id)
            if not app or app.status not in ("pending", "paused"):
                continue
            job = await session.get(Job, app.job_id)

        if not job:
            failed += 1
            continue

        try:
            # 获取文案
            text = app.greeting_text
            if not text and greeting_texts:
                text = greeting_texts.get(app.job_id, "")
            if not text:
                from app.services.ai_service import generate_greeting
                text = await generate_greeting(app.job_id)

            # 更新状态为发送中
            async with async_session() as session:
                a = await session.get(Application, app_id)
                if a:
                    a.status = "sending"
                    a.greeting_text = text
                    await session.commit()

            # 发送
            result = await _send_via_extension(job, text)
            sent = result.get("sent", False) if isinstance(result, dict) else False
            status = "sent" if sent else "recorded"
            completed += 1

            async with async_session() as session:
                a = await session.get(Application, app_id)
                if a:
                    a.status = status
                    a.applied_at = now_shanghai()
                    await session.commit()

            logger.info("[批量投递] %d/%d 成功: 岗位 %d (%s)", i + 1, len(app_ids), job.id, status)

        except Exception as e:
            failed += 1
            async with async_session() as session:
                a = await session.get(Application, app_id)
                if a:
                    a.status = "failed"
                    await session.commit()
            logger.warning("[批量投递] %d/%d 失败: 岗位 %d - %s", i + 1, len(app_ids), app.job_id, e)

        # 更新批次进度
        async with async_session() as session:
            b = await session.get(ApplicationBatch, batch_id)
            if b:
                b.completed = completed
                b.failed = failed
                await session.commit()

        # 随机延迟
        if i < len(app_ids) - 1 and _running_batches.get(batch_id, False):
            delay = random.uniform(*delay_range)
            logger.debug("[批量投递] 等待 %.1fs...", delay)
            await asyncio.sleep(delay)

    # 完成
    final_status = "completed" if _running_batches.get(batch_id, False) else "paused"
    async with async_session() as session:
        b = await session.get(ApplicationBatch, batch_id)
        if b:
            b.status = final_status
            b.completed = completed
            b.failed = failed
            await session.commit()

    _running_batches.pop(batch_id, None)
    logger.info("[批量投递] 批次 %d %s: %d/%d 成功, %d 失败",
                batch_id, final_status, completed, len(app_ids), failed)


async def pause_batch(batch_id: int):
    """暂停批量投递"""
    _running_batches[batch_id] = False
    async with async_session() as session:
        b = await session.get(ApplicationBatch, batch_id)
        if b and b.status == "running":
            b.status = "paused"
            await session.commit()
            # 把未完成的 applications 也标记为 paused
            result = await session.execute(
                select(Application).where(
                    Application.batch_id == batch_id,
                    Application.status.in_(["pending", "sending"]),
                )
            )
            for app in result.scalars().all():
                app.status = "paused"
            await session.commit()


async def resume_batch(batch_id: int):
    """恢复批量投递"""
    async with async_session() as session:
        b = await session.get(ApplicationBatch, batch_id)
        if not b or b.status != "paused":
            raise ValueError("批次不存在或未暂停")

        b.status = "running"
        await session.commit()

        # 获取未完成的 applications
        result = await session.execute(
            select(Application).where(
                Application.batch_id == batch_id,
                Application.status == "paused",
            )
        )
        paused_apps = result.scalars().all()
        app_ids = [a.id for a in paused_apps]

        for a in paused_apps:
            a.status = "pending"
        await session.commit()

    if app_ids:
        _running_batches[batch_id] = True
        asyncio.create_task(_run_batch(batch_id, app_ids, None))


async def pause_single(app_id: int):
    """暂停单个投递"""
    async with async_session() as session:
        app = await session.get(Application, app_id)
        if app and app.status in ("pending", "sending"):
            app.status = "paused"
            await session.commit()
