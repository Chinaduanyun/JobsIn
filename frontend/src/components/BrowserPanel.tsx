import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { browser as browserApi } from '@/lib/api'
import type { BrowserStatus } from '@/types'
import { Monitor, Power, QrCode, RefreshCw, Loader2 } from 'lucide-react'

export default function BrowserPanel() {
  const [status, setStatus] = useState<BrowserStatus>({
    launched: false,
    logged_in: false,
    has_qrcode: false,
    polling_login: false,
    headless: false,
  })
  const [headless, setHeadless] = useState(false)
  const [qrcode, setQrcode] = useState<string | null>(null)
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

  // When polling login, also poll QR code refresh
  useEffect(() => {
    if (!status.polling_login) return
    const timer = setInterval(async () => {
      await fetchStatus()
    }, 2000)
    return () => clearInterval(timer)
  }, [status.polling_login, fetchStatus])

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
    // 浏览器已运行，需要重启切换模式
    setLoading('restart')
    setError('')
    try {
      await browserApi.restart(newHeadless)
      setQrcode(null)
      await fetchStatus()
    } catch (e: any) {
      setError(e.message || '切换模式失败')
    }
    setLoading('')
  }

  const handleLogin = async () => {
    setLoading('login')
    setError('')
    try {
      const res = await browserApi.login()
      if (res.qrcode) {
        setQrcode(res.qrcode)
      }
      await fetchStatus()
    } catch (e: any) {
      setError(e.message || '登录失败')
    }
    setLoading('')
  }

  const handleRefreshQR = async () => {
    setLoading('qr')
    try {
      const res = await browserApi.qrcode()
      if (res.qrcode) {
        setQrcode(res.qrcode)
      }
    } catch {
      // ignore
    }
    setLoading('')
  }

  const handleClose = async () => {
    setLoading('close')
    setError('')
    try {
      await browserApi.close()
      setQrcode(null)
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
              {headless ? '后台运行，不显示浏览器窗口' : '显示浏览器窗口，可观察操作过程'}
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
              {!status.logged_in && (
                <Button onClick={handleLogin} disabled={loading === 'login'}>
                  {loading === 'login' ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <QrCode className="h-4 w-4 mr-1" />
                  )}
                  扫码登录
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

        {/* QR Code display */}
        {qrcode && !status.logged_in && (
          <div className="flex flex-col items-center gap-3 p-4 border rounded-lg bg-white">
            <p className="text-sm text-muted-foreground">请使用 Boss直聘/微信 扫描二维码登录</p>
            <img src={qrcode} alt="QR Code" className="w-48 h-48 object-contain" />
            <Button size="sm" variant="outline" onClick={handleRefreshQR} disabled={loading === 'qr'}>
              {loading === 'qr' ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              刷新二维码
            </Button>
            {status.polling_login && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> 等待扫码...
              </p>
            )}
          </div>
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
