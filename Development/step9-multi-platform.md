# Step 9: 多平台采集支持

## 完成日期
2024-xx-xx (自动填充)

## 变更内容

### 模型更新
- `Job` 和 `CollectionTask` 添加 `platform` 字段（默认 `"boss"`）
- `database.py` 添加轻量级迁移逻辑，自动给已有数据库表加字段

### 采集器架构
- 新增 `base_scraper.py` — 抽象基类，封装通用的任务生命周期管理
- 重构 `boss_scraper.py` — 继承 `BaseScraper`，移除冗余代码
- 新增 `zhaopin_scraper.py` — 智联招聘采集器
- 新增 `job51_scraper.py` — 前程无忧采集器
- 新增 `liepin_scraper.py` — 猎聘采集器
- 新增 `scraper_factory.py` — 工厂模式，统一获取采集器实例

### 路由更新
- `tasks.py` — 任务创建/启动/取消/城市列表均支持 `platform` 参数
- 新增 `GET /tasks/platforms` 端点

### 前端更新
- `types/index.ts` — Job 和 CollectionTask 添加 platform 字段，新增 Platform 类型
- `api.ts` — tasks.create 支持 platform，cities 接受 platform 参数
- `TasksPage.tsx` — 新建任务表单添加平台下拉选择器，任务卡片显示平台标签
- `JobsPage.tsx` — 岗位卡片显示平台彩色标签

## 支持的平台
| 平台 | key | 状态 |
|------|-----|------|
| Boss直聘 | boss | ✅ 生产可用 |
| 智联招聘 | zhaopin | ⚠️ 需实际验证选择器 |
| 前程无忧 | job51 | ⚠️ 需实际验证选择器 |
| 猎聘 | liepin | ⚠️ 需实际验证选择器 |
