from __future__ import annotations

"""浏览器管理 — 双模式: 登录用纯 Chrome，采集用 HTTP + cookies

核心策略 (经 test1-test4 验证):
  1. zhipin.com 会检测 CDP 连接 → 浏览器采集不可行
  2. 纯 Chrome (无 CDP) 可以正常访问 → 用于登录
  3. CDP headless 可以导出 cookies → 短暂连接导出后断开
  4. httpx + cookies 可以正常调用 API → 用于采集

流程:
  登录 → subprocess 纯 Chrome → 用户手动扫码
  导出 → headless CDP 短暂连接 → 导出 cookies → 断开
  采集 → httpx + cookies → 纯 HTTP 请求 API
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

    login 模式: 纯 Chrome subprocess (无 CDP) — 用于手动登录
    采集不使用浏览器 — 用 httpx + cookies
    """

    def __init__(self):
        self._chrome_proc: Optional[subprocess.Popen] = None
        self._logged_in: bool = False
        self._cookies: list[dict] = []
        self._mode: str = "idle"  # idle / login

        # 启动时尝试加载保存的 cookies
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
        """返回可直接用于 HTTP 请求的 Cookie header 字符串"""
        return "; ".join(f"{c['name']}={c['value']}" for c in self._cookies)

    @property
    def mode(self) -> str:
        return self._mode

    # ── 登录: 纯 Chrome (无 CDP) ────────────────────────

    async def open_login_page(self) -> str:
        """启动纯 Chrome 打开登录页。无 CDP 无检测。"""
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
        """关闭纯 Chrome，用 headless CDP 导出 cookies 并验证登录状态。"""
        self._kill_chrome()
        await asyncio.sleep(1)

        cookies, logged_in = await self._export_cookies_and_verify()

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

    async def _export_cookies_and_verify(self) -> tuple[list[dict], bool]:
        """短暂启动 headless CDP Chrome，导出 cookies 并验证登录状态。"""
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

                # 导出所有 cookies
                all_cookies = await ctx.cookies()
                cookies = [c for c in all_cookies if "zhipin" in c.get("domain", "")]

                # 短暂导航验证登录状态
                page = ctx.pages[0] if ctx.pages else await ctx.new_page()
                await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(2)

                nav = page.locator(SEL_NAV_FIGURE)
                logged_in = await nav.is_visible(timeout=5000)

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

    # ── Cookie 持久化 ────────────────────────────────────

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
        """重新从 Chrome profile 导出 cookies（不需要重新登录）"""
        cookies, logged_in = await self._export_cookies_and_verify()
        if logged_in and cookies:
            self._cookies = cookies
            self._logged_in = True
            self._save_cookies_to_file()
            return True
        return False

    # ── 关闭 / 清理 ──────────────────────────────────────

    async def close(self) -> None:
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
            "headless": False,
            "mode": self._mode,
            "cookies_count": len(self._cookies),
        }


# 全局单例
boss_browser = BossBrowser()
