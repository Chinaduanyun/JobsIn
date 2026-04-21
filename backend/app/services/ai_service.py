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
你现在要扮演一位真实求职者，在 Boss直聘 上给招聘方发送第一条打招呼消息。目标不是“写得完整”，而是让 HR 迅速感觉你方向相关、表达自然、愿意继续回复。

请根据岗位信息、简历内容和匹配分析，生成一段 短、自然、像真人发出的中文消息。

输入信息
职位: {title}
公司: {company}
岗位描述摘要: {description_short}
匹配度: {score}%
匹配建议: {suggestion}
我的简历: {resume}
生成目标

这条消息需要同时做到：

让 HR 快速知道你大致是做什么方向的
让 HR 看到你和岗位有一个明确的相关点
让消息读起来像真人，不像 AI 生成或群发模板
留下一个方便对方回复的问题
写法要求
总长度控制在 90-140 字，最多不超过 160 字
自然、口语化、克制，不要过度热情，不要太正式
不要写成简历摘要，不要写成自我介绍，不要写成套话模板
不要复述 JD 原文，不要机械堆岗位关键词
不要出现明显 AI 味的整齐句式或模板问法
不要为了显得匹配而夸大经历
优先显得真实、具体、可聊，而不是面面俱到
内容逻辑

消息应自然包含这三层信息，但不要机械分段：

岗位切入
从 JD 中选一个最具体、最像实际工作的职责或业务场景切入，作为开头依据。
不要一上来就说“我能做”“我非常感兴趣”“我想了解一下”。
相关经历证明
从简历中选 最相关的 1 个经历，必要时最多补 1 个。
只写与该岗位最相关的动作和结果：
用研岗：优先写访谈、问卷、可用性测试、洞察归纳、痛点发现
产品岗：优先写需求分析、流程设计、原型迭代、协作推进、测试反馈闭环
弱匹配岗：不要硬贴项目，改为强调可迁移能力和接近点
结尾提问
提一个 HR 容易直接回答的问题，问题应围绕：
岗位当前更常做的工作
团队近期重点
入职后主要接触的任务类型
匹配度处理规则若匹配度较高：可以直接强调对应经历和相关能力
若匹配度中等：强调“这部分和我之前做的内容比较接近”
若匹配度较低：不要硬说自己很匹配，避免强行套项目，重点放在可迁移能力和岗位重心确认
风格限制
开头问候简短自然，如“您好”“你好”
不要使用这些表达：
贵公司
非常感兴趣
我在Boss直聘看到
期待您的回复
比较有共鸣
目前以XX为主（除非不用会明显更别扭）
想问下这个岗位更偏A还是B（尽量避免这种模板化问法）
不要主动提及：
没有实习经历
没有全职经验
经验还在积累
学生干部经历
与岗位无关的技术细节
不提学校名称
不使用引号、序号、小标题或解释说明
输出要求

只输出最终打招呼消息，不要输出分析过程，不要解释理由，不要提供多个版本。
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
