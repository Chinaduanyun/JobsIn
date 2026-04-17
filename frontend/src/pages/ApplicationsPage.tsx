import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { applications as appsApi } from '@/lib/api'
import { ChevronLeft, ChevronRight, ExternalLink, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react'

interface ApplicationItem {
  id: number
  job_id: number
  greeting_text: string
  status: string
  applied_at: string | null
  created_at: string
  job_title: string
  job_company: string
}

export default function ApplicationsPage() {
  const [items, setItems] = useState<ApplicationItem[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [todayCount, setTodayCount] = useState(0)

  const fetchData = async (p: number) => {
    setLoading(true)
    try {
      const [res, today] = await Promise.all([appsApi.list(p), appsApi.today()])
      setItems(res.items || [])
      setTodayCount(today.count)
    } catch {
      setItems([])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchData(page)
    // 每 10s 自动刷新
    const timer = setInterval(() => fetchData(page), 10000)
    return () => clearInterval(timer)
  }, [page])

  const statusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return <Badge className="bg-green-100 text-green-700"><CheckCircle className="h-3 w-3 mr-1" />已发送</Badge>
      case 'recorded':
        return <Badge className="bg-blue-100 text-blue-700"><Clock className="h-3 w-3 mr-1" />已记录</Badge>
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />待处理</Badge>
      case 'failed':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />失败</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const formatTime = (t: string | null) => {
    if (!t) return '-'
    const d = new Date(t)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">投递管理</h2>
        <Badge variant="outline" className="text-sm">
          今日已投递: {todayCount}
        </Badge>
      </div>

      {loading && items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            加载中...
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            暂无投递记录，去岗位列表选择岗位投递吧
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((app) => (
            <Card key={app.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{app.job_title || `岗位 #${app.job_id}`}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{app.job_company}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(app.status)}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {app.greeting_text && (
                  <div className="bg-muted/50 rounded-md p-3 mb-2 text-sm">
                    <p className="text-xs text-muted-foreground mb-1">沟通文案:</p>
                    <p className="whitespace-pre-wrap">{app.greeting_text}</p>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>投递时间: {formatTime(app.applied_at || app.created_at)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-center mt-4 gap-2">
        <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm">第 {page} 页</span>
        <Button variant="outline" size="icon" disabled={items.length < 20} onClick={() => setPage(p => p + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
