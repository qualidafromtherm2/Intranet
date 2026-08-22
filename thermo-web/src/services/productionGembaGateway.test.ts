import { describe, expect, it, vi } from 'vitest'
import { loadProductionGemba } from './productionGembaGateway'

describe('productionGembaGateway', () => {
  it('uses authenticated GET-only endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, items: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await loadProductionGemba()
    expect(fetchMock).toHaveBeenCalledWith('/api/producao/gemba', expect.objectContaining({ credentials: 'include', cache: 'no-store' }))
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined()
  })

  it('fails explicitly when the items contract is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, ocorrencias: [] }) }))
    await expect(loadProductionGemba()).rejects.toThrow('Contrato Gemba inválido')
  })
})
