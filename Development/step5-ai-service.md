# Step 5: 简历管理 + AI 分析

## 完成内容

### ai_service.py (新建)
- `analyze_job(job_id)`: 从数据库取岗位+活跃简历，调 OpenAI 兼容 API 做匹配分析
  - 返回 JSON: overall_score(0-1), scores(skill/experience/education/salary), suggestion
  - 自动解析 LLM 返回的 JSON (支持 ```json 代码块)
  - 分析结果存入 job_analyses 表
- `generate_greeting(job_id)`: 根据岗位+分析+简历生成打招呼文案
  - 50-150字，口语化，存入 analysis.greeting_text
- `_chat(prompt)`: 通用 OpenAI 兼容 API 调用
  - 从 SystemConfig 读取 api_key / base_url / model
  - 使用 httpx 异步请求，60秒超时

### ai.py (重写)
- `POST /api/ai/analyze` — 分析岗位匹配度
- `POST /api/ai/greeting` — 生成沟通文案
- `GET /api/ai/analysis/{job_id}` — 获取已有分析结果

### resumes.py (新增端点)
- `POST /api/resumes/{id}/activate` — 激活指定简历(取消其余)

### 前端 api.ts (修改)
- ai.analyze / ai.greeting 改为 POST body 传 job_id
- 新增 ai.getAnalysis(jobId) 获取已有分析

## API 端点
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/ai/analyze | AI分析岗位匹配度 |
| POST | /api/ai/greeting | AI生成沟通文案 |
| GET | /api/ai/analysis/{job_id} | 获取分析结果 |
| POST | /api/resumes/{id}/activate | 激活简历 |
