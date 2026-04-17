import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { jobs as jobsApi, applications as appsApi } from '@/lib/api'
import type { Job, PaginatedResponse } from '@/types'
import { Search, ChevronLeft, ChevronRight, ExternalLink, CheckSquare, Square, Send, Loader2, Trash2 } from 'lucide-react'
import JobDetailDrawer from '@/components/JobDetailDrawer'

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
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchMsg, setBatchMsg] = useState('')

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

  const handleBatchApply = async () => {
    if (selectedIds.size === 0) return
    setBatchLoading(true)
    setBatchMsg('')
    try {
      const res = await appsApi.batchApply(Array.from(selectedIds))
      setBatchMsg(`✅ 批量投递已启动：${res.total} 个岗位`)
      setSelectedIds(new Set())
      // 3 秒后跳转到投递管理页
      setTimeout(() => navigate('/applications'), 2000)
    } catch (e: any) {
      setBatchMsg(`❌ ${e.message || '批量投递失败'}`)
    }
    setBatchLoading(false)
    setTimeout(() => setBatchMsg(''), 5000)
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
    setBatchLoading(true)
    try {
      await jobsApi.batchDelete(Array.from(selectedIds))
    } catch {}
    setSelectedIds(new Set())
    fetchJobs(page, keyword)
    setBatchLoading(false)
  }

  const totalPages = Math.ceil(data.total / data.size) || 1

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">岗位列表</h2>
        {selectedIds.size > 0 && (
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={handleBatchDelete} disabled={batchLoading}>
              <Trash2 className="h-4 w-4 mr-1" />
              删除 ({selectedIds.size})
            </Button>
            <Button onClick={handleBatchApply} disabled={batchLoading}>
              {batchLoading ? (
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
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2">
                    <button
                      onClick={(e) => toggleSelect(job.id, e)}
                      className="mt-1 text-muted-foreground hover:text-foreground"
                    >
                      {selectedIds.has(job.id) ? (
                        <CheckSquare className="h-4 w-4 text-blue-500" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                    <div>
                      <CardTitle className="text-base">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs mr-2 ${
                          { boss: 'bg-green-100 text-green-800', zhaopin: 'bg-blue-100 text-blue-800', job51: 'bg-orange-100 text-orange-800', liepin: 'bg-purple-100 text-purple-800' }[job.platform] || 'bg-gray-100 text-gray-800'
                        }`}>
                          {{ boss: 'Boss', zhaopin: '智联', job51: '51job', liepin: '猎聘' }[job.platform] || job.platform}
                        </span>
                        {job.title}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {job.company} · {job.city}
                        {job.company_size && ` · ${job.company_size}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-orange-600">
                      {job.salary}
                    </Badge>
                    {job.analysis && (
                      <Badge
                        variant={
                          job.analysis.overall_score >= 0.8
                            ? 'default'
                            : job.analysis.overall_score >= 0.6
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        匹配 {Math.round(job.analysis.overall_score * 100)}分
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex gap-3 text-muted-foreground">
                    <span>{job.experience}</span>
                    <span>{job.education}</span>
                    <span>
                      HR: {job.hr_name}
                      {job.hr_active && ` (${job.hr_active})`}
                    </span>
                  </div>
                  {job.url && (
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                  <button
                    onClick={(e) => handleDelete(job.id, e)}
                    className="text-muted-foreground hover:text-red-500 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
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
