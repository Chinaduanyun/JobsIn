import { useEffect, useState, type ChangeEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { tasks as tasksApi } from '@/lib/api'
import type { CollectionTask } from '@/types'
import { Plus, Play, Square, Trash2 } from 'lucide-react'

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

  const refresh = () => {
    tasksApi.list().then(setTaskList).catch(() => {})
  }

  useEffect(() => { refresh() }, [])

  const handleCreate = async () => {
    if (!form.keyword.trim()) return
    await tasksApi.create(form)
    setForm({ keyword: '', city: '全国', salary: '' })
    setShowForm(false)
    refresh()
  }

  const handleStart = async (id: number) => {
    await tasksApi.start(id)
    refresh()
  }

  const handleCancel = async (id: number) => {
    await tasksApi.cancel(id)
    refresh()
  }

  const handleDelete = async (id: number) => {
    await tasksApi.delete(id)
    refresh()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">采集任务</h2>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-1" /> 新建任务
        </Button>
      </div>

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
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      已采集 {task.total_collected} 个岗位
                    </span>
                    <div className="flex gap-1">
                      {task.status === 'pending' && (
                        <Button size="sm" variant="outline" onClick={() => handleStart(task.id)}>
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
