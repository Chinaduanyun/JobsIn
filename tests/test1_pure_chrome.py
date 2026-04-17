"""测试 1: 纯 subprocess Chrome — 无 CDP，无自动化

验证: 完全用 subprocess 打开 Chrome 访问 zhipin.com，
     没有 --remote-debugging-port，没有 Playwright。

预期: 页面应正常显示（和双击 Chrome 图标打开一样）。

运行: source .venv/bin/activate && python tests/test1_pure_chrome.py
"""

import subprocess
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "backend" / "data"
USER_DATA_DIR = str(DATA_DIR / "chrome_profile_test1")
LOGIN_URL = "https://www.zhipin.com/web/user/?ka=header-login"

CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if not Path(CHROME_PATH).exists():
    print("❌ 未找到 Chrome，请确认路径")
    sys.exit(1)

Path(USER_DATA_DIR).mkdir(parents=True, exist_ok=True)

print("=" * 60)
print("测试 1: 纯 Chrome subprocess（无 CDP）")
print(f"  Chrome: {CHROME_PATH}")
print(f"  Profile: {USER_DATA_DIR}")
print(f"  URL: {LOGIN_URL}")
print("=" * 60)
print()
print("Chrome 正在打开... 观察登录页面是否正常显示。")
print("关闭 Chrome 窗口即可结束测试。")
print()

proc = subprocess.Popen([
    CHROME_PATH,
    f"--user-data-dir={USER_DATA_DIR}",
    "--no-first-run",
    "--no-default-browser-check",
    LOGIN_URL,
])

proc.wait()
print("Chrome 已关闭。测试结束。")
