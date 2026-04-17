"""测试 4: CDP 连接后导出 cookies，断开 CDP，用 httpx 采集

这是最实用的混合方案:
1. 用户在纯 Chrome 里登录（test1 验证过）
2. 短暂连接 CDP，只做一件事: 导出所有 cookies
3. 立即断开 CDP 并关闭 Chrome
4. 用导出的 cookies + httpx 做所有采集工作

优点: 采集阶段完全不需要浏览器，zhipin 无法检测

运行: source .venv/bin/activate && python tests/test4_cdp_export_cookies.py
"""

import asyncio
import socket
import subprocess
import signal
import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "backend" / "data"
# 使用 test1 的 profile（用户已在那里登录）
USER_DATA_DIR = str(DATA_DIR / "chrome_profile_test1")

CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if not Path(CHROME_PATH).exists():
    print("❌ 未找到 Chrome")
    sys.exit(1)

try:
    import httpx
except ImportError:
    print("需要 httpx: pip install httpx")
    sys.exit(1)


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def export_cookies_via_cdp() -> list:
    """短暂启动 CDP Chrome，导出 cookies，立即关闭。"""
    port = find_free_port()

    proc = subprocess.Popen([
        CHROME_PATH,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={USER_DATA_DIR}",
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        for i in range(20):
            await asyncio.sleep(0.5)
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    break
            except (ConnectionRefusedError, OSError):
                if i == 19:
                    print("❌ 端口超时")
                    return []

        from playwright.async_api import async_playwright
        pw = await async_playwright().start()
        try:
            browser = await pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            ctx = browser.contexts[0] if browser.contexts else await browser.new_context()

            # 直接导出 cookies，不导航到任何页面
            cookies = await ctx.cookies()
            zhipin_cookies = [c for c in cookies if "zhipin" in c.get("domain", "")]

            print(f"  导出了 {len(zhipin_cookies)} 个 zhipin cookies")
            for c in zhipin_cookies[:5]:
                print(f"    {c['name']} = {c['value'][:30]}... (domain={c['domain']})")
            if len(zhipin_cookies) > 5:
                print(f"    ... 还有 {len(zhipin_cookies)-5} 个")

            await browser.close()
            return zhipin_cookies
        finally:
            await pw.stop()
    finally:
        try:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=5)
        except:
            try:
                proc.kill()
            except:
                pass


def test_scrape_with_cookies(cookies: list):
    """用导出的 cookies 测试 Boss 直聘搜索 API"""
    if not cookies:
        print("\n没有 cookies，请先运行 test1 并登录")
        return

    cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)

    headers = {
        "Cookie": cookie_str,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://www.zhipin.com/",
    }

    print("\n--- 测试 1: 访问首页 ---")
    with httpx.Client(headers=headers, follow_redirects=True, timeout=10) as client:
        resp = client.get("https://www.zhipin.com/")
        print(f"  状态码: {resp.status_code}, URL: {resp.url}")

        if "nav-figure" in resp.text:
            print("  ✅ 已登录!")
        else:
            print("  ⚠️ 未检测到登录状态")

    print("\n--- 测试 2: 搜索岗位 API ---")
    search_url = "https://www.zhipin.com/wapi/zpgeek/search/joblist.json"
    params = {
        "scene": "1",
        "query": "Python",
        "city": "101010100",  # 北京
        "page": "1",
        "pageSize": "15",
    }
    with httpx.Client(headers=headers, follow_redirects=True, timeout=10) as client:
        resp = client.get(search_url, params=params)
        print(f"  状态码: {resp.status_code}")

        if resp.status_code == 200:
            try:
                data = resp.json()
                if data.get("code") == 0:
                    jobs = data.get("zpData", {}).get("jobList", [])
                    print(f"  ✅ 获取到 {len(jobs)} 个岗位!")
                    for j in jobs[:3]:
                        print(f"    - {j.get('jobName')} @ {j.get('brandName')} ({j.get('salaryDesc')})")
                else:
                    print(f"  ❌ API 返回错误: code={data.get('code')}, msg={data.get('message')}")
            except Exception as e:
                print(f"  ❌ 解析失败: {e}")
        else:
            print(f"  ❌ 请求失败: {resp.status_code}")


async def main():
    print("=" * 60)
    print("测试 4: CDP 导出 cookies + HTTP 采集")
    print("=" * 60)

    print("\n阶段 1: 通过 CDP 导出 cookies (headless)...")
    cookies = await export_cookies_via_cdp()

    if cookies:
        print("\n阶段 2: 用 cookies 做 HTTP 请求...")
        test_scrape_with_cookies(cookies)
    else:
        print("\n❌ 没有获取到 cookies")
        print("请先运行 test1_pure_chrome.py 并在 Chrome 中登录 Boss 直聘")

    print("\n测试结束。")


asyncio.run(main())
