# Step 23: 跨平台兼容 (Windows / Linux / macOS)

## 版本: 1.2.2

## 问题描述
项目仅能在 macOS 运行。将程序复制到 Windows 或 Linux 系统时，Chrome 路径检测失败，启动脚本不兼容。

## 修改内容

### backend/app/services/browser.py — `_detect_system_chrome()`
- **环境变量优先**: 支持 `CHROME_PATH` 环境变量指定 Chrome 路径
- **macOS**: 增加 `~/Applications/` 路径检测
- **Linux**: 增加 `/snap/bin/chromium` + `shutil.which()` 兜底
- **Windows**: 
  - `%PROGRAMFILES%`、`%LOCALAPPDATA%` 等常见安装路径
  - 注册表 `App Paths\chrome.exe` 查找
- **`_kill_chrome()` / `_export_cookies_headless()`**: Windows 用 `terminate()` 替代 `SIGTERM`
- 错误提示增加 `CHROME_PATH` 环境变量提示

### start.sh
- 移除 macOS 专用 Playwright 缓存路径检测
- 改用跨平台方式检测 Playwright 是否已安装

### start.bat (新建)
- Windows 启动脚本，功能与 start.sh 对等
- 自动检测 Python >= 3.10，创建 venv，安装依赖，构建前端，启动后端

## 修改文件
- `backend/app/services/browser.py`
- `backend/app/main.py` (版本号 → 1.2.2)
- `start.sh`
- `start.bat` (新建)
