# Step 4: 岗位采集模块

## 完成内容

### boss_scraper.py (新建)
- `BossScraper` 类，核心方法:
  - `run_task(task_id)`: 从数据库读取采集任务，循环翻页搜索+抓取详情
  - `_scrape_page(keyword, city_code, salary, page)`: 构造搜索URL，JS evaluate提取岗位卡片
  - `_fetch_detail(url)`: 打开JD详情页提取完整描述、标签、公司信息
  - `_save_job(raw, detail, task_id)`: 去重(URL)后写入数据库
- 内置26个城市编码 (全国/北京/上海/深圳/广州/杭州等)
- Boss直聘薪资字体加密解码 (Unicode 0xE031-0xE03A → 0-9)
- 翻页延迟3-8秒，JD详情延迟1-3秒
- 支持任务取消 (`_cancel_flag`)

### tasks.py (修改)
- `start_task`: 检查浏览器启动+登录状态，用 `asyncio.create_task` 后台运行采集
- `cancel_task`: 通过 scraper 的 cancel flag 中断采集
- 新增 `GET /api/tasks/cities` 端点返回城市编码字典

### 前端类型对齐
- `types/index.ts`: Job/JobAnalysis/CollectionTask 字段与后端模型一致
- `api.ts`: tasks.cities() 方法，create参数更新
- `TasksPage.tsx`: salary_range→salary, collected_count→total_collected
- `JobsPage.tsx`: boss_name→hr_name, match_score→overall_score

## API 端点
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/tasks | 任务列表 |
| POST | /api/tasks | 创建任务 |
| POST | /api/tasks/{id}/start | 启动采集 |
| POST | /api/tasks/{id}/cancel | 取消采集 |
| DELETE | /api/tasks/{id} | 删除任务 |
| GET | /api/tasks/cities | 城市编码字典 |
