# Step 2: 前端骨架

## 完成内容

### 技术栈
- Vite + React 18 + TypeScript
- Tailwind CSS v4 + shadcn/ui 组件库
- React Router DOM 路由
- Lucide React 图标

### 项目结构
```
frontend/src/
├── components/
│   ├── layout/AppLayout.tsx    # 侧边栏导航布局
│   └── ui/                     # shadcn/ui 组件
├── pages/
│   ├── DashboardPage.tsx       # 仪表盘（统计卡片）
│   ├── JobsPage.tsx            # 岗位列表（搜索、分页）
│   ├── TasksPage.tsx           # 采集任务（创建、启停、删除）
│   ├── ResumesPage.tsx         # 简历管理（CRUD、设为活跃）
│   └── SettingsPage.tsx        # 系统设置（AI配置）
├── types/index.ts              # TypeScript 类型定义
├── lib/
│   ├── api.ts                  # API 客户端层
│   └── utils.ts                # shadcn 工具函数
├── App.tsx                     # 路由配置
└── main.tsx                    # 入口
```

### API 层
- `/api` 代理到后端 `127.0.0.1:27788`
- 封装了 jobs、tasks、resumes、ai、browser、config 6个模块
- 统一错误处理

### 修复
- 后端 `main.py` 中 health 路由移到 static mount 之前，避免被 catch-all 覆盖

## 验证
- `npm run build` 构建成功
- `tsc --noEmit` 类型检查通过
- 后端 API 各端点响应正常
