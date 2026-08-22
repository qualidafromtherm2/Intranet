import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateShippingLabel, loadShippingQueue, markShippingAsSent, shippingDeclarationUrl, shippingLabelUrl } from './shippingGateway'

const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('shippingGateway', () => {
  it('loads only the audited logistics queue', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true, rows: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await loadShippingQueue()
    expect(fetchMock).toHaveBeenCalledWith('/api/sac/solicitacoes?filaLogistica=1', expect.objectContaining({ credentials: 'include', cache: 'no-store' }))
  })

  it('preserves exact mutation payloads without contacting a real backend', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    await markShippingAsSent(42)
    await generateShippingLabel(42, 'SEP-1042')
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/sac/solicitacoes/42/status', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'Enviado' }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/vipp/gerar-etiqueta', expect.objectContaining({ method: 'POST', body: JSON.stringify({ envio_id: 42, n_solic: 'SEP-1042' }) }))
  })

  it('only exposes document URLs backed by proven record data', () => {
    expect(shippingLabelUrl({ id: 1, identificacao: 'AA 123 BB' })).toBe('/api/vipp/etiqueta?id=AA123BB&saida=1')
    expect(shippingLabelUrl({ id: 1 })).toBeNull()
    expect(shippingDeclarationUrl({ id: 7, conteudo: '[]' })).toBe('/api/vipp/declaracao?id=7')
    expect(shippingDeclarationUrl({ id: 7 })).toBeNull()
  })
})
