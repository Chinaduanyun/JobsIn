# Step 26: 采集任务添加页数设置

## 版本: 1.3.2

## 改动内容

### TasksPage.tsx — 新增"最大页数"输入框
- 任务创建表单添加第5列: 最大页数 (1-50)，默认值 5
- 提示文字: "每页约30个岗位"
- `max_pages` 参数通过 `tasksApi.create()` 传递给后端

### 关于"15个岗位就停了"
采集流程: 每页采集列表 → 逐个抓取详情页。如果某页 `scrape_page()` 返回空（无结果），则停止翻页。
Boss直聘不同关键词/城市的搜索结果数量不同，部分关键词可能只有1页15个结果。
可以通过日志 `backend/data/` 查看具体停止原因。

### ResumesPage.tsx 保存按钮
代码中已有保存按钮（line 98），如看不到请重新构建前端: `cd frontend && npx vite build`

## 修改文件
- `frontend/src/pages/TasksPage.tsx`
- `backend/app/main.py` (版本号 → 1.3.2)
