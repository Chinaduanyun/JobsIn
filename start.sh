#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=== FindJobs 启动 ==="

# 检查依赖
command -v python3 >/dev/null 2>&1 || { echo "需要 python3"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "需要 node"; exit 1; }

# 安装后端依赖（如果没装过）
if ! python3 -c "import fastapi" 2>/dev/null; then
    echo "安装后端依赖..."
    pip install -r "$DIR/backend/requirements.txt" -q
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
