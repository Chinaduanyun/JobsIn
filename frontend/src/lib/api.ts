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
  get: (id: number) => request<import('@/types').Job>(`/jobs/${id}`),
  delete: (id: number) => request<void>(`/jobs/${id}`, { method: 'DELETE' }),
}

// ===== Tasks =====
export const tasks = {
  list: () => request<import('@/types').CollectionTask[]>('/tasks'),
  create: (data: { keyword: string; city: string; salary?: string; max_pages?: number }) =>
    request<import('@/types').CollectionTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  start: (id: number) =>
    request<{ message: string }>(`/tasks/${id}/start`, { method: 'POST' }),
  cancel: (id: number) =>
    request<{ message: string }>(`/tasks/${id}/cancel`, { method: 'POST' }),
  delete: (id: number) =>
    request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  cities: () => request<Record<string, string>>('/tasks/cities'),
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
}

// ===== Browser =====
export const browser = {
  launch: (headless = true) =>
    request<{ message: string } & import('@/types').BrowserStatus>(
      `/browser/launch?headless=${headless}`,
      { method: 'POST' }
    ),
  restart: (headless = true) =>
    request<{ message: string } & import('@/types').BrowserStatus>(
      `/browser/restart?headless=${headless}`,
      { method: 'POST' }
    ),
  login: () =>
    request<{ message: string; qrcode: string | null }>('/browser/login', {
      method: 'POST',
    }),
  status: () => request<import('@/types').BrowserStatus>('/browser/status'),
  qrcode: () => request<{ qrcode: string | null }>('/browser/qrcode'),
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
  list: (page = 1) =>
    request<{ items: any[]; page: number; size: number }>(`/applications?page=${page}`),
  today: () => request<{ count: number }>('/applications/today'),
}
