# Step 12: HTML 解析模式 + 版本系统

## 变更内容

### 问题
- JSON API (`joblist.json`) 被 zhipin 的 `__zp_stoken__` 机制拦截，返回 `code=37`
- `__zp_stoken__` 由前端 JS 动态计算，纯 HTTP 无法生成

### 解决方案
- **不再调用 JSON API**，改为请求搜索页 HTML
- 从 HTML 中提取 `__INITIAL_STATE__` JSON 数据（Boss 的 SSR 数据）
- 搜索页 HTML 已验证返回 200 OK，无需 stoken

### 修改文件

| 文件 | 改动 |
|------|------|
| `backend/app/services/boss_scraper.py` | 重写 `scrape_page`: HTML 解析替代 JSON API |
| `backend/app/main.py` | 版本号 0.3.0，新增 `/api/version` 端点 |
| `frontend/src/pages/SettingsPage.tsx` | 显示系统版本号 |
| `frontend/src/pages/TasksPage.tsx` | 默认城市改为杭州 |
| `backend/app/routes/tasks.py` | 默认城市改为杭州 |

### 技术细节

**HTML 解析流程：**
1. 请求 `https://www.zhipin.com/web/geek/job?query=xxx&city=xxx&page=N`
2. 正则提取 `__INITIAL_STATE__ = {...}`
3. JSON 解析，从多种可能路径查找 `jobList`
4. 提取岗位数据（与之前 JSON API 字段相同）

**Headers 增强：**
- 添加完整浏览器 headers: `Sec-Fetch-*`, `Accept-Language`, `Upgrade-Insecure-Requests`
- 模拟真实浏览器的文档请求特征

**版本系统：**
- 后端 `/api/version` 返回当前版本
- 前端设置页右上角显示版本 badge
- 每次更新递增版本号
