# Step 20: HR 活跃度字段与筛选

## 变更内容

### 问题
- 很多 HR 长期不上线，给不活跃的 HR 发投递信息没有价值
- `extractJobs()` 列表页采集只存 `"在线"` 或空字符串，丢失了具体活跃时间
- 没有按 HR 活跃度筛选岗位的能力

### 修改

#### 1. Chrome 扩展 — content.js
- `extractJobs()`: `.boss-online-tag` 改为读取 `textContent.trim()` 而非硬编码 `'在线'`
- 现在能采集到: "在线", "刚刚活跃", "今日活跃", "3日内活跃", "本周活跃", "2周内活跃", "本月活跃", "半年前活跃" 等
- `extractFullJob()` (详情页) 已经正确采集，无需修改

#### 2. 后端 — routes/jobs.py
- `list_jobs()` 新增 `hr_active` 查询参数:
  - `online`: 仅在线 (在线, 刚刚活跃)
  - `active`: 近期活跃 (在线, 刚刚活跃, 今日活跃, 3日内活跃, 本周活跃)
  - `inactive`: 不活跃 (超过一周或无信息)

#### 3. 前端 — JobsPage.tsx
- 新增 HR 活跃度筛选按钮行: 全部HR / 🟢在线 / 🔵近期活跃 / ⚪不活跃
- HR 活跃标签颜色编码:
  - 绿色: 在线、刚刚活跃
  - 蓝色: 今日活跃、3日内活跃、本周活跃
  - 灰色: 其他 (2周内、本月、半年前等)

#### 4. 前端 — JobDetailDrawer.tsx
- HR 活跃 Badge 同样添加颜色编码

#### 5. 前端 — api.ts
- `jobs.list()` 支持 `hr_active` 参数

### 版本
- Backend: 1.0.0 → 1.1.0
