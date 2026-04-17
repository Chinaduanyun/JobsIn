from __future__ import annotations

"""浏览器管理 — 真实 Chrome + CDP

核心策略 (tandem-browser 方案验证):
  1. zhipin 检测 stealth 注入 → 不注入任何 stealth
  2. 使用真实 Chrome + 用户 profile → 保持登录态
  3. CDP 连接用于导航和 DOM 提取 → 不修改浏览器行为
  4. 遇到安全验证 → 暂停并通知用户

模式:
  login — 纯 Chrome (无 CDP)，用户手动扫码登录
  scrape — Chrome + CDP，自动导航 + DOM 提取
  idle — 浏览器未运行
"""

import asyncio
import json
import logging
import socket
import subprocess
import signal
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

BASE_URL = "https://www.zhipin.com"
LOGIN_URL = f"{BASE_URL}/web/user/?ka=header-login"
DATA_DIR = Path(__file__).parent.parent.parent / "data"
USER_DATA_DIR = str(DATA_DIR / "chrome_profile")
COOKIES_FILE = DATA_DIR / "cookies.json"


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
    """真实 Chrome 浏览器管理器

    login 模式: 纯 Chrome subprocess (无 CDP) — 用于手动登录
    scrape 模式: Chrome + CDP — 用于自动采集 (不注入 stealth)
    """

    def __init__(self):
        self._chrome_proc: Optional[subprocess.Popen] = None
        self._logged_in: bool = False
        self._cookies: list[dict] = []
        self._mode: str = "idle"  # idle / login / scrape
        self._cdp_port: int = 0
        self._pw = None  # playwright instance
        self._browser = None  # playwright browser
        self._page = None  # playwright page
        self._security_check: bool = False  # 是否遇到安全验证

        self._load_cookies_from_file()

    @property
    def launched(self) -> bool:
        return self._chrome_proc is not None and self._chrome_proc.poll() is None

    @property
    def logged_in(self) -> bool:
        return self._logged_in

    @property
    def cookies(self) -> list[dict]:
        return self._cookies

    @property
    def cookie_header(self) -> str:
        return "; ".join(f"{c['name']}={c['value']}" for c in self._cookies)

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def page(self):
        """返回当前 Playwright page（用于采集）"""
        return self._page

    @property
    def security_check(self) -> bool:
        return self._security_check

    # ── 登录: 纯 Chrome (无 CDP) ────────────────────────

    async def open_login_page(self) -> str:
        await self.close()

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        Path(USER_DATA_DIR).mkdir(parents=True, exist_ok=True)

        chrome_path = _detect_system_chrome()
        if not chrome_path:
            raise RuntimeError("未找到系统 Chrome，请安装 Google Chrome")

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
        return LOGIN_URL

    async def confirm_login(self) -> bool:
        self._kill_chrome()
        await asyncio.sleep(1)

        cookies, logged_in = await self._export_cookies_headless()

        if logged_in and cookies:
            self._cookies = cookies
            self._logged_in = True
            self._save_cookies_to_file()
            logger.info("登录确认成功，导出 %d 个 cookies", len(cookies))
        else:
            self._logged_in = False
            logger.warning("登录验证失败")

        self._mode = "idle"
        return self._logged_in

    # ── 采集模式: Chrome + CDP ────────────────────────────

    async def launch_scraper(self) -> bool:
        """启动带 CDP 的 Chrome 用于采集。不注入 stealth。"""
        if self._mode == "scrape" and self.launched and self._page:
            return True

        await self.close()

        chrome_path = _detect_system_chrome()
        if not chrome_path:
            raise RuntimeError("未找到系统 Chrome")

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        Path(USER_DATA_DIR).mkdir(parents=True, exist_ok=True)

        self._cdp_port = _find_free_port()
        chrome_args = [
            chrome_path,
            f"--remote-debugging-port={self._cdp_port}",
            f"--user-data-dir={USER_DATA_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-background-networking",
            "about:blank",
        ]

        logger.info("启动 Chrome + CDP (port=%d) 用于采集", self._cdp_port)
        self._chrome_proc = subprocess.Popen(
            chrome_args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # 等待 CDP 端口就绪
        for i in range(30):
            await asyncio.sleep(0.5)
            try:
                with socket.create_connection(("127.0.0.1", self._cdp_port), timeout=1):
                    break
            except (ConnectionRefusedError, OSError):
                if i == 29:
                    logger.error("Chrome CDP 端口超时")
                    self._kill_chrome()
                    return False

        # 连接 Playwright
        try:
            from playwright.async_api import async_playwright
            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.connect_over_cdp(
                f"http://127.0.0.1:{self._cdp_port}"
            )

            # 使用已有 context（保持登录态）
            if self._browser.contexts:
                ctx = self._browser.contexts[0]
                pages = ctx.pages
                self._page = pages[0] if pages else await ctx.new_page()
            else:
                ctx = await self._browser.new_context()
                self._page = await ctx.new_page()

            self._mode = "scrape"
            self._security_check = False

            # 导出最新 cookies
            all_cookies = await ctx.cookies()
            self._cookies = [c for c in all_cookies if "zhipin" in c.get("domain", "")]
            if self._cookies:
                self._logged_in = True
                self._save_cookies_to_file()

            logger.info("Chrome CDP 连接成功，cookies: %d", len(self._cookies))
            return True

        except Exception as e:
            logger.error("Playwright CDP 连接失败: %s", e)
            await self._disconnect_playwright()
            self._kill_chrome()
            return False

    async def navigate(self, url: str, wait_selector: str = None, timeout: int = 15000) -> bool:
        """导航到指定 URL，等待页面加载。返回是否成功（非安全检查页）。"""
        if not self._page:
            return False

        self._security_check = False

        try:
            resp = await self._page.goto(url, wait_until="domcontentloaded", timeout=timeout)
            current_url = self._page.url

            # 检测安全验证页
            if "verify.html" in current_url or "security.html" in current_url:
                self._security_check = True
                logger.warning("[Browser] 遇到安全验证页: %s", current_url)
                return False

            # 检测是否被重定向到登录页
            if "web/user" in current_url and "login" in current_url.lower():
                logger.warning("[Browser] 被重定向到登录页")
                return False

            # 等待特定元素
            if wait_selector:
                try:
                    await self._page.wait_for_selector(wait_selector, timeout=10000)
                except Exception:
                    logger.debug("[Browser] 等待 selector '%s' 超时", wait_selector)

            return True

        except Exception as e:
            logger.error("[Browser] 导航失败: %s", e)
            return False

    async def get_page_content(self) -> str:
        """获取当前页面的 HTML"""
        if not self._page:
            return ""
        return await self._page.content()

    async def evaluate(self, expression: str):
        """在页面中执行 JS 并返回结果"""
        if not self._page:
            return None
        return await self._page.evaluate(expression)

    # ── Cookie 管理 ────────────────────────────────────

    async def _export_cookies_headless(self) -> tuple[list[dict], bool]:
        """短暂启动 headless CDP Chrome 导出 cookies。"""
        chrome_path = _detect_system_chrome()
        if not chrome_path:
            return [], False

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

        cookies = []
        logged_in = False

        try:
            for i in range(20):
                await asyncio.sleep(0.5)
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=1):
                        break
                except (ConnectionRefusedError, OSError):
                    if i == 19:
                        return [], False

            from playwright.async_api import async_playwright
            pw = await async_playwright().start()
            try:
                browser = await pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
                ctx = browser.contexts[0] if browser.contexts else await browser.new_context()

                all_cookies = await ctx.cookies()
                cookies = [c for c in all_cookies if "zhipin" in c.get("domain", "")]

                cookie_names = {c["name"] for c in cookies}
                logged_in = bool(cookie_names & {"wt2", "zp_at", "token"})

                logger.info("导出 %d 个 zhipin cookies, 登录: %s", len(cookies), logged_in)
                await browser.close()
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

        return cookies, logged_in

    def _save_cookies_to_file(self) -> None:
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            COOKIES_FILE.write_text(json.dumps(self._cookies, ensure_ascii=False, indent=2))
            logger.info("Cookies 已保存到 %s", COOKIES_FILE)
        except Exception as e:
            logger.warning("保存 cookies 失败: %s", e)

    def _load_cookies_from_file(self) -> None:
        if COOKIES_FILE.exists():
            try:
                self._cookies = json.loads(COOKIES_FILE.read_text())
                if self._cookies:
                    self._logged_in = True
                    logger.info("从文件加载了 %d 个 cookies", len(self._cookies))
            except Exception as e:
                logger.warning("加载 cookies 失败: %s", e)

    async def refresh_cookies(self) -> bool:
        cookies, logged_in = await self._export_cookies_headless()
        if logged_in and cookies:
            self._cookies = cookies
            self._logged_in = True
            self._save_cookies_to_file()
            return True
        return False

    # ── 关闭 / 清理 ──────────────────────────────────────

    async def _disconnect_playwright(self) -> None:
        try:
            if self._browser:
                await self._browser.close()
        except Exception:
            pass
        try:
            if self._pw:
                await self._pw.stop()
        except Exception:
            pass
        self._browser = None
        self._pw = None
        self._page = None

    async def close(self) -> None:
        await self._disconnect_playwright()
        self._kill_chrome()
        self._mode = "idle"
        self._security_check = False
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
            "headless": False,
            "mode": self._mode,
            "cookies_count": len(self._cookies),
            "security_check": self._security_check,
        }


# 全局单例
boss_browser = BossBrowser()
