# Step 22: 修复投递超时 (content script 响应超时)

## 版本: 1.2.1

## 问题描述
投递岗位时报错 "content script 响应超时" 和 "命令执行超时"，弹窗出现但文案未输入。

## 根因分析
1. **background.js 错误处理不完整**: `handleApplyJob` catch 块只匹配 Chrome 原生错误 (`back/forward cache`, `message channel is closed`)，不匹配自定义超时错误 (`content script 响应超时`)。当 content script 被页面跳转销毁时，timeout 先于 Chrome 错误触发，导致聊天页跳转检测被跳过。
2. **"继续沟通" 检测过于宽泛**: `isFriend || redirectUrl` 条件中，`redirectUrl` 可能在 "立即沟通" 按钮上也存在，导致误判为 "继续沟通" 场景。
3. **`handleChatPageGreeting` 缺少导航等待**: 直接延时 2.5s 后发送消息，不检查是否真的到了聊天页，也不重试。

## 修复内容

### chrome_extension/background.js
- `handleApplyJob` catch 块: 移除特定错误消息检测，改为所有异常都检查当前 tab URL 是否跳转到聊天页
- `handleChatPageGreeting`: 增加 `waitForNavigation` 等待确认到达聊天页，增加 3 次重试机制
- 添加详细日志

### chrome_extension/content.js
- `applyJob` 中 "继续沟通" 检测条件: `isFriend || redirectUrl` → `isFriend || btnText.includes('继续沟通')`，避免 `redirect-url` 属性导致误判

## 修改文件
- `chrome_extension/background.js`
- `chrome_extension/content.js`
- `backend/app/main.py` (版本号 → 1.2.1)
