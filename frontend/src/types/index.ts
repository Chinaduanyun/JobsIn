// ===== 数据库模型映射 =====

export interface Job {
  id: number
  task_id: number | null
  title: string
  company: string
  salary: string
  city: string
  experience: string
  education: string
  description: string
  url: string
  boss_name: string
  boss_title: string
  boss_active: string
  company_size: string
  company_industry: string
  created_at: string
  analysis?: JobAnalysis | null
}

export interface JobAnalysis {
  id: number
  job_id: number
  match_score: number
  dimension_scores: Record<string, number>
  summary: string
  suggestion: string
  created_at: string
}

export interface Application {
  id: number
  job_id: number
  greeting_text: string
  status: string
  applied_at: string | null
  created_at: string
  job?: Job
}

export interface Resume {
  id: number
  name: string
  content: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CollectionTask {
  id: number
  keyword: string
  city: string
  salary_range: string
  status: string
  collected_count: number
  created_at: string
  updated_at: string
}

export interface SystemConfig {
  [key: string]: string
}

// ===== API 响应 =====

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface BrowserStatus {
  launched: boolean
  logged_in: boolean
  has_qrcode: boolean
  polling_login: boolean
}
