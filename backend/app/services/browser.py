from __future__ import annotations

"""浏览器管理 — 双模式: 登录用纯 Chrome，采集用 CDP 连接

核心策略:
  zhipin.com 会检测 CDP (Chrome DevTools Protocol) 连接。
  只要 Playwright 通过 CDP 连接了 Chrome，页面就会被检测到并跳白屏。

  因此分两阶段:
  1. 登录阶段: subprocess 启动纯 Chrome（无 --remote-debugging-port），
     就像用户手动双击 Chrome 一样，完全不可被检测。
     用户在这个纯 Chrome 里登录，cookies 保存在 user-data-dir 中。
  2. 采集阶段: 关闭纯 Chrome → 重新启动带 CDP 端口的 Chrome →
     Playwright connect_over_cdp → 用 cookies 直接采集。
     （采集页面的反检测没有登录页那么严格）
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
USER_DATA_DIR = str(DATA_DIR / "chrome_profile")

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
        for p in ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
                   "/usr/bin/chromium-browser", "/usr/bin/chromium"]:
            if Path(p).exists():
                return p
    return None


class BossBrowser:
    """双模式浏览器管理器

    login 模式: 纯 Chrome subprocess（无 CDP），用于手动登录
    scrape 模式: Chrome subprocess + CDP，用于自动化采集
    """

    def __init__(self):
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._chrome_proc: Optional[subprocess.Popen] = None
        self._debug_port: int = 0
        self._logged_in: bool = False
        self._headless: bool = False
        self._mode: str = "idle"  # idle / login / scrape

    @property
    def launched(self) -> bool:
        if self._mode == "login":
            return self._chrome_proc is not None and self._chrome_proc.poll() is None
        if self._mode == "scrape":
            return self._browser is not None and self._browser.is_connected()
        return False

    @property
    def logged_in(self) -> bool:
        return self._logged_in

    @property
    def page(self) -> Optional[Page]:
        return self._page

    @property
    def context(self) -> Optional[BrowserContext]:
        return self._context

    @property
    def mode(self) -> str:
        return self._mode

    # ── 登录模式: 纯 Chrome，无 CDP ───────────────────────

    async def open_login_page(self) -> str:
        """启动纯 Chrome 并打开登录页。无 CDP 连接，zhipin 无法检测。"""
        # 先关闭任何已有的浏览器
        await self.close()

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        Path(USER_DATA_DIR).mkdir(parents=True, exist_ok=True)

        chrome_path = _detect_system_chrome()
        if not chrome_path:
            raise RuntimeError("未找到系统 Chrome，请安装 Google Chrome")

        # 纯 Chrome — 没有 --remote-debugging-port
        chrome_args = [
            chrome_path,
            f"--user-data-dir={USER_DATA_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            LOGIN_URL,
        ]

        logger.info("启动纯 Chrome 用于登录 (无 CDP)")
        self._chrome_proc = subprocess.Popen(
            chrome_args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._mode = "login"
        self._headless = False
        return LOGIN_URL

    async def confirm_login(self) -> bool:
        """用户手动登录后调用。关闭纯 Chrome，用 CDP 短暂连接验证 cookies。"""
        # 关闭登录用的纯 Chrome
        self._kill_chrome()
        await asyncio.sleep(1)

        # 短暂启动带 CDP 的 Chrome 来验证登录状态
        verified = await self._verify_login_with_cdp()

        if verified:
            self._logged_in = True
            self._mode = "idle"
            logger.info("登录验证成功")
        else:
            self._logged_in = False
            self._mode = "idle"
            logger.warning("登录验证失败")

        return verified

    async def _verify_login_with_cdp(self) -> bool:
        """临时启动 CDP Chrome 检查登录状态，验证完立即关闭。"""
        chrome_path = _detect_system_chrome()
        if not chrome_path:
            return False

        port = _find_free_port()
        proc = subprocess.Popen(
            [chrome_path,
             f"--remote-debugging-port={port}",
             f"--user-data-dir={USER_DATA_DIR}",
             "--headless=new",
             "--no-first-run",
             "--no-default-browser-check"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        try:
            # 等待端口就绪
            for i in range(20):
                await asyncio.sleep(0.5)
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=1):
                        break
                except (ConnectionRefusedError, OSError):
                    if i == 19:
                        return False

            pw = await async_playwright().start()
            try:
                browser = await pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
                ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
                page = ctx.pages[0] if ctx.pages else await ctx.new_page()

                # 访问首页检查登录标志
                await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(2)

                nav = page.locator(SEL_NAV_FIGURE)
                logged_in = await nav.is_visible(timeout=5000)

                await browser.close()
                return logged_in
            finally:
                await pw.stop()
        finally:
            try:
                proc.send_signal(signal.SIGTERM)
                proc.wait(timeout=5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass

    # ── 采集模式: Chrome + CDP ────────────────────────────

    async def launch(self, headless: bool = True) -> None:
        """启动带 CDP 的 Chrome，用于采集任务。"""
        if self._mode == "scrape" and self.launched:
            logger.info("采集浏览器已运行")
            return

        # 关闭任何已有的浏览器
        await self.close()

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        Path(USER_DATA_DIR).mkdir(parents=True, exist_ok=True)

        chrome_path = _detect_system_chrome()
        if not chrome_path:
            raise RuntimeError("未找到系统 Chrome，请安装 Google Chrome")

        self._debug_port = _find_free_port()
        chrome_args = [
            chrome_path,
            f"--remote-debugging-port={self._debug_port}",
            f"--user-data-dir={USER_DATA_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ]
        if headless:
            chrome_args.append("--headless=new")

        logger.info("启动采集浏览器: port=%d, headless=%s", self._debug_port, headless)
        self._chrome_proc = subprocess.Popen(
            chrome_args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        for i in range(30):
            await asyncio.sleep(0.5)
            try:
                with socket.create_connection(("127.0.0.1", self._debug_port), timeout=1):
                    break
            except (ConnectionRefusedError, OSError):
                if i == 29:
                    self._kill_chrome()
                    raise RuntimeError("Chrome 调试端口启动超时")

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

        contexts = self._browser.contexts
        self._context = contexts[0] if contexts else await self._browser.new_context()
        pages = self._context.pages
        self._page = pages[0] if pages else await self._context.new_page()
        self._headless = headless
        self._mode = "scrape"
        logger.info("采集浏览器启动成功 (headless=%s, port=%d)", headless, self._debug_port)

        # 用 profile 里的 cookie 检测登录状态
        await self._check_login_status()

    async def restart(self, headless: bool = True) -> None:
        await self.close()
        await asyncio.sleep(1)
        await self.launch(headless=headless)

    async def _check_login_status(self) -> bool:
        if not self._page:
            return False
        try:
            await self._page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(2)

            current_url = self._page.url
            if current_url == "about:blank" or "security" in current_url:
                logger.warning("首页被重定向: %s", current_url)
                return False

            nav = self._page.locator(SEL_NAV_FIGURE)
            self._logged_in = await nav.is_visible(timeout=3000)
            if self._logged_in:
                logger.info("profile 中检测到已登录状态")
            return self._logged_in
        except Exception as e:
            logger.warning("登录状态检查失败: %s", e)
            return False

    # ── 关闭 / 清理 ──────────────────────────────────────

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
        self._mode = "idle"
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

    # ── 状态 ──────────────────────────────────────────────

    def get_status(self) -> dict:
        return {
            "launched": self.launched,
            "logged_in": self._logged_in,
            "headless": self._headless,
            "mode": self._mode,
        }


# 全局单例
boss_browser = BossBrowser()
