const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status}: ${body}`)
  }
  return res.json()
}

// ===== Jobs =====
export const jobs = {
  list: (params?: { page?: number; page_size?: number; keyword?: string }) => {
    const q = new URLSearchParams()
    if (params?.page) q.set('page', String(params.page))
    if (params?.page_size) q.set('size', String(params.page_size))
    if (params?.keyword) q.set('keyword', params.keyword)
    return request<import('@/types').PaginatedResponse<import('@/types').Job>>(
      `/jobs?${q}`
    )
  },
  listRecommendations: (params?: { page?: number; page_size?: number }) => {
    const q = new URLSearchParams()
    if (params?.page) q.set('page', String(params.page))
    if (params?.page_size) q.set('size', String(params.page_size))
    return request<import('@/types').PaginatedResponse<import('@/types').Job>>(
      `/jobs/recommendations?${q}`
    )
  },
  get: (id: number) => request<import('@/types').Job>(`/jobs/${id}`),
  delete: (id: number) => request<void>(`/jobs/${id}`, { method: 'DELETE' }),
  batchDelete: (jobIds: number[]) =>
    request<{ deleted: number }>('/jobs/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ job_ids: jobIds }),
    }),
}

// ===== Tasks =====
export const tasks = {
  list: () => request<import('@/types').CollectionTask[]>('/tasks'),
  create: (data: { platform?: string; keyword: string; city: string; salary?: string; max_pages?: number }) =>
    request<import('@/types').CollectionTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  start: (id: number) =>
    request<{ message: string }>(`/tasks/${id}/start`, { method: 'POST' }),
  cancel: (id: number) =>
    request<{ message: string }>(`/tasks/${id}/cancel`, { method: 'POST' }),
  pause: (id: number) =>
    request<{ message: string }>(`/tasks/${id}/pause`, { method: 'POST' }),
  resume: (id: number) =>
    request<{ message: string }>(`/tasks/${id}/resume`, { method: 'POST' }),
  delete: (id: number) =>
    request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  cities: (platform = 'boss') => request<Record<string, string>>(`/tasks/cities?platform=${platform}`),
  platforms: () => request<import('@/types').Platform[]>('/tasks/platforms'),
}

// ===== Resumes =====
export const resumes = {
  list: () => request<import('@/types').Resume[]>('/resumes'),
  create: (data: { name: string; content: string }) =>
    request<import('@/types').Resume>('/resumes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: number, data: { name?: string; content?: string }) =>
    request<import('@/types').Resume>(`/resumes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  activate: (id: number) =>
    request<import('@/types').Resume>(`/resumes/${id}/activate`, {
      method: 'POST',
    }),
  delete: (id: number) =>
    request<void>(`/resumes/${id}`, { method: 'DELETE' }),
}

// ===== AI =====
export const ai = {
  analyze: (jobId: number) =>
    request<import('@/types').JobAnalysis>('/ai/analyze', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId }),
    }),
  greeting: (jobId: number) =>
    request<{ greeting_text: string }>('/ai/greeting', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId }),
    }),
  getAnalysis: (jobId: number) =>
    request<import('@/types').JobAnalysis>(`/ai/analysis/${jobId}`),
  batchAnalyze: (jobIds: number[]) =>
    request<{ batch_id: string; total: number; message: string }>('/ai/batch-analyze', {
      method: 'POST',
      body: JSON.stringify({ job_ids: jobIds }),
    }),
  batchGreeting: (jobIds: number[]) =>
    request<{ batch_id: string; total: number; message: string }>('/ai/batch-greeting', {
      method: 'POST',
      body: JSON.stringify({ job_ids: jobIds }),
    }),
  batchStatus: (batchId: string) =>
    request<{ total: number; completed: number; failed: number; status: string; errors: string[] }>(
      `/ai/batch-status/${batchId}`
    ),
  suggestKeywords: (resumeId: number) =>
    request<{ keywords: Array<{ keyword: string; reason: string; city: string }> }>('/ai/suggest-keywords', {
      method: 'POST',
      body: JSON.stringify({ resume_id: resumeId }),
    }),
}

// ===== Browser =====
export const browser = {
  openLogin: () =>
    request<{ message: string; url: string }>('/browser/open-login', {
      method: 'POST',
    }),
  confirmLogin: () =>
    request<{ message: string } & import('@/types').BrowserStatus>('/browser/confirm-login', {
      method: 'POST',
    }),
  refreshCookies: () =>
    request<{ message: string } & import('@/types').BrowserStatus>('/browser/refresh-cookies', {
      method: 'POST',
    }),
  status: () => request<import('@/types').BrowserStatus>('/browser/status'),
  close: () =>
    request<{ message: string }>('/browser/close', { method: 'POST' }),
}

// ===== Config =====
export const config = {
  get: () => request<import('@/types').SystemConfig>('/config'),
  update: (data: Record<string, string>) =>
    request<import('@/types').SystemConfig>('/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
}

// ===== Applications =====
export const applications = {
  apply: (jobId: number, greetingText?: string) =>
    request<import('@/types').Application>('/applications/apply', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId, greeting_text: greetingText }),
    }),
  batchApply: (jobIds: number[], greetingTexts?: Record<number, string>) =>
    request<{ message: string; total: number; batch_id: number }>('/applications/batch-apply', {
      method: 'POST',
      body: JSON.stringify({ job_ids: jobIds, greeting_texts: greetingTexts }),
    }),
  list: (page = 1, status?: string) => {
    const q = new URLSearchParams({ page: String(page) })
    if (status) q.set('status', status)
    return request<{ items: any[]; page: number; size: number }>(`/applications?${q}`)
  },
  today: () => request<{ count: number }>('/applications/today'),
  // 批次
  listBatches: () =>
    request<{ items: any[] }>('/applications/batches'),
  getBatch: (batchId: number) =>
    request<{ batch: any; applications: any[] }>(`/applications/batches/${batchId}`),
  pauseBatch: (batchId: number) =>
    request<{ message: string }>(`/applications/batches/${batchId}/pause`, { method: 'POST' }),
  resumeBatch: (batchId: number) =>
    request<{ message: string }>(`/applications/batches/${batchId}/resume`, { method: 'POST' }),
  // 单个
  pause: (appId: number) =>
    request<{ message: string }>(`/applications/${appId}/pause`, { method: 'POST' }),
  retry: (appId: number) =>
    request<{ message: string }>(`/applications/${appId}/retry`, { method: 'POST' }),
}

// ===== Extension =====
export const extension = {
  status: () => request<{
    connected: boolean
    last_poll: number
    pending_commands: number
    waiting_results: number
    security_check: boolean
  }>('/extension/status'),
}
