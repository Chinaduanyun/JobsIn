#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$DIR/.venv"
echo "=== FindJobs 启动 ==="

# 检查依赖
command -v node >/dev/null 2>&1 || { echo "需要 node"; exit 1; }

# 选择 Python — 优先 Homebrew 的 python3 (>= 3.10)
PYTHON=""
for candidate in /opt/homebrew/bin/python3 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
        ver=$("$candidate" -c "import sys; print(sys.version_info.minor)")
        major=$("$candidate" -c "import sys; print(sys.version_info.major)")
        if [ "$major" -ge 3 ] && [ "$ver" -ge 10 ]; then
            PYTHON="$candidate"
            break
        fi
    fi
done
if [ -z "$PYTHON" ]; then
    echo "❌ 需要 Python >= 3.10。请安装: brew install python3"
    exit 1
fi
echo "使用 Python: $PYTHON ($($PYTHON --version))"

# 创建/激活虚拟环境
if [ ! -d "$VENV_DIR" ]; then
    echo "创建虚拟环境..."
    "$PYTHON" -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"

# 安装后端依赖
if ! python3 -c "import fastapi" 2>/dev/null; then
    echo "安装后端依赖..."
    pip install -r "$DIR/backend/requirements.txt" -q
fi

# 安装 Playwright 浏览器（如果没装过）
if ! python3 -c "from playwright.sync_api import sync_playwright" 2>/dev/null; then
    echo "安装 Playwright..."
    pip install playwright -q
fi
CHROMIUM_DIR="$HOME/Library/Caches/ms-playwright"
if [ ! -d "$CHROMIUM_DIR" ] || [ -z "$(ls -A "$CHROMIUM_DIR" 2>/dev/null)" ]; then
    echo "安装 Playwright Chromium 浏览器..."
    python3 -m playwright install chromium
fi

# 安装前端依赖（如果没装过）
if [ ! -d "$DIR/frontend/node_modules" ]; then
    echo "安装前端依赖..."
    cd "$DIR/frontend" && npm install --silent
fi

# 构建前端（如果没构建过）
if [ ! -d "$DIR/frontend/dist" ]; then
    echo "构建前端..."
    cd "$DIR/frontend" && npx vite build
fi

# 启动后端（服务前端静态文件）
cd "$DIR/backend"
echo ""
echo "✅ 启动完成！访问 http://localhost:27788"
echo "   按 Ctrl+C 停止"
echo ""
exec uvicorn app.main:app --host 0.0.0.0 --port 27788
