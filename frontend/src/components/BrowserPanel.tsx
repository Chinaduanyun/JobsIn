import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { browser as browserApi } from '@/lib/api'
import type { BrowserStatus } from '@/types'
import { Monitor, Power, LogIn, CheckCircle, Loader2 } from 'lucide-react'

export default function BrowserPanel() {
  const [status, setStatus] = useState<BrowserStatus>({
    launched: false,
    logged_in: false,
    headless: false,
  })
  const [headless, setHeadless] = useState(false)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')
  const [loginOpened, setLoginOpened] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const s = await browserApi.status()
      setStatus(s)
      if (s.logged_in) setLoginOpened(false)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const timer = setInterval(fetchStatus, 3000)
    return () => clearInterval(timer)
  }, [fetchStatus])

  const handleLaunch = async () => {
    setLoading('launch')
    setError('')
    try {
      await browserApi.launch(headless)
      await fetchStatus()
    } catch (e: any) {
      setError(e.message || '启动失败')
    }
    setLoading('')
  }

  const handleModeSwitch = async (newHeadless: boolean) => {
    setHeadless(newHeadless)
    if (!status.launched) return
    setLoading('restart')
    setError('')
    try {
      await browserApi.restart(newHeadless)
      setLoginOpened(false)
      await fetchStatus()
    } catch (e: any) {
      setError(e.message || '切换模式失败')
    }
    setLoading('')
  }

  const handleOpenLogin = async () => {
    setLoading('login')
    setError('')
    try {
      await browserApi.openLogin()
      setLoginOpened(true)
      await fetchStatus()
    } catch (e: any) {
      setError(e.message || '打开登录页失败')
    }
    setLoading('')
  }

  const handleConfirmLogin = async () => {
    setLoading('confirm')
    setError('')
    try {
      await browserApi.confirmLogin()
      setLoginOpened(false)
      await fetchStatus()
    } catch (e: any) {
      setError(e.message || '登录验证失败，请确认已在浏览器中完成登录')
    }
    setLoading('')
  }

  const handleClose = async () => {
    setLoading('close')
    setError('')
    try {
      await browserApi.close()
      setLoginOpened(false)
      await fetchStatus()
    } catch (e: any) {
      setError(e.message || '关闭失败')
    }
    setLoading('')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Monitor className="h-4 w-4" /> 浏览器控制
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={status.launched ? 'default' : 'outline'}>
              {status.launched ? '已启动' : '未启动'}
            </Badge>
            <Badge variant={status.logged_in ? 'default' : 'secondary'}>
              {status.logged_in ? '已登录' : '未登录'}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Headed / Headless 切换 */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="headless-switch" className="text-sm font-medium">
              {headless ? '无头模式 (Headless)' : '有头模式 (Headed)'}
            </Label>
            <p className="text-xs text-muted-foreground">
              {headless
                ? '后台运行，不显示浏览器窗口'
                : '显示浏览器窗口，可观察操作过程（登录推荐使用有头模式）'}
            </p>
          </div>
          <Switch
            id="headless-switch"
            checked={!headless}
            onCheckedChange={(checked) => handleModeSwitch(!checked)}
            disabled={loading === 'restart'}
          />
        </div>

        {loading === 'restart' && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> 正在切换浏览器模式...
          </p>
        )}

        <div className="flex gap-2">
          {!status.launched ? (
            <Button onClick={handleLaunch} disabled={loading === 'launch'}>
              {loading === 'launch' ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Power className="h-4 w-4 mr-1" />
              )}
              启动浏览器
            </Button>
          ) : (
            <>
              {!status.logged_in && !loginOpened && (
                <Button onClick={handleOpenLogin} disabled={loading === 'login'}>
                  {loading === 'login' ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4 mr-1" />
                  )}
                  打开登录页面
                </Button>
              )}
              {!status.logged_in && loginOpened && (
                <Button onClick={handleConfirmLogin} disabled={loading === 'confirm'} variant="default">
                  {loading === 'confirm' ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-1" />
                  )}
                  我已登录
                </Button>
              )}
              <Button variant="destructive" onClick={handleClose} disabled={loading === 'close'}>
                {loading === 'close' ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Power className="h-4 w-4 mr-1" />
                )}
                关闭浏览器
              </Button>
            </>
          )}
        </div>

        {/* 手动登录提示 */}
        {loginOpened && !status.logged_in && (
          <Alert>
            <AlertDescription>
              <p className="font-medium mb-1">📱 请在浏览器窗口中完成登录</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>浏览器已打开 Boss直聘登录页面</li>
                <li>请在浏览器中扫码或输入账号密码完成登录</li>
                <li>登录成功后，点击上方「我已登录」按钮</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-2">
                💡 登录信息会保存在 Chrome profile 中，下次启动无需重复登录
              </p>
            </AlertDescription>
          </Alert>
        )}

        {status.logged_in && (
          <Alert>
            <AlertDescription className="text-green-600">
              ✅ 浏览器已登录，可以开始采集岗位
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
