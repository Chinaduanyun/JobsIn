# Step 25: 简历页面简化为单简历表单

## 版本: 1.3.1

## 改动内容

### ResumesPage.tsx — 完全重写
- 移除多简历列表/创建/删除/切换功能
- 改为"我的简历"单页表单：一个名称输入框 + 一个大文本框
- 自动加载已有的活跃简历
- 保存按钮（新建或更新同一份简历）
- 保存成功后显示绿色 ✓ 提示
- 底部显示内容预览
- 提供 placeholder 模板（个人信息/求职意向/工作经历/技能）

### AppLayout.tsx
- 侧栏导航 "简历管理" → "我的简历"

## 说明
- 后端 API (resumes CRUD) 保持不变，前端只使用一份简历
- AI 分析和文案生成使用 `is_active=True` 的简历（行为不变）
- 采集任务"最大5页"含义：Boss直聘搜索结果每页约30个岗位，最大5页 ≈ 最多150个岗位

## 修改文件
- `frontend/src/pages/ResumesPage.tsx`
- `frontend/src/components/layout/AppLayout.tsx`
- `backend/app/main.py` (版本号 → 1.3.1)
