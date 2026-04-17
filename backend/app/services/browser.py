from __future__ import annotations

"""浏览器管理 — 系统 Chrome + 持久化 profile + 手动登录

核心策略 (来自 reference/security.ts 的发现):
  zhipin.com 会主动检测 stealth patches，注入 JS 反而触发拦截。
  因此:
  1. 使用系统安装的 Chrome + 真实 user profile → 最像真人
  2. 仅通过启动参数去掉 AutomationControlled
  3. 不注入任何 stealth JS
  4. 登录阶段完全手动：打开登录页 → 用户自行扫码 → 点「我已登录」
  5. 持久化 profile 保留 cookie，下次启动无需重新登录
"""

import asyncio
import logging
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Playwright

from app.services.anti_detection import LAUNCH_ARGS

logger = logging.getLogger(__name__)

BASE_URL = "https://www.zhipin.com"
LOGIN_URL = f"{BASE_URL}/web/user/?ka=header-login"
DATA_DIR = Path(__file__).parent.parent.parent / "data"

# 已登录的标志选择器
SEL_NAV_FIGURE = ".nav-figure"


def _detect_system_chrome() -> Optional[str]:
    """检测系统安装的 Chrome"""
    import platform as _platform
    if _platform.system() == "Darwin":
        p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        if Path(p).exists():
            return p
    elif _platform.system() == "Linux":
        for p in ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser"]:
            if Path(p).exists():
                return p
    return None


class BossBrowser:
    """单例浏览器管理器 — 系统 Chrome + persistent profile"""

    def __init__(self):
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._logged_in: bool = False
        self._headless: bool = True

    # ── 属性 ──────────────────────────────────────────────

    @property
    def launched(self) -> bool:
        return self._context is not None

    @property
    def logged_in(self) -> bool:
        return self._logged_in

    @property
    def page(self) -> Optional[Page]:
        return self._page

    @property
    def context(self) -> Optional[BrowserContext]:
        return self._context

    # ── 启动 / 关闭 ──────────────────────────────────────

    async def launch(self, headless: bool = True) -> None:
        if self.launched:
            logger.info("浏览器已运行")
            return

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._playwright = await async_playwright().start()

        chrome_path = _detect_system_chrome()
        user_data_dir = str(DATA_DIR / "chrome_profile")
        Path(user_data_dir).mkdir(parents=True, exist_ok=True)

        ctx_kwargs = {
            "headless": headless,
            "args": LAUNCH_ARGS,
            "locale": "zh-CN",
            "timezone_id": "Asia/Shanghai",
            "viewport": None,           # 用窗口实际大小，不固定
            "ignore_https_errors": True,
            # 不设 user_agent → 让 Chrome 用自己真实的 UA
            # 不设 bypass_csp → 避免触发 CSP 检测
            # 不注入 storage_state → cookie 全靠 profile 目录
        }

        # 按优先级尝试启动
        strategies = []
        if chrome_path:
            strategies.append(("系统 Chrome", {"executable_path": chrome_path}))
        strategies.append(("channel=chrome", {"channel": "chrome"}))
        strategies.append(("Playwright Chromium", {}))

        for name, extra in strategies:
            try:
                merged = {**ctx_kwargs, **extra}
                self._context = await self._playwright.chromium.launch_persistent_context(
                    user_data_dir, **merged
                )
                self._browser = self._context.browser
                logger.info("使用 %s 启动成功", name)
                break
            except Exception as e:
                logger.warning("%s 启动失败: %s", name, e)
                self._context = None
                self._browser = None

        if self._context is None:
            raise RuntimeError("所有浏览器启动策略均失败")

        # 不注入任何 stealth JS — zhipin.com 会检测并拒绝

        pages = self._context.pages
        self._page = pages[0] if pages else await self._context.new_page()
        self._headless = headless
        logger.info("浏览器启动成功 (headless=%s)", headless)

        # 用 profile 里的 cookie 检测是否已登录
        await self._check_login_status()

    async def restart(self, headless: bool = True) -> None:
        await self.close()
        await asyncio.sleep(1)
        await self.launch(headless=headless)

    async def close(self) -> None:
        self._page = None
        if self._context:
            try:
                await self._context.close()
            except Exception:
                pass
            self._context = None
        self._browser = None
        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None
        self._logged_in = False
        logger.info("浏览器已关闭")

    # ── 登录 ──────────────────────────────────────────────

    async def open_login_page(self) -> str:
        """打开登录页面，让用户手动登录。返回当前页面 URL。"""
        if not self._page:
            raise RuntimeError("浏览器未启动")
        if self._logged_in:
            return self._page.url

        try:
            await self._page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(2)
        except Exception as e:
            logger.warning("打开登录页失败: %s", e)

        return self._page.url

    async def confirm_login(self) -> bool:
        """用户手动登录完成后调用，验证登录状态。"""
        if not self._page:
            return False

        # 先尝试访问首页看 cookie 是否生效
        try:
            await self._page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(2)
        except Exception as e:
            logger.warning("访问首页失败: %s", e)
            return False

        # 检查登录标志
        try:
            nav = self._page.locator(SEL_NAV_FIGURE)
            self._logged_in = await nav.is_visible(timeout=5000)
        except Exception:
            self._logged_in = False

        if self._logged_in:
            logger.info("登录确认成功")
        else:
            logger.warning("登录确认失败 — 未检测到已登录状态")

        return self._logged_in

    async def _check_login_status(self) -> bool:
        """启动后检查 profile 中的 cookie 是否已登录"""
        if not self._page:
            return False
        try:
            await self._page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(2)

            if self._page.url == "about:blank":
                logger.warning("首页被重定向到 about:blank")
                return False

            nav = self._page.locator(SEL_NAV_FIGURE)
            self._logged_in = await nav.is_visible(timeout=3000)
            if self._logged_in:
                logger.info("profile 中检测到已登录状态")
            return self._logged_in
        except Exception as e:
            logger.warning("登录状态检查失败: %s", e)
            return False

    # ── 状态 ──────────────────────────────────────────────

    def get_status(self) -> dict:
        return {
            "launched": self.launched,
            "logged_in": self._logged_in,
            "headless": self._headless,
        }


# 全局单例
boss_browser = BossBrowser()
