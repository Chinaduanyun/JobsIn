# Step 24: 统一启动脚本 + 扩展图标状态

## 版本: 1.3.0

## 改动内容

### 1. `start.py` — 跨平台统一启动脚本 (新建)
Python 脚本，macOS/Linux/Windows 通用，替代 start.sh / start.bat 的功能：
- 检查 Python >= 3.10 和 Node.js
- 自动创建 venv、安装后端依赖、安装 Playwright、安装前端依赖、构建前端
- 支持参数: `--port 8080` 自定义端口, `--skip-build` 跳过构建, `--rebuild` 强制重建
- 启动时显示系统信息和各步骤状态

### 2. Chrome Extension 图标状态 (绿色/灰色)
- `background.js`: 新增 `updateConnectionIcon()` 函数
- 后端连接成功 → 扩展图标显示绿色小圆点 (badge)
- 后端未连接/断开 → 灰色小圆点
- 初始化时设为灰色，首次连接成功后变绿
- `pollCommand` 中连接状态变化时自动更新图标

### 3. `start.bat` (新建 — Step 23)
Windows 专用启动脚本，与 start.sh 功能对等

### 4. `browser.py` 跨平台 Chrome 检测 (Step 23)
- 新增 Windows Chrome 路径检测 (ProgramFiles + 注册表)
- 新增 `CHROME_PATH` 环境变量支持
- Windows 用 `terminate()` 替代 `SIGTERM`

## 修改文件
- `start.py` (新建)
- `start.bat` (新建)
- `chrome_extension/background.js`
- `backend/app/services/browser.py`
- `backend/app/main.py`
- `start.sh`
