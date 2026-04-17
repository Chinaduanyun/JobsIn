"""测试 2: subprocess Chrome + 延迟 CDP 连接

验证: Chrome 先以纯模式打开 zhipin.com，等页面完全加载后，
     再用 --remote-debugging-port 重启并连接 CDP。

目的: 看看 zhipin 是在页面加载时检测 CDP，还是持续检测。

运行: source .venv/bin/activate && python tests/test2_cdp_delayed.py
"""

import asyncio
import socket
import subprocess
import signal
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "backend" / "data"
USER_DATA_DIR = str(DATA_DIR / "chrome_profile_test2")

CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if not Path(CHROME_PATH).exists():
    print("❌ 未找到 Chrome")
    sys.exit(1)

Path(USER_DATA_DIR).mkdir(parents=True, exist_ok=True)

BASE_URL = "https://www.zhipin.com"


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def main():
    print("=" * 60)
    print("测试 2: CDP 延迟连接")
    print("=" * 60)

    # Phase 1: 先用带 CDP 端口的 Chrome 打开一个空白页
    port = find_free_port()
    print(f"\n阶段 1: 启动 Chrome (port={port})")

    proc = subprocess.Popen([
        CHROME_PATH,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={USER_DATA_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # 等待端口就绪
    for i in range(30):
        await asyncio.sleep(0.5)
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                break
        except (ConnectionRefusedError, OSError):
            if i == 29:
                print("❌ 端口超时")
                proc.kill()
                return

    print("  Chrome 已启动，端口就绪")

    # Phase 2: 连接 CDP
    print("\n阶段 2: 连接 CDP...")
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()
    try:
        browser = await pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        print("  CDP 连接成功")

        # Phase 3: 导航到 zhipin
        print(f"\n阶段 3: 导航到 {BASE_URL}...")
        await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15000)
        await asyncio.sleep(3)

        current_url = page.url
        print(f"  当前 URL: {current_url}")

        if "zhipin.com" in current_url and current_url != "about:blank":
            print("  ✅ 页面正常！CDP 连接没被检测到")
        else:
            print("  ❌ 页面被重定向，CDP 被检测到了")

        # 保持 10 秒观察
        print("\n保持 10 秒观察页面是否会后续跳转...")
        for i in range(10):
            await asyncio.sleep(1)
            new_url = page.url
            if new_url != current_url:
                print(f"  ⚠️ {i+1}秒后 URL 变化: {new_url}")
                current_url = new_url

        print(f"\n最终 URL: {page.url}")
        await browser.close()
    finally:
        await pw.stop()
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except:
            proc.kill()

    print("\n测试结束。")


asyncio.run(main())
