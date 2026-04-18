# JobsIn - 多平台智能岗位采集与投递系统

多平台岗位智能采集 → AI 匹配评分 → AI 生成个性化沟通文案 → 自动投递

## 功能

- 🔍 多平台岗位采集：支持 Boss直聘（已实现）、智联招聘 / 前程无忧 / 猎聘（架构已预留）
- 🤖 AI 多维度岗位匹配评分（技能/经验/学历/薪资）
- ✍️ AI 根据岗位 JD + 你的简历生成个性化打招呼文案
- 📊 Web 界面：岗位浏览、AI 推荐排序、采集任务管理、投递状态追踪
- 🚀 一键投递 / 批量投递：通过 Chrome Extension 自动化操作
- 🔒 使用系统 Chrome + 独立 Profile，登录态持久保存，无自动化痕迹

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.10+ · FastAPI · SQLModel · SQLite |
| 前端 | React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui |
| 浏览器自动化 | Chrome Extension (Manifest V3) + 系统 Chrome |
| AI | 任意 OpenAI 兼容 API（OpenAI / DeepSeek / 硅基流动 / Ollama 等） |

---

## 部署指南

### 系统要求

| 要求 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 操作系统 | macOS 12+ | Windows 10/11 | Ubuntu 22.04+ |
| Python | 3.10+ | 3.10+ | 3.10+ |
| Node.js | 18+ | 18+ | 18+ |
| Chrome 浏览器 | ✅ 需安装 | ✅ 需安装 | ✅ 需安装 |
| 磁盘 | 200MB+ | 200MB+ | 200MB+ |
| 内存 | 2GB+ | 2GB+ | 2GB+ |

> ⚠️ 必须安装 **Google Chrome 浏览器**（不是 Chromium），程序会使用系统 Chrome 并创建独立 Profile。

### 1. 获取项目

```bash
# 从 GitHub 克隆
git clone https://github.com/你的用户名/JobsIn.git
cd JobsIn

# 或解压压缩包
tar -xzf JobsIn.tar.gz   # macOS / Linux
# Windows: 右键解压 zip 文件
cd JobsIn
```

### 2. 安装后端依赖

**macOS / Linux:**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

**Windows (PowerShell):**
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

**Windows (CMD):**
```cmd
cd backend
python -m venv venv
venv\Scripts\activate.bat
pip install -r requirements.txt
cd ..
```

### 3. 安装前端依赖并构建

```bash
cd frontend
npm install
npm run build
cd ..
```

> 构建产物会输出到 `frontend/dist/`，后端会自动提供静态文件服务。

### 4. 启动项目

**方式一：跨平台 Python 启动脚本（推荐）**

```bash
python start.py
```

`start.py` 会自动检测环境、安装依赖、构建前端、启动后端。

**方式二：手动启动**

macOS / Linux:
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 27788
```

Windows (PowerShell):
```powershell
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 27788
```

**方式三：Shell 脚本（macOS / Linux）**
```bash
chmod +x start.sh
./start.sh
```

**方式四：批处理脚本（Windows）**
```cmd
start.bat
```

**方式五：开发模式（调试用）**

打开两个终端：
```bash
# 终端 1: 后端
cd backend
source venv/bin/activate  # Windows: .\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 0.0.0.0 --port 27788

# 终端 2: 前端
cd frontend
npm run dev
```
前端访问 `http://localhost:5173`，Vite 自动代理 `/api` 到后端。

---

### 5. 安装 Chrome Extension

1. 打开 Chrome 浏览器，地址栏输入 `chrome://extensions/`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目目录下的 `chrome_extension/` 文件夹
5. 扩展安装成功后，图标会出现在工具栏（绿色=已连接，灰色=未连接）

### 6. 首次使用配置

1. **打开 Web 界面** → 浏览器访问 `http://localhost:27788`
2. **登录 Boss直聘**:
   - 在设置页点击「打开登录页」→ 系统会用 Chrome 打开 Boss直聘登录页
   - 手动完成扫码/手机登录
   - 回到 Web 界面点击「确认登录」
   - 登录状态会保存在 Chrome Profile 中，下次启动无需重新登录
3. **配置 AI**（设置页 → AI 配置）:
   - API Key: 你的 AI 服务密钥
   - Base URL: API 地址
   - Model: 模型名称
   - 推荐配置:
     - 硅基流动: `https://api.siliconflow.cn/v1` + `Qwen/Qwen2.5-72B-Instruct`
     - DeepSeek: `https://api.deepseek.com/v1` + `deepseek-chat`
     - OpenAI: `https://api.openai.com/v1` + `gpt-4o-mini`
4. **填写简历** → 侧栏「我的简历」→ 用 Markdown 格式写入你的简历内容

### 7. 使用流程

1. **采集岗位** → 侧栏「采集任务」→ 新建任务（关键词/城市/薪资/页数）→ 开始采集
2. **浏览岗位** → 侧栏「岗位列表」→ 点击岗位查看详情
3. **AI 分析** → 岗位详情「AI 分析」→ 查看匹配评分和建议
4. **AI 推荐** → 侧栏「AI 推荐」→ 按匹配分排序，可隐藏已投递岗位
5. **生成文案** → 岗位详情「投递」→ 生成/编辑沟通文案
6. **投递** → 确认投递 → Chrome Extension 自动发送

---

## Chrome 路径说明

程序会自动检测系统 Chrome 路径，检测顺序：

| 平台 | 检测路径 |
|------|---------|
| macOS | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| Windows | `%PROGRAMFILES%\Google\Chrome\Application\chrome.exe` |
| Windows | `%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe` |
| Windows | `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` |
| Windows | 注册表 `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe` |
| Linux | `/usr/bin/google-chrome` · `/usr/bin/google-chrome-stable` · `/snap/bin/chromium` |

也可通过环境变量 `CHROME_PATH` 手动指定：
```bash
# macOS / Linux
export CHROME_PATH="/path/to/chrome"
python start.py

# Windows PowerShell
$env:CHROME_PATH = "C:\path\to\chrome.exe"
python start.py
```

---

## 项目结构

```
JobsIn/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口
│   │   ├── models.py            # 数据库模型 (7张表)
│   │   ├── database.py          # SQLite 异步引擎
│   │   ├── routes/              # API 路由
│   │   │   ├── jobs.py          # 岗位 CRUD + AI推荐
│   │   │   ├── tasks.py         # 采集任务
│   │   │   ├── resumes.py       # 简历管理
│   │   │   ├── ai.py            # AI 分析 / 文案 / 批量
│   │   │   ├── applications.py  # 投递记录 / 批量投递
│   │   │   ├── browser.py       # 浏览器控制
│   │   │   ├── extension.py     # Extension Bridge
│   │   │   └── config.py        # 系统配置
│   │   └── services/            # 业务逻辑
│   │       ├── browser.py       # Chrome 管理
│   │       ├── extension_bridge.py # Extension 通信桥
│   │       ├── boss_scraper.py  # Boss直聘采集
│   │       ├── ai_service.py    # AI 调用
│   │       └── boss_applicant.py# 自动投递
│   ├── data/                    # 运行数据 (自动创建)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/               # 页面组件
│   │   ├── components/          # UI 组件
│   │   ├── lib/api.ts           # API 客户端
│   │   └── types/index.ts       # TypeScript 类型
│   ├── dist/                    # 构建产物 (构建后生成)
│   └── package.json
├── chrome_extension/            # Chrome Extension (MV3)
│   ├── manifest.json
│   ├── background.js            # Service Worker
│   └── content.js               # 页面注入脚本
├── Development/                 # 开发文档
├── start.py                     # 跨平台启动脚本
├── start.sh                     # macOS/Linux 启动脚本
└── start.bat                    # Windows 启动脚本
```

## 常见问题

### Chrome Extension 显示灰色（未连接）
- 确保后端已启动 (`http://localhost:27788/api/health`)
- 检查扩展是否已启用
- 刷新扩展: `chrome://extensions/` → JobsIn 助手 → 刷新按钮

### Boss直聘检测到自动化
- 本项目使用系统 Chrome + 独立 Profile，不使用 Playwright 控制浏览器
- 登录完全手动操作，无自动化痕迹
- 如仍被检测，可能是操作频率过高，调大设置中的延迟参数

### Windows 上 `uvicorn` 提示找不到
```powershell
# 确保在虚拟环境中
.\venv\Scripts\Activate.ps1
# 或全局安装
pip install uvicorn
```

### macOS 提示权限问题
```bash
# 确保 start.sh 有执行权限
chmod +x start.sh
```

## 支持平台

| 招聘平台 | 状态 | 说明 |
|---------|------|------|
| Boss直聘 | ✅ 已实现 | 岗位采集 + AI分析 + 自动投递 |
| 智联招聘 | 🔧 架构预留 | Scraper 接口已定义，待实现 |
| 前程无忧 (51job) | 🔧 架构预留 | Scraper 接口已定义，待实现 |
| 猎聘 | 🔧 架构预留 | Scraper 接口已定义，待实现 |

> 系统采用平台无关的 Scraper 架构（`BaseScraper` 抽象基类），新增平台只需实现 `scrape_page()` / `fetch_detail()` / `resolve_city_code()` 三个方法。

## 注意事项

- 本项目仅供个人学习使用
- 各招聘平台均有反爬检测，采集频率不要太高（已内置随机延迟）
- 每日投递有上限（默认100，可在设置中调整）
- 数据存储在 `backend/data/` 目录下（SQLite 数据库 + 登录 Cookie）
- Chrome Profile 存储在 `backend/data/chrome_profile/`，登录状态跨会话保持
- 支持 macOS / Windows / Linux 三平台运行
