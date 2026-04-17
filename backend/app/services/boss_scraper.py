from __future__ import annotations

"""Boss直聘岗位采集服务"""

import asyncio
import logging
import random

from app.services.base_scraper import BaseScraper
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

# 常用城市编码（Boss直聘专用）
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
    return "".join(SALARY_CHAR_MAP.get(c, c) for c in text)


class BossScraper(BaseScraper):
    """Boss直聘岗位采集器"""

    PLATFORM = "boss"

    def resolve_city_code(self, city: str) -> str:
        if city in CITY_CODES:
            return CITY_CODES[city]
        if city.isdigit() and len(city) == 9:
            return city
        return CITY_CODES["全国"]

    def get_city_codes(self) -> dict[str, str]:
        return CITY_CODES

    async def scrape_page(self, keyword: str, city_code: str, salary: str, page: int) -> list[dict]:
        page_obj = boss_browser.page
        if not page_obj:
            return []

        params = f"query={keyword}&city={city_code}&page={page}"
        if salary:
            params += f"&salary={salary}"
        url = f"{SEARCH_URL}?{params}"

        await page_obj.goto(url, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(random.uniform(2, 4))

        try:
            await page_obj.wait_for_selector(".job-card-wrapper, .job-card-box", timeout=10000)
        except Exception:
            logger.warning("Boss列表页加载超时")
            return []

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
                        city, experience, education,
                        url: link ? link.getAttribute('href') : '',
                        hr_name: hrEl ? hrEl.textContent.trim() : '',
                        hr_active: activeEl ? activeEl.textContent.trim() : '',
                    };
                });
            }
        """)

        result = []
        for j in jobs:
            if not j.get("title"):
                continue
            j["salary"] = decode_salary(j.get("salary", ""))
            href = j.get("url", "")
            if href and not href.startswith("http"):
                j["url"] = f"https://www.zhipin.com{href}"
            result.append(j)

        logger.info("Boss 第 %d 页解析到 %d 个岗位", page, len(result))
        return result

    async def fetch_detail(self, job_url: str) -> dict:
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


# 全局单例
boss_scraper = BossScraper()
