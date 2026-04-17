# Step 6: Web 界面完整实现

## 完成内容

### 新组件
- **BrowserPanel.tsx** — 浏览器控制面板
  - 状态显示(已启动/未启动, 已登录/未登录)
  - 启动/关闭浏览器按钮
  - 扫码登录 + QR码展示 + 刷新二维码
  - 每3秒轮询状态，登录中每2秒轮询
- **JobDetailDrawer.tsx** — 岗位详情侧边抽屉 (Sheet)
  - 三个标签页: 岗位详情 / AI分析 / 投递
  - AI分析: 匹配评分进度条(总分+四维度)、优化建议
  - 投递: 生成/编辑沟通文案、确认投递按钮

### 页面更新
- **JobsPage** — 点击岗位卡片打开详情抽屉，获取完整JD+分析
- **TasksPage** — 浏览器状态提示，运行中任务自动轮询(3秒)，开始按钮禁用(未登录时)
- **SettingsPage** — 集成 BrowserPanel，布局优化
- **DashboardPage** — 保持不变(已连通API)

### shadcn/ui 新增组件
dialog, sheet, tabs, progress, select, scroll-area, tooltip, alert

### 类型修复
- PaginatedResponse: page_size → size (与后端对齐)
- API: jobs.list size 参数名修复
