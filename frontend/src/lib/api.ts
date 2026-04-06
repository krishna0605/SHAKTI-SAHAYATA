import { apiClient } from './apiClient'

class ApiClient {
  private async request<T>(endpoint: string, options: {
    method?: string
    body?: Record<string, unknown>
    auth?: boolean
    redirectOn401?: boolean
    retryOn401?: boolean
  } = {}): Promise<T> {
    return apiClient.request<T>(endpoint, options)
  }

  // Auth
  async login(buckleId: string, email: string, password: string) {
    return this.request<{ accessToken: string; expiresAt: string | null; session: { id: string | null; startedAt: string | null } | null; user: any }>('/auth/login', {
      method: 'POST',
      body: { buckleId, email, password },
      auth: false,
      redirectOn401: false,
    })
  }

  async signup(buckleId: string, fullName: string, email: string, password: string) {
    return this.request<{ accessToken: string; expiresAt: string | null; session: { id: string | null; startedAt: string | null } | null; user: any }>('/auth/signup', {
      method: 'POST',
      body: { buckleId, fullName, email, password },
      auth: false,
      redirectOn401: false,
    })
  }

  async logout() {
    return this.request('/auth/logout', { method: 'POST' })
  }

  async bootstrap() {
    return this.request<{
      authenticated: boolean
      accessToken?: string
      expiresAt?: string | null
      session?: { id: string | null; startedAt: string | null } | null
      user?: any
    }>('/auth/bootstrap', {
      auth: false,
      redirectOn401: false,
      retryOn401: false,
    })
  }

  async getMe() {
    return this.request('/auth/me')
  }

  async getSession() {
    return this.request<{ started_at: string | null; duration_seconds: number }>('/auth/session')
  }

  // Dashboard
  async getDashboardStats() {
    return this.request<{
      totalCases: number
      activeCases: number
      totalFiles: number
      recentCases: any[]
    }>('/dashboard/stats')
  }

  // Cases
  async getCases() {
    return this.request<{ data: any[]; pagination: { total: number } }>('/cases')
  }

  async getCase(id: number) {
    return this.request<any>(`/cases/${id}`)
  }

  async createCase(data: {
    caseName: string
    operator?: string
    caseType?: string
    priority?: string
    investigationDetails?: string
    startDate?: string
    endDate?: string
    firNumber?: string
  }) {
    return this.request<any>('/cases', {
      method: 'POST',
      body: data,
    })
  }

  async deleteCase(id: number) {
    return this.request(`/cases/${id}`, { method: 'DELETE' })
  }
}

export const api = new ApiClient()
