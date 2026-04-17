# Step 17: 插件陪伴模式

## 版本
- 后端: v0.7.0
- 扩展: v1.1.0

## 功能概述

Chrome 插件新增两种工作模式切换：

### ⚡ 自动模式 (Auto)
- 原有功能，后端下发采集命令，插件自动执行
- 适合批量采集大量岗位

### 👀 陪伴模式 (Companion)
- 用户手动浏览 Boss 直聘
- 当打开岗位详情页时，插件自动提取岗位信息并保存到后端
- Badge 提示：✓ 绿色=已保存，⊘ 黄色=已存在
- URL 去重，同一岗位不会重复保存
- 模式切换持久化到 chrome.storage

## 修改文件

### 后端
- `backend/app/routes/extension.py` — 新增 `POST /api/extension/companion-save` 端点
- `backend/app/main.py` — 版本号 → 0.7.0

### Chrome 扩展
- `chrome_extension/manifest.json` — 版本号 → 1.1.0
- `chrome_extension/background.js` — 添加陪伴模式逻辑：URL 监听、自动提取、保存
- `chrome_extension/content.js` — 新增 `extract_full_job` 处理器（从详情页提取完整数据）
- `chrome_extension/popup.html` — 新增模式切换 UI
- `chrome_extension/popup.js` — 新增模式切换逻辑

### 前端
- `frontend/src/pages/ApplicationsPage.tsx` — 投递列表增强（AI 匹配度、薪资、沟通文案展示）

## 技术细节

### 陪伴模式流程
1. 用户在 popup 中选择"陪伴模式"
2. background.js 停止轮询后端命令
3. 监听 `chrome.tabs.onUpdated` 事件
4. URL 匹配 `zhipin.com/job_detail/` 时触发
5. 向 content script 发送 `extract_full_job` 消息
6. content.js 从详情页 DOM 提取标题/薪资/公司/描述等
7. background.js POST 到 `/api/extension/companion-save`
8. 后端按 URL 去重后存入 jobs 表 (task_id=null)
