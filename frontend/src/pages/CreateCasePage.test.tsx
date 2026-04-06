import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreateCasePage from './CreateCasePage'

const navigateMock = vi.fn()
const createCaseMock = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock('../components/lib/apis', () => ({
  caseAPI: {
    create: (...args: unknown[]) => createCaseMock(...args),
  },
  fileAPI: {
    upload: vi.fn(),
  },
}))

describe('CreateCasePage', () => {
  beforeEach(() => {
    createCaseMock.mockReset()
    navigateMock.mockReset()
  })

  it('creates a case and redirects to the case view', async () => {
    createCaseMock.mockResolvedValue({ id: 101 })

    render(
      <MemoryRouter>
        <CreateCasePage />
      </MemoryRouter>
    )

    fireEvent.change(screen.getByPlaceholderText(/mumbai cyber fraud 2026/i), {
      target: { value: 'Mobile Readiness Case' },
    })
    fireEvent.click(screen.getByRole('combobox', { name: /telecom operator/i }))
    fireEvent.click(await screen.findByRole('option', { name: 'Jio' }))
    fireEvent.click(screen.getByRole('button', { name: /create case/i }))

    await waitFor(() => {
      expect(createCaseMock).toHaveBeenCalled()
      expect(navigateMock).toHaveBeenCalledWith('/case/101')
    })
  })
})
