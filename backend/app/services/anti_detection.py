"""反检测脚本 — 隐藏 Playwright 自动化痕迹

核心策略:
1. 隐藏 webdriver / automation 标记
2. 伪造浏览器指纹 (plugins, mimeTypes, WebGL, Canvas)
3. 拦截 CDP 端口探测 (Boss直聘反爬关键)
4. 模拟真实 Chrome 环境
"""

import random
import asyncio
import logging
from typing import Optional

from playwright.async_api import Page

logger = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
]

# ─── 反检测 JS（注入到每个页面） ───────────────────────────────
STEALTH_JS = """
() => {
    // ===== 1. 隐藏 webdriver 标记 =====
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    delete navigator.__proto__.webdriver;

    // ===== 2. 伪造 plugins =====
    Object.defineProperty(navigator, 'plugins', {
        get: () => {
            const plugins = [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
            ];
            plugins.length = 3;
            return plugins;
        }
    });

    // ===== 3. 伪造 mimeTypes =====
    Object.defineProperty(navigator, 'mimeTypes', {
        get: () => {
            const mimeTypes = [
                { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
                { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' }
            ];
            mimeTypes.length = 2;
            return mimeTypes;
        }
    });

    // ===== 4. 伪造语言/平台/硬件 =====
    Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en-US', 'en']
    });
    Object.defineProperty(navigator, 'platform', {
        get: () => 'MacIntel'
    });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

    // ===== 5. 完整的 Chrome 对象 =====
    window.chrome = {
        runtime: {
            connect: function() {},
            sendMessage: function() {},
            onMessage: { addListener: function() {} },
            onConnect: { addListener: function() {} },
            id: undefined
        },
        loadTimes: function() {
            return {
                commitLoadTime: Date.now() / 1000 - Math.random() * 10,
                connectionInfo: 'h2',
                finishDocumentLoadTime: Date.now() / 1000 - Math.random() * 5,
                finishLoadTime: Date.now() / 1000 - Math.random() * 2,
                firstPaintAfterLoadTime: 0,
                firstPaintTime: Date.now() / 1000 - Math.random() * 8,
                navigationType: 'Other',
                npnNegotiatedProtocol: 'h2',
                requestTime: Date.now() / 1000 - Math.random() * 15,
                startLoadTime: Date.now() / 1000 - Math.random() * 12,
                wasAlternateProtocolAvailable: false,
                wasFetchedViaSpdy: true,
                wasNpnNegotiated: true
            };
        },
        csi: function() {
            return {
                onloadT: Date.now(),
                pageT: Date.now() - Math.random() * 10000,
                startE: Date.now() - Math.random() * 15000,
                tran: 15
            };
        },
        app: {
            isInstalled: false,
            InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
        }
    };

    // ===== 6. 拦截 CDP 端口探测（Boss直聘反爬关键） =====
    // Boss直聘 JS 会尝试连接 ws://127.0.0.1:9222 等端口来检测自动化
    const _OrigWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        // 拦截对本地调试端口的探测
        if (typeof url === 'string' && /127\\.0\\.0\\.1|localhost/.test(url)) {
            const blockedPorts = ['9222', '9229', '9230', '18789', '12222'];
            for (const port of blockedPorts) {
                if (url.includes(':' + port)) {
                    // 返回一个永远不会连接的假 WebSocket
                    const fakeWs = {
                        readyState: 3, // CLOSED
                        send: function() {},
                        close: function() {},
                        addEventListener: function(type, cb) {
                            if (type === 'error') setTimeout(cb, 0);
                        },
                        removeEventListener: function() {},
                        onopen: null, onclose: null, onerror: null, onmessage: null,
                        url: url, protocol: '', extensions: '',
                        bufferedAmount: 0, binaryType: 'blob',
                        CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3
                    };
                    return fakeWs;
                }
            }
        }
        if (protocols) {
            return new _OrigWebSocket(url, protocols);
        }
        return new _OrigWebSocket(url);
    };
    window.WebSocket.prototype = _OrigWebSocket.prototype;
    window.WebSocket.CONNECTING = 0;
    window.WebSocket.OPEN = 1;
    window.WebSocket.CLOSING = 2;
    window.WebSocket.CLOSED = 3;

    // ===== 7. 权限查询覆盖 =====
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters)
    );

    // ===== 8. 移除 Playwright/Puppeteer 痕迹 =====
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    delete window.__playwright;
    delete window.__pw_manual;

    // ===== 9. WebGL 渲染信息伪造 =====
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
        // UNMASKED_VENDOR_WEBGL
        if (parameter === 37445) return 'Intel Inc.';
        // UNMASKED_RENDERER_WEBGL
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.call(this, parameter);
    };

    // ===== 10. Canvas 指纹噪点 =====
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
        if (type === 'image/png' && this.width <= 300 && this.height <= 50) {
            try {
                const context = this.getContext('2d');
                if (context) {
                    const imageData = context.getImageData(0, 0, this.width, this.height);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        imageData.data[i] += Math.random() * 0.1;
                    }
                    context.putImageData(imageData, 0, 0);
                }
            } catch(e) {}
        }
        return originalToDataURL.apply(this, arguments);
    };

    // ===== 11. 隐藏 console 中的 webdriver 调试信息 =====
    const originalConsoleDebug = console.debug;
    console.debug = function() {
        if (arguments[0] && typeof arguments[0] === 'string' &&
            arguments[0].includes('webdriver')) {
            return;
        }
        return originalConsoleDebug.apply(this, arguments);
    };
}
"""


def get_random_user_agent() -> str:
    return random.choice(USER_AGENTS)


# ─── 浏览器启动参数 ─────────────────────────────────────────
LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-infobars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking",
    "--disable-features=TranslateUI,AutomationControlled,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion,HeavyAdPrivacyMitigations,PrivacySandboxSettings4,AutofillServerCommunication",
    "--disable-ipc-flooding-protection",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-component-update",
    "--disable-hang-monitor",
    "--disable-prompt-on-repost",
    "--disable-sync",
    "--disable-domain-reliability",
    "--metrics-recording-only",
    "--no-pings",
]


# ─── 人类行为模拟 ─────────────────────────────────────────
async def simulate_mouse_movement(page: Page) -> None:
    """随机移动鼠标"""
    x = random.randint(100, 800)
    y = random.randint(100, 600)
    await page.mouse.move(x, y)
    await asyncio.sleep(random.uniform(0.1, 0.3))


async def simulate_scroll(page: Page) -> None:
    """随机滚动页面"""
    distance = random.randint(100, 500)
    direction = random.choice([1, -1])
    await page.evaluate(f'window.scrollBy(0, {distance * direction})')
    await asyncio.sleep(random.uniform(0.5, 1.5))


async def check_for_captcha(page: Page) -> bool:
    """检查页面是否出现验证码"""
    selectors = ['.geetest_', '.nc_', '.captcha', '#captcha', '[class*="verify"]', '[id*="verify"]']
    for sel in selectors:
        el = await page.query_selector(sel)
        if el:
            return True
    return False


async def check_account_limit(page: Page) -> Optional[str]:
    """检查是否被限制，返回限制原因"""
    content = await page.content()
    keywords = ['账号异常', '操作频繁', '暂时无法使用', '请稍后再试', '账号被限制', '系统繁忙']
    for kw in keywords:
        if kw in content:
            return kw
    return None
