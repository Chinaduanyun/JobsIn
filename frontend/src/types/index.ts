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
  hr_name: string
  hr_title: string
  hr_active: string
  company_size: string
  company_industry: string
  tags: string
  collected_at: string
  analysis?: JobAnalysis | null
}

export interface JobAnalysis {
  id: number
  job_id: number
  overall_score: number
  scores_json: string
  suggestion: string
  greeting_text: string
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
  city_code: string
  salary: string
  status: string
  total_collected: number
  max_pages: number
  created_at: string
}

export interface SystemConfig {
  [key: string]: string
}

// ===== API 响应 =====

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  size: number
}

export interface BrowserStatus {
  launched: boolean
  logged_in: boolean
  has_qrcode: boolean
  polling_login: boolean
  headless: boolean
}
