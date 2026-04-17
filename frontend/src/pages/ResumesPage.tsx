import { useEffect, useState, type ChangeEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { resumes as resumesApi } from '@/lib/api'
import type { Resume } from '@/types'
import { Plus, Star, Trash2, Save } from 'lucide-react'

export default function ResumesPage() {
  const [list, setList] = useState<Resume[]>([])
  const [editing, setEditing] = useState<Resume | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', content: '' })

  const refresh = () => {
    resumesApi.list().then(setList).catch(() => {})
  }

  useEffect(() => { refresh() }, [])

  const handleCreate = async () => {
    if (!form.name.trim() || !form.content.trim()) return
    await resumesApi.create(form)
    setForm({ name: '', content: '' })
    setShowCreate(false)
    refresh()
  }

  const handleUpdate = async () => {
    if (!editing) return
    await resumesApi.update(editing.id, {
      name: editing.name,
      content: editing.content,
    })
    setEditing(null)
    refresh()
  }

  const handleActivate = async (id: number) => {
    await resumesApi.activate(id)
    refresh()
  }

  const handleDelete = async (id: number) => {
    await resumesApi.delete(id)
    refresh()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">简历管理</h2>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4 mr-1" /> 新建简历
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        简历使用 Markdown 纯文本格式，AI 会根据此内容进行岗位匹配分析
      </p>

      {/* Create form */}
      {showCreate && (
        <Card className="mb-4">
          <CardContent className="pt-4 space-y-3">
            <div>
              <Label>简历名称</Label>
              <Input
                placeholder="如: 后端开发简历"
                value={form.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>简历内容 (Markdown)</Label>
              <Textarea
                placeholder="# 个人信息&#10;姓名: ...&#10;&#10;# 工作经历&#10;..."
                rows={12}
                value={form.content}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, content: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate}>创建</Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit form */}
      {editing && (
        <Card className="mb-4 border-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">编辑简历</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>简历名称</Label>
              <Input
                value={editing.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div>
              <Label>简历内容 (Markdown)</Label>
              <Textarea
                rows={12}
                value={editing.content}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                  setEditing({ ...editing, content: e.target.value })
                }
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleUpdate}>
                <Save className="h-4 w-4 mr-1" /> 保存
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resume list */}
      <div className="space-y-3">
        {list.length === 0 && !showCreate ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              暂无简历，请先创建一份
            </CardContent>
          </Card>
        ) : (
          list.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {r.name}
                    {r.is_active && (
                      <Badge variant="default">当前使用</Badge>
                    )}
                  </CardTitle>
                  <div className="flex gap-1">
                    {!r.is_active && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleActivate(r.id)}
                      >
                        <Star className="h-3 w-3 mr-1" /> 设为活跃
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(r)}
                    >
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(r.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-32 overflow-hidden">
                  {r.content.slice(0, 300)}
                  {r.content.length > 300 && '...'}
                </pre>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
