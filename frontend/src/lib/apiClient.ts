let inMemoryAccessToken: string | null = null
let authFailureHandler: (() => void) | null = null
let refreshPromise: Promise<boolean> | null = null

const redirectToLogin = () => {
  if (typeof window === 'undefined') return
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

export const setAccessToken = (token: string | null) => {
  inMemoryAccessToken = token
}

export const getAccessToken = () => inMemoryAccessToken

export const clearAccessToken = () => {
  inMemoryAccessToken = null
}

export const registerAuthFailureHandler = (handler: (() => void) | null) => {
  authFailureHandler = handler
}

export const resolveBackendBaseUrl = () => {
  const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim()

  if (typeof window === 'undefined') {
    return envUrl || 'http://localhost:3001'
  }

  const host = window.location.hostname
  const isLanAccess = host !== 'localhost' && host !== '127.0.0.1'
  const envPointsToLocalhost = !!envUrl && /localhost|127\.0\.0\.1/i.test(envUrl)

  if (envUrl && !(isLanAccess && envPointsToLocalhost)) {
    return envUrl.replace(/\/$/, '')
  }

  return `${window.location.protocol}//${host}:3001`
}

export const resolveApiBaseUrl = () => `${resolveBackendBaseUrl()}/api`

type RequestOptions = {
  method?: string
  body?: BodyInit | Record<string, unknown> | null
  headers?: Record<string, string>
  auth?: boolean
  redirectOn401?: boolean
  retryOn401?: boolean
}

const parseResponsePayload = async <T>(response: Response): Promise<T> => {
  const raw = await response.text()
  if (!raw) return null as T

  try {
    return JSON.parse(raw) as T
  } catch {
    return ({ error: raw } as unknown) as T
  }
}

class CanonicalApiClient {
  private isAuthRecoveryEndpoint(endpoint: string) {
    return endpoint.startsWith('/auth/refresh') || endpoint.startsWith('/auth/bootstrap')
  }

  private async fetchJson<T>(endpoint: string, init: RequestInit = {}): Promise<{ response: Response; data: T & { error?: string } }> {
    const response = await fetch(`${resolveApiBaseUrl()}${endpoint}`, {
      credentials: 'include',
      ...init,
    })
    const data = await parseResponsePayload<T & { error?: string }>(response)
    return { response, data }
  }

  async refreshAccessToken(redirectOn401 = true): Promise<boolean> {
    if (refreshPromise) return refreshPromise

    refreshPromise = (async () => {
      try {
        const { response, data } = await this.fetchJson<{ accessToken?: string }>('/auth/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok || !data?.accessToken) {
          clearAccessToken()
          authFailureHandler?.()
          if (redirectOn401) redirectToLogin()
          return false
        }

        setAccessToken(data.accessToken)
        return true
      } catch {
        clearAccessToken()
        authFailureHandler?.()
        if (redirectOn401) redirectToLogin()
        return false
      } finally {
        refreshPromise = null
      }
    })()

    return refreshPromise
  }

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      body = null,
      headers = {},
      auth = true,
      redirectOn401 = true,
      retryOn401 = true,
    } = options

    const token = auth ? getAccessToken() : null
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData

    const requestHeaders: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    }

    if (!isFormData) {
      requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json'
    }

    const requestInit: RequestInit = {
      method,
      headers: requestHeaders,
      credentials: 'include',
    }

    if (body !== null && body !== undefined) {
      requestInit.body = isFormData || typeof body === 'string'
        ? (body as BodyInit)
        : JSON.stringify(body)
    }

    const response = await fetch(`${resolveApiBaseUrl()}${endpoint}`, requestInit)

    if (response.status === 401 && auth && retryOn401 && !this.isAuthRecoveryEndpoint(endpoint)) {
      const refreshed = await this.refreshAccessToken(redirectOn401)
      if (refreshed) {
        return this.request<T>(endpoint, { ...options, retryOn401: false })
      }

      throw new Error('Session expired. Please sign in again.')
    }

    const data = await parseResponsePayload<T & { error?: string }>(response)
    if (!response.ok) {
      if (response.status === 401 && redirectOn401) {
        clearAccessToken()
        authFailureHandler?.()
        redirectToLogin()
      }
      throw new Error(data?.error || `Request failed with status ${response.status}`)
    }

    return data
  }
}

export const apiClient = new CanonicalApiClient()
