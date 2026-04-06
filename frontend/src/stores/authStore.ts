import { create } from 'zustand'
import { apiClient, clearAccessToken, registerAuthFailureHandler, setAccessToken } from '../lib/apiClient'

interface User {
  id: number
  buckleId: string
  email: string
  fullName: string
  role: string
  position?: string
}

interface SessionInfo {
  id: string | null
  startedAt: string | null
}

type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated'

interface AuthState {
  token: string | null
  user: User | null
  session: SessionInfo | null
  authStatus: AuthStatus
  isDarkMode: boolean

  setAuth: (token: string, user: User, session?: SessionInfo | null) => void
  clearAuth: () => void
  logout: () => void
  bootstrapAuth: () => Promise<void>
  toggleTheme: () => void
  initTheme: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  session: null,
  authStatus: 'unknown',
  isDarkMode: true,

  setAuth: (token: string, user: User, session: SessionInfo | null = null) => {
    setAccessToken(token)
    set({ token, user, session, authStatus: 'authenticated' })
  },

  clearAuth: () => {
    clearAccessToken()
    set({ token: null, user: null, session: null, authStatus: 'unauthenticated' })
  },

  logout: () => {
    get().clearAuth()
  },

  bootstrapAuth: async () => {
    try {
      const data = await apiClient.request<{
        authenticated: boolean
        accessToken?: string
        user?: User
        session?: { id: string | null; startedAt: string | null } | null
      }>('/auth/bootstrap', {
        auth: false,
        redirectOn401: false,
        retryOn401: false,
      })

      if (!data?.authenticated || !data.accessToken || !data.user) {
        get().clearAuth()
        return
      }

      get().setAuth(data.accessToken, data.user, data.session ?? null)
    } catch {
      get().clearAuth()
    }
  },

  toggleTheme: () => {
    const newMode = !get().isDarkMode
    set({ isDarkMode: newMode })
    localStorage.setItem('shakti_theme', newMode ? 'dark' : 'light')
    if (newMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  },

  initTheme: () => {
    const saved = localStorage.getItem('shakti_theme')
    const isDark = saved ? saved === 'dark' : true
    set({ isDarkMode: isDark })
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  },
}))

registerAuthFailureHandler(() => {
  useAuthStore.getState().clearAuth()
})
