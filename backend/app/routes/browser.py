from fastapi import APIRouter, HTTPException

from app.services.browser import boss_browser

router = APIRouter()


@router.post("/open-login")
async def open_login():
    """打开纯 Chrome 登录页面 (无 CDP，不会被检测)"""
    try:
        url = await boss_browser.open_login_page()
        return {"message": "已打开 Chrome，请在浏览器中完成登录", "url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/confirm-login")
async def confirm_login():
    """用户登录后调用。关闭 Chrome，导出 cookies 并验证。"""
    success = await boss_browser.confirm_login()
    if success:
        return {"message": "登录成功，cookies 已导出", **boss_browser.get_status()}
    raise HTTPException(status_code=400, detail="登录验证失败，请确认已在浏览器中完成登录后再点击此按钮")


@router.post("/refresh-cookies")
async def refresh_cookies():
    """重新从 Chrome profile 导出 cookies（不需要重新登录）"""
    success = await boss_browser.refresh_cookies()
    if success:
        return {"message": "Cookies 已刷新", **boss_browser.get_status()}
    raise HTTPException(status_code=400, detail="Cookies 刷新失败，可能需要重新登录")


@router.get("/status")
async def browser_status():
    return boss_browser.get_status()


@router.post("/close")
async def close_browser():
    await boss_browser.close()
    return {"message": "浏览器已关闭"}
