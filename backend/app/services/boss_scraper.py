from __future__ import annotations

"""Boss直聘岗位采集服务 — HTML 解析模式

从搜索页 HTML 中提取 __INITIAL_STATE__ 数据，绕过 JSON API 的 __zp_stoken__ 验证。
"""

import asyncio
import json
import logging
import random
import re
from typing import Optional
from urllib.parse import quote

import httpx

from app.services.base_scraper import BaseScraper
from app.services.browser import boss_browser

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
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        }

    async def scrape_page(self, keyword: str, city_code: str, salary: str, page: int) -> list[dict]:
        if not boss_browser.cookies:
            logger.warning("Boss: 没有可用的 cookies")
            return []

        # 构造搜索页 URL
        search_url = f"{BASE_URL}/web/geek/job?query={quote(keyword)}&city={city_code}&page={page}"
        if salary:
            search_url += f"&salary={salary}"

        headers = self._build_headers()

        logger.info("[Boss] 请求搜索页: keyword=%s, city=%s, page=%d", keyword, city_code, page)
        logger.debug("[Boss] URL: %s", search_url)

        try:
            async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=20) as client:
                resp = await client.get(search_url)

            logger.debug("[Boss] 搜索页状态: %d, 长度: %d bytes", resp.status_code, len(resp.content))

            if resp.status_code != 200:
                logger.warning("[Boss] 搜索页返回 %d", resp.status_code)
                return []

            html = resp.text

            # 从 HTML 中提取 __INITIAL_STATE__
            state_match = re.search(
                r'__INITIAL_STATE__\s*=\s*(\{.+?\})\s*;?\s*(?:</script>|$)',
                html, re.DOTALL
            )
            if not state_match:
                # 检查是否被安全页拦截
                if "security-check" in html or "security.html" in html:
                    logger.error("[Boss] 被安全检查页面拦截")
                else:
                    logger.warning("[Boss] 未找到 __INITIAL_STATE__，HTML 前500字符: %s",
                                   html[:500].replace('\n', ' '))
                return []

            try:
                state = json.loads(state_match.group(1))
            except json.JSONDecodeError as e:
                logger.error("[Boss] 解析 __INITIAL_STATE__ JSON 失败: %s", e)
                # 尝试修复常见的 JS → JSON 问题 (undefined → null)
                raw = state_match.group(1)
                raw = re.sub(r'\bundefined\b', 'null', raw)
                try:
                    state = json.loads(raw)
                except json.JSONDecodeError:
                    logger.error("[Boss] 修复后仍然无法解析 JSON")
                    return []

            # 提取 jobList — 尝试多种路径
            job_list = (
                state.get("zpData", {}).get("jobList", [])
                or state.get("searchResult", {}).get("jobList", [])
                or state.get("jobList", [])
            )

            # 也可能在 zpData.result.jobList
            if not job_list:
                zp = state.get("zpData", {})
                if isinstance(zp, dict):
                    for key in ["result", "data", "searchResult"]:
                        sub = zp.get(key, {})
                        if isinstance(sub, dict) and "jobList" in sub:
                            job_list = sub["jobList"]
                            break

            if not job_list:
                logger.warning("[Boss] __INITIAL_STATE__ 中未找到 jobList, 顶层 keys: %s",
                               list(state.keys())[:10])
                # 记录更多细节以便调试
                for k, v in state.items():
                    if isinstance(v, dict):
                        logger.debug("[Boss]   state[%s] keys: %s", k, list(v.keys())[:10])
                return []

            logger.info("[Boss] 第 %d 页从 HTML 提取到 %d 个岗位", page, len(job_list))

            result = []
            for idx, j in enumerate(job_list):
                enc_id = j.get("encryptJobId", "")
                job_url = f"{BASE_URL}/job_detail/{enc_id}.html" if enc_id else ""

                # 地区信息
                area_parts = []
                if j.get("cityName"):
                    area_parts.append(j["cityName"])
                if j.get("areaDistrict"):
                    area_parts.append(j["areaDistrict"])
                if j.get("businessDistrict"):
                    area_parts.append(j["businessDistrict"])
                location = " · ".join(area_parts) if area_parts else ""

                job_data = {
                    "title": j.get("jobName", ""),
                    "salary": j.get("salaryDesc", ""),
                    "company": j.get("brandName", ""),
                    "city": location,
                    "experience": j.get("jobExperience", ""),
                    "education": j.get("jobDegree", ""),
                    "url": job_url,
                    "hr_name": j.get("bossName", ""),
                    "hr_title": j.get("bossTitle", ""),
                    "hr_active": "在线" if j.get("bossOnline") else (j.get("lastModifyTime", "")),
                    "company_size": j.get("brandScaleName", ""),
                    "company_industry": j.get("brandIndustry", ""),
                    "tags": ",".join(j.get("skills", [])),
                    "description": j.get("jobLabels", []),
                    "_encrypt_id": enc_id,
                }

                if isinstance(job_data["description"], list):
                    job_data["description"] = ", ".join(str(x) for x in job_data["description"])

                logger.debug("[Boss] 岗位 %d: %s @ %s | %s | %s",
                             idx + 1, job_data["title"], job_data["company"],
                             job_data["salary"], job_data["city"])

                result.append(job_data)

            logger.info("[Boss] 第 %d 页解析到 %d 个有效岗位", page, len(result))
            return result

        except Exception as e:
            logger.error("[Boss] 搜索页请求失败: %s", e, exc_info=True)
            return []

    async def fetch_detail(self, job_url: str) -> dict:
        """从详情页 HTML 获取岗位描述。"""
        if not job_url or not boss_browser.cookies:
            return {}

        headers = self._build_headers()
        # 详情页需要更像浏览器的 Accept header
        headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"

        logger.debug("[Boss] 请求详情页: %s", job_url)

        try:
            async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=15) as client:
                resp = await client.get(job_url)

            if resp.status_code != 200:
                logger.warning("[Boss] 详情页返回 %d: %s", resp.status_code, job_url)
                return {}

            text = resp.text
            result = {}

            # 提取职位描述
            desc_match = re.search(
                r'<div\s+class="job-sec-text">(.*?)</div>',
                text, re.DOTALL
            )
            if not desc_match:
                desc_match = re.search(
                    r'<div\s+class="job-detail-section">(.*?)</div>',
                    text, re.DOTALL
                )
            if desc_match:
                raw = desc_match.group(1)
                result["description"] = re.sub(r'<[^>]+>', '\n', raw).strip()
                logger.debug("[Boss] 详情提取到描述: %d 字符", len(result["description"]))
            else:
                # 尝试从 __INITIAL_STATE__ JSON 中提取
                state_match = re.search(
                    r'__INITIAL_STATE__\s*=\s*(\{.*?\});?\s*</script>',
                    text, re.DOTALL
                )
                if state_match:
                    try:
                        state = json.loads(state_match.group(1))
                        jd = state.get("jobDetail", {}).get("postDescription", "")
                        if jd:
                            result["description"] = jd
                            logger.debug("[Boss] 从 INITIAL_STATE 提取描述: %d 字符", len(jd))
                    except (json.JSONDecodeError, KeyError):
                        pass

            if not result.get("description"):
                logger.debug("[Boss] 未能提取详情描述: %s", job_url)

            # 提取标签
            tag_matches = re.findall(r'<li class="tag-item">(.*?)</li>', text)
            if tag_matches:
                result["tags"] = ",".join(t.strip() for t in tag_matches)

            # 提取公司信息
            size_match = re.search(r'<li\s+class="(?:company-size|sider-company)">(.*?)</li>', text)
            if size_match:
                result["company_size"] = re.sub(r'<[^>]+>', '', size_match.group(1)).strip()

            industry_match = re.search(r'<li\s+class="(?:company-industry)">(.*?)</li>', text)
            if industry_match:
                result["company_industry"] = re.sub(r'<[^>]+>', '', industry_match.group(1)).strip()

            return result

        except Exception as e:
            logger.warning("[Boss] 详情请求失败 %s: %s", job_url, e)
            return {}


boss_scraper = BossScraper()
