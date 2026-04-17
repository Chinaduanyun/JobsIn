# FindJobs - Boss直聘智能岗位采集与投递系统

智能采集 Boss直聘 岗位 → AI 匹配评分 → AI 优化简历/生成沟通文案 → 自动投递

## 技术栈

- **后端**: FastAPI + SQLModel + SQLite + Playwright
- **前端**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **AI**: OpenAI 兼容 API

## 快速开始

```bash
# 后端
cd backend
pip install -r requirements.txt
playwright install chromium
uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
npm install
npm run dev
```

## 功能

- 🔍 按关键词/城市/薪资采集 Boss直聘岗位
- 🤖 AI 多维度岗位匹配评分
- ✍️ AI 根据岗位 JD 生成个性化沟通文案
- 📊 Web 界面管理岗位、查看投递状态
- 🚀 一键投递（自动发起沟通）
