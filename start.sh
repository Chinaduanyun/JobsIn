#!/bin/bash
set -e

echo "=== 启动 FindJobs ==="

# 后端
cd "$(dirname "$0")/backend"
uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "后端已启动 (PID: $BACKEND_PID)"

# 前端开发模式
cd ../frontend
if [ -d "dist" ]; then
    echo "前端使用生产构建，通过后端 :8000 访问"
else
    npm run dev &
    FRONTEND_PID=$!
    echo "前端开发服务器已启动 (PID: $FRONTEND_PID)"
fi

wait
