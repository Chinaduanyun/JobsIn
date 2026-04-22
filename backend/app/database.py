import logging
from pathlib import Path
from sqlmodel import SQLModel
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent.parent / "data" / "findjobs.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_async_engine(
    f"sqlite+aiosqlite:///{DB_PATH}",
    echo=False,
    connect_args={"check_same_thread": False},
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    await _migrate()


async def _migrate():
    """轻量级 schema 迁移：给已有表添加新字段"""
    migrations = [
        ("jobs", "platform", "ALTER TABLE jobs ADD COLUMN platform TEXT DEFAULT 'boss'"),
        ("collection_tasks", "platform", "ALTER TABLE collection_tasks ADD COLUMN platform TEXT DEFAULT 'boss'"),
        ("applications", "batch_id", "ALTER TABLE applications ADD COLUMN batch_id INTEGER"),
        ("collection_tasks", "mode", "ALTER TABLE collection_tasks ADD COLUMN mode TEXT DEFAULT 'manual'"),
        ("collection_tasks", "config_key", "ALTER TABLE collection_tasks ADD COLUMN config_key TEXT DEFAULT ''"),
        ("collection_tasks", "start_page", "ALTER TABLE collection_tasks ADD COLUMN start_page INTEGER DEFAULT 1"),
        ("collection_tasks", "resume_from_page", "ALTER TABLE collection_tasks ADD COLUMN resume_from_page INTEGER DEFAULT 1"),
        ("collection_tasks", "refresh_pages", "ALTER TABLE collection_tasks ADD COLUMN refresh_pages INTEGER DEFAULT 3"),
        ("collection_tasks", "pages_scanned", "ALTER TABLE collection_tasks ADD COLUMN pages_scanned INTEGER DEFAULT 0"),
        ("collection_tasks", "current_phase", "ALTER TABLE collection_tasks ADD COLUMN current_phase TEXT DEFAULT ''"),
        ("collection_tasks", "display_last_page", "ALTER TABLE collection_tasks ADD COLUMN display_last_page INTEGER DEFAULT 0"),
        ("collection_tasks", "last_page_reached", "ALTER TABLE collection_tasks ADD COLUMN last_page_reached INTEGER DEFAULT 0"),
        ("collection_tasks", "target_new_jobs", "ALTER TABLE collection_tasks ADD COLUMN target_new_jobs INTEGER DEFAULT 0"),
        ("collection_tasks", "stop_after_stale_pages", "ALTER TABLE collection_tasks ADD COLUMN stop_after_stale_pages INTEGER DEFAULT 2"),
    ]
    async with engine.begin() as conn:
        for table, column, sql in migrations:
            try:
                check = await conn.execute(text(f"SELECT {column} FROM {table} LIMIT 1"))
                check.close()
            except Exception:
                logger.info("迁移: %s.%s", table, column)
                await conn.execute(text(sql))


async def get_session():
    async with async_session() as session:
        yield session
