import { adminApiClient } from './adminApiClient'
import type {
  ActivityFeedResponse,
  AdminIdentity,
  AdminOverviewResponse,
  AdminSessionInfo,
  AdminSessionsResponse,
  AdminUsersResponse,
} from '../types'

export const adminAuthAPI = {
  async login(email: string, password: string) {
    return adminApiClient.request<{
      accessToken: string
      expiresAt: string | null
      session: AdminSessionInfo | null
      admin: AdminIdentity
    }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
      redirectOn401: false,
    })
  },

  async logout() {
    return adminApiClient.request('/auth/logout', { method: 'POST' })
  },

  async bootstrap() {
    return adminApiClient.request<{
      authenticated: boolean
      accessToken?: string
      expiresAt?: string | null
      session?: AdminSessionInfo | null
      admin?: AdminIdentity
    }>('/auth/bootstrap', {
      auth: false,
      redirectOn401: false,
      retryOn401: false,
    })
  },

  async getMe() {
    return adminApiClient.request<AdminIdentity>('/auth/me')
  },
}

const buildSearchParams = (params: Record<string, string | number | boolean | undefined | null>) => {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      search.set(key, String(value))
    }
  })
  return search.toString()
}

export const adminConsoleAPI = {
  async getOverview() {
    return adminApiClient.request<AdminOverviewResponse>('/overview')
  },

  async getActivity(filters: {
    page?: number
    limit?: number
    source?: string
    actorType?: string
    actor?: string
    action?: string
    resourceType?: string
    resourceId?: string
    caseId?: string
    sessionId?: string
    ipAddress?: string
    dateFrom?: string
    dateTo?: string
    q?: string
  } = {}) {
    const query = buildSearchParams(filters)
    return adminApiClient.request<ActivityFeedResponse>(`/activity${query ? `?${query}` : ''}`)
  },

  async getUsers() {
    return adminApiClient.request<AdminUsersResponse>('/users')
  },

  async getSessions(activeOnly = true) {
    const query = buildSearchParams({ activeOnly })
    return adminApiClient.request<AdminSessionsResponse>(`/sessions?${query}`)
  },

  async forceLogout(sessionId: string, sessionType: 'officer' | 'admin', reason = 'admin_forced') {
    return adminApiClient.request<{ forced: boolean; sessionType: 'officer' | 'admin'; sessionId: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/force-logout`,
      {
        method: 'POST',
        body: { sessionType, reason },
      }
    )
  },
}
