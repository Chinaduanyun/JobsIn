import { useEffect, useState, useRef, type ChangeEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { jobs as jobsApi, applications as appsApi, ai as aiApi } from '@/lib/api'
import type { Job, PaginatedResponse } from '@/types'
import { Search, ChevronLeft, ChevronRight, ExternalLink, CheckSquare, Square, Send, Loader2, Trash2, Brain, MessageSquare, Clock } from 'lucide-react'
import JobDetailDrawer from '@/components/JobDetailDrawer'

function formatTimeAgo(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay}天前`
  return date.toLocaleDateString('zh-CN')
}

export default function JobsPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<PaginatedResponse<Job>>({
    items: [],
    total: 0,
    page: 1,
    size: 20,
  })
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchLoading, setBatchLoading] = useState('')
  const [batchMsg, setBatchMsg] = useState('')
  const [hrActiveFilter, setHrActiveFilter] = useState<string>('')
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchJobs = (p: number, kw: string, hrFilter?: string) => {
    const filter = hrFilter !== undefined ? hrFilter : hrActiveFilter
    jobsApi.list({ page: p, page_size: 20, keyword: kw || undefined, hr_active: filter || undefined }).then(setData).catch(() => {})
  }

  useEffect(() => {
    fetchJobs(page, keyword)
  }, [page, hrActiveFilter])

  // 自动刷新：每5秒检查是否有新岗位
  useEffect(() => {
    const timer = setInterval(() => {
      fetchJobs(page, keyword)
    }, 5000)
    return () => clearInterval(timer)
  }, [page, keyword])

  const handleSearch = () => {
    setPage(1)
    fetchJobs(1, keyword)
  }

  const handleJobClick = async (job: Job) => {
    try {
      const detail = await jobsApi.get(job.id)
      const full = (detail as any).job || detail
      const analysis = (detail as any).analysis || null
      setSelectedJob({ ...full, analysis })
    } catch {
      setSelectedJob(job)
    }
    setDrawerOpen(true)
  }

  const handleApply = async (jobId: number, greeting: string) => {
    await appsApi.apply(jobId, greeting)
    setDrawerOpen(false)
    navigate('/applications')
  }

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === data.items.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(data.items.map(j => j.id)))
    }
  }

  const pollBatchProgress = (batchId: string, label: string) => {
    if (batchPollRef.current) clearInterval(batchPollRef.current)
    batchPollRef.current = setInterval(async () => {
      try {
        const status = await aiApi.batchStatus(batchId)
        setBatchMsg(`⏳ ${label}: ${status.completed}/${status.total} 完成${status.failed ? `, ${status.failed} 失败` : ''}`)
        if (status.status === 'completed') {
          if (batchPollRef.current) clearInterval(batchPollRef.current)
          setBatchMsg(`✅ ${label}完成: ${status.completed}/${status.total}${status.failed ? `, ${status.failed} 失败` : ''}`)
          setBatchLoading('')
          fetchJobs(page, keyword)
          setTimeout(() => setBatchMsg(''), 8000)
        }
      } catch {
        if (batchPollRef.current) clearInterval(batchPollRef.current)
        setBatchLoading('')
      }
    }, 2000)
  }

  const handleBatchApply = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`确定要批量投递选中的 ${selectedIds.size} 个岗位吗？`)) return
    setBatchLoading('apply')
    setBatchMsg('')
    try {
      const res = await appsApi.batchApply(Array.from(selectedIds))
      setBatchMsg(`✅ 批量投递已启动：${res.total} 个岗位`)
      setSelectedIds(new Set())
      setTimeout(() => navigate('/applications'), 2000)
    } catch (e: any) {
      setBatchMsg(`❌ ${e.message || '批量投递失败'}`)
    }
    setBatchLoading('')
    setTimeout(() => setBatchMsg(''), 5000)
  }

  const handleBatchAnalyze = async () => {
    if (selectedIds.size === 0) return
    setBatchLoading('analyze')
    setBatchMsg('')
    try {
      const res = await aiApi.batchAnalyze(Array.from(selectedIds))
      setBatchMsg(`⏳ 批量AI分析已启动: 0/${res.total}`)
      pollBatchProgress(res.batch_id, '批量AI分析')
      setSelectedIds(new Set())
    } catch (e: any) {
      setBatchMsg(`❌ ${e.message || '批量分析失败'}`)
      setBatchLoading('')
      setTimeout(() => setBatchMsg(''), 5000)
    }
  }

  const handleBatchGreeting = async () => {
    if (selectedIds.size === 0) return
    setBatchLoading('greeting')
    setBatchMsg('')
    try {
      const res = await aiApi.batchGreeting(Array.from(selectedIds))
      setBatchMsg(`⏳ 批量生成文案已启动: 0/${res.total}`)
      pollBatchProgress(res.batch_id, '批量文案生成')
      setSelectedIds(new Set())
    } catch (e: any) {
      setBatchMsg(`❌ ${e.message || '批量文案生成失败'}`)
      setBatchLoading('')
      setTimeout(() => setBatchMsg(''), 5000)
    }
  }

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定删除这个岗位？')) return
    try {
      await jobsApi.delete(id)
      fetchJobs(page, keyword)
      selectedIds.delete(id)
      setSelectedIds(new Set(selectedIds))
    } catch {}
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`确定删除选中的 ${selectedIds.size} 个岗位？`)) return
    setBatchLoading('delete')
    try {
      await jobsApi.batchDelete(Array.from(selectedIds))
    } catch {}
    setSelectedIds(new Set())
    fetchJobs(page, keyword)
    setBatchLoading('')
  }

  const totalPages = Math.ceil(data.total / data.size) || 1

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">岗位列表</h2>
        {selectedIds.size > 0 && (
          <div className="flex gap-2 flex-wrap">
            <Button variant="destructive" size="sm" onClick={handleBatchDelete} disabled={!!batchLoading}>
              <Trash2 className="h-4 w-4 mr-1" />
              删除 ({selectedIds.size})
            </Button>
            <Button variant="outline" size="sm" onClick={handleBatchAnalyze} disabled={!!batchLoading}>
              {batchLoading === 'analyze' ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Brain className="h-4 w-4 mr-1" />
              )}
              AI分析 ({selectedIds.size})
            </Button>
            <Button variant="outline" size="sm" onClick={handleBatchGreeting} disabled={!!batchLoading}>
              {batchLoading === 'greeting' ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4 mr-1" />
              )}
              生成文案 ({selectedIds.size})
            </Button>
            <Button size="sm" onClick={handleBatchApply} disabled={!!batchLoading}>
              {batchLoading === 'apply' ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              批量投递 ({selectedIds.size})
            </Button>
          </div>
        )}
      </div>

      {batchMsg && (
        <Alert className="mb-4">
          <AlertDescription>{batchMsg}</AlertDescription>
        </Alert>
      )}

      {/* Search */}
      <div className="flex gap-2 mb-2">
        <Input
          placeholder="搜索岗位关键词..."
          value={keyword}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && handleSearch()}
          className="max-w-sm"
        />
        <Button onClick={handleSearch} variant="outline" size="icon">
          <Search className="h-4 w-4" />
        </Button>
        {data.items.length > 0 && (
          <Button onClick={toggleSelectAll} variant="outline" size="sm" className="ml-auto">
            {selectedIds.size === data.items.length ? (
              <CheckSquare className="h-4 w-4 mr-1" />
            ) : (
              <Square className="h-4 w-4 mr-1" />
            )}
            全选
          </Button>
        )}
      </div>

      {/* HR 活跃度筛选 */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {([
          { value: '', label: '全部HR' },
          { value: 'online', label: '🟢 在线' },
          { value: 'active', label: '🔵 近期活跃' },
          { value: 'inactive', label: '⚪ 不活跃' },
        ] as const).map(f => (
          <Button
            key={f.value}
            variant={hrActiveFilter === f.value ? 'default' : 'outline'}
            size="sm"
            className="text-xs h-7"
            onClick={() => { setHrActiveFilter(f.value); setPage(1) }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Job list */}
      <div className="space-y-3">
        {data.items.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              暂无岗位数据，请先创建采集任务
            </CardContent>
          </Card>
        ) : (
          data.items.map((job) => (
            <Card
              key={job.id}
              className={`hover:shadow-md transition-shadow ${
                selectedIds.has(job.id) ? 'ring-2 ring-blue-400' : ''
              }`}
            >
              <CardContent className="p-0">
                <div className="flex">
                  {/* ===== 左半：点击选择 ===== */}
                  <div
                    className="flex-1 min-w-0 py-3 pl-4 pr-2 cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors border-r border-dashed"
                    onClick={(e) => toggleSelect(job.id, e)}
                  >
                    {/* 标题行 */}
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="flex-shrink-0">
                        {selectedIds.has(job.id) ? (
                          <CheckSquare className="h-4 w-4 text-blue-500" />
                        ) : (
                          <Square className="h-4 w-4 text-muted-foreground" />
                        )}
                      </span>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs flex-shrink-0 ${
                        { boss: 'bg-green-100 text-green-800', zhaopin: 'bg-blue-100 text-blue-800', job51: 'bg-orange-100 text-orange-800', liepin: 'bg-purple-100 text-purple-800' }[job.platform] || 'bg-gray-100 text-gray-800'
                      }`}>
                        {{ boss: 'Boss', zhaopin: '智联', job51: '51job', liepin: '猎聘' }[job.platform] || job.platform}
                      </span>
                      <span className="font-medium text-sm truncate">{job.title}</span>
                      {(job as any).apply_status && (
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {({ sent: '已投递', pending: '待投递', failed: '投递失败' } as Record<string, string>)[(job as any).apply_status] || (job as any).apply_status}
                        </Badge>
                      )}
                    </div>
                    {/* AI 分析（蓝色块） */}
                    {job.analysis?.suggestion ? (
                      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md p-2 mb-1.5 max-h-[80px] overflow-y-auto">
                        <p className="flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 mb-0.5">
                          <Brain className="h-3 w-3" /> AI 分析
                        </p>
                        <p className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed whitespace-pre-wrap">{job.analysis.suggestion}</p>
                      </div>
                    ) : null}
                    {/* 底部信息 */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      {job.experience && <span className="bg-muted px-1.5 py-0.5 rounded">{job.experience}</span>}
                      {job.education && <span className="bg-muted px-1.5 py-0.5 rounded">{job.education}</span>}
                      {job.company && <span>{job.company}</span>}
                      {job.hr_name && (
                        <span className="flex items-center gap-1">
                          HR: {job.hr_name}
                          {job.hr_active && (
                            <span className={`inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium ${
                              ['在线', '刚刚活跃'].includes(job.hr_active)
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : ['今日活跃', '3日内活跃', '本周活跃'].includes(job.hr_active)
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                            }`}>
                              {job.hr_active}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ===== 右半：点击打开详情 ===== */}
                  <div
                    className="flex-1 min-w-0 py-3 pl-2 pr-4 cursor-pointer hover:bg-purple-50/50 dark:hover:bg-purple-950/20 transition-colors"
                    onClick={() => handleJobClick(job)}
                  >
                    {/* 薪资 + 匹配分 */}
                    <div className="flex items-center justify-end gap-2 mb-1 text-sm">
                      {job.salary && (
                        <span className="font-semibold text-orange-600">{job.salary}</span>
                      )}
                      {job.analysis && (
                        <span className="font-semibold text-orange-600">
                          匹配 {Math.round(job.analysis.overall_score * 100)}分
                        </span>
                      )}
                    </div>
                    {/* 沟通文案（紫色块） */}
                    {job.analysis?.greeting_text ? (
                      <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-md p-2 mb-1.5 max-h-[80px] overflow-y-auto">
                        <p className="flex items-center gap-1 text-xs font-medium text-purple-700 dark:text-purple-400 mb-0.5">
                          <MessageSquare className="h-3 w-3" /> 沟通文案
                        </p>
                        <p className="text-xs text-purple-900 dark:text-purple-200 leading-relaxed whitespace-pre-wrap">{job.analysis.greeting_text}</p>
                      </div>
                    ) : null}
                    {/* 底部操作 */}
                    <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-3 w-3" />
                        {formatTimeAgo(job.collected_at)}
                      </span>
                      {job.url && (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                          title="打开原页面"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(job.id, e); }}
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Pagination */}
      {data.total > 0 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            共 {data.total} 条
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Job detail drawer */}
      <JobDetailDrawer
        job={selectedJob}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onApply={handleApply}
      />
    </div>
  )
}
