import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FreightSimulatorScreen } from './FreightSimulatorScreen'

const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('FreightSimulatorScreen', () => {
  it('enforces navigation permission without calling the backend', () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    render(<FreightSimulatorScreen allowed={false} />)
    expect(screen.getByLabelText('Sem permissão para Simulador de frete')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads the real status and exposes empty, validation and responsive-safe content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true, origem: { endereco: 'Rua Edgard Hoffmann, 699', cidade: 'Biguaçu', uf: 'SC', cep: '88164-275' }, tabelas: [{ id: 1, transportadora: 'Bristot', versao: '2026', status: 'ativa' }] })))
    render(<FreightSimulatorScreen />)
    expect(await screen.findByText('1 homologada(s)')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma máquina adicionada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simular frete' })).toBeDisabled()
    expect(screen.getByText('Informe a cidade e a UF de destino.')).toBeInTheDocument()
  })

  it('adds an audited product and submits the exact server-owned calculation payload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ ok: true, origem: { endereco: 'Origem', cidade: 'Biguaçu', uf: 'SC', cep: '88164-275' }, tabelas: [] }))
      .mockResolvedValueOnce(json({ ok: true, itens: [{ codigo: 'FH240', descricao: 'Máquina FH', altura: 100, largura: 90, profundidade: 80, peso_bruto: 120, apto_simulacao: true }] }))
      .mockResolvedValueOnce(json({ ok: true, itens: [] }))
      .mockResolvedValueOnce(json({ ok: true, cotacao_id: 91, resultados: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<FreightSimulatorScreen />)
    await screen.findByText('0 homologada(s)')
    await userEvent.type(screen.getByPlaceholderText('Buscar por código ou descrição'), 'FH')
    await userEvent.click(await screen.findByText('Máquina FH'))
    const uf = screen.getByText('UF').querySelector('input')!; await userEvent.type(uf, 'SC')
    const city = screen.getByText('Cidade').querySelector('input')!; await userEvent.type(city, 'Biguaçu')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simular frete' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Simular frete' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/frete/simular', expect.objectContaining({ body: JSON.stringify({ destino: { cep: null, cidade: 'Biguaçu', uf: 'SC' }, valor_mercadoria: '0,00', itens: [{ codigo: 'FH240', quantidade: 1 }] }) })))
  })
})
