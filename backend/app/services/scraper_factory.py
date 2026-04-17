from __future__ import annotations

"""多平台采集器工厂"""

from app.services.base_scraper import BaseScraper
from app.services.boss_scraper import boss_scraper
from app.services.zhaopin_scraper import zhaopin_scraper
from app.services.job51_scraper import job51_scraper
from app.services.liepin_scraper import liepin_scraper

_SCRAPERS: dict[str, BaseScraper] = {
    "boss": boss_scraper,
    "zhaopin": zhaopin_scraper,
    "job51": job51_scraper,
    "liepin": liepin_scraper,
}

PLATFORM_NAMES = {
    "boss": "Boss直聘",
    "zhaopin": "智联招聘",
    "job51": "前程无忧",
    "liepin": "猎聘",
}


def get_scraper(platform: str) -> BaseScraper:
    scraper = _SCRAPERS.get(platform)
    if not scraper:
        raise ValueError(f"不支持的平台: {platform}")
    return scraper


def list_platforms() -> list[dict]:
    return [{"key": k, "name": v} for k, v in PLATFORM_NAMES.items()]
