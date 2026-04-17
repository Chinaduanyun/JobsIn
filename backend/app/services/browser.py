from __future__ import annotations

"""浏览器管理 — 仅用于登录

登录流程:
  1. 打开纯 Chrome (无 CDP) → 用户手动扫码登录
  2. 关闭 Chrome → headless CDP 导出 cookies
  3. 保存 cookies 到文件 → 标记 logged_in

采集通过 Chrome Extension 完成 (extension_bridge.py)，
不需要 CDP 连接，不会被 zhipin 检测。
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
    """Chrome 浏览器管理器 — 仅用于登录和 cookie 管理"""

    def __init__(self):
        self._chrome_proc: Optional[subprocess.Popen] = None
        self._logged_in: bool = False
        self._cookies: list[dict] = []
        self._mode: str = "idle"  # idle / login

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
