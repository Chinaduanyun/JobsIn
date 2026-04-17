from __future__ import annotations

"""多平台采集器抽象基类"""

import asyncio
import logging
import random
from abc import ABC, abstractmethod
from typing import Optional

from sqlmodel import select

from app.database import async_session as async_session_factory
from app.models import Job, CollectionTask
from app.services.browser import boss_browser

logger = logging.getLogger(__name__)


class BaseScraper(ABC):
    """所有平台采集器的基类，封装通用的任务生命周期管理"""

    PLATFORM: str = ""  # 子类必须设置: boss / zhaopin / job51 / liepin

    def __init__(self):
        self._running_tasks: dict[int, bool] = {}

    async def run_task(self, task_id: int) -> None:
        """执行一个采集任务（通用流程）"""
        if not boss_browser.logged_in or not boss_browser.cookies:
            await self._fail_task(task_id, "未登录或无可用 cookies，请先完成登录")
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

            city_code = self.resolve_city_code(task.city)
            collected = 0

            for page_num in range(1, task.max_pages + 1):
                if not self._running_tasks.get(task_id, False):
                    logger.info("[%s] 任务 %d 被取消", self.PLATFORM, task_id)
                    break

                logger.info("[%s] 任务 %d: 采集第 %d/%d 页", self.PLATFORM, task_id, page_num, task.max_pages)
                jobs = await self.scrape_page(task.keyword, city_code, task.salary, page_num)

                if not jobs:
                    logger.info("[%s] 任务 %d: 第 %d 页无结果，停止", self.PLATFORM, task_id, page_num)
                    break

                for job_data in jobs:
                    if not self._running_tasks.get(task_id, False):
                        break
                    try:
                        detail = await self.fetch_detail(job_data.get("url", ""))
                        job_data.update(detail)
                    except Exception as e:
                        logger.warning("[%s] 抓详情失败 %s: %s", self.PLATFORM, job_data.get("url"), e)

                    saved = await self._save_job(job_data, task_id)
                    if saved:
                        collected += 1

                    await asyncio.sleep(random.uniform(1, 3))

                # 更新已采集数
                async with async_session_factory() as session:
                    t = await session.get(CollectionTask, task_id)
                    if t:
                        t.total_collected = collected
                        await session.commit()

                await asyncio.sleep(random.uniform(3, 8))

            final_status = "completed" if self._running_tasks.get(task_id) else "cancelled"
            async with async_session_factory() as session:
                t = await session.get(CollectionTask, task_id)
                if t and t.status == "running":
                    t.status = final_status
                    t.total_collected = collected
                    await session.commit()
            logger.info("[%s] 任务 %d 完成: %s, 采集 %d 个岗位", self.PLATFORM, task_id, final_status, collected)

        except Exception as e:
            logger.error("[%s] 任务 %d 异常: %s", self.PLATFORM, task_id, e)
            await self._fail_task(task_id, str(e))
        finally:
            self._running_tasks.pop(task_id, None)

    async def cancel_task(self, task_id: int) -> None:
        self._running_tasks[task_id] = False

    # ── 子类必须实现 ──────────────────────────────────────────

    @abstractmethod
    async def scrape_page(self, keyword: str, city_code: str, salary: str, page: int) -> list[dict]:
        """抓取搜索结果的一页，返回 job dict 列表"""
        ...

    @abstractmethod
    async def fetch_detail(self, job_url: str) -> dict:
        """抓取岗位详情页，返回补充字段"""
        ...

    @abstractmethod
    def resolve_city_code(self, city: str) -> str:
        """城市名 → 平台城市编码"""
        ...

    @abstractmethod
    def get_city_codes(self) -> dict[str, str]:
        """返回支持的城市列表 {名称: 编码}"""
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
