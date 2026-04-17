import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { jobs as jobsApi, applications as appsApi } from '@/lib/api'
import type { Job, PaginatedResponse } from '@/types'
import { Search, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import JobDetailDrawer from '@/components/JobDetailDrawer'

export default function JobsPage() {
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
    // Fetch full detail with analysis
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
  }

  const totalPages = Math.ceil(data.total / data.size) || 1

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">岗位列表</h2>

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
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => handleJobClick(job)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{job.title}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {job.company} · {job.city}
                      {job.company_size && ` · ${job.company_size}`}
                    </p>
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
