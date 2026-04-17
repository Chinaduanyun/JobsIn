from __future__ import annotations

"""浏览器管理 — subprocess 启动真实 Chrome + CDP 连接

核心策略:
  Playwright 的 launch / launch_persistent_context 会给 Chrome 注入自动化标记，
  即使加了 --disable-blink-features=AutomationControlled 也会被 zhipin.com 检测到。

  解决方案: 用 subprocess 启动真实的 Chrome 进程，然后通过 CDP 连接。
  这样 Chrome 是完全原生启动的进程，Playwright 只是通过调试协议操作页面。

  登录阶段完全手动: 打开登录页 → 用户自行扫码 → 点「我已登录」。
  持久化 profile 保留 cookie，下次启动无需重新登录。
"""

import asyncio
import logging
import socket
import subprocess
import signal
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Playwright

logger = logging.getLogger(__name__)

BASE_URL = "https://www.zhipin.com"
LOGIN_URL = f"{BASE_URL}/web/user/?ka=header-login"
DATA_DIR = Path(__file__).parent.parent.parent / "data"

SEL_NAV_FIGURE = ".nav-figure"


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _detect_system_chrome() -> Optional[str]:
    import platform as _platform
    if _platform.system() == "Darwin":
        p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        if Path(p).exists():
            return p
    elif _platform.system() == "Linux":
        for p in ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"]:
            if Path(p).exists():
                return p
    return None


class BossBrowser:
    """单例浏览器管理器 — subprocess Chrome + CDP connect"""

    def __init__(self):
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._chrome_proc: Optional[subprocess.Popen] = None
        self._debug_port: int = 0
        self._logged_in: bool = False
        self._headless: bool = True

    @property
    def launched(self) -> bool:
        return self._browser is not None and self._browser.is_connected()

    @property
    def logged_in(self) -> bool:
        return self._logged_in

    @property
    def page(self) -> Optional[Page]:
        return self._page

    @property
    def context(self) -> Optional[BrowserContext]:
        return self._context

    async def launch(self, headless: bool = True) -> None:
        if self.launched:
            logger.info("浏览器已运行")
            return

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        user_data_dir = str(DATA_DIR / "chrome_profile")
        Path(user_data_dir).mkdir(parents=True, exist_ok=True)

        chrome_path = _detect_system_chrome()
        if not chrome_path:
            raise RuntimeError("未找到系统 Chrome，请安装 Google Chrome")

        self._debug_port = _find_free_port()

        # 用 subprocess 启动真实 Chrome — 不经过 Playwright
        chrome_args = [
            chrome_path,
            f"--remote-debugging-port={self._debug_port}",
            f"--user-data-dir={user_data_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ]
        if headless:
            chrome_args.append("--headless=new")

        logger.info("用 subprocess 启动 Chrome: port=%d, headless=%s", self._debug_port, headless)
        self._chrome_proc = subprocess.Popen(
            chrome_args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # 等待 Chrome 调试端口就绪
        for i in range(30):
            await asyncio.sleep(0.5)
            try:
                with socket.create_connection(("127.0.0.1", self._debug_port), timeout=1):
                    break
            except (ConnectionRefusedError, OSError):
                if i == 29:
                    self._kill_chrome()
                    raise RuntimeError("Chrome 调试端口启动超时")

        # 通过 CDP 连接已运行的 Chrome
        self._playwright = await async_playwright().start()
        try:
            self._browser = await self._playwright.chromium.connect_over_cdp(
                f"http://127.0.0.1:{self._debug_port}"
            )
        except Exception as e:
            self._kill_chrome()
            if self._playwright:
                await self._playwright.stop()
                self._playwright = None
            raise RuntimeError(f"CDP 连接失败: {e}")

        # 获取默认 context 和 page
        contexts = self._browser.contexts
        self._context = contexts[0] if contexts else await self._browser.new_context()
        pages = self._context.pages
        self._page = pages[0] if pages else await self._context.new_page()
        self._headless = headless
        logger.info("Chrome 启动并连接成功 (headless=%s, port=%d)", headless, self._debug_port)

        await self._check_login_status()

    async def restart(self, headless: bool = True) -> None:
        await self.close()
        await asyncio.sleep(1)
        await self.launch(headless=headless)

    async def close(self) -> None:
        self._page = None
        self._context = None
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None
        self._kill_chrome()
        self._logged_in = False
        logger.info("浏览器已关闭")

    def _kill_chrome(self) -> None:
        if self._chrome_proc and self._chrome_proc.poll() is None:
            try:
                self._chrome_proc.send_signal(signal.SIGTERM)
                self._chrome_proc.wait(timeout=5)
            except Exception:
                try:
                    self._chrome_proc.kill()
                except Exception:
                    pass
            self._chrome_proc = None

    # ── 登录 ──────────────────────────────────────────────

    async def open_login_page(self) -> str:
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
        if not self._page:
            return False

        try:
            await self._page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(2)
        except Exception as e:
            logger.warning("访问首页失败: %s", e)
            return False

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

    def get_status(self) -> dict:
        return {
            "launched": self.launched,
            "logged_in": self._logged_in,
            "headless": self._headless,
        }


# 全局单例
boss_browser = BossBrowser()
