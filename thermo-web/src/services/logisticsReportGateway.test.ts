import { describe, expect, it, vi } from 'vitest'
import { loadLogisticsReport } from './logisticsReportGateway'
describe('logistics report gateway', () => { it('uses the audited read endpoint and period', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })); await loadLogisticsReport('6m'); expect(fetch).toHaveBeenCalledWith('/api/sac/logistica/relatorio-gerencial?modo=6m', expect.objectContaining({ credentials: 'include', cache: 'no-store' })) }) })
