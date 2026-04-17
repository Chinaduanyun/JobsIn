# Step 10: 浏览器反检测修复

## 问题演进

### 第一轮修复: 移除 stealth JS 注入
参考 `references/security.ts` 发现 zhipin.com 被明确列为 **STEALTH_SKIP_HOSTS**。
我们移除了所有 stealth JS 注入，改为手动登录流程。

### 第二轮修复: subprocess Chrome + CDP 连接
即使移除 stealth JS，Playwright 的 `launch_persistent_context` 仍会注入自动化标记。
zhipin.com 能检测到这些标记，继续触发 about:blank 和 security.html 循环。

**解决方案**: 彻底脱离 Playwright 的浏览器启动流程：
1. 用 `subprocess.Popen` 直接启动系统 Chrome（`--remote-debugging-port`）
2. 用 Playwright `connect_over_cdp` 连接已运行的 Chrome
3. Chrome 进程完全原生，没有任何 Playwright 注入的自动化指纹

## 当前架构 (browser.py)

```
subprocess.Popen(chrome, --remote-debugging-port=<random>, --user-data-dir=...)
        ↓
Playwright connect_over_cdp("http://127.0.0.1:<port>")
        ↓
正常操作 page (goto / click / evaluate 等)
```

- Chrome 进程由我们自己管理（启动/终止）
- 端口随机分配，避免冲突
- `_kill_chrome()` 在 close() 时清理进程
- 支持 `--headless=new` 和 headed 模式切换

## 登录流程

1. 用户启动浏览器（建议有头模式）
2. 点击「打开登录页面」→ 浏览器导航到登录页
3. 用户在浏览器中手动扫码/登录
4. 登录完成后点击「我已登录」→ 程序验证登录状态
5. 下次启动浏览器时，profile 中的 cookie 自动生效，无需重复登录
