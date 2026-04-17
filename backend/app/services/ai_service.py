from __future__ import annotations

"""AI 服务: 岗位匹配分析 + 沟通文案生成"""

import json
import logging

import httpx
from sqlmodel import select

from app.database import async_session
from app.models import SystemConfig, Job, Resume, JobAnalysis

logger = logging.getLogger(__name__)

ANALYZE_PROMPT = """\
你是一位资深的职业顾问。请根据以下岗位描述和求职者简历，做一个匹配度分析。

## 岗位信息
- 职位: {title}
- 公司: {company}
- 城市: {city}
- 薪资: {salary}
- 经验要求: {experience}
- 学历要求: {education}
- 标签: {tags}

## 岗位描述
{description}

## 求职者简历
{resume}

请严格按以下 JSON 格式返回（不要包含其他文字）：
{{
  "overall_score": 0.0到1.0之间的总体匹配度,
  "scores": {{
    "skill": 0.0到1.0,
    "experience": 0.0到1.0,
    "education": 0.0到1.0,
    "salary": 0.0到1.0
  }},
  "suggestion": "给求职者的简历优化建议，针对这个岗位，100字以内"
}}
"""

GREETING_PROMPT = """\
你是一位求职者，正在 Boss直聘 上找工作。请根据以下信息，生成一段简短自然的打招呼消息。

## 岗位信息
- 职位: {title}
- 公司: {company}

## 岗位描述（摘要）
{description_short}

## AI 匹配分析
- 匹配度: {score}%
- 建议: {suggestion}

## 我的简历
{resume}

要求：
1. 50-150字
2. 自然口语化，不要太正式
3. 体现你对该岗位的了解和匹配度
4. 不要说"我在Boss直聘上看到"之类的废话
5. 直接输出打招呼的文字，不要包含任何引号或其他格式
"""

KEYWORDS_PROMPT = """\
你是一位资深的职业顾问和招聘专家。请根据以下求职者简历，从多个角度分析并生成适合在招聘网站上搜索的关键词列表。

## 求职者简历
{resume}

请从以下多个维度生成搜索关键词：
1. 直接岗位名称（如：Python开发工程师、后端开发）
2. 技术栈关键词（如：Java开发、React前端）
3. 行业+岗位组合（如：金融科技开发、电商后端）
4. 更广泛/高级的岗位（如：全栈工程师、技术负责人）
5. 求职者可能感兴趣的相关岗位

请严格按以下 JSON 格式返回（不要包含其他文字）：
{{
  "keywords": [
    {{
      "keyword": "搜索关键词",
      "reason": "为什么推荐这个关键词，15字以内",
      "city": "推荐城市（根据简历推断，如不确定写'全国'）"
    }}
  ]
}}

要求：
- 生成 8-15 个关键词
- 关键词要具体、实用，能在招聘网站上搜出结果
- 不要生成太宽泛的词（如"工程师"）
- 每个关键词搭配推荐城市
"""


async def _get_ai_config() -> dict:
    """从数据库读取 AI 配置"""
    async with async_session() as session:
        result = await session.execute(select(SystemConfig))
        rows = {r.key: r.value for r in result.scalars().all()}
    return {
        "api_key": rows.get("ai_api_key", ""),
        "base_url": rows.get("ai_base_url", "https://api.openai.com/v1"),
        "model": rows.get("ai_model", "gpt-4o-mini"),
    }


async def _chat(prompt: str) -> str:
    """调用 OpenAI 兼容 API"""
    cfg = await _get_ai_config()
    if not cfg["api_key"]:
        raise ValueError("请先在设置页面配置 AI API Key")

    url = f"{cfg['base_url'].rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": cfg["model"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()


def _parse_analysis_json(text: str) -> dict:
    """从 LLM 返回文本中提取 JSON"""
    # 尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 尝试提取 ```json ... ``` 块
    if "```" in text:
        start = text.find("```json")
        if start == -1:
            start = text.find("```")
        start = text.find("\n", start) + 1
        end = text.find("```", start)
        if end > start:
            try:
                return json.loads(text[start:end].strip())
            except json.JSONDecodeError:
                pass
    raise ValueError(f"无法解析 AI 返回的 JSON: {text[:200]}")


async def analyze_job(job_id: int) -> JobAnalysis:
    """分析岗位与简历的匹配度"""
    async with async_session() as session:
        job = await session.get(Job, job_id)
        if not job:
            raise ValueError(f"岗位 {job_id} 不存在")

        result = await session.execute(
            select(Resume).where(Resume.is_active == True)
        )
        resume = result.scalar_one_or_none()
        if not resume:
            raise ValueError("请先创建并激活一份简历")

        prompt = ANALYZE_PROMPT.format(
            title=job.title,
            company=job.company,
            city=job.city,
            salary=job.salary,
            experience=job.experience,
            education=job.education,
            tags=job.tags,
            description=job.description[:2000],
            resume=resume.content[:3000],
        )

        raw = await _chat(prompt)
        parsed = _parse_analysis_json(raw)

        analysis = JobAnalysis(
            job_id=job.id,
            overall_score=float(parsed.get("overall_score", 0)),
            scores_json=json.dumps(parsed.get("scores", {}), ensure_ascii=False),
            suggestion=parsed.get("suggestion", ""),
        )
        session.add(analysis)
        await session.commit()
        await session.refresh(analysis)
        return analysis


async def generate_greeting(job_id: int) -> str:
    """为指定岗位生成打招呼文案"""
    async with async_session() as session:
        job = await session.get(Job, job_id)
        if not job:
            raise ValueError(f"岗位 {job_id} 不存在")

        # 找最新的分析结果
        result = await session.execute(
            select(JobAnalysis)
            .where(JobAnalysis.job_id == job_id)
            .order_by(JobAnalysis.created_at.desc())
            .limit(1)
        )
        analysis = result.scalar_one_or_none()
        if not analysis:
            raise ValueError("请先对该岗位进行 AI 分析")

        result = await session.execute(
            select(Resume).where(Resume.is_active == True)
        )
        resume = result.scalar_one_or_none()
        if not resume:
            raise ValueError("请先创建并激活一份简历")

        prompt = GREETING_PROMPT.format(
            title=job.title,
            company=job.company,
            description_short=job.description[:500],
            score=int(analysis.overall_score * 100),
            suggestion=analysis.suggestion,
            resume=resume.content[:2000],
        )

        greeting = await _chat(prompt)

        # 保存到 analysis
        analysis.greeting_text = greeting
        session.add(analysis)
        await session.commit()

        return greeting


async def suggest_keywords(resume_id: int) -> list[dict]:
    """根据简历内容生成搜索关键词建议"""
    async with async_session() as session:
        resume = await session.get(Resume, resume_id)
        if not resume:
            raise ValueError(f"简历 {resume_id} 不存在")

        prompt = KEYWORDS_PROMPT.format(resume=resume.content[:4000])
        raw = await _chat(prompt)
        parsed = _parse_analysis_json(raw)
        return parsed.get("keywords", [])
