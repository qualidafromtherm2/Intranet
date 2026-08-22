import { describe, expect, it, vi } from 'vitest'
import { loadProduction3d } from './production3dGateway'
describe('production3dGateway', () => {
  it('loads the real endpoint as GET-only', async () => { const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, total: 0, itens: [] }) }); vi.stubGlobal('fetch', fetchMock); await loadProduction3d(); expect(fetchMock).toHaveBeenCalledWith('/api/producao/cena-3d', expect.objectContaining({ credentials: 'include', cache: 'no-store' })); expect(fetchMock.mock.calls[0][1].method).toBeUndefined() })
  it('fails explicitly on an incompatible scene payload', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, rows: [] }) })); await expect(loadProduction3d()).rejects.toThrow('Contrato Produção 3D inválido') })
})
