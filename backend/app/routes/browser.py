from fastapi import APIRouter, HTTPException

from app.services.browser import boss_browser

router = APIRouter()


@router.post("/launch")
async def launch_browser(headless: bool = True):
    """启动采集模式的浏览器 (CDP 连接)"""
    try:
        await boss_browser.launch(headless=headless)
        return {"message": "采集浏览器启动成功", **boss_browser.get_status()}
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
    """打开纯 Chrome 登录页面 (无 CDP，不会被检测)"""
    if boss_browser.logged_in:
        return {"message": "已登录", "url": ""}
    try:
        url = await boss_browser.open_login_page()
        return {"message": "已打开纯 Chrome，请在浏览器中完成登录", "url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/confirm-login")
async def confirm_login():
    """验证登录状态 — 会关闭纯 Chrome 并短暂用 CDP 验证 cookies"""
    success = await boss_browser.confirm_login()
    if success:
        return {"message": "登录成功", **boss_browser.get_status()}
    raise HTTPException(status_code=400, detail="登录验证失败，请确认已在浏览器中完成登录后再点击此按钮")


@router.get("/status")
async def browser_status():
    return boss_browser.get_status()


@router.post("/close")
async def close_browser():
    await boss_browser.close()
    return {"message": "浏览器已关闭"}
