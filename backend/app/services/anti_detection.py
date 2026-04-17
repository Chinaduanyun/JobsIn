"""反检测配置 — 最小化策略

核心发现 (来自 reference/security.ts):
  zhipin.com 主动检测 stealth patches 并拒绝注入了 stealth 的浏览器。
  因此对 zhipin.com 必须 **完全跳过** JS 注入。

策略:
  1. 使用系统安装的 Chrome + 真实用户 profile → 最像真人
  2. 仅通过启动参数移除 AutomationControlled 标记
  3. 不注入任何 JS stealth 脚本
  4. 用户手动完成登录，程序不触碰登录页
"""

import random
import asyncio
import logging
from typing import Optional

from playwright.async_api import Page

logger = logging.getLogger(__name__)

# ─── 浏览器启动参数（仅移除自动化标记，不做过度伪装） ──────────
LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-infobars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=TranslateUI,AutomationControlled",
]


# ─── 人类行为模拟 ─────────────────────────────────────────
async def simulate_mouse_movement(page: Page) -> None:
    x = random.randint(100, 800)
    y = random.randint(100, 600)
    await page.mouse.move(x, y)
    await asyncio.sleep(random.uniform(0.1, 0.3))


async def simulate_scroll(page: Page) -> None:
    distance = random.randint(100, 500)
    direction = random.choice([1, -1])
    await page.evaluate(f'window.scrollBy(0, {distance * direction})')
    await asyncio.sleep(random.uniform(0.5, 1.5))


async def check_for_captcha(page: Page) -> bool:
    selectors = ['.geetest_', '.nc_', '.captcha', '#captcha', '[class*="verify"]', '[id*="verify"]']
    for sel in selectors:
        el = await page.query_selector(sel)
        if el:
            return True
    return False


async def check_account_limit(page: Page) -> Optional[str]:
    content = await page.content()
    keywords = ['账号异常', '操作频繁', '暂时无法使用', '请稍后再试', '账号被限制', '系统繁忙']
    for kw in keywords:
        if kw in content:
            return kw
    return None
