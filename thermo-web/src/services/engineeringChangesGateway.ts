import type { EngineeringChange } from '../features/engineering-changes/types'
async function request<T>(path:string){const r=await fetch(path,{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});const p=await r.json().catch(()=>({}));if(!r.ok||p.success===false)throw new Error(p.error||`HTTP ${r.status}`);return p as T}
export function loadEngineeringChanges(){return request<{ok:true;alteracoes:EngineeringChange[]}>('/api/engenharia/alteracoes-produto/todos')}
export function loadEngineeringChangesForProduct(code:string){return request<{ok:true;alteracoes:EngineeringChange[]}>(`/api/engenharia/alteracoes-produto/${encodeURIComponent(code.trim())}`)}
