import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { browser as browserApi } from '@/lib/api'
import type { BrowserStatus } from '@/types'
import { Monitor, Power, LogIn, CheckCircle, Loader2, Play } from 'lucide-react'

export default function BrowserPanel() {
  const [status, setStatus] = useState<BrowserStatus>({
    launched: false,
    logged_in: false,
    headless: false,
    mode: 'idle',
  })
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  const fetchStatus = useCallback(async () => {
    try {
      const s = await browserApi.status()
      setStatus(s)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const timer = setInterval(fetchStatus, 3000)
    return () => clearInterval(timer)
  }, [fetchStatus])

  const handleOpenLogin = async () => {
    setLoading('login')
    setError('')
    try {
      await browserApi.openLogin()
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
      await fetchStatus()
    } catch (e: any) {
      setError(e.message || '登录验证失败，请确认已在浏览器中完成登录')
    }
    setLoading('')
  }

  const handleLaunchScraper = async () => {
    setLoading('launch')
    setError('')
    try {
      await browserApi.launch(true)
      await fetchStatus()
    } catch (e: any) {
      setError(e.message || '启动采集浏览器失败')
    }
    setLoading('')
  }

  const handleClose = async () => {
    setLoading('close')
    setError('')
    try {
      await browserApi.close()
      await fetchStatus()
    } catch (e: any) {
      setError(e.message || '关闭失败')
    }
    setLoading('')
  }

  const modeBadge = () => {
    switch (status.mode) {
      case 'login': return <Badge variant="outline" className="bg-yellow-50">登录中</Badge>
      case 'scrape': return <Badge variant="default" className="bg-blue-600">采集中</Badge>
      default: return <Badge variant="outline">空闲</Badge>
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Monitor className="h-4 w-4" /> 浏览器控制
          </CardTitle>
          <div className="flex items-center gap-2">
            {modeBadge()}
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

        {/* 第一步: 登录 */}
        {!status.logged_in && status.mode !== 'login' && (
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">第一步：登录 Boss 直聘</p>
            <p className="text-xs text-muted-foreground">
              会打开一个普通的 Chrome 窗口（不会被网站检测），请在其中完成登录。
            </p>
            <Button onClick={handleOpenLogin} disabled={loading === 'login'}>
              {loading === 'login' ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4 mr-1" />
              )}
              打开登录页面
            </Button>
          </div>
        )}

        {/* 登录中 */}
        {status.mode === 'login' && (
          <Alert>
            <AlertDescription>
              <p className="font-medium mb-1">📱 请在 Chrome 窗口中完成登录</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Chrome 已打开 Boss 直聘登录页面</li>
                <li>请扫码或输入账号密码完成登录</li>
                <li>登录成功后，点击下方「我已登录」按钮</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-2">
                💡 点击「我已登录」后，Chrome 会自动关闭并验证登录状态
              </p>
              <div className="mt-3 flex gap-2">
                <Button onClick={handleConfirmLogin} disabled={loading === 'confirm'}>
                  {loading === 'confirm' ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-1" />
                  )}
                  我已登录
                </Button>
                <Button variant="ghost" onClick={handleClose} disabled={loading === 'close'}>
                  取消
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* 第二步: 已登录，启动采集 */}
        {status.logged_in && status.mode !== 'scrape' && (
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium text-green-600">✅ 已登录</p>
            <p className="text-xs text-muted-foreground">
              可以启动采集浏览器（后台无头模式），开始采集岗位信息。
            </p>
            <Button onClick={handleLaunchScraper} disabled={loading === 'launch'}>
              {loading === 'launch' ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              启动采集浏览器
            </Button>
          </div>
        )}

        {/* 采集模式运行中 */}
        {status.mode === 'scrape' && (
          <Alert>
            <AlertDescription className="text-green-600">
              ✅ 采集浏览器已就绪，可以在「采集任务」页面创建任务
            </AlertDescription>
          </Alert>
        )}

        {/* 关闭按钮 */}
        {(status.launched || status.mode === 'login') && status.mode !== 'login' && (
          <Button variant="destructive" onClick={handleClose} disabled={loading === 'close'} size="sm">
            {loading === 'close' ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Power className="h-4 w-4 mr-1" />
            )}
            关闭浏览器
          </Button>
        )}

        {/* 登录信息持久化提示 */}
        {status.logged_in && (
          <p className="text-xs text-muted-foreground">
            💡 登录信息已保存在 Chrome profile 中，下次启动无需重复登录
          </p>
        )}
      </CardContent>
    </Card>
  )
}
