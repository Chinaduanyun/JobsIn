# Step 11: HTTP 采集模式重构 + 功能增强

## 变更内容

### 1. HTTP 采集模式 (核心重构)
- `browser.py` — 移除 scrape 模式，新增 cookie 导出和持久化
- `boss_scraper.py` — 纯 httpx + Boss JSON API 采集
- `base_scraper.py` — 检查 cookies 而非 browser.launched
- 登录验证改为检查 cookie token 而非导航页面

### 2. 详细日志
- `main.py` — 添加 DEBUG 级别日志配置
- `base_scraper.py` — 每步操作输出日志（翻页、详情、保存、去重）
- `boss_scraper.py` — API 请求/响应/解析全程日志

### 3. 可配置采集速度
- 系统设置新增：翻页间隔、详情间隔、投递间隔
- `config.py` — DEFAULTS 添加 scrape_page_delay, scrape_detail_delay, apply_delay
- 前端设置页新增"采集 & 投递速度"配置卡片

### 4. 信息提取优化
- 地区信息合并 cityName + areaDistrict + businessDistrict
- HR 活跃状态映射 bossOnline
- 详情页支持 __INITIAL_STATE__ JSON 解析
- 更多正则匹配备选方案

### 5. 批量投递功能
- `boss_applicant.py` — 新增 `batch_apply()` 带随机延迟
- `applications.py` — 新增 `/batch-apply` 端点
- `api.ts` — 新增 `batchApply` API
- `JobsPage.tsx` — 复选框批量选择 + 批量投递按钮

### 6. 前端更新
- `TasksPage.tsx` — 修复 browserReady 判断逻辑
- `BrowserPanel.tsx` — 简化为登录 + cookies 管理
- `SettingsPage.tsx` — 新增速度配置
