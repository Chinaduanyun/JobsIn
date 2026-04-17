# Step 13: 投递管理页 + 岗位删除 + 版本系统

## 变更内容

### 新增功能
1. **投递管理页面** (`/applications`) — 展示所有投递记录，按时间排序，10s 自动刷新
2. **岗位删除** — 单个删除按钮 + 批量删除（选中后删除）
3. **批量删除 API** — `POST /api/jobs/batch-delete`
4. **动态版本号** — 侧边栏 + 设置页均显示从 `/api/version` 获取的版本号
5. **投递后跳转** — 单个投递/批量投递后自动跳转到投递管理页

### 投递状态说明
- `recorded` — 已记录（当前仅创建数据库记录，未实际在 Boss 直聘上发送消息）
- `sent` — 已发送（未来实现浏览器自动发送后使用）
- `failed` — 失败

### 修改文件
| 文件 | 改动 |
|------|------|
| `frontend/src/pages/ApplicationsPage.tsx` | 新建 — 投递管理页面 |
| `frontend/src/App.tsx` | 添加 /applications 路由 |
| `frontend/src/components/layout/AppLayout.tsx` | 添加投递管理导航项，动态版本号 |
| `frontend/src/pages/JobsPage.tsx` | 删除按钮、批量删除、投递后跳转 |
| `frontend/src/pages/SettingsPage.tsx` | 显示版本号 badge |
| `frontend/src/lib/api.ts` | 添加 batchDelete API |
| `backend/app/routes/jobs.py` | 添加 batch-delete 端点 |
| `backend/app/services/boss_applicant.py` | 状态改为 recorded |
| `backend/app/main.py` | 版本 0.3.1 |
