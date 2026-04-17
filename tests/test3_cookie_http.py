"""测试 3: 从 Chrome profile 提取 cookies，用 httpx 直接请求

验证: 完全不用浏览器自动化，读取 Chrome 的 cookie 数据库，
     用 httpx 发 HTTP 请求访问 Boss 直聘 API。

这是最彻底的反检测方案 — 没有浏览器，就没有检测。

前提: 先运行 test1 让用户在纯 Chrome 里登录。

运行: source .venv/bin/activate && pip install httpx && python tests/test3_cookie_http.py
"""

import json
import sqlite3
import sys
from pathlib import Path

# 先尝试解密，如果失败就提示
try:
    import httpx
except ImportError:
    print("需要安装 httpx: pip install httpx")
    sys.exit(1)

# Chrome profile 路径（使用 test1 的 profile，因为用户可能在那里登录了）
DATA_DIR = Path(__file__).parent.parent / "backend" / "data"
PROFILE_DIR = DATA_DIR / "chrome_profile_test1"
COOKIE_DB = PROFILE_DIR / "Default" / "Cookies"

# 也检查主 profile
MAIN_PROFILE = DATA_DIR / "chrome_profile"
MAIN_COOKIE_DB = MAIN_PROFILE / "Default" / "Cookies"


def read_cookies_from_db(db_path: Path) -> dict:
    """读取 Chrome SQLite cookie 数据库（未加密的 cookie）。
    注意: macOS 上 Chrome cookies 是加密的，需要 Keychain 解密。
    这里先尝试读取，如果值是加密的会显示提示。
    """
    if not db_path.exists():
        print(f"  Cookie 数据库不存在: {db_path}")
        return {}

    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT host_key, name, value, encrypted_value, path, expires_utc
            FROM cookies
            WHERE host_key LIKE '%zhipin%'
            ORDER BY host_key
        """)
        rows = cursor.fetchall()
    except sqlite3.OperationalError as e:
        print(f"  数据库读取失败（Chrome 可能正在运行）: {e}")
        return {}
    finally:
        conn.close()

    cookies = {}
    encrypted_count = 0
    for host, name, value, encrypted_value, path, expires in rows:
        if value:
            cookies[name] = value
            print(f"  ✅ {name} = {value[:30]}... (host={host})")
        elif encrypted_value:
            encrypted_count += 1
            cookies[name] = f"[ENCRYPTED-{len(encrypted_value)}bytes]"

    if encrypted_count > 0:
        print(f"\n  ⚠️ {encrypted_count} 个 cookies 是加密的（macOS Keychain 保护）")
        print("  macOS Chrome 使用 Keychain 加密 cookies，直接读取不可行。")
        print("  替代方案: 使用 CDP 导出 cookies (test2) 或用 browsercookie3 库。")

    return cookies


def test_api_with_cookies(cookies: dict):
    """用提取的 cookies 测试 Boss 直聘 API"""
    if not cookies or all("[ENCRYPTED" in v for v in cookies.values()):
        print("\n没有可用的 cookies，跳过 API 测试")
        return

    cookie_str = "; ".join(f"{k}={v}" for k, v in cookies.items() if "[ENCRYPTED" not in v)

    headers = {
        "Cookie": cookie_str,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://www.zhipin.com/",
    }

    print("\n尝试用 cookies 请求 Boss 直聘首页...")
    with httpx.Client(headers=headers, follow_redirects=True) as client:
        resp = client.get("https://www.zhipin.com/")
        print(f"  状态码: {resp.status_code}")
        print(f"  最终 URL: {resp.url}")

        if resp.status_code == 200 and "zhipin" in str(resp.url):
            # 检查是否有登录标志
            if "nav-figure" in resp.text or "用户信息" in resp.text:
                print("  ✅ 已登录状态！可以用 HTTP 请求采集")
            else:
                print("  ⚠️ 页面可访问，但未检测到登录状态")
        else:
            print("  ❌ 请求失败或被重定向")


def main():
    print("=" * 60)
    print("测试 3: Cookie + HTTP 请求（无浏览器自动化）")
    print("=" * 60)

    for name, db in [("test1 profile", COOKIE_DB), ("main profile", MAIN_COOKIE_DB)]:
        print(f"\n--- 读取 {name}: {db} ---")
        cookies = read_cookies_from_db(db)
        if cookies:
            test_api_with_cookies(cookies)
        print()

    print("测试结束。")
    print()
    print("如果 cookies 全部加密，替代方案:")
    print("  1. 用 test2 的 CDP 方式通过 page.context.cookies() 导出")
    print("  2. 安装 browsercookie3: pip install browsercookie3")
    print("  3. 使用 Playwright CDP 短暂连接导出 cookies 后立即断开")


if __name__ == "__main__":
    main()
