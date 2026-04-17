from __future__ import annotations

"""Boss直聘浏览器管理 — 启动、登录、Cookie 持久化

关键反检测策略:
1. 优先使用系统 Chrome (channel="chrome")，比 Playwright 内置 Chromium 更隐蔽
2. 注入全面的反检测 JS，拦截 CDP 端口探测
3. 不使用固定 viewport，避免指纹特征
4. about:blank 重定向自动重试
"""

import asyncio
import json
import base64
import random
import logging
import shutil
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Playwright

from app.services.anti_detection import STEALTH_JS, LAUNCH_ARGS, get_random_user_agent

logger = logging.getLogger(__name__)

BASE_URL = "https://www.zhipin.com"
LOGIN_URL = f"{BASE_URL}/web/user/?ka=header-login"
AUTH_DIR = Path(__file__).parent.parent.parent / "data"
AUTH_FILE = AUTH_DIR / "auth_state.json"
COOKIES_FILE = AUTH_DIR / "cookies.json"

# 选择器
SEL_LOGIN_BTN = "#header .user-nav a"
SEL_QR_SWITCH = ".btn-sign-switch.ewm-switch"
SEL_QR_IMG = ".qr-code-box .qr-img-box img"
SEL_QR_REFRESH = ".qr-code-box .qr-img-box div > button"
SEL_WX_LOGIN = ".wx-login-btn"
SEL_WX_QR = ".mini-qrcode"
SEL_NAV_FIGURE = ".nav-figure"


def _detect_system_chrome() -> Optional[str]:
    """检测系统是否安装了 Chrome，返回路径或 None"""
    import platform
    if platform.system() == "Darwin":
        chrome_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        if Path(chrome_path).exists():
            return chrome_path
    elif platform.system() == "Linux":
        for path in ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser"]:
            if Path(path).exists():
                return path
    # Windows 用 channel="chrome" 即可，不需要路径
    return None


class BossBrowser:
    """单例浏览器管理器"""

    def __init__(self):
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._logged_in: bool = False
        self._qrcode_data: Optional[str] = None
        self._login_polling: bool = False

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

        AUTH_DIR.mkdir(parents=True, exist_ok=True)

        self._playwright = await async_playwright().start()

        # 策略: 优先用系统 Chrome，退而用 Playwright Chromium
        chrome_path = _detect_system_chrome()
        launch_kwargs = {
            "headless": headless,
            "args": LAUNCH_ARGS,
        }
        if chrome_path:
            launch_kwargs["executable_path"] = chrome_path
            logger.info("使用系统 Chrome: %s", chrome_path)
        else:
            # 尝试 channel="chrome"（Windows 下有效）
            try:
                self._browser = await self._playwright.chromium.launch(
                    channel="chrome", **launch_kwargs
                )
                logger.info("使用 channel=chrome 启动")
            except Exception:
                self._browser = None

        if self._browser is None:
            self._browser = await self._playwright.chromium.launch(**launch_kwargs)
            if not chrome_path:
                logger.info("使用 Playwright 内置 Chromium")

        context_opts: dict = {
            "user_agent": get_random_user_agent(),
            "locale": "zh-CN",
            "timezone_id": "Asia/Shanghai",
            "no_viewport": True,  # 不固定 viewport，避免指纹检测
            "bypass_csp": True,
            "ignore_https_errors": True,
        }

        # 尝试加载已有的 auth state
        if AUTH_FILE.exists():
            try:
                context_opts["storage_state"] = str(AUTH_FILE)
                logger.info("加载已有登录状态")
            except Exception:
                logger.warning("登录状态文件损坏，忽略")

        self._context = await self._browser.new_context(**context_opts)
        # 注入反检测脚本到每一个新页面
        await self._context.add_init_script(STEALTH_JS)

        self._page = await self._context.new_page()
        logger.info("浏览器启动成功 (headless=%s)", headless)

        # 检测是否已登录
        await self._check_login_status()

    async def _check_login_status(self) -> bool:
        """访问首页检查是否已登录，带 about:blank 重定向重试"""
        if not self._page:
            return False
        for attempt in range(3):
            try:
                await self._page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(2)

                # 检查是否被重定向到 about:blank
                if self._page.url == "about:blank":
                    logger.warning("检测到 about:blank 重定向 (尝试 %d/3)，等待后重试...", attempt + 1)
                    await asyncio.sleep(3 + attempt * 2)
                    continue

                nav = self._page.locator(SEL_NAV_FIGURE)
                self._logged_in = await nav.is_visible(timeout=3000)
                if self._logged_in:
                    logger.info("检测到已登录状态")
                return self._logged_in
            except Exception as e:
                logger.warning("登录状态检查失败 (尝试 %d/3): %s", attempt + 1, e)
                await asyncio.sleep(2)
        return False

    async def start_login(self) -> Optional[str]:
        """发起 QR 码登录，返回二维码图片的 base64 或 URL"""
        if not self._page:
            raise RuntimeError("浏览器未启动")
        if self._logged_in:
            return None

        # 导航到登录页
        await self._page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=15000)
        await asyncio.sleep(2)

        # 点击切换到 QR 码模式
        try:
            qr_switch = self._page.locator(SEL_QR_SWITCH)
            if await qr_switch.is_visible(timeout=3000):
                await qr_switch.click()
                await asyncio.sleep(1)
        except Exception:
            pass

        # 提取 QR 码
        self._qrcode_data = await self._extract_qrcode()
        if self._qrcode_data:
            # 启动后台轮询等待扫码
            if not self._login_polling:
                asyncio.create_task(self._poll_login_status())
            return self._qrcode_data

        # 尝试微信登录
        try:
            wx_btn = self._page.locator(SEL_WX_LOGIN)
            if await wx_btn.is_visible(timeout=2000):
                await wx_btn.click(delay=random.randint(50, 200))
                await asyncio.sleep(2)
                wx_qr = self._page.locator(SEL_WX_QR)
                if await wx_qr.is_visible(timeout=5000):
                    src = await wx_qr.get_attribute("src")
                    if src:
                        self._qrcode_data = src if src.startswith("http") else f"{BASE_URL}{src}"
                        if not self._login_polling:
                            asyncio.create_task(self._poll_login_status())
                        return self._qrcode_data
        except Exception:
            pass

        return None

    async def _extract_qrcode(self) -> Optional[str]:
        """提取页面上的二维码图片"""
        if not self._page:
            return None
        try:
            qr_img = self._page.locator(SEL_QR_IMG)
            await qr_img.wait_for(state="visible", timeout=5000)
            src = await qr_img.get_attribute("src")
            if not src:
                return None
            if src.startswith("data:"):
                return src
            if not src.startswith("http"):
                src = f"{BASE_URL}{src}"
            # 下载图片并转 base64 返回给前端
            resp = await self._page.context.request.get(src)
            body = await resp.body()
            b64 = base64.b64encode(body).decode()
            return f"data:image/png;base64,{b64}"
        except Exception as e:
            logger.warning("提取二维码失败: %s", e)
            return None

    async def _poll_login_status(self) -> None:
        """后台轮询检测登录状态"""
        self._login_polling = True
        try:
            for _ in range(120):  # 最多等 2 分钟
                await asyncio.sleep(1)
                if not self._page or not self.launched:
                    break
                try:
                    # 检查是否跳转离开了登录页
                    url = self._page.url
                    if "web/user" not in url and "zhipin.com" in url:
                        self._logged_in = True
                        await self._save_auth()
                        logger.info("扫码登录成功（页面跳转）")
                        break
                    # 检查头像是否出现
                    nav = self._page.locator(SEL_NAV_FIGURE)
                    if await nav.is_visible(timeout=500):
                        self._logged_in = True
                        await self._save_auth()
                        logger.info("扫码登录成功（头像可见）")
                        break
                except Exception:
                    continue
        finally:
            self._login_polling = False

    async def refresh_qrcode(self) -> Optional[str]:
        """刷新过期的二维码"""
        if not self._page:
            return None
        try:
            refresh_btn = self._page.locator(SEL_QR_REFRESH)
            if await refresh_btn.is_visible(timeout=2000):
                await refresh_btn.click()
                await asyncio.sleep(2)
            self._qrcode_data = await self._extract_qrcode()
            return self._qrcode_data
        except Exception:
            return None

    async def _save_auth(self) -> None:
        """保存登录状态"""
        if not self._context:
            return
        try:
            AUTH_DIR.mkdir(parents=True, exist_ok=True)
            await self._context.storage_state(path=str(AUTH_FILE))
            logger.info("登录状态已保存: %s", AUTH_FILE)
        except Exception as e:
            logger.warning("保存登录状态失败: %s", e)

    def get_status(self) -> dict:
        return {
            "launched": self.launched,
            "logged_in": self._logged_in,
            "has_qrcode": self._qrcode_data is not None,
            "polling_login": self._login_polling,
        }

    def get_qrcode(self) -> Optional[str]:
        return self._qrcode_data

    async def close(self) -> None:
        """关闭浏览器，释放资源"""
        if self._logged_in and self._context:
            await self._save_auth()
        if self._page:
            try:
                await self._page.close()
            except Exception:
                pass
            self._page = None
        if self._context:
            try:
                await self._context.close()
            except Exception:
                pass
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
        self._logged_in = False
        self._qrcode_data = None
        self._login_polling = False
        logger.info("浏览器已关闭")


# 全局单例
boss_browser = BossBrowser()
