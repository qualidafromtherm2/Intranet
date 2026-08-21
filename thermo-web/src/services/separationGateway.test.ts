import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearSeparationCart,
  loadSeparationItems,
  loadSeparationKanban,
  startSeparation,
  submitSeparation,
  updateSeparationCartQuantity,
} from './separationGateway'

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('separationGateway', () => {
  it('uses the audited kanban and item detail endpoints with session credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, colunas: {} }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, itens: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await loadSeparationKanban('SEP 1042')
    await loadSeparationItems('SEP-1042', { includeDerived: true })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/logistica/solicitacoes-kanban?q=SEP+1042',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/logistica/kanban/itens?n_solic=SEP-1042&escopo=global&include_derivados=1',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('sends exact mutation payloads used by the legacy backend', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, atualizados: 2 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, deleted: 2 }))
    vi.stubGlobal('fetch', fetchMock)

    await updateSeparationCartQuantity(31, 2.5)
    await startSeparation([91, 92])
    await clearSeparationCart()

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/logistica/carrinho/31/quantidade',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ quantidade: 2.5 }) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/logistica/itens_solicitados/separacao',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ solic_ids: [91, 92] }) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/logistica/carrinho',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('submits the real cart contract without adding inferred fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, total: 2, n_solic: 'SEP-1042', reutilizada: false }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const input = {
      solicitado_para: 'Jair',
      local_estoque: '10717096386',
      local_estoque_nome: 'Almoxarifado',
      data_prevista: '2026-08-21',
      horario: '14:30',
      observacao: 'Retirada no balcão',
    }
    await submitSeparation(input)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/logistica/separacao/enviar',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
    )
  })

  it('surfaces the backend error with endpoint context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: 'Não autenticado.' }, 401)))

    await expect(loadSeparationKanban()).rejects.toThrow(
      'Falha ao acessar o fluxo real de separação por /api/logistica/solicitacoes-kanban. Não autenticado.',
    )
  })
})
