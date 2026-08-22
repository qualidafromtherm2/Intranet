import type {SalesMapRow} from '../features/sales-map/types'
async function request<T>(path:string){const r=await fetch(path,{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});const p=await r.json().catch(()=>({}));if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);return p as T}
export const loadSalesMap=(periodo:number,etapa='')=>request<{ok:true;rows:SalesMapRow[]}>(`/api/sac/vendas/graficos/mapa-brasil?periodo=${encodeURIComponent(periodo)}&etapa=${encodeURIComponent(etapa)}`)
export const loadSalesMapTimeline=(periodo:number,etapa='')=>request<{ok:true;timeline_rows:SalesMapRow[]}>(`/api/sac/vendas/graficos/mapa-brasil?periodo=${encodeURIComponent(periodo)}&etapa=${encodeURIComponent(etapa)}&timeline=1`)
