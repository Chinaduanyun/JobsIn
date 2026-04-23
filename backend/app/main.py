import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.database import init_db
from app.routes import jobs, tasks, resumes, ai, browser, config, applications, extension

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


app = FastAPI(title="JobsIn", version="1.6.1", lifespan=lifespan)

APP_VERSION = "1.6.1"

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
app.include_router(extension.router, prefix="/api/extension", tags=["extension"])

@app.get("/api/health")
async def health():
    return {"status": "ok"}

@app.get("/api/version")
async def version():
    return {"version": APP_VERSION}

# 前端静态文件（生产模式）— SPA 路由支持
frontend_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    # 静态资源 (JS/CSS/images)
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        """SPA catch-all: 非 API 请求都返回 index.html"""
        file_path = frontend_dist / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(frontend_dist / "index.html")
