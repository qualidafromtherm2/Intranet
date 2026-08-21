import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadFreightLocations, loadFreightStatus, searchFreightProducts, simulateFreight } from './freightGateway'

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('freightGateway', () => {
  it('preserves the audited read contracts and authenticated session', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ ok: true, itens: [] })))
    vi.stubGlobal('fetch', fetchMock)
    await loadFreightStatus()
    await searchFreightProducts('FH 240')
    await loadFreightLocations('SC', 'Biguaçu')
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/frete/status', expect.objectContaining({ credentials: 'include', cache: 'no-store' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/frete/produtos?q=FH%20240&limit=20', expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/frete/localidades?uf=SC&q=Bigua%C3%A7u&limit=1000', expect.any(Object))
  })

  it('sends only destination, declared value, product code and quantity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true, resultados: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const payload = { destino: { cep: '88000-000', cidade: 'Florianópolis', uf: 'SC' }, valor_mercadoria: '12.000,00', itens: [{ codigo: 'FH240', quantidade: 2 }] }
    await simulateFreight(payload)
    expect(fetchMock).toHaveBeenCalledWith('/api/frete/simular', expect.objectContaining({ method: 'POST', body: JSON.stringify(payload) }))
  })

  it('surfaces backend validation without replacing it with mock data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: false, error: 'Existem produtos sem peso ou dimensões confiáveis.' }, 422)))
    await expect(simulateFreight({ destino: { cep: null, cidade: 'Joinville', uf: 'SC' }, valor_mercadoria: '0,00', itens: [{ codigo: 'X', quantidade: 1 }] })).rejects.toThrow('Existem produtos sem peso')
  })
})
