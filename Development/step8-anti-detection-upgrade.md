# Step 8: 反检测升级 + 浏览器模式切换

## 完成内容

### 反检测全面升级 (anti_detection.py)
- **CDP 端口探测拦截**: 拦截 Boss直聘 JS 对 ws://127.0.0.1:9222 等调试端口的 WebSocket 连接
- **WebGL/Canvas 指纹伪造**: 返回 Intel GPU 信息，Canvas 添加噪点
- **完整 Chrome 对象伪造**: runtime API、loadTimes、csi、app 全模拟
- **mimeTypes/platform/permissions 伪造**
- **移除 Playwright 特征**: `__playwright`、`__pw_manual` 等全清除
- **人类行为模拟函数**: 鼠标移动、页面滚动、验证码检测、账号限制检测

### 浏览器启动策略 (browser.py)
- **优先级**: 系统 Chrome → channel=chrome → Playwright Chromium
- **独立 user-data-dir**: 避免和用户正在使用的 Chrome 冲突
- **about:blank 重试**: 被重定向到 about:blank 时自动重试 3 次
- **模式切换**: `restart()` 方法关闭后以新模式重启

### Headed/Headless 前端开关 (BrowserPanel.tsx)
- Switch 组件切换有头/无头模式
- 运行中切换自动调 restart API
- 状态同步显示当前模式

### 新增 API
- `POST /api/browser/restart?headless=true|false` — 模式热切换

## 参考来源
- `boss-zhipin-automation`: cleanup + relaunch 策略、viewport=None、完整反检测 JS
- `jobclaw`: cookie 管理策略
- `browser-use`: 大量禁用特性列表
