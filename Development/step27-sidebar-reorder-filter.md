# Step 27: 侧栏重排 + AI推荐隐藏已投递

## 版本: 1.3.4

## 改动内容

### 1. 侧栏导航重新排序
新顺序: 仪表盘 → 我的简历 → 采集任务 → 岗位列表 → AI推荐 → 投递管理

### 2. AI推荐页 — "隐藏已投递"按钮
- 点击后排除所有状态为 sent/recorded/sending 的已投递岗位
- 按钮切换: "隐藏已投递" ↔ "显示全部"
- 后端 `/api/jobs/recommendations` 新增 `exclude_applied` 查询参数

## 修改文件
- `frontend/src/components/layout/AppLayout.tsx` — 侧栏顺序
- `frontend/src/pages/RecommendationsPage.tsx` — 筛选按钮
- `frontend/src/lib/api.ts` — exclude_applied 参数
- `backend/app/routes/jobs.py` — recommendations 端点添加 exclude_applied 过滤
- `backend/app/main.py` (版本号 → 1.3.4)
