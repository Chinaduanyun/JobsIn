from __future__ import annotations

"""智联招聘岗位采集服务"""

import asyncio
import logging
import random

from app.services.base_scraper import BaseScraper
from app.services.browser import boss_browser

logger = logging.getLogger(__name__)

SEARCH_URL = "https://sou.zhaopin.com/"

CITY_CODES = {
    "全国": "0", "北京": "530", "上海": "538", "广州": "763",
    "深圳": "765", "杭州": "653", "成都": "801", "南京": "635",
    "武汉": "736", "西安": "854", "苏州": "639", "长沙": "749",
    "郑州": "719", "东莞": "769", "佛山": "766", "合肥": "664",
    "厦门": "682", "珠海": "773", "重庆": "551", "天津": "531",
    "青岛": "702", "大连": "600", "宁波": "654", "无锡": "636",
    "济南": "703", "福州": "681",
}


class ZhaopinScraper(BaseScraper):
    """智联招聘采集器"""

    PLATFORM = "zhaopin"

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

        url = f"{SEARCH_URL}?jl={city_code}&kw={keyword}&p={page}"
        await page_obj.goto(url, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(random.uniform(2, 4))

        try:
            await page_obj.wait_for_selector(
                ".positionlist .joblist-box__item, .joblist-box__item, .jobcard",
                timeout=10000,
            )
        except Exception:
            logger.warning("智联列表页加载超时")
            return []

        jobs = await page_obj.evaluate("""
            () => {
                const cards = document.querySelectorAll(
                    '.joblist-box__item, .positionlist .joblist-box__item, .jobcard'
                );
                return Array.from(cards).map(card => {
                    const linkEl = card.querySelector('a[href*="/job/"]') || card.querySelector('a');
                    const titleEl = card.querySelector('.iteminfo__line1__jobname, .jobinfo__name, .job-name');
                    const salaryEl = card.querySelector('.iteminfo__line2__jobdesc__salary, .jobinfo__salary, .salary');
                    const companyEl = card.querySelector('.iteminfo__line1__compname a, .company-name a, .company-name');
                    const cityEl = card.querySelector('.iteminfo__line2__jobdesc__city, .jobinfo__city, .job-area');
                    const expEl = card.querySelector('.iteminfo__line2__jobdesc__demand span:first-child, .jobinfo__demand span');
                    const eduEl = card.querySelector('.iteminfo__line2__jobdesc__demand span:last-child, .jobinfo__demand span:last-child');

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
        logger.info("智联 第 %d 页解析到 %d 个岗位", page, len(result))
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
                    '.describtion__detail-content, .job-detail .description, .pos-ul'
                );
                const tagsEls = document.querySelectorAll('.pos-tag .tag-item, .highlights__content .highlights-tag');
                const sizeEl = document.querySelector('.company__info .company__size, .company-size');
                const indEl = document.querySelector('.company__info .company__industry, .company-industry');

                return {
                    description: descEl ? descEl.innerText.trim() : '',
                    tags: Array.from(tagsEls).map(el => el.textContent.trim()).join(','),
                    company_size: sizeEl ? sizeEl.textContent.trim() : '',
                    company_industry: indEl ? indEl.textContent.trim() : '',
                };
            }
        """)
        return detail


zhaopin_scraper = ZhaopinScraper()
