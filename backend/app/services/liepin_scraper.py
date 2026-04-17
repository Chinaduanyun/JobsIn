from __future__ import annotations

"""猎聘岗位采集服务"""

import asyncio
import logging
import random

from app.services.base_scraper import BaseScraper
from app.services.browser import boss_browser

logger = logging.getLogger(__name__)

SEARCH_URL = "https://www.liepin.com/zhaopin/"

CITY_CODES = {
    "全国": "0", "北京": "010", "上海": "020", "广州": "050020",
    "深圳": "050090", "杭州": "070020", "成都": "280020", "南京": "060020",
    "武汉": "170020", "西安": "270020", "苏州": "060080", "长沙": "180020",
    "郑州": "150020", "东莞": "050060", "佛山": "050040", "合肥": "140020",
    "厦门": "090020", "珠海": "050050", "重庆": "040",    "天津": "030",
    "青岛": "250060", "大连": "210020", "宁波": "070060", "无锡": "060030",
    "济南": "250020", "福州": "090030",
}


class LiepinScraper(BaseScraper):
    """猎聘采集器"""

    PLATFORM = "liepin"

    def resolve_city_code(self, city: str) -> str:
        if city in CITY_CODES:
            return CITY_CODES[city]
        return CITY_CODES.get("全国", "0")

    def get_city_codes(self) -> dict[str, str]:
        return CITY_CODES

    async def scrape_page(self, keyword: str, city_code: str, salary: str, page: int) -> list[dict]:
        page_obj = boss_browser.page
        if not page_obj:
            return []

        # 猎聘 page 从 0 开始
        url = f"{SEARCH_URL}?city={city_code}&key={keyword}&currentPage={page - 1}"
        await page_obj.goto(url, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(random.uniform(2, 4))

        try:
            await page_obj.wait_for_selector(
                ".job-card-pc-container, .job-list-item, .job-card",
                timeout=10000,
            )
        except Exception:
            logger.warning("猎聘列表页加载超时")
            return []

        jobs = await page_obj.evaluate("""
            () => {
                const cards = document.querySelectorAll(
                    '.job-card-pc-container, .job-list-item, .job-card'
                );
                return Array.from(cards).map(card => {
                    const linkEl = card.querySelector('a[href*="/job/"], a.job-title-box');
                    const titleEl = card.querySelector('.job-title-box .ellipsis-1, .job-title, .title');
                    const salaryEl = card.querySelector('.job-salary, .salary');
                    const companyEl = card.querySelector('.company-name a, .company-name, .comp-name');
                    const cityEl = card.querySelector('.job-dq, .city, .job-area');
                    const expEl = card.querySelector('.job-labels-box .labels-tag:first-child, .experience');
                    const eduEl = card.querySelector('.job-labels-box .labels-tag:nth-child(2), .education');

                    return {
                        title: titleEl ? titleEl.textContent.trim() : '',
                        salary: salaryEl ? salaryEl.textContent.trim() : '',
                        company: companyEl ? companyEl.textContent.trim() : '',
                        city: cityEl ? cityEl.textContent.trim() : '',
                        experience: expEl ? expEl.textContent.trim() : '',
                        education: eduEl ? eduEl.textContent.trim() : '',
                        url: linkEl ? linkEl.href : '',
                        hr_name: '',
                        hr_active: '',
                    };
                });
            }
        """)

        result = [j for j in jobs if j.get("title")]
        logger.info("猎聘 第 %d 页解析到 %d 个岗位", page, len(result))
        return result

    async def fetch_detail(self, job_url: str) -> dict:
        if not job_url or not boss_browser.page:
            return {}

        page_obj = boss_browser.page
        await page_obj.goto(job_url, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(random.uniform(1, 2))

        detail = await page_obj.evaluate("""
            () => {
                const descEl = document.querySelector(
                    '.job-intro-container .content, .job-description, .job-detail-content'
                );
                const tagsEls = document.querySelectorAll('.job-tags .tag, .job-keyword .tag-item');
                const sizeEl = document.querySelector('.company-info .size, .company-size, .comp-size');
                const indEl = document.querySelector('.company-info .industry, .company-industry, .comp-industry');

                return {
                    description: descEl ? descEl.innerText.trim() : '',
                    tags: Array.from(tagsEls).map(el => el.textContent.trim()).join(','),
                    company_size: sizeEl ? sizeEl.textContent.trim() : '',
                    company_industry: indEl ? indEl.textContent.trim() : '',
                };
            }
        """)
        return detail


liepin_scraper = LiepinScraper()
