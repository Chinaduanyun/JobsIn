from __future__ import annotations

"""多平台采集器抽象基类"""

import asyncio
import logging
import random
from abc import ABC, abstractmethod
from typing import Optional

from sqlmodel import select

from app.database import async_session as async_session_factory
from app.models import Job, CollectionTask, SystemConfig
from app.services.browser import boss_browser
from app.services.extension_bridge import extension_bridge

logger = logging.getLogger(__name__)


async def _get_config(key: str, default: str) -> str:
    try:
        async with async_session_factory() as session:
            cfg = await session.get(SystemConfig, key)
            return cfg.value if cfg else default
    except Exception:
        return default


class BaseScraper(ABC):
    """所有平台采集器的基类，封装通用的任务生命周期管理"""

    PLATFORM: str = ""

    def __init__(self):
        self._running_tasks: dict[int, bool] = {}

    async def _get_delay(self, key: str, default_min: float, default_max: float) -> tuple[float, float]:
        """从系统配置获取延迟范围"""
        val = await _get_config(key, f"{default_min}-{default_max}")
        try:
            parts = val.split("-")
            return float(parts[0]), float(parts[1]) if len(parts) > 1 else float(parts[0])
        except (ValueError, IndexError):
            return default_min, default_max

    async def run_task(self, task_id: int) -> None:
        """执行一个采集任务（通用流程）"""
        if not extension_bridge.connected:
            await self._fail_task(task_id, "Chrome 扩展未连接，请安装并启用 FindJobs 助手扩展")
            return

        if not boss_browser.logged_in:
            await self._fail_task(task_id, "未登录，请先完成登录")
            return

        if task_id in self._running_tasks:
            logger.warning("[%s] 任务 %d 已在运行中", self.PLATFORM, task_id)
            return

        self._running_tasks[task_id] = True
        try:
            async with async_session_factory() as session:
                task = await session.get(CollectionTask, task_id)
                if not task:
                    return
                task.status = "running"
                await session.commit()

            logger.info("[%s] ========== 任务 %d 开始 ==========", self.PLATFORM, task_id)
            logger.info("[%s] 关键词=%s, 城市=%s(%s), 薪资=%s, 最大页数=%d",
                        self.PLATFORM, task.keyword, task.city, task.city_code,
                        task.salary or "(不限)", task.max_pages)

            city_code = self.resolve_city_code(task.city)
            collected = 0

            # 获取配置的延迟范围
            page_delay = await self._get_delay("scrape_page_delay", 3.0, 8.0)
            detail_delay = await self._get_delay("scrape_detail_delay", 1.0, 3.0)
            logger.info("[%s] 延迟配置: 页间=%.1f-%.1fs, 详情间=%.1f-%.1fs",
                        self.PLATFORM, page_delay[0], page_delay[1],
                        detail_delay[0], detail_delay[1])

            for page_num in range(1, task.max_pages + 1):
                if not self._running_tasks.get(task_id, False):
                    logger.info("[%s] 任务 %d 被取消", self.PLATFORM, task_id)
                    break

                logger.info("[%s] 任务 %d: ── 采集第 %d/%d 页 ──", self.PLATFORM, task_id, page_num, task.max_pages)
                jobs = await self.scrape_page(task.keyword, city_code, task.salary, page_num)

                if not jobs:
                    logger.info("[%s] 任务 %d: 第 %d 页无结果，停止", self.PLATFORM, task_id, page_num)
                    break

                for i, job_data in enumerate(jobs):
                    if not self._running_tasks.get(task_id, False):
                        break
                    try:
                        logger.debug("[%s] 抓取详情 %d/%d: %s",
                                     self.PLATFORM, i + 1, len(jobs), job_data.get("url", ""))
                        detail = await self.fetch_detail(job_data.get("url", ""))
                        job_data.update(detail)
                    except Exception as e:
                        logger.warning("[%s] 抓详情失败 %s: %s", self.PLATFORM, job_data.get("url"), e)

                    saved = await self._save_job(job_data, task_id)
                    if saved:
                        collected += 1
                        logger.debug("[%s] 保存岗位: %s @ %s (total=%d)",
                                     self.PLATFORM, job_data.get("title"), job_data.get("company"), collected)
                    else:
                        logger.debug("[%s] 跳过重复: %s", self.PLATFORM, job_data.get("url", ""))

                    delay = random.uniform(*detail_delay)
                    await asyncio.sleep(delay)

                # 更新已采集数
                async with async_session_factory() as session:
                    t = await session.get(CollectionTask, task_id)
                    if t:
                        t.total_collected = collected
                        await session.commit()

                logger.info("[%s] 任务 %d: 第 %d 页完成，累计 %d 个岗位",
                            self.PLATFORM, task_id, page_num, collected)

                if page_num < task.max_pages:
                    delay = random.uniform(*page_delay)
                    logger.info("[%s] 等待 %.1fs 后翻页...", self.PLATFORM, delay)
                    await asyncio.sleep(delay)

            final_status = "completed" if self._running_tasks.get(task_id) else "cancelled"
            async with async_session_factory() as session:
                t = await session.get(CollectionTask, task_id)
                if t and t.status == "running":
                    t.status = final_status
                    t.total_collected = collected
                    await session.commit()
            logger.info("[%s] ========== 任务 %d %s: 共采集 %d 个岗位 ==========",
                        self.PLATFORM, task_id, final_status, collected)

        except Exception as e:
            logger.error("[%s] 任务 %d 异常: %s", self.PLATFORM, task_id, e, exc_info=True)
            await self._fail_task(task_id, str(e))
        finally:
            self._running_tasks.pop(task_id, None)

    async def cancel_task(self, task_id: int) -> None:
        self._running_tasks[task_id] = False

    # ── 子类必须实现 ──────────────────────────────────────────

    @abstractmethod
    async def scrape_page(self, keyword: str, city_code: str, salary: str, page: int) -> list[dict]:
        ...

    @abstractmethod
    async def fetch_detail(self, job_url: str) -> dict:
        ...

    @abstractmethod
    def resolve_city_code(self, city: str) -> str:
        ...

    @abstractmethod
    def get_city_codes(self) -> dict[str, str]:
        ...

    # ── 通用私有方法 ──────────────────────────────────────────

    async def _save_job(self, data: dict, task_id: int) -> bool:
        """保存岗位到数据库，按 URL 去重"""
        url = data.get("url", "")
        async with async_session_factory() as session:
            if url:
                existing = (await session.execute(
                    select(Job).where(Job.url == url)
                )).scalar_one_or_none()
                if existing:
                    return False

            job = Job(
                platform=self.PLATFORM,
                title=data.get("title", ""),
                company=data.get("company", ""),
                salary=data.get("salary", ""),
                city=data.get("city", ""),
                experience=data.get("experience", ""),
                education=data.get("education", ""),
                description=data.get("description", ""),
                url=url,
                hr_name=data.get("hr_name", ""),
                hr_title=data.get("hr_title", ""),
                hr_active=data.get("hr_active", ""),
                company_size=data.get("company_size", ""),
                company_industry=data.get("company_industry", ""),
                tags=data.get("tags", ""),
                task_id=task_id,
            )
            session.add(job)
            await session.commit()
            return True

    async def _fail_task(self, task_id: int, reason: str) -> None:
        async with async_session_factory() as session:
            t = await session.get(CollectionTask, task_id)
            if t:
                t.status = "failed"
                await session.commit()
        logger.error("[%s] 任务 %d 失败: %s", self.PLATFORM, task_id, reason)
