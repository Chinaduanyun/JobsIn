@echo off
setlocal enabledelayedexpansion

echo === FindJobs 启动 ===

set "DIR=%~dp0"

:: 检查 node
where node >nul 2>&1 || (echo 需要 node，请安装 Node.js & exit /b 1)

:: 检查 Python >= 3.10
set "PYTHON="
for %%P in (python3 python py) do (
    where %%P >nul 2>&1 && (
        for /f "tokens=*" %%V in ('%%P -c "import sys; print(sys.version_info.minor)"') do (
            for /f "tokens=*" %%M in ('%%P -c "import sys; print(sys.version_info.major)"') do (
                if %%M GEQ 3 if %%V GEQ 10 (
                    set "PYTHON=%%P"
                    goto :found_python
                )
            )
        )
    )
)
:found_python
if "%PYTHON%"=="" (
    echo 需要 Python ^>= 3.10，请安装 Python
    exit /b 1
)
echo 使用 Python: %PYTHON%

:: 创建虚拟环境
if not exist "%DIR%.venv" (
    echo 创建虚拟环境...
    %PYTHON% -m venv "%DIR%.venv"
)

:: 激活虚拟环境
call "%DIR%.venv\Scripts\activate.bat"

:: 安装后端依赖
python -c "import fastapi" 2>nul || (
    echo 安装后端依赖...
    pip install -r "%DIR%backend\requirements.txt" -q
)

:: 安装 Playwright 浏览器
python -c "from playwright.sync_api import sync_playwright" 2>nul || (
    echo 安装 Playwright...
    pip install playwright -q
    python -m playwright install chromium
)

:: 安装前端依赖
if not exist "%DIR%frontend\node_modules" (
    echo 安装前端依赖...
    cd "%DIR%frontend" && npm install --silent
)

:: 构建前端
if not exist "%DIR%frontend\dist" (
    echo 构建前端...
    cd "%DIR%frontend" && npx vite build
)

:: 启动后端
cd "%DIR%backend"
echo.
echo 启动完成！访问 http://localhost:27788
echo    按 Ctrl+C 停止
echo.
uvicorn app.main:app --host 0.0.0.0 --port 27788
