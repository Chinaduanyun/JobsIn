import { useEffect, useState, type ChangeEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { config as configApi } from '@/lib/api'
import type { SystemConfig } from '@/types'
import { Save } from 'lucide-react'

const configFields = [
  { key: 'ai_api_key', label: 'AI API Key', type: 'password', placeholder: 'sk-...' },
  { key: 'ai_base_url', label: 'AI Base URL', type: 'text', placeholder: 'https://api.siliconflow.cn/v1' },
  { key: 'ai_model', label: 'AI 模型', type: 'text', placeholder: 'Qwen/Qwen2.5-72B-Instruct' },
  { key: 'daily_apply_limit', label: '每日投递上限', type: 'number', placeholder: '50' },
]

export default function SettingsPage() {
  const [cfg, setCfg] = useState<SystemConfig>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    configApi.get().then(setCfg).catch(() => {})
  }, [])

  const handleSave = async () => {
    await configApi.update(cfg)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">系统设置</h2>

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
