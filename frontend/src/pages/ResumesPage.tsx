import { useEffect, useState, type ChangeEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { resumes as resumesApi } from '@/lib/api'
import type { Resume } from '@/types'
import { Save, FileText, CheckCircle2 } from 'lucide-react'

export default function ResumesPage() {
  const [resume, setResume] = useState<Resume | null>(null)
  const [name, setName] = useState('我的简历')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    resumesApi.list().then((list) => {
      if (list.length > 0) {
        // 优先用激活的，否则用第一个
        const active = list.find((r: Resume) => r.is_active) || list[0]
        setResume(active)
        setName(active.name)
        setContent(active.content)
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    if (!content.trim()) return
    setSaving(true)
    try {
      if (resume) {
        await resumesApi.update(resume.id, { name, content })
      } else {
        const created = await resumesApi.create({ name, content })
        setResume(created)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        加载中...
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" /> 我的简历
        </h2>
        {resume && (
          <Badge variant="secondary">
            上次更新: {new Date(resume.updated_at).toLocaleString('zh-CN')}
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-muted-foreground">
            简历使用 Markdown 纯文本格式，AI 会根据此内容进行岗位匹配分析和文案生成
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>简历名称</Label>
            <Input
              placeholder="如: 后端开发简历"
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label>简历内容 (Markdown)</Label>
            <Textarea
              placeholder={`# 个人信息\n姓名: 张三\n手机: 138xxxx\n邮箱: xxx@xxx.com\n\n# 求职意向\n期望岗位: 前端开发工程师\n期望城市: 杭州\n期望薪资: 15-25K\n\n# 工作经历\n## XX科技有限公司 | 前端开发 | 2021.06 - 至今\n- 负责公司核心产品前端开发\n- 使用 React + TypeScript 重构老项目\n\n# 技能\n- JavaScript / TypeScript / React / Vue\n- Node.js / Python\n- Git / Docker`}
              rows={20}
              className="font-mono text-sm"
              value={content}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving || !content.trim()}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? '保存中...' : '保存简历'}
            </Button>
            {saved && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> 已保存
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {content && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">内容预览</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm whitespace-pre-wrap leading-relaxed">{content}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
