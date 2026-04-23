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

    def _build_page_plan(self, task: CollectionTask) -> tuple[list[int], int]:
        scan_limit = max(task.max_pages or 1, 1)
        mode = (task.mode or "manual").lower()

        if mode != "smart":
            start_page = max(task.start_page or 1, 1)
            return list(range(start_page, start_page + scan_limit)), 0

        refresh_pages = min(max(task.refresh_pages or 0, 0), scan_limit)
        resume_from_page = max(task.resume_from_page or 1, 1)

        page_plan: list[int] = []
        seen_pages: set[int] = set()

        for page_num in range(1, refresh_pages + 1):
            if page_num not in seen_pages:
                page_plan.append(page_num)
                seen_pages.add(page_num)

        next_page = resume_from_page
        while len(page_plan) < scan_limit:
            if next_page not in seen_pages:
                page_plan.append(next_page)
                seen_pages.add(next_page)
            next_page += 1

        return page_plan, refresh_pages

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
                task.pages_scanned = 0
                task.current_phase = ""
                task.display_last_page = 0
                task.last_page_reached = 0
                await session.commit()

            city_code = self.resolve_city_code(task.city)
            collected = 0
            seen_urls_in_task: set[str] = set()
            stale_pages = 0
            refresh_stale_pages = 0
            page_plan, refresh_cutoff = self._build_page_plan(task)
            scan_limit = len(page_plan)
            mode = (task.mode or "manual").lower()

            logger.info("[%s] ========== 任务 %d 开始 ==========", self.PLATFORM, task_id)
            if mode == "smart":
                logger.info("[%s] 关键词=%s, 城市=%s(%s), 薪资=%s, 模式=smart, 回看前页=%d, 历史续采页=%d, 最多扫描页数=%d, 目标新岗位=%d, 连续空转停止页数=%d",
                            self.PLATFORM, task.keyword, task.city, task.city_code,
                            task.salary or "(不限)", refresh_cutoff, max(task.resume_from_page or 1, 1), scan_limit, task.target_new_jobs, task.stop_after_stale_pages)
            else:
                logger.info("[%s] 关键词=%s, 城市=%s(%s), 薪资=%s, 模式=manual, 起始页=%d, 最多扫描页数=%d, 目标新岗位=%d, 连续空转停止页数=%d",
                            self.PLATFORM, task.keyword, task.city, task.city_code,
                            task.salary or "(不限)", max(task.start_page or 1, 1), scan_limit, task.target_new_jobs, task.stop_after_stale_pages)

            # 获取配置的延迟范围
            page_delay = await self._get_delay("scrape_page_delay", 3.0, 8.0)
            detail_delay = await self._get_delay("scrape_detail_delay", 1.0, 3.0)
            logger.info("[%s] 延迟配置: 页间=%.1f-%.1fs, 详情间=%.1f-%.1fs",
                        self.PLATFORM, page_delay[0], page_delay[1],
                        detail_delay[0], detail_delay[1])

            cursor = 0
            while cursor < scan_limit:
                index = cursor + 1
                page_num = page_plan[cursor]

                if not self._running_tasks.get(task_id, False):
                    logger.info("[%s] 任务 %d 被取消", self.PLATFORM, task_id)
                    break

                current_phase = "refresh" if mode == "smart" and index <= refresh_cutoff else ("resume" if mode == "smart" else "manual")
                logger.info("[%s] 任务 %d: ── %s阶段扫描第 %d 页（本次第 %d/%d 页）──",
                            self.PLATFORM, task_id, current_phase, page_num, index, scan_limit)
                jobs = await self.scrape_page(task.keyword, city_code, task.salary, page_num)

                if not jobs:
                    logger.info("[%s] 任务 %d: 第 %d 页无结果，停止", self.PLATFORM, task_id, page_num)
                    break

                async with async_session_factory() as session:
                    t = await session.get(CollectionTask, task_id)
                    if t:
                        t.current_phase = current_phase
                        t.pages_scanned = index
                        t.display_last_page = page_num
                        t.last_page_reached = max(t.last_page_reached or 0, page_num)
                        await session.commit()

                existing_urls = await self._find_existing_job_urls(
                    [job.get("url", "") for job in jobs]
                )
                pending_jobs = []
                page_seen_urls = set()
                duplicate_in_page = 0
                duplicate_in_task = 0
                duplicate_in_db = 0
                missing_url = 0

                for job_data in jobs:
                    url = job_data.get("url", "")
                    if not url:
                        missing_url += 1
                        logger.debug("[%s] 列表页跳过无链接岗位: %s", self.PLATFORM, job_data.get("title", ""))
                        continue
                    if url in page_seen_urls:
                        duplicate_in_page += 1
                        logger.debug("[%s] 列表页同页重复岗位: %s", self.PLATFORM, url)
                        continue
                    if url in seen_urls_in_task:
                        duplicate_in_task += 1
                        logger.debug("[%s] 列表页跨页重复岗位: %s", self.PLATFORM, url)
                        continue
                    if url in existing_urls:
                        duplicate_in_db += 1
                        logger.debug("[%s] 列表页数据库已存在岗位: %s", self.PLATFORM, url)
                        continue

                    page_seen_urls.add(url)
                    seen_urls_in_task.add(url)
                    pending_jobs.append(job_data)

                if duplicate_in_page or duplicate_in_task or duplicate_in_db or missing_url:
                    logger.info(
                        "[%s] 任务 %d: 第 %d 页过滤后待抓详情 %d 个 (同页重复=%d, 跨页重复=%d, 库中已存在=%d, 无链接=%d)",
                        self.PLATFORM,
                        task_id,
                        page_num,
                        len(pending_jobs),
                        duplicate_in_page,
                        duplicate_in_task,
                        duplicate_in_db,
                        missing_url,
                    )

                jump_to_resume = False
                if pending_jobs:
                    stale_pages = 0
                    refresh_stale_pages = 0
                else:
                    if mode == "smart" and current_phase == "refresh":
                        refresh_stale_pages += 1
                        logger.info(
                            "[%s] 任务 %d: 第 %d 页首页探测无新增，刷新空转页数 %d/%d",
                            self.PLATFORM,
                            task_id,
                            page_num,
                            refresh_stale_pages,
                            refresh_cutoff,
                        )
                        if refresh_cutoff > 0 and refresh_stale_pages >= refresh_cutoff and cursor + 1 < scan_limit:
                            logger.info("[%s] 任务 %d: 首页连续无新增，提前切到历史续采页", self.PLATFORM, task_id)
                            jump_to_resume = True
                    else:
                        stale_pages += 1
                        logger.info(
                            "[%s] 任务 %d: 第 %d 页没有新岗位，连续空转页数 %d/%d",
                            self.PLATFORM,
                            task_id,
                            page_num,
                            stale_pages,
                            task.stop_after_stale_pages,
                        )
                        if task.stop_after_stale_pages > 0 and stale_pages >= task.stop_after_stale_pages:
                            logger.info("[%s] 任务 %d: 连续空转页达到阈值，提前结束", self.PLATFORM, task_id)
                            break

                for i, job_data in enumerate(pending_jobs):
                    if not self._running_tasks.get(task_id, False):
                        break
                    try:
                        logger.debug("[%s] 抓取详情 %d/%d: %s",
                                     self.PLATFORM, i + 1, len(pending_jobs), job_data.get("url", ""))
                        detail = await self.fetch_detail(job_data.get("url", ""))
                        # 如果列表页薪资有乱码（包含私用区字符或问号），用详情页的
                        list_salary = job_data.get("salary", "")
                        detail_salary = detail.pop("salary", "")
                        if detail_salary and (not list_salary or '?' in list_salary or not any(c.isdigit() for c in list_salary)):
                            job_data["salary"] = detail_salary
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

                async with async_session_factory() as session:
                    t = await session.get(CollectionTask, task_id)
                    if t:
                        t.total_collected = collected
                        await session.commit()

                logger.info("[%s] 任务 %d: 第 %d 页完成，累计 %d 个岗位",
                            self.PLATFORM, task_id, page_num, collected)

                if task.target_new_jobs > 0 and collected >= task.target_new_jobs:
                    logger.info("[%s] 任务 %d: 已达到目标新岗位数 %d，提前结束", self.PLATFORM, task_id, task.target_new_jobs)
                    break

                if jump_to_resume:
                    cursor = max(refresh_cutoff, cursor + 1)
                    continue

                cursor += 1
                if cursor < scan_limit:
                    delay = random.uniform(*page_delay)
                    logger.info("[%s] 等待 %.1fs 后翻页...", self.PLATFORM, delay)
                    await asyncio.sleep(delay)

            final_status = "completed" if self._running_tasks.get(task_id) else "cancelled"
            async with async_session_factory() as session:
                t = await session.get(CollectionTask, task_id)
                if t and t.status == "running":
                    t.status = final_status
                    t.total_collected = collected
                    t.current_phase = "done" if final_status == "completed" else t.current_phase
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

    async def _find_existing_job_urls(self, urls: list[str]) -> set[str]:
        normalized_urls = {url for url in urls if url}
        if not normalized_urls:
            return set()

        async with async_session_factory() as session:
            rows = await session.execute(
                select(Job.url).where(Job.url.in_(normalized_urls))
            )
            return {url for url in rows.scalars().all() if url}

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
