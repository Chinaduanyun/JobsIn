# Step 20: HR 活跃度字段与筛选 + 删除级联 + 智能全选

## 变更内容

### 问题 1: HR 活跃度
- 很多 HR 长期不上线，给不活跃的 HR 发投递信息没有价值
- `extractJobs()` 列表页采集只存 `"在线"` 或空字符串，丢失了具体活跃时间

### 问题 2: 删除不彻底
- 删除岗位时只删除 `Job` 记录，不删关联的 `JobAnalysis` 和 `Application`
- SQLite 会复用自增 ID，导致新岗位继承旧的 AI 分析结果

### 问题 3: 全选不够智能
- 只有一个"全选"按钮，无法快速选中"未分析"或"未生成文案"的岗位

### 修改

#### 1. Chrome 扩展 — content.js
- `extractJobs()`: `.boss-online-tag` 读取 `textContent.trim()` (刚刚活跃/今日活跃等)

#### 2. 后端 — routes/jobs.py
- `list_jobs()` 新增 `hr_active` 筛选参数 (online/active/inactive)
- `delete_job()` + `batch_delete_jobs()`: 级联删除 JobAnalysis + Application

#### 3. 前端 — JobsPage.tsx
- HR活跃度筛选按钮 (全部HR / 🟢在线 / 🔵近期活跃 / ⚪不活跃)
- 全选按钮拆分: 全选 / 未分析(N) / 未生成文案(N)
- HR活跃标签颜色编码 (绿/蓝/灰)

#### 4. 前端 — JobDetailDrawer.tsx
- HR Badge 颜色编码

### 版本
- Backend: 1.0.0 → 1.1.0
