import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './LoginPage'
import { useAuthStore } from '../stores/authStore'

const navigateMock = vi.fn()
const loginMock = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock('../lib/api', () => ({
  api: {
    login: (...args: unknown[]) => loginMock(...args),
  },
}))

describe('LoginPage', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    loginMock.mockReset()
    useAuthStore.getState().clearAuth()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('logs in and redirects to dashboard', async () => {
    loginMock.mockResolvedValue({
      accessToken: 'token-123',
      user: {
        id: 2,
        buckleId: 'BK-9999',
        email: 'admin@police.gov.in',
        fullName: 'Priya Patel',
        role: 'super_admin',
      },
      session: { id: 'session-1', startedAt: '2026-04-06T00:00:00.000Z' },
    })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    )

    fireEvent.change(screen.getByLabelText(/buckle id/i), { target: { value: 'BK-9999' } })
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'admin@police.gov.in' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Shakti@123' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('BK-9999', 'admin@police.gov.in', 'Shakti@123')
      expect(navigateMock).toHaveBeenCalledWith('/dashboard')
    })

    expect(useAuthStore.getState().authStatus).toBe('authenticated')
    expect(useAuthStore.getState().user?.fullName).toBe('Priya Patel')
  })
})

