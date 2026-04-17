# Step 18: AI 推荐页 + 智能创建 + 任务暂停 + 排序

## 版本: 0.8.0

## 新增功能

### 1. AI 智能推荐页面 (`/recommendations`)
- 独立页面，侧边栏新增「AI 推荐」导航项
- 只展示已有 AI 分析结果的岗位
- 按 `overall_score` 从高到低排序
- 每个卡片显示排名、匹配分、AI 分析建议、沟通文案
- 后端新增 `GET /api/jobs/recommendations` 端点，使用子查询获取每个 job 的最新 analysis 再按分数排序

### 2. AI 智能创建采集任务
- 采集任务页面顶部新增「AI 智能创建」按钮
- 点击后：
  1. 用户选择一份简历
  2. AI 根据简历内容生成 8-15 个搜索关键词建议
  3. 每个关键词显示推荐理由和城市
  4. 用户可逐个「批准」或「拒绝」
  5. 批准后自动创建采集任务并尝试启动
- 后端新增 `POST /api/ai/suggest-keywords` 端点
- `ai_service.py` 新增 `KEYWORDS_PROMPT` 和 `suggest_keywords()` 函数

### 3. 采集任务暂停功能
- 运行中的任务现在显示「暂停」和「停止」两个按钮
- 暂停后状态变为 `paused`，可点击「恢复」继续采集
- 已暂停的任务也可以直接删除
- 后端新增 `POST /api/tasks/{id}/pause` 和 `POST /api/tasks/{id}/resume` 端点
- `statusMap` 新增 `paused: '已暂停'`

### 4. 采集任务排序
- 任务列表上方显示「按时间」和「按状态」排序按钮
- 按状态排序优先级：运行中 > 已暂停 > 等待中 > 已完成 > 失败 > 已取消

## 修改的文件

### 后端
- `backend/app/main.py` — 版本号 → 0.8.0
- `backend/app/routes/jobs.py` — 新增 `GET /recommendations` 端点
- `backend/app/routes/ai.py` — 新增 `POST /suggest-keywords` 端点
- `backend/app/routes/tasks.py` — 新增 `POST /{id}/pause` 和 `POST /{id}/resume` 端点
- `backend/app/services/ai_service.py` — 新增 `KEYWORDS_PROMPT` 和 `suggest_keywords()` 函数

### 前端
- `frontend/src/pages/RecommendationsPage.tsx` — 新建 AI 推荐页面
- `frontend/src/pages/TasksPage.tsx` — 重写：AI 智能创建面板、暂停/恢复按钮、排序控件
- `frontend/src/App.tsx` — 新增 `/recommendations` 路由
- `frontend/src/components/layout/AppLayout.tsx` — 侧边栏新增「AI 推荐」
- `frontend/src/lib/api.ts` — 新增 `jobs.listRecommendations`、`tasks.pause/resume`、`ai.suggestKeywords`

## 部署步骤
```bash
cd frontend && npm run build
# 重启后端
cd backend && pkill -f uvicorn; python -m uvicorn app.main:app --host 0.0.0.0 --port 27788
```
