# Step 17: 插件陪伴模式 + 岗位卡片增强

## 版本
- 后端: v0.7.0
- 扩展: v1.1.0

## 功能概述

### Chrome 插件双模式

#### ⚡ 自动模式 (Auto)
- 原有功能，后端下发采集命令，插件自动执行
- 适合批量采集大量岗位

#### 👀 陪伴模式 (Companion)
- 用户手动浏览 Boss 直聘
- 当打开岗位详情页时，插件自动提取岗位信息并保存到后端
- Badge 提示：✓ 绿色=已保存，⊘ 黄色=已存在
- URL 去重，同一岗位不会重复保存
- 模式切换持久化到 chrome.storage

### 岗位列表卡片增强
- 左侧：平台标签 + 岗位标题 + 投递状态 + 薪资（醒目橙色）+ 公司城市 + 经验学历标签
- 右侧：AI 匹配度（分数+进度条）+ 建议 + 沟通文案预览（可滚动）
- 右侧仅在 AI 分析存在时显示内容
- 后端 list_jobs 接口现在返回 analysis 和 apply_status

## 修改文件

### 后端
- `backend/app/routes/extension.py` — 新增 `POST /api/extension/companion-save` 端点
- `backend/app/routes/jobs.py` — list_jobs 现在返回 analysis + apply_status
- `backend/app/main.py` — 版本号 → 0.7.0

### Chrome 扩展
- `chrome_extension/manifest.json` — 版本号 → 1.1.0
- `chrome_extension/background.js` — 添加陪伴模式逻辑
- `chrome_extension/content.js` — 新增 `extract_full_job` 处理器
- `chrome_extension/popup.html` — 新增模式切换 UI
- `chrome_extension/popup.js` — 新增模式切换逻辑

### 前端
- `frontend/src/pages/JobsPage.tsx` — 全新卡片布局（左右分栏，右侧 AI 预览）
- `frontend/src/pages/ApplicationsPage.tsx` — 投递列表增强
