import { useEffect, useState, type ChangeEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { config as configApi } from '@/lib/api'
import type { SystemConfig } from '@/types'
import { Save, Info } from 'lucide-react'
import BrowserPanel from '@/components/BrowserPanel'

const configFields = [
  { key: 'ai_api_key', label: 'AI API Key', type: 'password', placeholder: 'sk-...' },
  { key: 'ai_base_url', label: 'AI Base URL', type: 'text', placeholder: 'https://api.siliconflow.cn/v1' },
  { key: 'ai_model', label: 'AI 模型', type: 'text', placeholder: 'Qwen/Qwen2.5-72B-Instruct' },
  { key: 'daily_apply_limit', label: '每日投递上限', type: 'number', placeholder: '50' },
]

const speedFields = [
  { key: 'scrape_page_delay', label: '翻页间隔 (秒)', placeholder: '3-8', hint: '格式: 最小-最大，如 3-8' },
  { key: 'scrape_detail_delay', label: '详情请求间隔 (秒)', placeholder: '1-3', hint: '格式: 最小-最大，如 1-3' },
  { key: 'apply_delay', label: '投递间隔 (秒)', placeholder: '5-15', hint: '格式: 最小-最大，如 5-15' },
]

export default function SettingsPage() {
  const [cfg, setCfg] = useState<SystemConfig>({})
  const [saved, setSaved] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    configApi.get().then(setCfg).catch(() => {})
    fetch('/api/version').then(r => r.json()).then(d => setVersion(d.version)).catch(() => {})
  }, [])

  const handleSave = async () => {
    await configApi.update(cfg)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">系统设置</h2>
        {version && (
          <Badge variant="outline" className="text-sm">
            <Info className="h-3 w-3 mr-1" />
            v{version}
          </Badge>
        )}
      </div>

      {/* Browser panel */}
      <BrowserPanel />

      {/* AI Config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {configFields.map((f) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <Input
                type={f.type}
                placeholder={f.placeholder}
                value={cfg[f.key] || ''}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Speed Config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">采集 & 投递速度</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {speedFields.map((f) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <Input
                placeholder={f.placeholder}
                value={cfg[f.key] || ''}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [f.key]: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">{f.hint}</p>
            </div>
          ))}

          <Separator />

          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-1" />
            {saved ? '已保存 ✓' : '保存设置'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
