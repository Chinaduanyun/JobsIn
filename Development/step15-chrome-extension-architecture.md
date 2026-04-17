# Step 15: Chrome Extension 采集架构 v0.5.0

## 核心变更：从 CDP 到 Chrome Extension

### 问题
Chrome CDP 连接本身会被 zhipin.com 检测到，导致页面跳转到 about:blank。
即使不注入 stealth，CDP 协议本身暴露了自动化特征。

### 解决方案
使用 **Chrome Extension** 替代 CDP。Chrome 以 100% 正常模式运行：
- 无 CDP 连接、无 Playwright 控制、无 stealth 注入
- Extension 通过 content script 从 DOM 提取数据
- Extension 通过 HTTP 与后端通信

## 架构

```
[后端 FastAPI]  ←── HTTP ──→  [Chrome Extension]  ←── DOM ──→  [zhipin.com]
                                    │
                              background.js (轮询命令)
                              content.js   (DOM提取)
                              popup.html   (状态面板)
```

### 通信流程
1. 后端 scraper 发命令到队列 (`extension_bridge.send_command()`)
2. Extension background.js 每1.5秒轮询 `GET /api/extension/command`
3. Extension 通过 `chrome.tabs` 导航到目标 URL
4. Content script 从 DOM 提取岗位数据
5. Extension 将结果 POST 到 `POST /api/extension/result`
6. 后端 bridge 通过 asyncio.Future 唤醒等待中的 scraper

### 命令类型
| 命令 | 说明 |
|------|------|
| `navigate_and_extract_jobs` | 导航到搜索页 → 提取岗位卡片 |
| `navigate_and_extract_detail` | 导航到详情页 → 提取 JD |
| `ping` | 连接检测 |

## 新增文件

| 文件 | 说明 |
|------|------|
| `chrome_extension/manifest.json` | Extension 配置 (Manifest V3) |
| `chrome_extension/background.js` | Service Worker: 轮询命令、执行导航 |
| `chrome_extension/content.js` | Content Script: DOM 数据提取 |
| `chrome_extension/popup.html` | Popup UI: 连接状态 |
| `chrome_extension/popup.js` | Popup 逻辑 |
| `backend/app/services/extension_bridge.py` | 通信桥接：命令队列 + Future |
| `backend/app/routes/extension.py` | Extension API 端点 |

## 修改文件

| 文件 | 改动 |
|------|------|
| `backend/app/services/boss_scraper.py` | 完全重写：使用 extension_bridge 替代 CDP |
| `backend/app/services/browser.py` | 精简：移除 scrape 模式，仅保留登录 |
| `backend/app/services/base_scraper.py` | 前置检查增加扩展连接检测 |
| `backend/app/routes/tasks.py` | 增加扩展连接检查 |
| `backend/app/main.py` | 注册 extension router，版本 0.5.0 |
| `frontend/src/lib/api.ts` | 新增 extension API |
| `frontend/src/pages/TasksPage.tsx` | 扩展状态提示 |
| `frontend/src/pages/SettingsPage.tsx` | 扩展安装指南面板 |

## 安装扩展步骤
1. 打开 Chrome → `chrome://extensions/`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选 `chrome_extension` 文件夹
4. 扩展自动开始轮询后端
