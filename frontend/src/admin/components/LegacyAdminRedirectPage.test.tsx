import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LegacyAdminRedirectPage from './LegacyAdminRedirectPage'

describe('LegacyAdminRedirectPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('redirects legacy /admin routes to the dedicated admin origin', async () => {
    const originalLocation = window.location
    const replaceSpy = vi.fn()

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        hostname: 'localhost',
        protocol: 'http:',
        replace: replaceSpy,
      },
    })

    render(
      <MemoryRouter initialEntries={['/admin/system?tab=backups#restore']}>
        <Routes>
          <Route path="/admin/*" element={<LegacyAdminRedirectPage />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('http://localhost:4174/database?tab=observability#restore')
    })

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })
})
