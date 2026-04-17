from fastapi import APIRouter

router = APIRouter()


@router.post("/launch")
async def launch_browser(headless: bool = True):
    """启动 Playwright 浏览器 — Step 3 实现"""
    return {"message": "浏览器管理将在 Step 3 实现"}


@router.get("/qrcode")
async def get_qrcode():
    """获取登录二维码 — Step 3 实现"""
    return {"message": "QR 登录将在 Step 3 实现"}


@router.get("/status")
async def browser_status():
    """浏览器状态 — Step 3 实现"""
    return {"launched": False, "logged_in": False}


@router.post("/close")
async def close_browser():
    """关闭浏览器 — Step 3 实现"""
    return {"ok": True}
