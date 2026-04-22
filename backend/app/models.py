from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlmodel import SQLModel, Field

# 上海时区 UTC+8
SHANGHAI_TZ = timezone(timedelta(hours=8))


def now_shanghai() -> datetime:
    return datetime.now(SHANGHAI_TZ).replace(tzinfo=None)


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
    collected_at: datetime = Field(default_factory=now_shanghai)


# ── AI 分析 ──────────────────────────────────────────────────────────────

class JobAnalysis(SQLModel, table=True):
    __tablename__ = "job_analyses"

    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="jobs.id", index=True)
    overall_score: float = 0.0  # 0-1
    scores_json: str = "{}"  # {"skill": 0.8, "salary": 0.6, ...}
    suggestion: str = ""  # AI 的简历优化建议
    greeting_text: str = ""  # AI 生成的沟通文案
    created_at: datetime = Field(default_factory=now_shanghai)


# ── 投递批次 ──────────────────────────────────────

class ApplicationBatch(SQLModel, table=True):
    __tablename__ = "application_batches"

    id: Optional[int] = Field(default=None, primary_key=True)
    status: str = "running"  # running / paused / completed / failed
    total: int = 0
    completed: int = 0
    failed: int = 0
    created_at: datetime = Field(default_factory=now_shanghai)


# ── 投递记录 ─────────────────────────────────────────────────────────────

class Application(SQLModel, table=True):
    __tablename__ = "applications"

    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="jobs.id", index=True)
    batch_id: Optional[int] = Field(default=None, foreign_key="application_batches.id", index=True)
    greeting_text: str = ""
    status: str = "pending"  # pending / sending / sent / failed / paused
    applied_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=now_shanghai)


# ── 简历 ─────────────────────────────────────────────────────────────────

class Resume(SQLModel, table=True):
    __tablename__ = "resumes"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = "默认简历"
    content: str = ""  # Markdown
    is_active: bool = Field(default=True)
    updated_at: datetime = Field(default_factory=now_shanghai)


# ── 采集任务 ─────────────────────────────────────────────────────────────

class CollectionTask(SQLModel, table=True):
    __tablename__ = "collection_tasks"

    id: Optional[int] = Field(default=None, primary_key=True)
    platform: str = Field(default="boss", index=True)  # boss / zhaopin / job51 / liepin
    mode: str = Field(default="manual", index=True)  # manual / smart
    config_key: str = Field(default="", index=True)
    keyword: str
    city: str = "全国"
    city_code: str = "100010000"
    salary: str = ""
    status: str = "pending"  # pending / running / paused / completed / failed / cancelled
    total_collected: int = 0
    start_page: int = 1
    resume_from_page: int = 1
    refresh_pages: int = 3
    pages_scanned: int = 0
    current_phase: str = ""  # refresh / resume / done
    display_last_page: int = 0
    last_page_reached: int = 0
    max_pages: int = 5
    target_new_jobs: int = 0
    stop_after_stale_pages: int = 2
    created_at: datetime = Field(default_factory=now_shanghai)


# ── 系统配置 ─────────────────────────────────────────────────────────────

class SystemConfig(SQLModel, table=True):
    __tablename__ = "system_config"

    key: str = Field(primary_key=True)
    value: str = ""
