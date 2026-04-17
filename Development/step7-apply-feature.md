# Step 7: 投递功能

## 完成内容

### boss_applicant.py (新建)
- `apply_to_job(job_id, greeting_text)`: Playwright 自动投递
  - 打开岗位页 → 点击"立即沟通" → 输入文案 → 发送
  - 多个选择器兜底(.btn-startchat, .op-btn-chat, role)
  - 支持 textarea 和 contenteditable 输入
  - 投递前检查每日限额
- `get_today_applied()`: 查询今日已投递数
- `get_daily_limit()`: 从 SystemConfig 读取限额

### applications.py (新建路由)
- `POST /api/applications/apply` — 投递(自动生成文案或使用传入的)
- `GET /api/applications` — 投递记录列表(分页)
- `GET /api/applications/today` — 今日投递计数

### main.py (修改)
- 注册 applications router → `/api/applications`

### 前端更新
- `api.ts`: 新增 applications 模块 (apply/list/today)
- `JobsPage.tsx`: onApply 回调传入 JobDetailDrawer
- `DashboardPage.tsx`: "今日已投递" 卡片接入真实 API

## 投递流程
1. 用户在岗位详情抽屉点击"AI分析"
2. 查看评分后点击"生成文案"
3. 可编辑文案内容
4. 点击"确认投递" → 浏览器自动执行
5. 投递结果记录到 applications 表
