"""Boss直聘岗位采集服务"""

import asyncio
import json
import logging
import random
from typing import Optional

from sqlmodel import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session as async_session_factory
from app.models import Job, CollectionTask
from app.services.browser import boss_browser

logger = logging.getLogger(__name__)

SEARCH_URL = "https://www.zhipin.com/web/geek/job"

# 薪资字体加密映射
SALARY_CHAR_MAP = {
    chr(0xE031): "0", chr(0xE032): "1", chr(0xE033): "2",
    chr(0xE034): "3", chr(0xE035): "4", chr(0xE036): "5",
    chr(0xE037): "6", chr(0xE038): "7", chr(0xE039): "8",
    chr(0xE03A): "9",
}

# 常用城市编码
CITY_CODES = {
    "全国": "100010000",
    "北京": "101010100", "上海": "101020100", "广州": "101280100",
    "深圳": "101280600", "杭州": "101210100", "成都": "101270100",
    "南京": "101190100", "武汉": "101200100", "西安": "101110100",
    "苏州": "101190400", "长沙": "101250100", "郑州": "101180100",
    "东莞": "101281600", "佛山": "101280800", "合肥": "101220100",
    "厦门": "101230200", "珠海": "101280700", "重庆": "101040100",
    "天津": "101030100", "青岛": "101120200", "大连": "101070200",
    "宁波": "101210400", "无锡": "101190200", "济南": "101120100",
    "福州": "101230100",
}


def decode_salary(text: str) -> str:
    """解码 Boss 直聘加密的薪资字符"""
    return "".join(SALARY_CHAR_MAP.get(c, c) for c in text)


def resolve_city_code(city: str) -> str:
    """城市名 → 编码，找不到就返回全国"""
    if city in CITY_CODES:
        return CITY_CODES[city]
    # 可能用户直接传了编码
    if city.isdigit() and len(city) == 9:
        return city
    return CITY_CODES["全国"]


class BossScraper:
    """Boss直聘岗位采集器"""

    def __init__(self):
        self._running_tasks: dict[int, bool] = {}  # task_id -> is_running

    async def run_task(self, task_id: int) -> None:
        """执行一个采集任务"""
        if not boss_browser.launched or not boss_browser.logged_in:
            await self._fail_task(task_id, "浏览器未启动或未登录")
            return

        if task_id in self._running_tasks:
            logger.warning("任务 %d 已在运行中", task_id)
            return

        self._running_tasks[task_id] = True
        try:
            async with async_session_factory() as session:
                task = await session.get(CollectionTask, task_id)
                if not task:
                    return
                task.status = "running"
                await session.commit()

            city_code = resolve_city_code(task.city)
            collected = 0

            for page_num in range(1, task.max_pages + 1):
                if not self._running_tasks.get(task_id, False):
                    logger.info("任务 %d 被取消", task_id)
                    break

                logger.info("任务 %d: 采集第 %d/%d 页", task_id, page_num, task.max_pages)
                jobs = await self._scrape_page(task.keyword, city_code, task.salary, page_num)

                if not jobs:
                    logger.info("任务 %d: 第 %d 页无结果，停止", task_id, page_num)
                    break

                # 逐个抓详情并入库
                for job_data in jobs:
                    if not self._running_tasks.get(task_id, False):
                        break
                    try:
                        detail = await self._fetch_detail(job_data.get("url", ""))
                        job_data.update(detail)
                    except Exception as e:
                        logger.warning("抓详情失败 %s: %s", job_data.get("url"), e)

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

            # 完成 — 仅在任务仍为 running 时更新，避免覆盖已取消的状态
            final_status = "completed" if self._running_tasks.get(task_id) else "cancelled"
            async with async_session_factory() as session:
                t = await session.get(CollectionTask, task_id)
                if t and t.status == "running":
                    t.status = final_status
                    t.total_collected = collected
                    await session.commit()
            logger.info("任务 %d 完成: %s, 采集 %d 个岗位", task_id, final_status, collected)

        except Exception as e:
            logger.error("任务 %d 异常: %s", task_id, e)
            await self._fail_task(task_id, str(e))
        finally:
            self._running_tasks.pop(task_id, None)

    async def cancel_task(self, task_id: int) -> None:
        """标记任务为取消"""
        self._running_tasks[task_id] = False

    async def _scrape_page(self, keyword: str, city_code: str, salary: str, page: int) -> list[dict]:
        """抓取搜索结果的一页"""
        page_obj = boss_browser.page
        if not page_obj:
            return []

        params = f"query={keyword}&city={city_code}&page={page}"
        if salary:
            params += f"&salary={salary}"
        url = f"{SEARCH_URL}?{params}"

        await page_obj.goto(url, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(random.uniform(2, 4))

        # 等待岗位列表加载
        try:
            await page_obj.wait_for_selector(".job-card-wrapper, .job-card-box", timeout=10000)
        except Exception:
            logger.warning("列表页加载超时")
            return []

        # 用 JS 提取岗位数据
        jobs = await page_obj.evaluate("""
            () => {
                const cards = document.querySelectorAll('.job-card-wrapper, .job-card-box');
                return Array.from(cards).map(card => {
                    const link = card.querySelector('a.job-card-left, a[href*="/job_detail/"]');
                    const nameEl = card.querySelector('.job-name');
                    const salaryEl = card.querySelector('.salary');
                    const companyEl = card.querySelector('.company-name a, .company-name');
                    const infoItems = card.querySelectorAll('.job-info .tag-list li, .job-info span');
                    const hrEl = card.querySelector('.info-public em');
                    const activeEl = card.querySelector('.boss-online-tag, .boss-active-time');

                    let city = '', experience = '', education = '';
                    const infos = Array.from(infoItems).map(el => el.textContent.trim());
                    if (infos.length >= 1) city = infos[0];
                    if (infos.length >= 2) experience = infos[1];
                    if (infos.length >= 3) education = infos[2];

                    return {
                        title: nameEl ? nameEl.textContent.trim() : '',
                        salary: salaryEl ? salaryEl.textContent.trim() : '',
                        company: companyEl ? companyEl.textContent.trim() : '',
                        city: city,
                        experience: experience,
                        education: education,
                        url: link ? link.getAttribute('href') : '',
                        hr_name: hrEl ? hrEl.textContent.trim() : '',
                        hr_active: activeEl ? activeEl.textContent.trim() : '',
                    };
                });
            }
        """)

        # 处理结果
        result = []
        for j in jobs:
            if not j.get("title"):
                continue
            j["salary"] = decode_salary(j.get("salary", ""))
            href = j.get("url", "")
            if href and not href.startswith("http"):
                j["url"] = f"https://www.zhipin.com{href}"
            result.append(j)

        logger.info("第 %d 页解析到 %d 个岗位", page, len(result))
        return result

    async def _fetch_detail(self, job_url: str) -> dict:
        """抓取岗位详情页"""
        if not job_url or not boss_browser.page:
            return {}

        page_obj = boss_browser.page
        await page_obj.goto(job_url, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(random.uniform(1, 2))

        detail = await page_obj.evaluate("""
            () => {
                const descEl = document.querySelector('.job-sec-text, .job-detail-section .text');
                const tagsEls = document.querySelectorAll('.job-tags .tag-item, .job-keyword-list li');
                const sizeEl = document.querySelector('.sider-company .company-info-size, .company-size');
                const indEl = document.querySelector('.sider-company .company-info-industry, .company-industry');

                return {
                    description: descEl ? descEl.innerText.trim() : '',
                    tags: Array.from(tagsEls).map(el => el.textContent.trim()).join(','),
                    company_size: sizeEl ? sizeEl.textContent.trim() : '',
                    company_industry: indEl ? indEl.textContent.trim() : '',
                };
            }
        """)
        return detail

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
                title=data.get("title", ""),
                company=data.get("company", ""),
                salary=data.get("salary", ""),
                city=data.get("city", ""),
                experience=data.get("experience", ""),
                education=data.get("education", ""),
                description=data.get("description", ""),
                url=url,
                hr_name=data.get("hr_name", ""),
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
        logger.error("任务 %d 失败: %s", task_id, reason)


# 全局单例
boss_scraper = BossScraper()
