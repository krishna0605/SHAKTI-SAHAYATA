import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './authStore'
import { ApiError, apiClient } from '../lib/apiClient'

describe('authStore bootstrap', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useAuthStore.getState().clearAuth()
  })

  it('sets authenticated state from bootstrap payload', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      authenticated: true,
      accessToken: 'token-123',
      user: {
        id: 2,
        buckleId: 'BK-9999',
        email: 'admin@police.gov.in',
        fullName: 'Priya Patel',
        role: 'super_admin',
      },
      session: {
        id: 'session-1',
        startedAt: '2026-04-06T00:00:00.000Z',
      },
    } as never)

    await useAuthStore.getState().bootstrapAuth()

    const state = useAuthStore.getState()
    expect(state.authStatus).toBe('authenticated')
    expect(state.token).toBe('token-123')
    expect(state.user?.buckleId).toBe('BK-9999')
  })

  it('falls back to unauthenticated state when bootstrap says false', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({ authenticated: false } as never)

    await useAuthStore.getState().bootstrapAuth()

    const state = useAuthStore.getState()
    expect(state.authStatus).toBe('unauthenticated')
    expect(state.token).toBeNull()
    expect(state.user).toBeNull()
  })

  it('preserves existing auth state when bootstrap is rate limited', async () => {
    useAuthStore.getState().setAuth('live-token', {
      id: 7,
      buckleId: 'BK-429',
      email: 'investigator@police.gov.in',
      fullName: 'Riya Singh',
      role: 'investigator',
    })

    vi.spyOn(apiClient, 'request').mockRejectedValue(
      new ApiError('Too many requests. Please try again later.', 429, 'RATE_LIMIT_EXCEEDED')
    )

    await useAuthStore.getState().bootstrapAuth()

    const state = useAuthStore.getState()
    expect(state.authStatus).toBe('authenticated')
    expect(state.token).toBe('live-token')
    expect(state.user?.buckleId).toBe('BK-429')
  })
})
