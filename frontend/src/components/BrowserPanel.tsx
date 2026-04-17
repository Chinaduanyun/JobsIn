import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { browser as browserApi } from '@/lib/api'
import type { BrowserStatus } from '@/types'
import { Monitor, LogIn, CheckCircle, Loader2, RefreshCw, Cookie } from 'lucide-react'

export default function BrowserPanel() {
  const [status, setStatus] = useState<BrowserStatus>({
    launched: false,
    logged_in: false,
    headless: false,
    mode: 'idle',
    cookies_count: 0,
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

  const handleRefreshCookies = async () => {
    setLoading('refresh')
    setError('')
    try {
      await browserApi.refreshCookies()
      await fetchStatus()
    } catch (e: any) {
      setError(e.message || 'Cookies 刷新失败')
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Monitor className="h-4 w-4" /> 浏览器 & 登录
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={status.logged_in ? 'default' : 'secondary'}>
              {status.logged_in ? '已登录' : '未登录'}
            </Badge>
            {status.cookies_count > 0 && (
              <Badge variant="outline" className="text-xs">
                <Cookie className="h-3 w-3 mr-1" />
                {status.cookies_count} cookies
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 未登录状态 */}
        {!status.logged_in && status.mode !== 'login' && (
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">登录 Boss 直聘</p>
            <p className="text-xs text-muted-foreground">
              打开 Chrome 完成登录后，系统会导出 cookies 用于 HTTP 采集。
              不使用浏览器自动化，不会被网站检测。
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
                💡 点击后 Chrome 会关闭，系统自动导出 cookies
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

        {/* 已登录 */}
        {status.logged_in && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
            <p className="text-sm font-medium text-green-700">✅ 已登录，可以开始采集</p>
            <p className="text-xs text-muted-foreground">
              采集使用纯 HTTP 请求（不启动浏览器），直接调用 Boss 直聘 API 获取数据。
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleRefreshCookies} disabled={loading === 'refresh'}>
                {loading === 'refresh' ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                刷新 Cookies
              </Button>
              <Button variant="outline" size="sm" onClick={handleOpenLogin} disabled={loading === 'login'}>
                <LogIn className="h-4 w-4 mr-1" />
                重新登录
              </Button>
            </div>
          </div>
        )}

        {/* 持久化提示 */}
        {status.logged_in && (
          <p className="text-xs text-muted-foreground">
            💡 Cookies 已保存，重启程序后无需重新登录。如果采集出现 403 错误，请刷新 Cookies 或重新登录。
          </p>
        )}
      </CardContent>
    </Card>
  )
}
