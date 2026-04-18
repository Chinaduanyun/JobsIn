import { useState, useEffect } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ai as aiApi } from '@/lib/api'
import type { Job, JobAnalysis } from '@/types'
import {
  Brain,
  MessageSquare,
  Send,
  ExternalLink,
  Loader2,
  Building2,
  MapPin,
  Clock,
  GraduationCap,
  User,
} from 'lucide-react'

interface Props {
  job: Job | null
  open: boolean
  onClose: () => void
  onApply?: (jobId: number, greeting: string) => Promise<void>
}

export default function JobDetailDrawer({ job, open, onClose, onApply }: Props) {
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null)
  const [greeting, setGreeting] = useState('')
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  // Load existing analysis when job changes or drawer opens
  useEffect(() => {
    if (open && job) {
      setError('')
      setGreeting('')
      loadAnalysis(job.id)
    }
    if (!open) {
      setAnalysis(null)
      setGreeting('')
    }
  }, [open, job?.id])

  const loadAnalysis = async (jobId: number) => {
    try {
      const a = await aiApi.getAnalysis(jobId)
      setAnalysis(a)
      if (a.greeting_text) setGreeting(a.greeting_text)
    } catch {
      setAnalysis(null)
    }
  }

  // Handle sheet close
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose()
    }
  }

  const handleAnalyze = async () => {
    if (!job) return
    setLoading('analyze')
    setError('')
    try {
      const a = await aiApi.analyze(job.id)
      setAnalysis(a)
    } catch (e: any) {
      setError(e.message || 'AI 分析失败')
    }
    setLoading('')
  }

  const handleGreeting = async () => {
    if (!job) return
    setLoading('greeting')
    setError('')
    try {
      const res = await aiApi.greeting(job.id)
      setGreeting(res.greeting_text)
    } catch (e: any) {
      setError(e.message || '文案生成失败')
    }
    setLoading('')
  }

  const handleApply = async () => {
    if (!job || !onApply) return
    setLoading('apply')
    setError('')
    try {
      await onApply(job.id, greeting)
    } catch (e: any) {
      setError(e.message || '投递失败')
    }
    setLoading('')
  }

  if (!job) return null

  const scores = analysis?.scores_json ? (() => {
    try { return JSON.parse(analysis.scores_json) } catch { return {} }
  })() : {}

  const scoreLabels: Record<string, string> = {
    skill: '技能匹配',
    experience: '经验匹配',
    education: '学历匹配',
    salary: '薪资匹配',
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-[560px] sm:max-w-[560px] p-0">
        <SheetHeader className="p-6 pb-4">
          <SheetTitle className="text-left">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold">{job.title}</h3>
                <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                  <Building2 className="h-3 w-3" /> {job.company}
                  {job.company_industry && ` · ${job.company_industry}`}
                </div>
              </div>
              <Badge variant="secondary" className="text-orange-600 text-base">
                {job.salary}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-3 mt-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {job.city}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {job.experience}</span>
              <span className="flex items-center gap-1"><GraduationCap className="h-3 w-3" /> {job.education}</span>
              {job.company_size && <span>· {job.company_size}</span>}
            </div>
            {job.hr_name && (
              <div className="flex items-center gap-1 mt-2 text-sm">
                <User className="h-3 w-3" /> HR: {job.hr_name}
                {job.hr_active && (
                  <Badge
                    variant="outline"
                    className={`text-xs ml-1 ${
                      ['在线', '刚刚活跃'].includes(job.hr_active)
                        ? 'border-green-400 text-green-600 bg-green-50 dark:bg-green-900/20'
                        : ['今日活跃', '3日内活跃', '本周活跃'].includes(job.hr_active)
                          ? 'border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-300 text-gray-500'
                    }`}
                  >
                    {job.hr_active}
                  </Badge>
                )}
              </div>
            )}
          </SheetTitle>
        </SheetHeader>

        <Separator />

        <ScrollArea className="h-[calc(100vh-220px)]">
          <div className="p-6">
            <Tabs defaultValue="detail">
              <TabsList className="w-full">
                <TabsTrigger value="detail" className="flex-1">岗位详情</TabsTrigger>
                <TabsTrigger value="analysis" className="flex-1">AI 分析</TabsTrigger>
                <TabsTrigger value="apply" className="flex-1">投递</TabsTrigger>
              </TabsList>

              {/* Job detail tab */}
              <TabsContent value="detail" className="mt-4 space-y-4">
                {job.tags && (
                  <div className="flex flex-wrap gap-1">
                    {job.tags.split(',').filter(Boolean).map((tag, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {tag.trim()}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
                    {job.description || '暂无岗位描述'}
                  </pre>
                </div>
                {job.url && (
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> 在 Boss直聘 查看
                  </a>
                )}
              </TabsContent>

              {/* AI Analysis tab */}
              <TabsContent value="analysis" className="mt-4 space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button onClick={handleAnalyze} disabled={loading === 'analyze'}>
                  {loading === 'analyze' ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Brain className="h-4 w-4 mr-1" />
                  )}
                  {analysis ? '重新分析' : 'AI 匹配分析'}
                </Button>

                {analysis && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center justify-between">
                        匹配评分
                        <Badge
                          variant={analysis.overall_score >= 0.7 ? 'default' : 'secondary'}
                          className="text-lg"
                        >
                          {Math.round(analysis.overall_score * 100)} 分
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Progress value={analysis.overall_score * 100} className="h-2" />

                      {Object.entries(scores).map(([key, val]) => (
                        <div key={key} className="flex items-center gap-3">
                          <span className="text-sm w-16 text-muted-foreground">
                            {scoreLabels[key] || key}
                          </span>
                          <Progress value={(val as number) * 100} className="h-1.5 flex-1" />
                          <span className="text-sm w-10 text-right">
                            {Math.round((val as number) * 100)}
                          </span>
                        </div>
                      ))}

                      {analysis.suggestion && (
                        <>
                          <Separator />
                          <div>
                            <p className="text-sm font-medium mb-1">优化建议</p>
                            <p className="text-sm text-muted-foreground">
                              {analysis.suggestion}
                            </p>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Apply tab */}
              <TabsContent value="apply" className="mt-4 space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {!analysis && (
                  <Alert>
                    <AlertDescription>
                      请先进行 AI 分析后再生成沟通文案
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  onClick={handleGreeting}
                  disabled={loading === 'greeting' || !analysis}
                  variant="outline"
                >
                  {loading === 'greeting' ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <MessageSquare className="h-4 w-4 mr-1" />
                  )}
                  {greeting ? '重新生成文案' : '生成沟通文案'}
                </Button>

                {greeting && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">沟通文案（可编辑）</p>
                    <Textarea
                      value={greeting}
                      onChange={(e) => setGreeting(e.target.value)}
                      rows={5}
                    />
                  </div>
                )}

                {onApply && greeting && (
                  <Button
                    onClick={handleApply}
                    disabled={loading === 'apply' || !greeting}
                    className="w-full"
                  >
                    {loading === 'apply' ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-1" />
                    )}
                    确认投递
                  </Button>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
