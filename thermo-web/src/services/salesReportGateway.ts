import type { SalesFilterOptions, SalesReport, SalesReportFilters, SalesTexts } from '../features/sales-report/types'

async function requestJson<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers); headers.set('Accept', 'application/json'); if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'include', cache: 'no-store' })
  const payload = await response.json().catch(() => ({})) as T & { ok?: boolean; error?: string }
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`)
  return payload
}
export function salesReportQuery(filters: SalesReportFilters) { const query = new URLSearchParams({ modo: filters.modo || 'mes', etapa: 'entregue' }); Object.entries(filters).forEach(([key, value]) => { if (value && key !== 'modo') query.set(key, value) }); return query.toString() }
export const loadSalesReport = (filters: SalesReportFilters, signal?: AbortSignal) => requestJson<SalesReport>(`/api/sac/vendas/relatorio-gerencial?${salesReportQuery(filters)}`, { signal })
export const loadSalesReportOptions = () => requestJson<SalesFilterOptions & { ok: true }>('/api/sac/vendas/relatorio-gerencial/filtros-opcoes')
export const saveSalesReportTexts = (month: string, texts: SalesTexts) => requestJson<{ ok: true; textos: SalesTexts }>('/api/sac/vendas/relatorio-gerencial/textos', { method: 'PUT', body: JSON.stringify({ mes: month, plano_acao: texts.plano_acao, conclusao_resumo: texts.conclusao_resumo, conclusao_pontos_criticos: texts.conclusao_pontos_criticos, conclusao_oportunidades: texts.conclusao_oportunidades }) })
