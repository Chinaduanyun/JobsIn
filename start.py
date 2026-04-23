#!/usr/bin/env python3
"""
JobsIn 跨平台一键启动脚本

使用方法:
  python start.py          # 正常启动
  python start.py --skip-build  # 跳过前端构建（已构建过）
  python start.py --port 8080   # 使用自定义端口

启动流程:
  1. 检查 Python >= 3.10 和 Node.js
  2. 创建/激活虚拟环境 (.venv/)
  3. 安装后端 Python 依赖 (FastAPI, SQLModel, ...)
  4. 安装 Playwright + Chromium（用于登录 cookie 导出）
  5. 安装前端依赖 (npm install)
  6. 构建前端 (vite build)
  7. 启动后端服务 (uvicorn on port 27788)

支持平台: macOS / Linux / Windows
"""

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent
VENV_DIR = DIR / ".venv"
BACKEND_DIR = DIR / "backend"
FRONTEND_DIR = DIR / "frontend"

# Windows 下 venv 的 python/pip 路径不同
if platform.system() == "Windows":
    VENV_PYTHON = VENV_DIR / "Scripts" / "python.exe"
    VENV_PIP = VENV_DIR / "Scripts" / "pip.exe"
else:
    VENV_PYTHON = VENV_DIR / "bin" / "python3"
    VENV_PIP = VENV_DIR / "bin" / "pip"


def check_python():
    """检查 Python 版本 >= 3.10"""
    v = sys.version_info
    if v.major < 3 or (v.major == 3 and v.minor < 10):
        print(f"❌ 需要 Python >= 3.10，当前: {v.major}.{v.minor}.{v.micro}")
        print("   请安装新版 Python: https://www.python.org/downloads/")
        sys.exit(1)
    print(f"✅ Python {v.major}.{v.minor}.{v.micro}")


def check_node():
    """检查 Node.js 是否可用"""
    if not shutil.which("node"):
        print("❌ 未找到 Node.js，请安装: https://nodejs.org/")
        sys.exit(1)
    result = subprocess.run(["node", "--version"], capture_output=True, text=True)
    print(f"✅ Node.js {result.stdout.strip()}")


def setup_venv():
    """创建虚拟环境"""
    if not VENV_DIR.exists():
        print("📦 创建虚拟环境...")
        subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)], check=True)
    print(f"✅ 虚拟环境: {VENV_DIR}")


def pip_install(packages_or_file, quiet=True):
    """在 venv 中安装包"""
    cmd = [str(VENV_PIP), "install"]
    if quiet:
        cmd.append("-q")
    if isinstance(packages_or_file, Path) and packages_or_file.exists():
        cmd.extend(["-r", str(packages_or_file)])
    elif isinstance(packages_or_file, list):
        cmd.extend(packages_or_file)
    else:
        cmd.append(str(packages_or_file))
    subprocess.run(cmd, check=True)


def install_backend_deps():
    """安装后端依赖"""
    req_file = BACKEND_DIR / "requirements.txt"
    # 检查是否已安装
    result = subprocess.run(
        [str(VENV_PYTHON), "-c", "import fastapi"],
        capture_output=True,
    )
    if result.returncode != 0:
        print("📦 安装后端依赖...")
        pip_install(req_file)
    else:
        print("✅ 后端依赖已安装")


def install_playwright():
    """安装 Playwright + Chromium"""
    result = subprocess.run(
        [str(VENV_PYTHON), "-c", "from playwright.sync_api import sync_playwright"],
        capture_output=True,
    )
    if result.returncode != 0:
        print("📦 安装 Playwright...")
        pip_install(["playwright"])
        print("📦 安装 Chromium 浏览器...")
        subprocess.run([str(VENV_PYTHON), "-m", "playwright", "install", "chromium"], check=True)
    else:
        print("✅ Playwright 已安装")


def install_frontend_deps():
    """安装前端依赖"""
    node_modules = FRONTEND_DIR / "node_modules"
    if not node_modules.exists():
        print("📦 安装前端依赖...")
        npm = "npm.cmd" if platform.system() == "Windows" else "npm"
        subprocess.run([npm, "install", "--silent"], cwd=str(FRONTEND_DIR), check=True)
    else:
        print("✅ 前端依赖已安装")


def build_frontend(force=False):
    """构建前端"""
    dist = FRONTEND_DIR / "dist"
    if not dist.exists() or force:
        print("🔨 构建前端...")
        npx = "npx.cmd" if platform.system() == "Windows" else "npx"
        subprocess.run([npx, "vite", "build"], cwd=str(FRONTEND_DIR), check=True)
    else:
        print("✅ 前端已构建")


def start_server(port=27788):
    """启动后端服务"""
    print()
    print("=" * 50)
    print(f"  ✅ JobsIn 启动完成！")
    print(f"  🌐 访问: http://localhost:{port}")
    print(f"  📋 按 Ctrl+C 停止")
    print("=" * 50)
    print()

    uvicorn = VENV_DIR / ("Scripts" if platform.system() == "Windows" else "bin") / "uvicorn"
    cmd = [
        str(uvicorn) if uvicorn.exists() else str(VENV_PYTHON),
    ]
    if uvicorn.exists():
        cmd.extend(["app.main:app", "--host", "0.0.0.0", "--port", str(port)])
    else:
        cmd.extend(["-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", str(port)])

    try:
        subprocess.run(cmd, cwd=str(BACKEND_DIR))
    except KeyboardInterrupt:
        print("\n👋 已停止")


def main():
    parser = argparse.ArgumentParser(description="JobsIn 一键启动")
    parser.add_argument("--port", type=int, default=27788, help="服务端口 (默认: 27788)")
    parser.add_argument("--skip-build", action="store_true", help="跳过前端构建")
    parser.add_argument("--rebuild", action="store_true", help="强制重新构建前端")
    args = parser.parse_args()

    print("=== JobsIn 启动 ===")
    print(f"系统: {platform.system()} {platform.machine()}")
    print()

    check_python()
    check_node()
    setup_venv()
    install_backend_deps()
    install_playwright()
    install_frontend_deps()

    if not args.skip_build:
        build_frontend(force=args.rebuild)

    start_server(port=args.port)


if __name__ == "__main__":
    main()
