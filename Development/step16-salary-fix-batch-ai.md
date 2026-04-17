# Step 16: 薪资解析修复 + 批量AI分析 + 采集时间显示

## 变更概要

### 1. 薪资解析修复 (content.js)
- **问题**: Boss直聘使用自定义字体加密薪资数字，私用区 Unicode 字符 (U+E000-U+F8FF) 通过 @font-face 渲染为数字，但 `textContent` 读取的是原始字符
- **解决**: 添加 Canvas 字体解密器 `decodeFontEncryptedText()`
  - 用 Canvas 渲染私用区字符和标准数字 0-9
  - 对比像素签名（像素数量+加权位置）匹配最接近的数字
  - 如果解密失败，输出 `?` 标记
- **标题修复**: 提取标题时 clone 节点并移除 `.salary` 子元素，避免标题混入薪资文本
- **详情页薪资**: content.js 的 `extractDetail()` 也返回解密后的薪资
- **后端兜底**: base_scraper.py 在详情页薪资可用且列表薪资有乱码时，使用详情页薪资覆盖

### 2. 采集时间显示 (JobsPage.tsx)
- 岗位卡片右下角显示 `collected_at` 时间戳
- 使用相对时间格式: "刚刚"、"5分钟前"、"2小时前"、"3天前"
- 超过 30 天显示具体日期

### 3. 批量异步 AI 分析 + 文案生成
- **后端新端点**:
  - `POST /api/ai/batch-analyze` — 接收 `{job_ids: []}`, 后台异步逐个分析
  - `POST /api/ai/batch-greeting` — 接收 `{job_ids: []}`, 后台异步逐个生成文案
  - `GET /api/ai/batch-status/{batch_id}` — 查询进度 `{total, completed, failed, status}`
- **前端**:
  - JobsPage 批量操作栏新增 "AI分析" 和 "生成文案" 按钮
  - 批量操作启动后轮询进度，显示实时完成数
  - 完成后自动刷新岗位列表

## 修改文件
- `chrome_extension/content.js` — 字体解密 + 标题/薪资提取修复
- `backend/app/routes/ai.py` — 新增批量分析/文案端点
- `backend/app/services/base_scraper.py` — 薪资后备逻辑
- `backend/app/services/boss_scraper.py` — 返回详情页薪资
- `frontend/src/pages/JobsPage.tsx` — 采集时间 + 批量AI按钮
- `frontend/src/lib/api.ts` — 新增批量AI API
