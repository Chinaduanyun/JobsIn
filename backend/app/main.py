import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.routes import jobs, tasks, resumes, ai, browser, config, applications

# 配置日志级别 — app 模块用 DEBUG
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
logging.getLogger("app").setLevel(logging.DEBUG)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="FindJobs", version="0.3.0", lifespan=lifespan)

APP_VERSION = "0.3.0"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 路由
app.include_router(jobs.router, prefix="/api/jobs", tags=["jobs"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(resumes.router, prefix="/api/resumes", tags=["resumes"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(browser.router, prefix="/api/browser", tags=["browser"])
app.include_router(config.router, prefix="/api/config", tags=["config"])
app.include_router(applications.router, prefix="/api/applications", tags=["applications"])

@app.get("/api/health")
async def health():
    return {"status": "ok"}

@app.get("/api/version")
async def version():
    return {"version": APP_VERSION}

# 前端静态文件（生产模式）
frontend_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
