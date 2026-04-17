from __future__ import annotations

"""Boss直聘岗位采集服务 — 纯 HTTP 模式

使用 httpx + cookies 调用 Boss 直聘搜索 API。
不使用浏览器自动化，zhipin 无法检测。
"""

import asyncio
import logging
import random
from typing import Optional

import httpx

from app.services.base_scraper import BaseScraper
from app.services.browser import boss_browser

logger = logging.getLogger(__name__)

SEARCH_API = "https://www.zhipin.com/wapi/zpgeek/search/joblist.json"
DETAIL_API = "https://www.zhipin.com/wapi/zpgeek/job/card.json"
BASE_URL = "https://www.zhipin.com"

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

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


class BossScraper(BaseScraper):
    """Boss直聘 HTTP 采集器"""

    PLATFORM = "boss"

    def resolve_city_code(self, city: str) -> str:
        if city in CITY_CODES:
            return CITY_CODES[city]
        if city.isdigit() and len(city) == 9:
            return city
        return CITY_CODES["全国"]

    def get_city_codes(self) -> dict[str, str]:
        return CITY_CODES

    def _build_headers(self) -> dict:
        return {
            "Cookie": boss_browser.cookie_header,
            "User-Agent": UA,
            "Referer": f"{BASE_URL}/",
            "Accept": "application/json, text/plain, */*",
        }

    async def scrape_page(self, keyword: str, city_code: str, salary: str, page: int) -> list[dict]:
        if not boss_browser.cookies:
            logger.warning("Boss: 没有可用的 cookies")
            return []

        params = {
            "scene": "1",
            "query": keyword,
            "city": city_code,
            "page": str(page),
            "pageSize": "15",
        }
        if salary:
            params["salary"] = salary

        headers = self._build_headers()

        try:
            async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=15) as client:
                resp = await client.get(SEARCH_API, params=params)

            if resp.status_code != 200:
                logger.warning("Boss API 返回 %d", resp.status_code)
                return []

            data = resp.json()
            if data.get("code") != 0:
                logger.warning("Boss API 错误: code=%s, msg=%s", data.get("code"), data.get("message"))
                return []

            job_list = data.get("zpData", {}).get("jobList", [])
            result = []
            for j in job_list:
                enc_id = j.get("encryptJobId", "")
                job_url = f"{BASE_URL}/job_detail/{enc_id}.html" if enc_id else ""

                result.append({
                    "title": j.get("jobName", ""),
                    "salary": j.get("salaryDesc", ""),
                    "company": j.get("brandName", ""),
                    "city": j.get("cityName", ""),
                    "experience": j.get("jobExperience", ""),
                    "education": j.get("jobDegree", ""),
                    "url": job_url,
                    "hr_name": j.get("bossName", ""),
                    "hr_title": j.get("bossTitle", ""),
                    "hr_active": j.get("bossOnline", ""),
                    "company_size": j.get("brandScaleName", ""),
                    "company_industry": j.get("brandIndustry", ""),
                    "tags": ",".join(j.get("skills", [])),
                    # 保存 encryptJobId 用于详情请求
                    "_encrypt_id": enc_id,
                })

            logger.info("Boss 第 %d 页获取到 %d 个岗位 (API)", page, len(result))
            return result

        except Exception as e:
            logger.error("Boss API 请求失败: %s", e)
            return []

    async def fetch_detail(self, job_url: str) -> dict:
        """从 API 获取岗位详情。Boss 搜索 API 已返回大部分字段，
        如果需要 description 可以请求详情页 HTML 并解析。"""
        if not job_url or not boss_browser.cookies:
            return {}

        headers = self._build_headers()

        try:
            async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=15) as client:
                resp = await client.get(job_url)

            if resp.status_code != 200:
                return {}

            # 从 HTML 中提取 job description
            text = resp.text
            desc = ""
            tags = ""

            # 简单的 HTML 解析提取描述文本
            import re
            desc_match = re.search(
                r'<div class="job-sec-text">(.*?)</div>',
                text, re.DOTALL
            )
            if desc_match:
                raw = desc_match.group(1)
                desc = re.sub(r'<[^>]+>', '\n', raw).strip()

            tag_matches = re.findall(r'<li class="tag-item">(.*?)</li>', text)
            if tag_matches:
                tags = ",".join(t.strip() for t in tag_matches)

            return {
                "description": desc,
                "tags": tags if tags else "",
            }

        except Exception as e:
            logger.warning("Boss 详情请求失败 %s: %s", job_url, e)
            return {}


boss_scraper = BossScraper()
