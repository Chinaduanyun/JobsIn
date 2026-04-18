import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { jobs as jobsApi, applications as appsApi } from '@/lib/api'
import type { Job, PaginatedResponse } from '@/types'
import {
  Brain, MessageSquare, ExternalLink, ChevronLeft, ChevronRight,
  Star, Clock,
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

export default function RecommendationsPage() {
  const [data, setData] = useState<PaginatedResponse<Job>>({ items: [], total: 0, page: 1, size: 20 })
  const [page, setPage] = useState(1)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchRecommendations = (p: number) => {
    setLoading(true)
    jobsApi.listRecommendations({ page: p, page_size: 20 })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchRecommendations(page)
  }, [page])

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

  const totalPages = Math.ceil(data.total / data.size) || 1

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Star className="h-6 w-6 text-yellow-500" />
          <h2 className="text-2xl font-bold">AI 智能推荐</h2>
        </div>
        <span className="text-sm text-muted-foreground">
          按 AI 匹配分从高到低排列，仅显示已分析的岗位
        </span>
      </div>

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

            return (
              <Card
                key={job.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => handleJobClick(job)}
              >
                <CardContent className="p-4">
                  <div className="flex gap-4">
                    {/* 排名 + 分数 */}
                    <div className="flex-shrink-0 w-16 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-muted-foreground">#{rank}</span>
                      <span className={`text-lg font-bold ${scoreColor}`}>{scorePercent}分</span>
                      <Progress value={scorePercent} className="w-14 h-1.5 mt-1" />
                    </div>

                    {/* 主要信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                          { boss: 'bg-green-100 text-green-800', zhaopin: 'bg-blue-100 text-blue-800', job51: 'bg-orange-100 text-orange-800', liepin: 'bg-purple-100 text-purple-800' }[job.platform] || 'bg-gray-100 text-gray-800'
                        }`}>
                          {{ boss: 'Boss', zhaopin: '智联', job51: '51job', liepin: '猎聘' }[job.platform] || job.platform}
                        </span>
                        <span className="font-medium truncate">{job.title}</span>
                        {job.salary && <span className="font-semibold text-orange-600 flex-shrink-0">{job.salary}</span>}
                        {(job as any).apply_status && (
                          <Badge variant="outline" className="text-xs flex-shrink-0">
                            {({ sent: '已投递', pending: '待投递', failed: '投递失败' } as Record<string, string>)[(job as any).apply_status] || (job as any).apply_status}
                          </Badge>
                        )}
                      </div>

                      {/* AI 分析建议 */}
                      {job.analysis?.suggestion && (
                        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md p-2 mb-1.5 max-h-[60px] overflow-y-auto">
                          <p className="flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 mb-0.5">
                            <Brain className="h-3 w-3" /> AI 分析
                          </p>
                          <p className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">{job.analysis.suggestion}</p>
                        </div>
                      )}

                      {/* 沟通文案 */}
                      {job.analysis?.greeting_text && (
                        <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-md p-2 mb-1.5 max-h-[50px] overflow-y-auto">
                          <p className="flex items-center gap-1 text-xs font-medium text-purple-700 dark:text-purple-400 mb-0.5">
                            <MessageSquare className="h-3 w-3" /> 沟通文案
                          </p>
                          <p className="text-xs text-purple-900 dark:text-purple-200 leading-relaxed">{job.analysis.greeting_text}</p>
                        </div>
                      )}

                      {/* 底部信息 */}
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
