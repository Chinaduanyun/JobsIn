import { useEffect, useState, useRef, type ChangeEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { tasks as tasksApi, browser as browserApi, extension as extensionApi, ai as aiApi, resumes as resumesApi } from '@/lib/api'
import type { CollectionTask, BrowserStatus, Platform, Resume } from '@/types'
import { Plus, Play, Square, Trash2, AlertTriangle, Loader2, Puzzle, Brain, Pause, RotateCcw, ArrowUpDown, Clock, CheckCircle2, XCircle, Sparkles } from 'lucide-react'

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  pending: { label: '等待中', variant: 'outline' },
  running: { label: '运行中', variant: 'default' },
  paused: { label: '已暂停', variant: 'secondary' },
  completed: { label: '已完成', variant: 'secondary' },
  cancelled: { label: '已取消', variant: 'destructive' },
  failed: { label: '失败', variant: 'destructive' },
}

const platformColors: Record<string, string> = {
  boss: 'bg-green-100 text-green-800',
  zhaopin: 'bg-blue-100 text-blue-800',
  job51: 'bg-orange-100 text-orange-800',
  liepin: 'bg-purple-100 text-purple-800',
}

type SortMode = 'time' | 'status'
type SuggestedKeyword = { keyword: string; reason: string; city: string; status: 'pending' | 'approved' | 'rejected'; taskId?: number }

export default function TasksPage() {
  const [taskList, setTaskList] = useState<CollectionTask[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    platform: 'boss',
    keyword: '',
    city: '杭州',
    salary: '',
    max_pages: 5,
    target_new_jobs: 30,
    stop_after_stale_pages: 2,
    start_page: '',
  })
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(null)
  const [extConnected, setExtConnected] = useState(false)
  const [extSecurityCheck, setExtSecurityCheck] = useState(false)
  const [error, setError] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('time')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // AI 智能创建
  const [showAiCreate, setShowAiCreate] = useState(false)
  const [resumeList, setResumeList] = useState<Resume[]>([])
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [suggestedKeywords, setSuggestedKeywords] = useState<SuggestedKeyword[]>([])

  const refresh = () => {
    tasksApi.list().then(setTaskList).catch(() => {})
  }

  const refreshStatuses = () => {
    browserApi.status().then(setBrowserStatus).catch(() => {})
    extensionApi.status().then(s => {
      setExtConnected(s.connected)
      setExtSecurityCheck(s.security_check)
    }).catch(() => setExtConnected(false))
  }

  useEffect(() => {
    refresh()
    refreshStatuses()
    tasksApi.platforms().then(setPlatforms).catch(() => {})
  }, [])

  // Poll while any task is running
  useEffect(() => {
    const hasRunning = taskList.some(t => t.status === 'running')
    if (hasRunning && !pollRef.current) {
      pollRef.current = setInterval(() => {
        refresh()
        refreshStatuses()
      }, 3000)
    } else if (!hasRunning && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [taskList])

  const handleCreate = async () => {
    if (!form.keyword.trim()) return
    setError('')
    try {
      const payload = {
        ...form,
        start_page: form.start_page === '' ? undefined : Number(form.start_page),
      }
      await tasksApi.create(payload)
      setForm({
        platform: 'boss',
        keyword: '',
        city: '杭州',
        salary: '',
        max_pages: 5,
        target_new_jobs: 30,
        stop_after_stale_pages: 2,
        start_page: '',
      })
      setShowForm(false)
      refresh()
    } catch (e: any) {
      setError(e.message || '创建失败')
    }
  }

  const handleStart = async (id: number) => {
    setError('')
    try {
      await tasksApi.start(id)
      refresh()
    } catch (e: any) {
      setError(e.message || '启动失败，请确保浏览器已启动并登录')
    }
  }

  const handlePause = async (id: number) => {
    setError('')
    try {
      await tasksApi.pause(id)
      refresh()
    } catch (e: any) {
      setError(e.message || '暂停失败')
    }
  }

  const handleResume = async (id: number) => {
    setError('')
    try {
      await tasksApi.resume(id)
      refresh()
    } catch (e: any) {
      setError(e.message || '恢复失败')
    }
  }

  const handleCancel = async (id: number) => {
    await tasksApi.cancel(id)
    refresh()
  }

  const handleDelete = async (id: number) => {
    await tasksApi.delete(id)
    refresh()
  }

  // AI 智能创建
  const handleOpenAiCreate = async () => {
    setShowAiCreate(true)
    setSuggestedKeywords([])
    setSelectedResumeId(null)
    try {
      const list = await resumesApi.list()
      setResumeList(list)
      const active = list.find(r => r.is_active)
      if (active) setSelectedResumeId(active.id)
    } catch {}
  }

  const handleAiSuggest = async () => {
    if (!selectedResumeId) return
    setAiLoading(true)
    setError('')
    try {
      const res = await aiApi.suggestKeywords(selectedResumeId)
      setSuggestedKeywords(res.keywords.map(k => ({ ...k, status: 'pending' as const })))
    } catch (e: any) {
      setError(e.message || 'AI 关键词生成失败')
    }
    setAiLoading(false)
  }

  const handleApproveKeyword = async (index: number) => {
    const kw = suggestedKeywords[index]
    if (!kw || kw.status !== 'pending') return
    setError('')
    try {
      const task = await tasksApi.create({ platform: 'boss', keyword: kw.keyword, city: kw.city || '全国' })
      setSuggestedKeywords(prev => prev.map((k, i) => i === index ? { ...k, status: 'approved' as const, taskId: task.id } : k))
      // Auto-start if browser is ready
      if (browserReady) {
        try {
          await tasksApi.start(task.id)
        } catch {}
      }
      refresh()
    } catch (e: any) {
      setError(e.message || '创建任务失败')
    }
  }

  const handleRejectKeyword = (index: number) => {
    setSuggestedKeywords(prev => prev.map((k, i) => i === index ? { ...k, status: 'rejected' as const } : k))
  }

  const browserReady = browserStatus?.logged_in && (browserStatus?.cookies_count ?? 0) > 0
  const getPlatformName = (key: string) => platforms.find(p => p.key === key)?.name || key

  // 排序
  const statusOrder: Record<string, number> = { running: 0, paused: 1, pending: 2, completed: 3, failed: 4, cancelled: 5 }
  const sortedTasks = [...taskList].sort((a, b) => {
    if (sortMode === 'status') {
      return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">采集任务</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleOpenAiCreate}>
            <Sparkles className="h-4 w-4 mr-1" /> AI 智能创建
          </Button>
          <Button onClick={() => { setShowForm(!showForm); setShowAiCreate(false) }}>
            <Plus className="h-4 w-4 mr-1" /> 新建任务
          </Button>
        </div>
      </div>

      {/* Extension status */}
      {!extConnected && (
        <Alert className="mb-4">
          <Puzzle className="h-4 w-4" />
          <AlertDescription>
            Chrome 扩展未连接。请在 Chrome 中安装并启用「FindJobs 助手」扩展，详见「系统设置」页面。
          </AlertDescription>
        </Alert>
      )}

      {/* Browser login warning */}
      {extConnected && !browserStatus?.logged_in && browserStatus !== null && (
        <Alert className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            未登录，请先到「系统设置」完成 Boss 直聘登录
          </AlertDescription>
        </Alert>
      )}

      {/* Security check warning */}
      {extSecurityCheck && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            ⚠️ Boss 直聘安全验证触发！请在 Chrome 浏览器中完成验证后，采集会自动继续。
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* AI 智能创建面板 */}
      {showAiCreate && (
        <Card className="mb-4 border-purple-200 dark:border-purple-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-600" />
              AI 智能创建采集任务
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* 选择简历 */}
            <div className="mb-4">
              <Label>选择简历</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                value={selectedResumeId ?? ''}
                onChange={(e) => setSelectedResumeId(Number(e.target.value) || null)}
              >
                <option value="">请选择简历...</option>
                {resumeList.map(r => (
                  <option key={r.id} value={r.id}>{r.name}{r.is_active ? ' (当前激活)' : ''}</option>
                ))}
              </select>
            </div>

            <Button onClick={handleAiSuggest} disabled={!selectedResumeId || aiLoading} className="mb-4">
              {aiLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Brain className="h-4 w-4 mr-1" />}
              {aiLoading ? 'AI 分析中...' : '生成关键词建议'}
            </Button>

            {/* 关键词建议列表 */}
            {suggestedKeywords.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">AI 推荐的搜索关键词（点击批准开始采集）：</p>
                {suggestedKeywords.map((kw, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-md border ${
                    kw.status === 'approved' ? 'bg-green-50 dark:bg-green-950/20 border-green-200' :
                    kw.status === 'rejected' ? 'bg-red-50 dark:bg-red-950/20 border-red-200 opacity-60' :
                    'bg-muted/50'
                  }`}>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm">{kw.keyword}</span>
                      <span className="text-xs text-muted-foreground ml-2">({kw.city})</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{kw.reason}</p>
                    </div>
                    {kw.status === 'pending' && (
                      <div className="flex gap-1 flex-shrink-0">
                        <Button size="sm" variant="outline" className="h-7 text-green-600 border-green-300 hover:bg-green-50" onClick={() => handleApproveKeyword(i)}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> 批准
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-red-500 border-red-300 hover:bg-red-50" onClick={() => handleRejectKeyword(i)}>
                          <XCircle className="h-3.5 w-3.5 mr-1" /> 拒绝
                        </Button>
                      </div>
                    )}
                    {kw.status === 'approved' && (
                      <Badge variant="secondary" className="text-green-700 bg-green-100 flex-shrink-0">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> 已创建
                      </Badge>
                    )}
                    {kw.status === 'rejected' && (
                      <Badge variant="secondary" className="text-red-500 bg-red-100 flex-shrink-0">
                        <XCircle className="h-3 w-3 mr-1" /> 已拒绝
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end mt-3">
              <Button variant="outline" size="sm" onClick={() => { setShowAiCreate(false); setSuggestedKeywords([]) }}>
                关闭
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create form */}
      {showForm && (
        <Card className="mb-4">
          <CardContent className="pt-4">
            <div className="grid grid-cols-5 gap-4">
              <div>
                <Label>平台</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.platform}
                  onChange={(e) => setForm({ ...form, platform: e.target.value })}
                >
                  {platforms.map(p => (
                    <option key={p.key} value={p.key}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>关键词 *</Label>
                <Input
                  placeholder="如: Python开发"
                  value={form.keyword}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, keyword: e.target.value })}
                />
              </div>
              <div>
                <Label>城市</Label>
                <Input
                  placeholder="如: 深圳"
                  value={form.city}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div>
                <Label>薪资范围</Label>
                <Input
                  placeholder="如: 15-25K"
                  value={form.salary}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, salary: e.target.value })}
                />
              </div>
              <div>
                <Label>起始页码</Label>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  placeholder="1"
                  value={form.start_page}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, start_page: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">留空默认从 1 开始；相同参数再次采集时，系统会自动续接到上次之后。</p>
              </div>
              <div>
                <Label>最多扫描页数</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  placeholder="5"
                  value={form.max_pages}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, max_pages: parseInt(e.target.value) || 5 })}
                />
                <p className="text-xs text-muted-foreground mt-1">不是固定抓完这些页，而是最多扫描这么多页。</p>
              </div>
              <div>
                <Label>目标新岗位数</Label>
                <Input
                  type="number"
                  min={0}
                  max={500}
                  placeholder="30"
                  value={form.target_new_jobs}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, target_new_jobs: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground mt-1">达到这个数量后会提前停止；填 0 表示只按页数控制。</p>
              </div>
              <div>
                <Label>连续空转停止页数</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  placeholder="2"
                  value={form.stop_after_stale_pages}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, stop_after_stale_pages: parseInt(e.target.value) || 2 })}
                />
                <p className="text-xs text-muted-foreground mt-1">连续几页都没有新岗位时，提前结束这次采集。</p>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={handleCreate}>创建</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sort controls */}
      {taskList.length > 1 && (
        <div className="flex gap-2 mb-3">
          <Button
            variant={sortMode === 'time' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSortMode('time')}
          >
            <Clock className="h-3.5 w-3.5 mr-1" /> 按时间
          </Button>
          <Button
            variant={sortMode === 'status' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSortMode('status')}
          >
            <ArrowUpDown className="h-3.5 w-3.5 mr-1" /> 按状态
          </Button>
        </div>
      )}

      {/* Task list */}
      <div className="space-y-3">
        {sortedTasks.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              暂无采集任务
            </CardContent>
          </Card>
        ) : (
          sortedTasks.map((task) => {
            const st = statusMap[task.status] || statusMap.pending
            return (
              <Card key={task.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs mr-2 ${platformColors[task.platform] || 'bg-gray-100 text-gray-800'}`}>
                        {getPlatformName(task.platform)}
                      </span>
                      {task.keyword}
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        {task.city}
                        {task.salary && ` · ${task.salary}`}
                      </span>
                    </CardTitle>
                    <Badge variant={st.variant}>
                      {task.status === 'running' && (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      )}
                      {st.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      已采集 {task.total_collected} 个岗位
                      {task.start_page > 0 && ` · 起始页 ${task.start_page}`}
                      {task.last_page_reached > 0 && ` · 扫到第 ${task.last_page_reached} 页`}
                      {task.max_pages > 0 && ` · 最多扫 ${task.max_pages} 页`}
                      {task.target_new_jobs > 0 && ` · 目标 ${task.target_new_jobs} 个新岗位`}
                      {task.stop_after_stale_pages > 0 && ` · 空转 ${task.stop_after_stale_pages} 页即停`}
                    </span>
                    <div className="flex gap-1">
                      {task.status === 'pending' && (
                        <Button size="sm" variant="outline" onClick={() => handleStart(task.id)} disabled={!browserReady}>
                          <Play className="h-3 w-3 mr-1" /> 开始
                        </Button>
                      )}
                      {task.status === 'running' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => handlePause(task.id)}>
                            <Pause className="h-3 w-3 mr-1" /> 暂停
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleCancel(task.id)}>
                            <Square className="h-3 w-3 mr-1" /> 停止
                          </Button>
                        </>
                      )}
                      {task.status === 'paused' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => handleResume(task.id)} disabled={!browserReady}>
                            <RotateCcw className="h-3 w-3 mr-1" /> 恢复
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(task.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                      {(task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') && (
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(task.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
