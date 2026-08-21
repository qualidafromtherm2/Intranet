import type { SalesChartDetail, SalesChartsData } from '../features/sales-charts/types'
async function request<T>(path: string) { const r=await fetch(path,{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}}); const p=await r.json().catch(()=>({})); if(!r.ok||p.ok===false) throw new Error(p.error||`HTTP ${r.status}`); return p as T }
export const loadSalesValueByStateMonth=()=>request<SalesChartsData>('/api/sac/vendas/graficos/valor-estado-mes')
export const loadSalesQuantityByFamilyMonth=()=>request<SalesChartsData>('/api/sac/vendas/graficos/quantidade-familia-mes')
export const loadSalesValueByFamilyMonth=()=>request<SalesChartsData>('/api/sac/vendas/graficos/valor-familia-mes')
export const loadSalesFamilyDetail=(familia:string,mes:string)=>request<{ok:true;rows:SalesChartDetail[]}>(`/api/sac/vendas/graficos/quantidade-familia-mes/detalhe?familia=${encodeURIComponent(familia)}&mes=${encodeURIComponent(mes)}`)
export const loadSalesValueDetail=(familia:string,mes:string)=>request<{ok:true;rows:SalesChartDetail[]}>(`/api/sac/vendas/graficos/valor-familia-mes/detalhe?familia=${encodeURIComponent(familia)}&mes=${encodeURIComponent(mes)}`)
