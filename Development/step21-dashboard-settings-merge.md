# Step 21: 仪表盘整合系统设置 + 扩展连接状态

## 变更内容

### 需求
- 将"系统设置"页面的内容合并到仪表盘，减少导航层级
- Chrome 扩展连接后图标从灰色变为绿色

### 修改

#### 1. DashboardPage.tsx — 完全重写
- 保留原有统计卡片 (已采集岗位/进行中任务/简历状态/今日已投递)
- 新增 Chrome 扩展状态卡片:
  - 已连接: 绿色图标 + 绿色 Badge
  - 未连接: 灰色图标 + 灰色 Badge + 安装步骤
- 整合 BrowserPanel (浏览器登录)
- 整合 AI 配置表单 (API Key / Base URL / Model / 并发数 / 投递上限)
- 整合采集速度配置 (翻页间隔 / 详情间隔 / 投递间隔)
- 保存按钮

#### 2. AppLayout.tsx — 移除系统设置导航
- 侧边栏移除"系统设置"入口

#### 3. App.tsx — /settings 重定向
- `/settings` 路由重定向到 `/` (仪表盘)
- 移除 SettingsPage import

#### 4. routes/jobs.py — 删除级联 + 清除数据接口
- `delete_job()` / `batch_delete_jobs()`: 级联删除 JobAnalysis + Application
- 新增 `POST /jobs/clear-all`: 清除所有数据

#### 5. content.js — HR 活跃选择器
- `extractJobs()` 添加 `.boss-active-time` 选择器

#### 6. JobsPage.tsx — 智能全选按钮
- 全选 / 未分析(N) / 未生成文案(N)

### 版本
- 1.1.0 → 1.2.0
