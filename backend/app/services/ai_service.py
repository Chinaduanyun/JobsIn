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

GREETING_SYSTEM_PROMPT = """\
你是一位真实求职者，要在 Boss直聘 上给招聘方发送第一条消息。

目标：
让对方快速感觉到你认真看过岗位、经历有连接、表达自然，而且愿意继续聊。

写作原则：
- 像真人聊天，不像求职信，不像群发模板。
- 语气自然、礼貌、真诚，可以有一点情绪温度，但不要夸张、不要油腻。
- 每次都要主动变化句式，不要总复用同一个骨架。
- 不要默认使用“看到岗位里提到……”“这部分和我之前做的内容比较接近”“想了解下这个岗位前期更侧重……”这类固定句式。
- 只写 1 个最相关经历，必要时最多补 1 个，不要堆砌卖点。
- 可以表达真实动机，但不要自夸，不要喊口号。

生成前请先在心里完成，不要输出过程：
1. 判断这份岗位更适合高匹配 / 中匹配 / 低匹配哪种说法。
2. 从以下开头里选一种最自然的，不要总重复同一种：
   - 从岗位职责切入
   - 从业务场景切入
   - 从过往经历切入
   - 从个人动机切入
3. 从以下结尾里选一种最自然的问题，不要总重复同一种：
   - 问前期工作重点
   - 问团队当前重点方向
   - 问岗位更看重的能力
   - 问岗位实际更偏哪类工作

限制：
- 不要使用编号、项目符号、小标题。
- 不要逐条对应 JD。
- 不要逐条复述简历。
- 不要出现明显 AI 味的排比句。
- 不要为了匹配而夸大经历。
- 不要主动提及自己的不足。
- 不要提学校名称，除非输入里这个信息对岗位判断非常关键。

避免这些表达：
贵公司、非常感兴趣、十分适配、极度吻合、我的强项、沟通能力不成问题、期待您的回复、我在Boss直聘看到、如果你对我感兴趣、本人具备、能够胜任、望给予机会。

输出要求：
- 只输出最终消息。
- 长度控制在 90-160 字，复杂岗位最多 180 字。
- 不要解释，不要多个版本，不要加引号。
"""

GREETING_PROMPT = """\
请根据下面的信息生成一条 Boss 首次沟通文案。

岗位信息：
职位：{title}
公司：{company}
岗位描述摘要：{description_short}
匹配度：{score}%

简历信息：
{resume}

补充要求：
- 从岗位中抓一个最具体的职责、场景或能力点来写，不要泛泛而谈。
- 只选一个最相关经历来证明，不要把 RAG、Agent、评测、审核、数据分析全部塞进去。
- 如果岗位和经历强匹配，可以直接说做过类似事情。
- 如果是中等匹配，用“接近”“相关”“之前做过类似部分”这类更自然的说法。
- 如果是低匹配，不要硬贴，重点写可迁移能力和想确认的岗位重点。
- 文案里要有一点真实动机，但不要喊口号。
- 结尾留一个自然、容易回复的问题，并且尽量和前文不重复。
- 如果对方称呼明确且自然，允许使用“X老师您好”；否则优先普通问候或直接切入，不必每次都“您好”。
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


async def _chat(
    prompt: str,
    *,
    system_prompt: str | None = None,
    temperature: float = 0.7,
) -> str:
    """调用 OpenAI 兼容 API"""
    cfg = await _get_ai_config()
    if not cfg["api_key"]:
        raise ValueError("请先在设置页面配置 AI API Key")

    url = f"{cfg['base_url'].rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    body = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": temperature,
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
            resume=resume.content[:2000],
        )

        greeting = await _chat(
            prompt,
            system_prompt=GREETING_SYSTEM_PROMPT,
            temperature=0.95,
        )

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
