# Step 26: 采集任务页数设置 + 时区修复

## 版本: 1.3.3

## 改动内容

### 1. TasksPage.tsx — 新增"最大页数"输入框
- 任务创建表单添加第5列: 最大页数 (1-50)，默认值 5
- 提示文字: "每页约30个岗位"
- `max_pages` 参数通过 `tasksApi.create()` 传递给后端

### 2. 时区修复 — UTC → 上海时区 (UTC+8)
- `models.py`: 新增 `SHANGHAI_TZ` 和 `now_shanghai()` 工具函数
- 所有 model 的 `default_factory` 从 `datetime.utcnow` → `now_shanghai`
- `routes/resumes.py`: `resume.updated_at` 使用 `now_shanghai()`
- `routes/applications.py`: 重新投递时间使用 `now_shanghai()`
- `services/boss_applicant.py`: 今日投递统计、投递时间全部使用 `now_shanghai()`

### 关于"15个岗位就停了"
Boss直聘不同关键词/城市的搜索结果数量不同，部分关键词可能只有1页15个结果。
如果 `scrape_page()` 返回空列表则停止翻页。可通过后端日志查看具体原因。

## 修改文件
- `frontend/src/pages/TasksPage.tsx`
- `backend/app/models.py`
- `backend/app/routes/resumes.py`
- `backend/app/routes/applications.py`
- `backend/app/services/boss_applicant.py`
- `backend/app/main.py` (版本号 → 1.3.3)
