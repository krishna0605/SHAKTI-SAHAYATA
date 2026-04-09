import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AdminLayout from './AdminLayout'

const logoutMock = vi.fn()

vi.mock('../store/adminAuthStore', () => ({
  useAdminAuthStore: () => ({
    admin: {
      fullName: 'IT Admin',
      role: 'it_admin',
    },
    logout: logoutMock,
  }),
}))

vi.mock('../components/AdminLiveUpdatesProvider', () => ({
  useAdminLiveUpdates: () => ({
    isConnected: true,
    statusLabel: 'Live updates',
  }),
}))

describe('AdminLayout', () => {
  it('opens responsive navigation and preserves dashboard shell controls', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AdminLayout />}>
            <Route index element={<div>Dashboard content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByPlaceholderText(/search cases, uploads, jobs, users, or logs/i)).toBeInTheDocument()
    expect(screen.getByText(/dashboard content/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /open navigation/i }))

    expect(screen.getByText(/primary admin navigation and live operations entry points/i)).toBeInTheDocument()
    expect(screen.getAllByText(/operations console/i).length).toBeGreaterThan(0)
  })
})
