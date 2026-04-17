from __future__ import annotations

"""前程无忧(51job)岗位采集服务"""

import asyncio
import logging
import random

from app.services.base_scraper import BaseScraper
from app.services.browser import boss_browser

logger = logging.getLogger(__name__)

SEARCH_URL = "https://we.51job.com/api/job/search-pc"

CITY_CODES = {
    "全国": "000000", "北京": "010000", "上海": "020000", "广州": "030200",
    "深圳": "040000", "杭州": "080200", "成都": "090200", "南京": "070200",
    "武汉": "180200", "西安": "200200", "苏州": "070300", "长沙": "190200",
    "郑州": "170200", "东莞": "030800", "佛山": "030600", "合肥": "150200",
    "厦门": "110300", "珠海": "030500", "重庆": "060000", "天津": "050000",
    "青岛": "120300", "大连": "230200", "宁波": "080300", "无锡": "070400",
    "济南": "120200", "福州": "110200",
}


class Job51Scraper(BaseScraper):
    """前程无忧采集器"""

    PLATFORM = "job51"

    def resolve_city_code(self, city: str) -> str:
        if city in CITY_CODES:
            return CITY_CODES[city]
        return CITY_CODES.get("全国", "000000")

    def get_city_codes(self) -> dict[str, str]:
        return CITY_CODES

    async def scrape_page(self, keyword: str, city_code: str, salary: str, page: int) -> list[dict]:
        page_obj = boss_browser.page
        if not page_obj:
            return []

        url = f"https://we.51job.com/pc/search?keyword={keyword}&searchType=2&sortType=0&metro=&jobArea={city_code}&pageNum={page}"
        await page_obj.goto(url, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(random.uniform(2, 4))

        try:
            await page_obj.wait_for_selector(
                ".joblist .j_joblist, .joblist-item, .job-card-item",
                timeout=10000,
            )
        except Exception:
            logger.warning("51job列表页加载超时")
            return []

        jobs = await page_obj.evaluate("""
            () => {
                const cards = document.querySelectorAll(
                    '.j_joblist .e, .joblist-item, .job-card-item'
                );
                return Array.from(cards).map(card => {
                    const linkEl = card.querySelector('a[href*="job.51job.com"], a.el, a[href*="/job/"]');
                    const titleEl = card.querySelector('.jname .el, .job-name, .title');
                    const salaryEl = card.querySelector('.sal, .salary, .job-salary');
                    const companyEl = card.querySelector('.cname a, .company-name a, .company-name');
                    const areaEl = card.querySelector('.d_at, .area, .job-area');
                    const expEl = card.querySelector('.d_exp, .experience');
                    const eduEl = card.querySelector('.d_edu, .education');

                    return {
                        title: titleEl ? titleEl.textContent.trim() : '',
                        salary: salaryEl ? salaryEl.textContent.trim() : '',
                        company: companyEl ? companyEl.textContent.trim() : '',
                        city: areaEl ? areaEl.textContent.trim().split('|')[0].trim() : '',
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
        logger.info("51job 第 %d 页解析到 %d 个岗位", page, len(result))
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
                    '.job_msg, .job-detail .des, .bmsg'
                );
                const tagsEls = document.querySelectorAll('.t1 span, .job-tags .tag, .job-keyword span');
                const sizeEl = document.querySelector('.com_tag .i_flag, .company-size');
                const indEl = document.querySelector('.com_tag .at, .company-industry');

                return {
                    description: descEl ? descEl.innerText.trim() : '',
                    tags: Array.from(tagsEls).map(el => el.textContent.trim()).join(','),
                    company_size: sizeEl ? sizeEl.textContent.trim() : '',
                    company_industry: indEl ? indEl.textContent.trim() : '',
                };
            }
        """)
        return detail


job51_scraper = Job51Scraper()
