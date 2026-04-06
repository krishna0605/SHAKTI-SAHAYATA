import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from './Dashboard'
import { useAuthStore } from '../stores/authStore'
import { TooltipProvider } from '@/components/ui/tooltip'

const getStatsMock = vi.fn()
const listCasesMock = vi.fn()

vi.mock('../components/lib/apis', () => ({
  dashboardAPI: {
    getStats: () => getStatsMock(),
  },
  caseAPI: {
    list: (...args: unknown[]) => listCasesMock(...args),
  },
}))

describe('Dashboard', () => {
  beforeEach(() => {
    getStatsMock.mockReset()
    listCasesMock.mockReset()
    useAuthStore.setState({
      authStatus: 'authenticated',
      token: 'token-123',
      user: {
        id: 2,
        buckleId: 'BK-9999',
        email: 'admin@police.gov.in',
        fullName: 'Priya Patel',
        role: 'super_admin',
      },
      session: null,
    })
  })

  it('loads dashboard stats and cases', async () => {
    getStatsMock.mockResolvedValue({
      totalCases: 1,
      activeCases: 1,
      totalFiles: 3,
      recentCases: [],
    })
    listCasesMock.mockResolvedValue({
      items: [
        {
          id: 2,
          case_name: 'Test Case Alpha',
          case_number: 'TCA-2026-8423',
          status: 'open',
          priority: 'medium',
          operator: 'Jio',
          file_count: 3,
          updated_at: '2026-04-06T00:00:00.000Z',
        },
      ],
      pagination: { page: 1, pageSize: 50, total: 1 },
    })

    render(
      <TooltipProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </TooltipProvider>
    )

    await waitFor(() => {
      expect(screen.getByText(/your investigations/i)).toBeInTheDocument()
      expect(screen.getByText('Test Case Alpha')).toBeInTheDocument()
      expect(screen.getByText(/TCA-2026-8423/i)).toBeInTheDocument()
    })
  })
})
