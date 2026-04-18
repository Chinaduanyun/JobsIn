# Step 19: 自动投递 via Chrome Extension

## 版本: 0.9.0

## 变更内容

### 1. Chrome Extension 投递功能
- `content.js`: 新增 `applyJob()` 函数 — 查找并点击"立即沟通"按钮
- `content.js`: 新增 `sendGreetingInChat()` — 在聊天输入框输入文案并发送
- `background.js`: 新增 `apply_job` 命令处理器 — 导航到岗位页面并调用 content script

### 2. 后端投递实际发送
- `boss_applicant.py`: 完全重写，通过 `extension_bridge.send_command("apply_job")` 实际发送
- 支持单个投递和批量投递
- 批量投递使用 `ApplicationBatch` 模型跟踪进度
- 支持暂停/恢复批量投递和单个投递

### 3. 数据模型更新
- `models.py`: 新增 `ApplicationBatch` 表 (id, status, total, completed, failed, created_at)
- `models.py`: `Application` 新增 `batch_id` 字段关联到批次
- `Application.status` 新增 `sending` 和 `paused` 状态

### 4. 后端路由更新 (applications.py)
- `GET /api/applications/batches` — 列出所有批次
- `GET /api/applications/batches/{id}` — 批次详情及包含的投递列表
- `POST /api/applications/batches/{id}/pause` — 暂停批次
- `POST /api/applications/batches/{id}/resume` — 恢复批次
- `POST /api/applications/{id}/pause` — 暂停单个投递

### 5. 前端投递页面重设计 (ApplicationsPage.tsx)
- 视图模式切换：全部 / 单个 / 批次
- 单个投递：完整岗位信息卡片 (标题、公司、薪资、城市、标签、AI匹配度、文案)
- 批次投递：可折叠卡片，显示进度条、成功/失败统计，展开查看每个投递
- 暂停/恢复按钮支持批次和单个投递

### 6. API 客户端更新
- `api.ts`: 新增 `applications.listBatches`, `getBatch`, `pauseBatch`, `resumeBatch`, `pause`

## 投递流程

```
用户选择岗位 → 点击投递/批量投递
  ↓
后端创建 Application 记录 (status: sending)
  ↓
通过 extension_bridge 发送 apply_job 命令
  ↓
Chrome Extension background.js 导航到岗位页面
  ↓
content.js 点击"立即沟通" → 输入文案 → 发送
  ↓
返回结果 → 更新 status (sent / recorded / failed)
```
