import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./services/authGateway', () => ({
  buildLegacyUrl: (path: string) => path,
  getAuthStatus: vi.fn().mockResolvedValue({
    loggedIn: true,
    user: {
      username: 'qa.user',
      funcao_nome: 'Logística',
      setor: 'Operação',
      roles: ['Logística'],
    },
  }),
  getPermissionTree: vi.fn().mockResolvedValue({
    nodes: [],
  }),
  login: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('./services/homeGateway', () => ({
  loadReservationsMonth: vi.fn().mockResolvedValue({ reservas: [] }),
  loadRemindersMonth: vi.fn().mockResolvedValue({ lembretes: [] }),
  loadRecentActivity: vi.fn().mockResolvedValue({ eventos: [] }),
  loadActiveUsers: vi.fn().mockResolvedValue({ usuarios: [] }),
}))

vi.mock('./hooks/usePilotData', () => ({
  getPilotDataCacheState: vi.fn().mockReturnValue({ products: [], warnings: [], ready: false, loading: false, fetchedAt: null }),
  prefetchPilotData: vi.fn().mockResolvedValue({ products: [], warnings: [], ready: true, loading: false, fetchedAt: Date.now() }),
}))

describe('App stability', () => {
  afterEach(() => {
    window.sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('renders repeatedly without maximum update depth errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const first = render(<App />)
    await screen.findByText('qa.user')
    first.unmount()

    const second = render(<App />)
    await screen.findByText('qa.user')

    await waitFor(() => {
      expect(screen.getByText('Calendário de reuniões')).toBeInTheDocument()
    })

    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Maximum update depth exceeded'))
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Maximum update depth exceeded')

    second.unmount()
    consoleError.mockRestore()
  })
})
