# Step 11: HTTP 采集模式重构

## 背景
经 test1-test4 验证，zhipin.com 会检测 CDP 连接。纯 HTTP + cookies 是唯一可行的采集方式。

## 变更内容

### browser.py — 双模式简化
- 移除 `launch()` / `restart()` / scrape 模式（不再需要浏览器采集）
- 保留 `open_login_page()` — 纯 Chrome 登录
- 新增 `confirm_login()` — 关闭 Chrome + CDP 导出 cookies + 验证
- 新增 `refresh_cookies()` — 重新导出 cookies
- 新增 `cookie_header` 属性 — 返回 HTTP Cookie 字符串
- 新增 cookies 持久化 — 保存到 `data/cookies.json`，重启无需重新登录

### boss_scraper.py — 纯 HTTP 采集
- `scrape_page()` 改用 `httpx.AsyncClient` + Boss JSON API
- API: `wapi/zpgeek/search/joblist.json`
- `fetch_detail()` 改用 httpx 请求 HTML + regex 解析

### base_scraper.py
- `run_task()` 检查条件从 `boss_browser.launched` 改为 `boss_browser.cookies`

### routes/browser.py
- 移除 `/launch` 和 `/restart` 端点
- 新增 `/refresh-cookies` 端点

### routes/tasks.py
- `start_task` 检查改为 `logged_in + cookies`

### 前端
- `BrowserPanel.tsx` — 简化为登录 + cookies 管理
- `api.ts` — 移除 launch/restart，新增 refreshCookies
- `types/index.ts` — BrowserStatus 新增 cookies_count

## 采集流程
1. 用户点击"打开登录页面" → 纯 Chrome 打开
2. 用户手动登录 → 点击"我已登录"
3. 系统 headless CDP 导出 cookies → 保存到文件
4. 创建采集任务 → httpx + cookies 调用 API → 入库
