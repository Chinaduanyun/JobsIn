import { useEffect, useState, useRef, type ChangeEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { tasks as tasksApi, browser as browserApi } from '@/lib/api'
import type { CollectionTask, BrowserStatus } from '@/types'
import { Plus, Play, Square, Trash2, AlertTriangle, Loader2 } from 'lucide-react'

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  pending: { label: '等待中', variant: 'outline' },
  running: { label: '运行中', variant: 'default' },
  completed: { label: '已完成', variant: 'secondary' },
  cancelled: { label: '已取消', variant: 'destructive' },
  failed: { label: '失败', variant: 'destructive' },
}

export default function TasksPage() {
  const [taskList, setTaskList] = useState<CollectionTask[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ keyword: '', city: '全国', salary: '' })
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(null)
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = () => {
    tasksApi.list().then(setTaskList).catch(() => {})
  }

  useEffect(() => {
    refresh()
    browserApi.status().then(setBrowserStatus).catch(() => {})
  }, [])

  // Poll while any task is running
  useEffect(() => {
    const hasRunning = taskList.some(t => t.status === 'running')
    if (hasRunning && !pollRef.current) {
      pollRef.current = setInterval(refresh, 3000)
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
      await tasksApi.create(form)
      setForm({ keyword: '', city: '全国', salary: '' })
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

  const handleCancel = async (id: number) => {
    await tasksApi.cancel(id)
    refresh()
  }

  const handleDelete = async (id: number) => {
    await tasksApi.delete(id)
    refresh()
  }

  const browserReady = browserStatus?.launched && browserStatus?.logged_in

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">采集任务</h2>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-1" /> 新建任务
        </Button>
      </div>

      {/* Browser status warning */}
      {!browserReady && browserStatus !== null && (
        <Alert className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {!browserStatus?.launched
              ? '浏览器未启动，请先到「系统设置」启动浏览器'
              : '浏览器未登录，请先到「系统设置」扫码登录'}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Create form */}
      {showForm && (
        <Card className="mb-4">
          <CardContent className="pt-4">
            <div className="grid grid-cols-3 gap-4">
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

      {/* Task list */}
      <div className="space-y-3">
        {taskList.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              暂无采集任务
            </CardContent>
          </Card>
        ) : (
          taskList.map((task) => {
            const st = statusMap[task.status] || statusMap.pending
            return (
              <Card key={task.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
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
                      {task.max_pages > 0 && ` · 最大 ${task.max_pages} 页`}
                    </span>
                    <div className="flex gap-1">
                      {task.status === 'pending' && (
                        <Button size="sm" variant="outline" onClick={() => handleStart(task.id)} disabled={!browserReady}>
                          <Play className="h-3 w-3 mr-1" /> 开始
                        </Button>
                      )}
                      {task.status === 'running' && (
                        <Button size="sm" variant="outline" onClick={() => handleCancel(task.id)}>
                          <Square className="h-3 w-3 mr-1" /> 停止
                        </Button>
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
