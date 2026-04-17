from __future__ import annotations

"""Boss直聘岗位采集服务 — Chrome CDP DOM 提取模式

使用真实 Chrome + CDP 连接，从渲染后的 DOM 提取岗位数据。
不注入 stealth（tandem-browser 方案：zhipin 检测 stealth 注入）。
"""

import asyncio
import json
import logging
import random
import re
from typing import Optional
from urllib.parse import quote

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


class BossScraper(BaseScraper):
    """Boss直聘 Chrome CDP 采集器"""

    PLATFORM = "boss"

    def resolve_city_code(self, city: str) -> str:
        if city in CITY_CODES:
            return CITY_CODES[city]
        if city.isdigit() and len(city) == 9:
            return city
        return CITY_CODES["全国"]

    def get_city_codes(self) -> dict[str, str]:
        return CITY_CODES

    async def _ensure_browser(self) -> bool:
        """确保 Chrome CDP 浏览器已启动"""
        if boss_browser.mode == "scrape" and boss_browser.page:
            return True
        logger.info("[Boss] 启动 Chrome CDP 采集浏览器...")
        ok = await boss_browser.launch_scraper()
        if not ok:
            logger.error("[Boss] 无法启动采集浏览器")
        return ok

    async def scrape_page(self, keyword: str, city_code: str, salary: str, page: int) -> list[dict]:
        if not boss_browser.logged_in:
            logger.warning("Boss: 未登录")
            return []

        if not await self._ensure_browser():
            return []

        # 构造搜索 URL
        search_url = f"{BASE_URL}/web/geek/job?query={quote(keyword)}&city={city_code}&page={page}"
        if salary:
            search_url += f"&salary={salary}"

        logger.info("[Boss] 导航到搜索页: keyword=%s, city=%s, page=%d", keyword, city_code, page)
        logger.debug("[Boss] URL: %s", search_url)

        # 导航并等待岗位卡片加载
        ok = await boss_browser.navigate(
            search_url,
            wait_selector=".job-card-wrapper, .job-list-box, .search-job-result",
            timeout=20000,
        )

        if not ok:
            if boss_browser.security_check:
                logger.error("[Boss] 遇到安全验证，请在浏览器中完成验证后重试")
            return []

        # 等待页面充分渲染
        await asyncio.sleep(random.uniform(1.5, 3.0))

        # 从 DOM 提取岗位数据
        try:
            jobs_data = await boss_browser.evaluate("""
                (() => {
                    const cards = document.querySelectorAll('.job-card-wrapper, .job-card-box');
                    if (!cards.length) return [];

                    return Array.from(cards).map(card => {
                        const nameEl = card.querySelector('.job-name, .job-title');
                        const areaEl = card.querySelector('.job-area, .job-area-wrapper');
                        const salaryEl = card.querySelector('.salary');
                        const companyEl = card.querySelector('.company-name a, .company-name');
                        const expEl = card.querySelector('.tag-list li:first-child, .job-info .tag-list li:first-child');
                        const eduEl = card.querySelector('.tag-list li:nth-child(2), .job-info .tag-list li:nth-child(2)');
                        const hrNameEl = card.querySelector('.info-public em, .boss-name');
                        const hrTitleEl = card.querySelector('.info-public .name, .boss-title');
                        const hrOnlineEl = card.querySelector('.boss-online-tag');
                        const companySizeEl = card.querySelector('.company-tag-list li:last-child');
                        const companyIndustryEl = card.querySelector('.company-tag-list li:first-child');
                        const linkEl = card.querySelector('a[href*="job_detail"]');
                        const skillEls = card.querySelectorAll('.tag-list li, .job-card-footer .tag-list li');

                        // 提取技能标签 (排除经验和学历)
                        const skills = [];
                        skillEls.forEach((el, i) => {
                            if (i >= 2) skills.push(el.textContent.trim());
                        });

                        return {
                            title: nameEl ? nameEl.textContent.trim() : '',
                            city: areaEl ? areaEl.textContent.trim() : '',
                            salary: salaryEl ? salaryEl.textContent.trim() : '',
                            company: companyEl ? companyEl.textContent.trim() : '',
                            experience: expEl ? expEl.textContent.trim() : '',
                            education: eduEl ? eduEl.textContent.trim() : '',
                            hr_name: hrNameEl ? hrNameEl.textContent.trim() : '',
                            hr_title: hrTitleEl ? hrTitleEl.textContent.trim() : '',
                            hr_active: hrOnlineEl ? '在线' : '',
                            company_size: companySizeEl ? companySizeEl.textContent.trim() : '',
                            company_industry: companyIndustryEl ? companyIndustryEl.textContent.trim() : '',
                            url: linkEl ? linkEl.href : '',
                            tags: skills.join(','),
                        };
                    });
                })()
            """)
        except Exception as e:
            logger.error("[Boss] DOM 提取失败: %s", e)
            return []

        if not jobs_data:
            # 检查页面状态
            current_url = boss_browser.page.url if boss_browser.page else ""
            logger.warning("[Boss] 未提取到岗位卡片, 当前 URL: %s", current_url)

            # 尝试检查是否有 "没有找到相关职位" 提示
            try:
                empty = await boss_browser.evaluate("""
                    document.querySelector('.job-empty-wrapper, .empty-tips') ? true : false
                """)
                if empty:
                    logger.info("[Boss] 页面显示无更多结果")
            except Exception:
                pass
            return []

        logger.info("[Boss] 第 %d 页从 DOM 提取到 %d 个岗位", page, len(jobs_data))

        result = []
        for idx, j in enumerate(jobs_data):
            if not j.get("title"):
                continue

            # 提取 encrypt_id from URL
            enc_id = ""
            if j.get("url"):
                m = re.search(r'/job_detail/([^.]+)\.html', j["url"])
                if m:
                    enc_id = m.group(1)

            job_data = {
                "title": j.get("title", ""),
                "salary": j.get("salary", ""),
                "company": j.get("company", ""),
                "city": j.get("city", ""),
                "experience": j.get("experience", ""),
                "education": j.get("education", ""),
                "url": j.get("url", ""),
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

            result.append(job_data)

        logger.info("[Boss] 第 %d 页解析到 %d 个有效岗位", page, len(result))
        return result

    async def fetch_detail(self, job_url: str) -> dict:
        """从详情页 DOM 获取岗位描述。"""
        if not job_url or not boss_browser.page:
            return {}

        logger.debug("[Boss] 导航到详情页: %s", job_url)

        ok = await boss_browser.navigate(
            job_url,
            wait_selector=".job-sec-text, .job-detail-section",
            timeout=15000,
        )

        if not ok:
            if boss_browser.security_check:
                logger.warning("[Boss] 详情页遇到安全验证")
            return {}

        await asyncio.sleep(random.uniform(0.5, 1.5))

        try:
            detail = await boss_browser.evaluate("""
                (() => {
                    const descEl = document.querySelector('.job-sec-text, .job-detail-section');
                    const tagEls = document.querySelectorAll('.job-tags .tag-item, .job-keyword-list li');
                    const sizeEl = document.querySelector('.sider-company p:last-child, .company-info-size');
                    const industryEl = document.querySelector('.sider-company p:first-child, .company-info-industry');

                    return {
                        description: descEl ? descEl.innerText.trim() : '',
                        tags: Array.from(tagEls).map(el => el.textContent.trim()).join(','),
                        company_size: sizeEl ? sizeEl.textContent.trim() : '',
                        company_industry: industryEl ? industryEl.textContent.trim() : '',
                    };
                })()
            """)

            if detail.get("description"):
                logger.debug("[Boss] 详情提取到描述: %d 字符", len(detail["description"]))

            return {k: v for k, v in detail.items() if v}

        except Exception as e:
            logger.warning("[Boss] 详情提取失败 %s: %s", job_url, e)
            return {}


boss_scraper = BossScraper()
