# Step 10: 浏览器反检测修复 — 移除 stealth 注入 + 手动登录

## 问题根因

参考 `references/security.ts` 发现 zhipin.com 被明确列为 **STEALTH_SKIP_HOSTS**：
> "Sites that actively detect stealth patches and break when injected."

我们之前注入的大量 stealth JS（WebSocket 拦截、Canvas 噪点、plugins 伪造等）
**反而触发了 zhipin.com 的检测机制**，导致 about:blank 重定向和 security.html 循环。

## 修复策略

### 反检测 (anti_detection.py)
- 移除所有 STEALTH_JS 注入（~170 行 JS 代码）
- 仅保留最小化启动参数 `--disable-blink-features=AutomationControlled`
- 不设 user_agent（让 Chrome 用真实 UA）
- 不设 bypass_csp（避免触发 CSP 检测）

### 浏览器管理 (browser.py)
- 系统 Chrome + persistent profile → 最像真人
- 移除 `add_init_script(STEALTH_JS)` 调用
- 移除 QR 码提取/轮询逻辑（减少页面交互）
- 新增 `open_login_page()` + `confirm_login()` 手动登录流程
- cookie 全靠 Chrome profile 目录持久化

### 路由 (routes/browser.py)
- 移除 `POST /login`, `GET /qrcode`
- 新增 `POST /open-login` — 打开登录页
- 新增 `POST /confirm-login` — 用户确认登录

### 前端 (BrowserPanel.tsx)
- 移除 QR 码显示和刷新逻辑
- 新增「打开登录页面」→「我已登录」两步流程
- 登录引导文案

## 登录流程

1. 用户启动浏览器（建议有头模式）
2. 点击「打开登录页面」→ 浏览器导航到登录页
3. 用户在浏览器中手动扫码/登录
4. 登录完成后点击「我已登录」→ 程序验证登录状态
5. 下次启动浏览器时，profile 中的 cookie 自动生效，无需重复登录
