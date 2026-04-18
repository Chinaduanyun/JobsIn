import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { applications as appsApi } from '@/lib/api'
import {
  ChevronLeft, ChevronRight, Clock, CheckCircle, XCircle, Loader2,
  Brain, MessageSquare, Pause, Play, ChevronDown, ChevronUp,
  Send, Package
} from 'lucide-react'

interface ApplicationItem {
  id: number
  job_id: number
  batch_id: number | null
  greeting_text: string
  status: string
  applied_at: string | null
  created_at: string
  job_title: string
  job_company: string
  job_salary: string
  job_city: string
  job_url: string
  job_experience: string
  job_education: string
  job_tags: string
  overall_score: number | null
  suggestion: string
  ai_greeting: string
}

interface BatchItem {
  id: number
  status: string
  total: number
  completed: number
  failed: number
  actual_total: number
  created_at: string
}

type ViewMode = 'all' | 'individual' | 'batches'

export default function ApplicationsPage() {
  const [items, setItems] = useState<ApplicationItem[]>([])
  const [batches, setBatches] = useState<BatchItem[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [todayCount, setTodayCount] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [expandedBatches, setExpandedBatches] = useState<Set<number>>(new Set())
  const [batchDetails, setBatchDetails] = useState<Record<number, ApplicationItem[]>>({})

  const fetchData = async (p: number) => {
    setLoading(true)
    try {
      const [res, today, batchRes] = await Promise.all([
        appsApi.list(p),
        appsApi.today(),
        appsApi.listBatches(),
      ])
      setItems(res.items || [])
      setTodayCount(today.count)
      setBatches(batchRes.items || [])
    } catch {
      setItems([])
      setBatches([])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchData(page)
    const timer = setInterval(() => fetchData(page), 10000)
    return () => clearInterval(timer)
  }, [page])

  const toggleBatch = async (batchId: number) => {
    const next = new Set(expandedBatches)
    if (next.has(batchId)) {
      next.delete(batchId)
    } else {
      next.add(batchId)
      if (!batchDetails[batchId]) {
        try {
          const res = await appsApi.getBatch(batchId)
          setBatchDetails(prev => ({ ...prev, [batchId]: res.applications || [] }))
        } catch { /* ignore */ }
      }
    }
    setExpandedBatches(next)
  }

  const handlePauseBatch = async (batchId: number) => {
    try {
      await appsApi.pauseBatch(batchId)
      fetchData(page)
    } catch { /* ignore */ }
  }

  const handleResumeBatch = async (batchId: number) => {
    try {
      await appsApi.resumeBatch(batchId)
      fetchData(page)
    } catch { /* ignore */ }
  }

  const handlePauseSingle = async (appId: number) => {
    try {
      await appsApi.pause(appId)
      fetchData(page)
    } catch { /* ignore */ }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
      sent: { cls: 'bg-green-100 text-green-700', icon: <CheckCircle className="h-3 w-3 mr-1" />, label: '已发送' },
      recorded: { cls: 'bg-blue-100 text-blue-700', icon: <Clock className="h-3 w-3 mr-1" />, label: '已记录' },
      pending: { cls: 'bg-gray-100 text-gray-600', icon: <Clock className="h-3 w-3 mr-1" />, label: '待处理' },
      sending: { cls: 'bg-yellow-100 text-yellow-700', icon: <Send className="h-3 w-3 mr-1 animate-pulse" />, label: '发送中' },
      paused: { cls: 'bg-orange-100 text-orange-700', icon: <Pause className="h-3 w-3 mr-1" />, label: '已暂停' },
      failed: { cls: 'bg-red-100 text-red-700', icon: <XCircle className="h-3 w-3 mr-1" />, label: '失败' },
    }
    const s = map[status] || { cls: '', icon: null, label: status }
    return <Badge className={s.cls}>{s.icon}{s.label}</Badge>
  }

  const batchStatusBadge = (status: string) => {
    const map: Record<string, { cls: string; label: string }> = {
      running: { cls: 'bg-green-100 text-green-700', label: '运行中' },
      paused: { cls: 'bg-orange-100 text-orange-700', label: '已暂停' },
      completed: { cls: 'bg-blue-100 text-blue-700', label: '已完成' },
      failed: { cls: 'bg-red-100 text-red-700', label: '失败' },
    }
    const s = map[status] || { cls: '', label: status }
    return <Badge className={s.cls}>{s.label}</Badge>
  }

  const formatTime = (t: string | null) => {
    if (!t) return '-'
    return new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  // 分组: 没有 batch_id 的是单个投递, 有的归入批次
  const individualApps = items.filter(a => !a.batch_id)

  const renderAppCard = (app: ApplicationItem, compact = false) => (
    <Card key={app.id} className={`hover:shadow-md transition-shadow ${compact ? 'border-l-4 border-l-blue-200' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{app.job_title || `岗位 #${app.job_id}`}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {app.job_company}
              {app.job_city && ` · ${app.job_city}`}
              {app.job_experience && ` · ${app.job_experience}`}
              {app.job_education && ` · ${app.job_education}`}
            </p>
            {app.job_tags && (
              <div className="flex flex-wrap gap-1 mt-1">
                {app.job_tags.split(',').filter(Boolean).slice(0, 5).map((tag, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{tag.trim()}</Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
            {app.job_salary && (
              <Badge variant="secondary" className="text-orange-600">{app.job_salary}</Badge>
            )}
            {statusBadge(app.status)}
            {(app.status === 'pending' || app.status === 'sending') && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePauseSingle(app.id)}>
                <Pause className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {app.overall_score !== null && (
          <div className="bg-blue-50 dark:bg-blue-950/30 rounded-md p-3 text-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400">
                <Brain className="h-3 w-3" /> AI 匹配度
              </span>
              <span className="text-sm font-bold text-blue-700 dark:text-blue-400">
                {Math.round(app.overall_score * 100)} 分
              </span>
            </div>
            <Progress value={app.overall_score * 100} className="h-1.5" />
            {!compact && app.suggestion && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{app.suggestion}</p>
            )}
          </div>
        )}
        {(app.ai_greeting || app.greeting_text) && (
          <div className="bg-muted/50 rounded-md p-3 text-sm">
            <p className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <MessageSquare className="h-3 w-3" /> 沟通文案
            </p>
            <p className="whitespace-pre-wrap line-clamp-3">{app.greeting_text || app.ai_greeting}</p>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>投递时间: {formatTime(app.applied_at || app.created_at)}</span>
          {app.job_url && (
            <a href={app.job_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
              查看岗位 ↗
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )

  const renderBatchCard = (batch: BatchItem) => {
    const isExpanded = expandedBatches.has(batch.id)
    const details = batchDetails[batch.id] || []
    const progress = batch.total > 0 ? ((batch.completed + batch.failed) / batch.total) * 100 : 0

    return (
      <Card key={`batch-${batch.id}`} className="border-2 border-dashed">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">批量投递 #{batch.id}</CardTitle>
              {batchStatusBadge(batch.status)}
            </div>
            <div className="flex items-center gap-2">
              {batch.status === 'running' && (
                <Button variant="outline" size="sm" onClick={() => handlePauseBatch(batch.id)}>
                  <Pause className="h-3.5 w-3.5 mr-1" /> 暂停
                </Button>
              )}
              {batch.status === 'paused' && (
                <Button variant="outline" size="sm" onClick={() => handleResumeBatch(batch.id)}>
                  <Play className="h-3.5 w-3.5 mr-1" /> 恢复
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => toggleBatch(batch.id)}>
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm mb-2">
            <span>总计: {batch.actual_total || batch.total}</span>
            <span className="text-green-600">成功: {batch.completed}</span>
            <span className="text-red-600">失败: {batch.failed}</span>
            <span className="text-muted-foreground">{formatTime(batch.created_at)}</span>
          </div>
          <Progress value={progress} className="h-2" />

          {isExpanded && (
            <div className="mt-3 space-y-2">
              {details.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-1" />加载中...
                </p>
              ) : (
                details.map((app: any) => (
                  <div key={app.id} className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium truncate">{app.job_title || `岗位 #${app.job_id}`}</span>
                      <span className="text-muted-foreground ml-2">{app.job_company}</span>
                      {app.job_salary && <span className="text-orange-600 ml-2">{app.job_salary}</span>}
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      {statusBadge(app.status)}
                      {(app.status === 'pending' || app.status === 'sending') && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handlePauseSingle(app.id)}>
                          <Pause className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">投递管理</h2>
        <div className="flex items-center gap-3">
          <div className="flex border rounded-md overflow-hidden text-sm">
            {(['all', 'individual', 'batches'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                className={`px-3 py-1 ${viewMode === mode ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                onClick={() => setViewMode(mode)}
              >
                {{ all: '全部', individual: '单个', batches: '批次' }[mode]}
              </button>
            ))}
          </div>
          <Badge variant="outline" className="text-sm">
            今日已投递: {todayCount}
          </Badge>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            加载中...
          </CardContent>
        </Card>
      ) : items.length === 0 && batches.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            暂无投递记录，去岗位列表选择岗位投递吧
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* 批次列表 */}
          {(viewMode === 'all' || viewMode === 'batches') && batches.length > 0 && (
            <>
              {viewMode === 'all' && batches.length > 0 && (
                <h3 className="text-sm font-medium text-muted-foreground mt-2">批量投递</h3>
              )}
              {batches.map(batch => renderBatchCard(batch))}
            </>
          )}

          {/* 单个投递列表 */}
          {(viewMode === 'all' || viewMode === 'individual') && individualApps.length > 0 && (
            <>
              {viewMode === 'all' && individualApps.length > 0 && (
                <h3 className="text-sm font-medium text-muted-foreground mt-4">单个投递</h3>
              )}
              {individualApps.map(app => renderAppCard(app))}
            </>
          )}
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
