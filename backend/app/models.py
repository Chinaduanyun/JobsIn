from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field


# ── Jobs ─────────────────────────────────────────────────────────────────

class Job(SQLModel, table=True):
    __tablename__ = "jobs"

    id: Optional[int] = Field(default=None, primary_key=True)
    platform: str = Field(default="boss", index=True)  # boss / zhaopin / job51 / liepin
    title: str
    company: str
    salary: str = ""
    city: str = ""
    experience: str = ""
    education: str = ""
    description: str = ""
    url: str = Field(default="", index=True)
    hr_name: str = ""
    hr_title: str = ""
    hr_active: str = ""  # "在线" / "刚刚活跃" / "3日内活跃" ...
    company_size: str = ""
    company_industry: str = ""
    tags: str = ""  # 逗号分隔
    task_id: Optional[int] = Field(default=None, foreign_key="collection_tasks.id")
    collected_at: datetime = Field(default_factory=datetime.utcnow)


# ── AI 分析 ──────────────────────────────────────────────────────────────

class JobAnalysis(SQLModel, table=True):
    __tablename__ = "job_analyses"

    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="jobs.id", index=True)
    overall_score: float = 0.0  # 0-1
    scores_json: str = "{}"  # {"skill": 0.8, "salary": 0.6, ...}
    suggestion: str = ""  # AI 的简历优化建议
    greeting_text: str = ""  # AI 生成的沟通文案
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ── 投递记录 ─────────────────────────────────────────────────────────────

class Application(SQLModel, table=True):
    __tablename__ = "applications"

    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="jobs.id", index=True)
    greeting_text: str = ""
    status: str = "pending"  # pending / sent / failed
    applied_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ── 简历 ─────────────────────────────────────────────────────────────────

class Resume(SQLModel, table=True):
    __tablename__ = "resumes"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = "默认简历"
    content: str = ""  # Markdown
    is_active: bool = Field(default=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ── 采集任务 ─────────────────────────────────────────────────────────────

class CollectionTask(SQLModel, table=True):
    __tablename__ = "collection_tasks"

    id: Optional[int] = Field(default=None, primary_key=True)
    platform: str = Field(default="boss", index=True)  # boss / zhaopin / job51 / liepin
    keyword: str
    city: str = "全国"
    city_code: str = "100010000"
    salary: str = ""
    status: str = "pending"  # pending / running / completed / failed / cancelled
    total_collected: int = 0
    max_pages: int = 5
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ── 系统配置 ─────────────────────────────────────────────────────────────

class SystemConfig(SQLModel, table=True):
    __tablename__ = "system_config"

    key: str = Field(primary_key=True)
    value: str = ""
