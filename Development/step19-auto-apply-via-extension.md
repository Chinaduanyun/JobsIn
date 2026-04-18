# Step 19: 自动投递 via Chrome Extension

## 版本: 0.9.0

## 变更内容

### 1. Chrome Extension 投递功能 (重写)
- `content.js`: 重写 `applyJob()` — 精确选择器避免误点"感兴趣"按钮
  - 优先使用 `a.btn.btn-startchat` 精确匹配
  - 支持 `data-isfriend` 属性检测
  - 处理两种场景：弹窗对话框 (首次沟通) 和聊天页跳转 (已是好友)
- `content.js`: 新增 `tryPopupGreeting()` — 处理首次沟通的弹窗 (含"请简短描述您的问题"输入框)
- `content.js`: 新增 `sendGreetingOnChatPage()` — 在 `/web/geek/chat` 页面输入文案 (使用 `#chat-input` + `.btn-send`)
- `content.js`: 新增 `typeIntoInput()` — 统一输入函数 (支持 textarea/input/contenteditable)
- `background.js`: `apply_job` 命令处理器 — 导航到岗位页面并调用 content script

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
- `POST /api/applications/{id}/retry` — 重新投递 (recorded/failed/paused 状态)

### 5. 前端投递页面重设计 (ApplicationsPage.tsx)
- 视图模式切换：全部 / 单个 / 批次
- 单个投递：分栏卡片 (对齐 JobsPage 风格)
- 批次投递：可折叠卡片，显示进度条、成功/失败统计
- 暂停/恢复/重新投递按钮
- 重试按钮：recorded/failed/paused 状态可点击重新投递

### 6. 页面实时刷新
- JobsPage: 5s 自动刷新
- DashboardPage: 5s 自动刷新
- ApplicationsPage: 10s 自动刷新

### 7. API 客户端更新
- `api.ts`: 新增 `applications.listBatches`, `getBatch`, `pauseBatch`, `resumeBatch`, `pause`, `retry`

## 投递流程

```
用户选择岗位 → 点击投递/批量投递
  ↓
后端创建 Application 记录 (status: sending)
  ↓
通过 extension_bridge 发送 apply_job 命令
  ↓
Chrome Extension background.js 导航到岗位详情页
  ↓
content.js applyJob():
  1. 找 a.btn.btn-startchat (精确选择器)
  2. 点击按钮
  3a. 首次沟通 → 弹窗出现 → tryPopupGreeting() → 输入文案 → 发送
  3b. 已是好友 → 跳转 /web/geek/chat → sendGreetingOnChatPage() → 输入 → 发送
  ↓
返回结果 → 更新 status (sent / recorded / failed)
```

## Boss直聘按钮选择器 (2025 验证)

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 立即沟通 | `a.btn.btn-startchat` | data-isfriend="false" |
| 继续沟通 | `a.btn.btn-startchat` | data-isfriend="true" |
| 聊天输入框 | `#chat-input` | 聊天页面 |
| 发送按钮 | `.btn-send` | 聊天页面 (兜底) |
| 弹窗输入框 | placeholder 含 "描述"/"问题" | 首次沟通弹窗 |
| 发送方式 | Enter 键 | **主要方式** — 输入框按回车即可发送 |

## Step 20: Enter 键发送修复 (v0.9.1)

### 问题
文案成功输入到 Boss直聘输入框，但点击发送按钮无效。用户发现按 Enter 键即可发送。

### 修复
- `content.js`: 新增 `pressEnterToSend()` — 模拟 Enter 键 (keydown → keypress → keyup)
- `tryPopupGreeting()`: 输入文案后优先用 Enter 发送，点击按钮作为兜底
- `sendGreetingOnChatPage()`: 同上
- 参考 ai-job-master 项目：该项目完全绕过 DOM，通过 API + WebSocket/protobuf 发送消息

### Bug: 投递状态始终显示 "recorded" 而非 "sent"
- **原因**: content.js 返回 `{ success, data: { sent: true } }`，background.js 又包了一层 `{ success, data: response }`，导致双层嵌套。`boss_applicant.py` 只解了一层，读不到 `sent` 字段。
- **修复**: `_send_via_extension()` 现在正确解嵌套结构，优先从 `data.data.sent` 取值。
