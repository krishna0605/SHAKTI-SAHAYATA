export interface AdminIdentity {
  id: number
  email: string
  fullName: string
  role: string
  permissions: string[]
  isActive?: boolean
  lastLogin?: string | null
  createdAt?: string | null
}

export interface AdminSessionInfo {
  id: string | null
  startedAt: string | null
}

export type AdminAuthStatus = 'unknown' | 'authenticated' | 'unauthenticated'

export interface AdminHealthCheck {
  status: string
  reason?: string | null
  required?: boolean
  detail?: string
  checkedAt?: string
  [key: string]: unknown
}

export interface AdminHealthSection {
  status: string
  service?: string
  timestamp?: string
  checks?: Record<string, AdminHealthCheck>
  summary?: {
    failed?: string[]
    degraded?: string[]
  }
}

export interface ActivityEvent {
  source: 'audit' | 'admin'
  id: string
  created_at: string
  actor_type: 'officer' | 'admin'
  actor_id: string | null
  actor_name: string | null
  actor_email: string | null
  actor_role: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  session_id: string | null
  ip_address: string | null
  details: Record<string, unknown> | null
}

export interface AdminOverviewResponse {
  metrics: {
    activeOfficerSessions: number
    activeAdminSessions: number
    openCases: number
    evidenceLockedCases: number
    uploadsToday: number
    fileDeletionsToday: number
    failedOfficerLogins: number
    failedAdminLogins: number
    recentAdminActions: number
  }
  health: {
    databaseConnected: boolean
    serverTime: string | null
    live: AdminHealthSection
    ready: AdminHealthSection
    startup: AdminHealthSection
  }
  attention: Array<{
    id: string
    severity: 'warning' | 'critical' | 'info'
    title: string
    description: string
    href: string
    count: number
  }>
  recentActivity: ActivityEvent[]
}

export interface ActivityFeedResponse {
  items: ActivityEvent[]
  pagination: {
    page: number
    pageSize: number
    total: number
  }
}

export interface OfficerAdminUserRow {
  id: number
  buckle_id?: string | null
  email: string
  full_name: string
  role: string
  is_active: boolean
  last_login: string | null
  login_count?: number
  position?: string | null
  department?: string | null
  station?: string | null
  active_sessions: number
  total_cases?: number
  open_cases?: number
  recent_actions_7d: number
  permissions?: string[]
}

export interface AdminSessionRow {
  id: string
  session_type: 'officer' | 'admin'
  actor_id: number
  actor_name: string
  actor_email: string
  actor_role: string
  actor_badge: string | null
  started_at: string
  ended_at: string | null
  logout_reason: string | null
  ip_address: string | null
  user_agent: string | null
  session_age_seconds: number
}

export interface AdminUsersResponse {
  officers: OfficerAdminUserRow[]
  admins: OfficerAdminUserRow[]
  summary: {
    totalOfficers: number
    totalAdmins: number
    activeOfficerSessions: number
    activeAdminSessions: number
  }
}

export interface AdminSessionsResponse {
  officerSessions: AdminSessionRow[]
  adminSessions: AdminSessionRow[]
  summary: {
    activeOnly: boolean
    officerCount: number
    adminCount: number
  }
}
