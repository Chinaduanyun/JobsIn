from fastapi import APIRouter, HTTPException

from app.services.browser import boss_browser

router = APIRouter()


@router.post("/launch")
async def launch_browser(headless: bool = True):
    """启动 Playwright 浏览器"""
    try:
        await boss_browser.launch(headless=headless)
        return {"message": "浏览器启动成功", **boss_browser.get_status()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/restart")
async def restart_browser(headless: bool = True):
    """关闭并以新模式重启浏览器"""
    try:
        await boss_browser.restart(headless=headless)
        return {"message": f"浏览器已重启 ({'无头' if headless else '有头'}模式)", **boss_browser.get_status()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/login")
async def start_login():
    """发起 QR 码登录流程"""
    if not boss_browser.launched:
        raise HTTPException(status_code=400, detail="浏览器未启动")
    if boss_browser.logged_in:
        return {"message": "已登录", "qrcode": None}
    qrcode = await boss_browser.start_login()
    if not qrcode:
        raise HTTPException(status_code=500, detail="获取二维码失败")
    return {"message": "请扫码登录", "qrcode": qrcode}


@router.get("/qrcode")
async def get_qrcode():
    """获取当前二维码（含刷新）"""
    qr = boss_browser.get_qrcode()
    if not qr:
        # 尝试刷新
        qr = await boss_browser.refresh_qrcode()
    return {"qrcode": qr}


@router.get("/status")
async def browser_status():
    """浏览器和登录状态"""
    return boss_browser.get_status()


@router.post("/close")
async def close_browser():
    """关闭浏览器"""
    await boss_browser.close()
    return {"message": "浏览器已关闭"}
