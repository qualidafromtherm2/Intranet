import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSalesReport, salesReportQuery, saveSalesReportTexts } from './salesReportGateway'
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())
describe('salesReportGateway', () => {
  it('preserves period and drill-down query contracts', () => { expect(salesReportQuery({ modo: 'trimestre', ano: '2026', trimestre: '2', estado: 'SC', cliente: 'ACME', familia: '04,07' })).toBe('modo=trimestre&etapa=entregue&ano=2026&trimestre=2&estado=SC&cliente=ACME&familia=04%2C07') })
  it('loads authenticated real report data', async () => { const fetchMock = vi.fn().mockResolvedValue(json({ ok: true, kpis: {} })); vi.stubGlobal('fetch', fetchMock); await loadSalesReport({ ano: '2026', mes: '8' }); expect(fetchMock).toHaveBeenCalledWith('/api/sac/vendas/relatorio-gerencial?modo=mes&etapa=entregue&ano=2026&mes=8', expect.objectContaining({ credentials: 'include', cache: 'no-store' })) })
  it('keeps the audited text payload for explicit saves', async () => { const fetchMock = vi.fn().mockResolvedValue(json({ ok: true, textos: {} })); vi.stubGlobal('fetch', fetchMock); const textos = { plano_acao: [{ acao: 'A', descricao: 'D', responsavel: 'R', prazo: '30/08', prioridade: 'alta' as const }], conclusao_resumo: 'R', conclusao_pontos_criticos: 'P', conclusao_oportunidades: 'O' }; await saveSalesReportTexts('2026-08', textos); expect(fetchMock).toHaveBeenCalledWith('/api/sac/vendas/relatorio-gerencial/textos', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mes: '2026-08', ...textos }) })) })
})
