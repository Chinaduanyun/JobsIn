from fastapi import APIRouter, HTTPException

from app.services.browser import boss_browser

router = APIRouter()


@router.post("/launch")
async def launch_browser(headless: bool = True):
    try:
        await boss_browser.launch(headless=headless)
        return {"message": "浏览器启动成功", **boss_browser.get_status()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/restart")
async def restart_browser(headless: bool = True):
    try:
        await boss_browser.restart(headless=headless)
        return {"message": f"浏览器已重启 ({'无头' if headless else '有头'}模式)", **boss_browser.get_status()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/open-login")
async def open_login():
    """打开登录页面，让用户手动登录"""
    if not boss_browser.launched:
        raise HTTPException(status_code=400, detail="浏览器未启动")
    if boss_browser.logged_in:
        return {"message": "已登录", "url": ""}
    url = await boss_browser.open_login_page()
    return {"message": "请在浏览器中完成登录", "url": url}


@router.post("/confirm-login")
async def confirm_login():
    """用户手动登录完成后，确认登录状态"""
    if not boss_browser.launched:
        raise HTTPException(status_code=400, detail="浏览器未启动")
    success = await boss_browser.confirm_login()
    if success:
        return {"message": "登录成功", **boss_browser.get_status()}
    raise HTTPException(status_code=400, detail="登录验证失败，请确认已在浏览器中完成登录")


@router.get("/status")
async def browser_status():
    return boss_browser.get_status()


@router.post("/close")
async def close_browser():
    await boss_browser.close()
    return {"message": "浏览器已关闭"}
