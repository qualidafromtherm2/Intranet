import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SalesReportScreen } from './SalesReportScreen'
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())
describe('SalesReportScreen', () => {
  it('renders all eleven pages and keeps management texts local', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve(json(url.includes('filtros-opcoes') ? { ok: true, anos: [2026] } : { ok: true, periodo: 'Agosto/2026', etapa: 'Entregues', mes: '2026-08', kpis: { total_pedidos: 2, valor_total: 1000 }, textos: { salvo: true, plano_acao: [], conclusao_resumo: 'Resumo oficial' } })))
    vi.stubGlobal('fetch', fetchMock); render(<SalesReportScreen />)
    expect(await screen.findByText('Agosto/2026 · Entregues')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '11. Conclusão Executiva' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '10. Plano de Ação' })); await userEvent.click(screen.getByRole('button', { name: 'Adicionar ação' }))
    expect(screen.getByLabelText('Ação')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/textos') && init?.method === 'PUT')).toBe(false)
  })
})
