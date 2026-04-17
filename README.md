# FindJobs - Boss直聘智能岗位采集与投递系统

智能采集 Boss直聘 岗位 → AI 匹配评分 → AI 生成沟通文案 → 自动投递

## 功能

- 🔍 按关键词/城市/薪资采集 Boss直聘岗位（Playwright 自动化）
- 🤖 AI 多维度岗位匹配评分（技能/经验/学历/薪资）
- ✍️ AI 根据岗位 JD + 你的简历生成个性化打招呼文案
- 📊 Web 界面：岗位浏览、采集任务管理、投递状态查看
- 🚀 一键投递：自动在 Boss直聘 发起沟通

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.10+ · FastAPI · SQLModel · SQLite · Playwright |
| 前端 | React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui |
| AI | 任意 OpenAI 兼容 API（OpenAI / DeepSeek / 硅基流动 / Ollama 等） |

---

## 从零开始部署（另一台机器）

### 1. 系统要求

- **操作系统**: Linux (推荐 Ubuntu 22.04+) 或 macOS
- **Python**: 3.9+
- **Node.js**: 18+
- **磁盘**: 500MB+（Chromium 浏览器约 300MB）
- **内存**: 2GB+

### 2. 解压项目

```bash
tar -xzf FindJobs.tar.gz
cd FindJobs
```

### 3. 安装后端依赖

```bash
cd backend
pip install -r requirements.txt
# 安装 Playwright Chromium 浏览器（约 300MB，只需一次）
playwright install chromium
# 如果提示缺少系统依赖，运行:
# playwright install-deps chromium
cd ..
```

### 4. 安装前端依赖

```bash
cd frontend
npm install
cd ..
```

### 5. 启动项目

**方式一：开发模式（推荐调试用）**

打开两个终端：

```bash
# 终端 1: 后端
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 27788

# 终端 2: 前端
cd frontend
npm run dev
```

前端访问 `http://localhost:5173`，后端 API 在 `http://localhost:27788`。
Vite 会自动代理 `/api` 请求到后端。

**方式二：生产模式**

```bash
# 先构建前端
cd frontend && npm run build && cd ..

# 启动后端（会自动服务前端静态文件）
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 27788
```

直接访问 `http://localhost:27788` 即可。

**方式三：一键启动脚本**

```bash
chmod +x start.sh
./start.sh
```

### 6. 首次使用配置

1. **打开浏览器** → 访问 Web 界面 → 侧栏「系统设置」
2. **启动 Playwright 浏览器** → 点击「启动浏览器」
3. **扫码登录 Boss直聘** → 点击「扫码登录」→ 用 Boss直聘 APP 或微信扫码
4. **配置 AI** → 填入你的 AI API Key、Base URL、模型名称
   - 例: 硅基流动 `https://api.siliconflow.cn/v1` + `Qwen/Qwen2.5-72B-Instruct`
   - 例: DeepSeek `https://api.deepseek.com/v1` + `deepseek-chat`
   - 例: OpenAI `https://api.openai.com/v1` + `gpt-4o-mini`
5. **创建简历** → 侧栏「简历管理」→ 用 Markdown 格式写入你的简历

### 7. 使用流程

1. **采集岗位** → 侧栏「采集任务」→ 新建任务（输入关键词、城市）→ 开始
2. **浏览岗位** → 侧栏「岗位列表」→ 点击任意岗位打开详情
3. **AI 分析** → 详情面板「AI 分析」标签 → 点击分析 → 查看评分和建议
4. **生成文案** → 详情面板「投递」标签 → 生成沟通文案 → 可手动编辑
5. **投递** → 点击「确认投递」→ 浏览器自动发送

---

## 项目结构

```
FindJobs/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口
│   │   ├── models.py            # 数据库模型 (6张表)
│   │   ├── database.py          # SQLite 异步引擎
│   │   ├── routes/              # API 路由
│   │   │   ├── jobs.py          # 岗位 CRUD
│   │   │   ├── tasks.py         # 采集任务
│   │   │   ├── resumes.py       # 简历管理
│   │   │   ├── ai.py            # AI 分析
│   │   │   ├── applications.py  # 投递记录
│   │   │   ├── browser.py       # 浏览器控制
│   │   │   └── config.py        # 系统配置
│   │   └── services/            # 业务逻辑
│   │       ├── browser.py       # Playwright 浏览器
│   │       ├── anti_detection.py# 反检测
│   │       ├── boss_scraper.py  # 岗位采集
│   │       ├── ai_service.py    # AI 调用
│   │       └── boss_applicant.py# 自动投递
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/               # 5个页面
│   │   ├── components/          # UI 组件
│   │   ├── lib/api.ts           # API 客户端
│   │   └── types/index.ts       # TypeScript 类型
│   └── package.json
├── Development/                  # 开发文档
└── start.sh                     # 启动脚本
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| GET | /api/jobs | 岗位列表 (分页) |
| GET | /api/jobs/:id | 岗位详情 + 分析 |
| POST | /api/tasks | 创建采集任务 |
| POST | /api/tasks/:id/start | 启动采集 |
| POST | /api/tasks/:id/cancel | 取消采集 |
| GET | /api/tasks/cities | 城市编码字典 |
| POST | /api/ai/analyze | AI 匹配分析 |
| POST | /api/ai/greeting | 生成沟通文案 |
| POST | /api/applications/apply | 投递岗位 |
| GET | /api/applications/today | 今日投递数 |
| POST | /api/browser/launch | 启动浏览器 |
| POST | /api/browser/login | 扫码登录 |
| GET | /api/browser/status | 浏览器状态 |
| GET/PUT | /api/config | 系统配置 |
| GET/POST | /api/resumes | 简历管理 |

## 注意事项

- 本项目仅供个人学习使用
- Boss直聘有反爬检测，采集频率不要太高（已内置随机延迟）
- 每日投递有上限（默认100，可在设置中调整）
- 数据存储在 `backend/data/` 目录下（SQLite + 登录状态）
