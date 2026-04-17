from __future__ import annotations

"""Boss直聘岗位采集服务 — Chrome Extension 模式

通过 Chrome Extension 在真实浏览器中提取岗位数据。
完全无 CDP、无 stealth — Chrome 以 100% 正常模式运行。
Extension 通过 HTTP 与后端通信，content script 从 DOM 提取数据。
"""

import logging
import re
from urllib.parse import quote

from app.services.base_scraper import BaseScraper
from app.services.extension_bridge import extension_bridge

logger = logging.getLogger(__name__)

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


class BossScraper(BaseScraper):
    """Boss直聘 Chrome Extension 采集器"""

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
        if not extension_bridge.connected:
            logger.warning("[Boss] Chrome 扩展未连接，请安装并启用 FindJobs 助手扩展")
            return []

        # 构造搜索 URL
        search_url = f"{BASE_URL}/web/geek/job?query={quote(keyword)}&city={city_code}&page={page}"
        if salary:
            search_url += f"&salary={salary}"

        logger.info("[Boss] 通过扩展导航: keyword=%s, city=%s, page=%d", keyword, city_code, page)
        logger.debug("[Boss] URL: %s", search_url)

        # 发送命令给扩展：导航并提取岗位
        result = await extension_bridge.send_command(
            "navigate_and_extract_jobs",
            url=search_url,
            timeout=35,
        )

        if not result.get("success"):
            error = result.get("error", "未知错误")
            if result.get("security_check"):
                logger.error("[Boss] 遇到安全验证，请在 Chrome 中完成验证后重试")
            else:
                logger.error("[Boss] 采集失败: %s", error)
            return []

        data = result.get("data", {})
        jobs_raw = data.get("jobs", [])

        if not jobs_raw:
            if data.get("empty"):
                logger.info("[Boss] 第 %d 页无搜索结果: %s", page, data.get("message", ""))
            else:
                logger.warning("[Boss] 第 %d 页未提取到岗位: %s", page, data.get("message", ""))
            return []

        logger.info("[Boss] 第 %d 页提取到 %d 个岗位 (卡片总数=%d)",
                    page, len(jobs_raw), data.get("total_cards", 0))

        result_list = []
        for idx, j in enumerate(jobs_raw):
            if not j.get("title"):
                continue

            enc_id = ""
            url = j.get("url", "")
            if url:
                m = re.search(r'/job_detail/([^.]+)\.html', url)
                if m:
                    enc_id = m.group(1)

            job_data = {
                "title": j.get("title", ""),
                "salary": j.get("salary", ""),
                "company": j.get("company", ""),
                "city": j.get("city", ""),
                "experience": j.get("experience", ""),
                "education": j.get("education", ""),
                "url": url,
                "hr_name": j.get("hr_name", ""),
                "hr_title": j.get("hr_title", ""),
                "hr_active": j.get("hr_active", ""),
                "company_size": j.get("company_size", ""),
                "company_industry": j.get("company_industry", ""),
                "tags": j.get("tags", ""),
                "description": "",
                "_encrypt_id": enc_id,
            }

            logger.debug("[Boss] 岗位 %d: %s @ %s | %s | %s",
                         idx + 1, job_data["title"], job_data["company"],
                         job_data["salary"], job_data["city"])

            result_list.append(job_data)

        logger.info("[Boss] 第 %d 页解析到 %d 个有效岗位", page, len(result_list))
        return result_list

    async def fetch_detail(self, job_url: str) -> dict:
        """通过扩展获取岗位详情。"""
        if not job_url:
            return {}

        if not extension_bridge.connected:
            return {}

        logger.debug("[Boss] 通过扩展获取详情: %s", job_url)

        result = await extension_bridge.send_command(
            "navigate_and_extract_detail",
            url=job_url,
            timeout=25,
        )

        if not result.get("success"):
            if result.get("security_check"):
                logger.warning("[Boss] 详情页遇到安全验证")
            else:
                logger.warning("[Boss] 详情获取失败: %s", result.get("error", ""))
            return {}

        data = result.get("data", {})
        detail = {}

        if data.get("description"):
            detail["description"] = data["description"]
            logger.debug("[Boss] 详情提取到描述: %d 字符", len(detail["description"]))

        for key in ("tags", "company_size", "company_industry"):
            if data.get(key):
                detail[key] = data[key]

        return detail


boss_scraper = BossScraper()
