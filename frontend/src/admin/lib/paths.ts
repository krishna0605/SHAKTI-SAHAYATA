const DEFAULT_ADMIN_APP_URL = 'http://localhost:4174'
const DEFAULT_MAIN_APP_URL = 'http://localhost:5173'

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const resolveAppBaseUrl = (envUrl: string | undefined, fallbackOrigin: string) => {
  const normalizedEnvUrl = String(envUrl || '').trim()

  if (typeof window === 'undefined') {
    return trimTrailingSlash(normalizedEnvUrl || fallbackOrigin)
  }

  const host = window.location.hostname
  const protocol = window.location.protocol
  const isLanAccess = host !== 'localhost' && host !== '127.0.0.1'
  const envPointsToLocalhost = /localhost|127\.0\.0\.1/i.test(normalizedEnvUrl)

  if (normalizedEnvUrl && !(isLanAccess && envPointsToLocalhost)) {
    return trimTrailingSlash(normalizedEnvUrl)
  }

  const fallback = new URL(fallbackOrigin)
  return `${protocol}//${host}${fallback.port ? `:${fallback.port}` : ''}`
}

const withLeadingSlash = (value: string) => {
  if (!value) return '/'
  return value.startsWith('/') ? value : `/${value}`
}

export const adminPaths = {
  login: '/login',
  forcePasswordChange: '/security/update-password',
  home: '/',
  dashboard: '/',
  cases: '/cases',
  caseDetail: (caseId: number | string) => `/cases/${encodeURIComponent(String(caseId))}`,
  ingestion: '/ingestion-pipeline',
  normalization: '/normalization-processing',
  tableEditor: '/table-editor',
  database: '/database',
  users: '/users-roles',
  audit: '/audit-trail',
  alerts: '/alerts-incidents',
  settings: '/settings',
  legacyOverview: '/legacy/overview',
  activity: '/activity',
  files: '/files',
  system: '/system',
  exports: '/exports',
} as const

export const resolveAdminAppBaseUrl = () =>
  resolveAppBaseUrl(import.meta.env.VITE_ADMIN_APP_URL as string | undefined, DEFAULT_ADMIN_APP_URL)

export const resolveMainAppBaseUrl = () =>
  resolveAppBaseUrl(import.meta.env.VITE_MAIN_APP_URL as string | undefined, DEFAULT_MAIN_APP_URL)

export const buildAppPath = (pathname: string, search = '', hash = '') => {
  const normalizedPathname = withLeadingSlash(pathname === '/' ? '/' : pathname.replace(/\/+$/, ''))
  const normalizedSearch = search ? (search.startsWith('?') ? search : `?${search}`) : ''
  const normalizedHash = hash ? (hash.startsWith('#') ? hash : `#${hash}`) : ''
  return `${normalizedPathname}${normalizedSearch}${normalizedHash}`
}

export const buildAdminAppUrl = (pathname: string, search = '', hash = '') =>
  `${resolveAdminAppBaseUrl()}${buildAppPath(pathname, search, hash)}`

export const buildMainAppUrl = (pathname: string, search = '', hash = '') =>
  `${resolveMainAppBaseUrl()}${buildAppPath(pathname, search, hash)}`

export const stripLegacyAdminPrefix = (pathname: string) => {
  const stripped = pathname.replace(/^\/admin(?=\/|$)/, '')
  return stripped || adminPaths.home
}

export const mapLegacyAdminPath = (pathname: string) => {
  const normalized = stripLegacyAdminPrefix(pathname)

  if (normalized === adminPaths.legacyOverview || normalized === adminPaths.home) return adminPaths.dashboard
  if (normalized.startsWith(adminPaths.activity)) return adminPaths.audit
  if (normalized.startsWith(adminPaths.files)) return adminPaths.ingestion
  if (normalized.startsWith(adminPaths.system)) return `${adminPaths.database}?tab=observability`
  if (normalized.startsWith(adminPaths.exports)) return adminPaths.audit
  if (normalized.startsWith(adminPaths.users)) return adminPaths.users
  if (normalized.startsWith(adminPaths.cases)) return normalized
  if (normalized.startsWith(adminPaths.database)) return adminPaths.tableEditor
  if (normalized.startsWith(adminPaths.alerts)) return adminPaths.alerts

  return normalized
}
