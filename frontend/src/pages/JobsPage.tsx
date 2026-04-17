import { useEffect, useState, useRef, type ChangeEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
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
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchJobs = (p: number, kw: string) => {
    jobsApi.list({ page: p, page_size: 20, keyword: kw || undefined }).then(setData).catch(() => {})
  }

  useEffect(() => {
    fetchJobs(page, keyword)
  }, [page])

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
      <div className="flex gap-2 mb-4">
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
              className={`hover:shadow-md transition-shadow cursor-pointer ${
                selectedIds.has(job.id) ? 'ring-2 ring-blue-400' : ''
              }`}
              onClick={() => handleJobClick(job)}
            >
              <CardContent className="py-3 px-4">
                <div className="flex gap-4">
                  {/* 左侧：基本信息 */}
                  <div className="flex-shrink-0 w-[55%] min-w-0">
                    <div className="flex items-start gap-2">
                      <button
                        onClick={(e) => toggleSelect(job.id, e)}
                        className="mt-1 text-muted-foreground hover:text-foreground flex-shrink-0"
                      >
                        {selectedIds.has(job.id) ? (
                          <CheckSquare className="h-4 w-4 text-blue-500" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        {/* 平台 + 标题 */}
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-xs flex-shrink-0 ${
                            { boss: 'bg-green-100 text-green-800', zhaopin: 'bg-blue-100 text-blue-800', job51: 'bg-orange-100 text-orange-800', liepin: 'bg-purple-100 text-purple-800' }[job.platform] || 'bg-gray-100 text-gray-800'
                          }`}>
                            {{ boss: 'Boss', zhaopin: '智联', job51: '51job', liepin: '猎聘' }[job.platform] || job.platform}
                          </span>
                          <span className="font-medium text-sm truncate">{job.title}</span>
                          {(job as any).apply_status && (
                            <Badge variant="outline" className="text-xs flex-shrink-0">
                              {{ sent: '已投递', pending: '待投递', failed: '投递失败' }[(job as any).apply_status] || (job as any).apply_status}
                            </Badge>
                          )}
                        </div>
                        {/* 薪资 */}
                        {job.salary && (
                          <p className="text-base font-semibold text-orange-600 mt-0.5">{job.salary}</p>
                        )}
                        {/* 公司 + 城市 */}
                        <p className="text-sm text-muted-foreground mt-0.5 truncate">
                          {job.company}{job.city && ` · ${job.city}`}
                          {job.company_size && ` · ${job.company_size}`}
                        </p>
                        {/* 要求标签 */}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                          {job.experience && <span className="bg-muted px-1.5 py-0.5 rounded">{job.experience}</span>}
                          {job.education && <span className="bg-muted px-1.5 py-0.5 rounded">{job.education}</span>}
                          {job.hr_name && (
                            <span>
                              HR: {job.hr_name}
                              {job.hr_active && ` (${job.hr_active})`}
                            </span>
                          )}
                          <span className="flex items-center gap-0.5 ml-auto">
                            <Clock className="h-3 w-3" />
                            {formatTimeAgo(job.collected_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 右侧：AI 分析 + 文案预览 */}
                  <div className="flex-1 min-w-0 border-l pl-3">
                    {job.analysis ? (
                      <div className="max-h-[120px] overflow-y-auto space-y-2 text-xs">
                        {/* AI 匹配度 */}
                        <div>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="flex items-center gap-1 font-medium text-blue-700 dark:text-blue-400">
                              <Brain className="h-3 w-3" /> AI 匹配度
                            </span>
                            <span className="font-bold text-blue-700 dark:text-blue-400">
                              {Math.round(job.analysis.overall_score * 100)} 分
                            </span>
                          </div>
                          <Progress value={job.analysis.overall_score * 100} className="h-1" />
                        </div>
                        {/* 建议 */}
                        {job.analysis.suggestion && (
                          <p className="text-muted-foreground leading-relaxed">{job.analysis.suggestion}</p>
                        )}
                        {/* 沟通文案 */}
                        {job.analysis.greeting_text && (
                          <div className="bg-muted/50 rounded p-2">
                            <p className="flex items-center gap-1 text-muted-foreground mb-0.5">
                              <MessageSquare className="h-3 w-3" /> 沟通文案
                            </p>
                            <p className="whitespace-pre-wrap">{job.analysis.greeting_text}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                        暂无 AI 分析
                      </div>
                    )}
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    {job.url && (
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground p-1"
                        onClick={(e) => e.stopPropagation()}
                        title="打开原页面"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <button
                      onClick={(e) => handleDelete(job.id, e)}
                      className="text-muted-foreground hover:text-red-500 transition-colors p-1"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
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
