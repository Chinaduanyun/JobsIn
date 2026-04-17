from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from app.services.extension_bridge import extension_bridge

router = APIRouter()


class ResultReport(BaseModel):
    command_id: str
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None
    security_check: Optional[bool] = False


@router.get("/command")
async def get_command():
    """扩展轮询：获取下一个待执行命令（long-poll，最多等5秒）"""
    cmd = await extension_bridge.get_pending_command()
    if cmd:
        return cmd
    return {}


@router.post("/result")
async def report_result(report: ResultReport):
    """扩展报告：命令执行结果"""
    result = {
        "success": report.success,
        "data": report.data,
        "error": report.error,
        "security_check": report.security_check,
    }
    ok = extension_bridge.report_result(report.command_id, result)
    return {"received": ok}


@router.get("/status")
async def extension_status():
    """扩展连接状态"""
    return extension_bridge.get_status()
