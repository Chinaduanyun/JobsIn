import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { jobs as jobsApi, applications as appsApi } from '@/lib/api'
import type { Job, PaginatedResponse } from '@/types'
import {
  Brain, MessageSquare, ExternalLink, ChevronLeft, ChevronRight,
  Star, Clock, Filter, CheckSquare, Square, Send, Loader2,
} from 'lucide-react'
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

const RECOMMENDATIONS_PAGE_SIZE = 50

export default function RecommendationsPage() {
  const [data, setData] = useState<PaginatedResponse<Job>>({ items: [], total: 0, page: 1, size: RECOMMENDATIONS_PAGE_SIZE })
  const [page, setPage] = useState(1)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [excludeApplied, setExcludeApplied] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchLoading, setBatchLoading] = useState('')
  const [batchMsg, setBatchMsg] = useState('')

  const fetchRecommendations = (p: number) => {
    setLoading(true)
    jobsApi.listRecommendations({ page: p, page_size: RECOMMENDATIONS_PAGE_SIZE, exclude_applied: excludeApplied })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchRecommendations(page)
    setSelectedIds(new Set())
  }, [page, excludeApplied])

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
    fetchRecommendations(page)
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

  const selectableItems = data.items.filter(job => job.apply_status !== 'sent')

  const toggleSelectAll = () => {
    if (selectableItems.length > 0 && selectedIds.size === selectableItems.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableItems.map(job => job.id)))
    }
  }

  const handleBatchApply = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`确定要批量投递选中的 ${selectedIds.size} 个推荐岗位吗？`)) return

    setBatchLoading('apply')
    setBatchMsg('')
    try {
      const res = await appsApi.batchApply(Array.from(selectedIds))
      setBatchMsg(`✅ 批量投递已启动：${res.total} 个岗位`)
      setSelectedIds(new Set())
      fetchRecommendations(page)
    } catch (e: any) {
      setBatchMsg(`❌ ${e.message || '批量投递失败'}`)
    }
    setBatchLoading('')
  }

  const totalPages = Math.ceil(data.total / data.size) || 1

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Star className="h-6 w-6 text-yellow-500" />
          <h2 className="text-2xl font-bold">AI 智能推荐</h2>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant={excludeApplied ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setExcludeApplied(!excludeApplied); setPage(1) }}
          >
            <Filter className="h-4 w-4 mr-1" />
            {excludeApplied ? '显示全部' : '隐藏已投递'}
          </Button>
          <span className="text-sm text-muted-foreground">
            按 AI 匹配分从高到低排列，每页展示 {RECOMMENDATIONS_PAGE_SIZE} 条
          </span>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          <Button variant="outline" size="sm" onClick={toggleSelectAll}>
            {selectedIds.size === selectableItems.length && selectableItems.length > 0 ? (
              <CheckSquare className="h-4 w-4 mr-1" />
            ) : (
              <Square className="h-4 w-4 mr-1" />
            )}
            {selectedIds.size === selectableItems.length && selectableItems.length > 0 ? '取消全选' : '全选本页'}
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

      {batchMsg && (
        <Alert className="mb-4">
          <AlertDescription>{batchMsg}</AlertDescription>
        </Alert>
      )}

      {data.items.length === 0 && !loading ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-2">暂无 AI 推荐</p>
            <p className="text-sm text-muted-foreground">
              请先在「岗位列表」中对岗位进行 AI 分析，分析后的岗位会按匹配度在此排序展示
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((job, index) => {
            const rank = (page - 1) * data.size + index + 1
            const score = job.analysis?.overall_score ?? 0
            const scorePercent = Math.round(score * 100)
            const scoreColor = scorePercent >= 80 ? 'text-green-600' : scorePercent >= 60 ? 'text-yellow-600' : 'text-red-500'
            const isSelected = selectedIds.has(job.id)
            const isApplied = job.apply_status === 'sent'

            return (
              <Card
                key={job.id}
                className={`hover:shadow-md transition-shadow ${isSelected ? 'ring-2 ring-blue-400' : ''}`}
              >
                <CardContent className="p-0">
                  <div className="flex gap-0">
                    <div
                      className={`w-16 sm:w-20 flex-shrink-0 flex flex-col items-center justify-center border-r border-dashed p-3 ${
                        isApplied ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/20'
                      } transition-colors`}
                      onClick={isApplied ? undefined : (e) => toggleSelect(job.id, e)}
                      title={isApplied ? '该岗位已投递' : '选择岗位'}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-5 w-5 text-blue-500 mb-2" />
                      ) : (
                        <Square className="h-5 w-5 text-muted-foreground mb-2" />
                      )}
                      <span className="text-lg font-bold text-muted-foreground">#{rank}</span>
                      <span className={`text-sm font-bold ${scoreColor}`}>{scorePercent}分</span>
                      <Progress value={scorePercent} className="w-10 h-1.5 mt-1" />
                    </div>

                    <div
                      className="flex-1 min-w-0 p-4 cursor-pointer"
                      onClick={() => handleJobClick(job)}
                    >
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                          { boss: 'bg-green-100 text-green-800', zhaopin: 'bg-blue-100 text-blue-800', job51: 'bg-orange-100 text-orange-800', liepin: 'bg-purple-100 text-purple-800' }[job.platform] || 'bg-gray-100 text-gray-800'
                        }`}>
                          {{ boss: 'Boss', zhaopin: '智联', job51: '51job', liepin: '猎聘' }[job.platform] || job.platform}
                        </span>
                        <span className="font-medium truncate">{job.title}</span>
                        {job.salary && <span className="font-semibold text-orange-600 flex-shrink-0">{job.salary}</span>}
                        {job.apply_status && (
                          <Badge variant="outline" className="text-xs flex-shrink-0">
                            {({ sent: '已投递', pending: '待投递', failed: '投递失败' } as Record<string, string>)[job.apply_status] || job.apply_status}
                          </Badge>
                        )}
                      </div>

                      {job.analysis?.suggestion && (
                        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md p-2 mb-1.5 max-h-[72px] overflow-y-auto">
                          <p className="flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 mb-0.5">
                            <Brain className="h-3 w-3" /> AI 分析
                          </p>
                          <p className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">{job.analysis.suggestion}</p>
                        </div>
                      )}

                      {job.analysis?.greeting_text && (
                        <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-md p-2 mb-1.5 max-h-[64px] overflow-y-auto">
                          <p className="flex items-center gap-1 text-xs font-medium text-purple-700 dark:text-purple-400 mb-0.5">
                            <MessageSquare className="h-3 w-3" /> 沟通文案
                          </p>
                          <p className="text-xs text-purple-900 dark:text-purple-200 leading-relaxed">{job.analysis.greeting_text}</p>
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        {job.company && <span>{job.company}</span>}
                        {job.city && <span>· {job.city}</span>}
                        {job.experience && <span className="bg-muted px-1.5 py-0.5 rounded">{job.experience}</span>}
                        {job.education && <span className="bg-muted px-1.5 py-0.5 rounded">{job.education}</span>}
                        <span className="flex items-center gap-0.5 ml-auto">
                          <Clock className="h-3 w-3" />
                          {formatTimeAgo(job.collected_at)}
                        </span>
                        {job.url && (
                          <a href={job.url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground" onClick={e => e.stopPropagation()}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {data.total > 0 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">共 {data.total} 个已分析岗位</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">{page} / {totalPages}</span>
            <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <JobDetailDrawer
        job={selectedJob}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onApply={handleApply}
      />
    </div>
  )
}
