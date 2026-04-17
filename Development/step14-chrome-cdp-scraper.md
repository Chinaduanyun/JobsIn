# Step 14: Chrome CDP 浏览器采集模式 v0.4.0

## 核心变更

### 问题
- 纯 HTTP 请求被 code=37 拦截（JSON API 需要 __zp_stoken__）
- HTML 解析也失败：Boss 是 SPA，搜索页 HTML 只有 8856 bytes 空壳
- 结论：必须使用浏览器渲染后提取 DOM 数据

### 方案：真实 Chrome + CDP，不注入 stealth
参考 tandem-browser PR#25：zhipin 检测 stealth 注入，正确做法是**不注入任何 stealth**。

**采集流程：**
1. 启动真实 Chrome + `--remote-debugging-port`，使用用户 profile（保持登录态）
2. Playwright 通过 CDP 连接（不注入 stealth）
3. 导航到搜索页，等待 DOM 渲染
4. 用 `page.evaluate()` 从 DOM 提取岗位数据
5. 逐页翻页，每页随机延迟
6. 遇到安全验证（verify.html）→ 标记状态，前端提示用户

### 修改文件

| 文件 | 改动 |
|------|------|
| `backend/app/services/browser.py` | 新增 scrape 模式：launch_scraper, navigate, evaluate, get_page_content |
| `backend/app/services/boss_scraper.py` | 完全重写：DOM 提取替代 HTTP 请求 |
| `frontend/src/pages/TasksPage.tsx` | 安全验证检测 + 提示 |
| `backend/app/main.py` | 版本 0.4.0 |

### 安全验证处理
- 采集过程中如果遇到 `verify.html`，`security_check` 标志为 true
- 前端 TasksPage 检测到后显示红色警告
- Chrome 是可见的，用户可以直接在浏览器中完成验证
- 验证完成后，下次导航会自动继续

### DOM 提取选择器
- 岗位卡片: `.job-card-wrapper, .job-card-box`
- 岗位名称: `.job-name, .job-title`
- 薪资: `.salary`
- 公司: `.company-name a`
- 详情描述: `.job-sec-text, .job-detail-section`
