import type {TechnicalDrawing} from '../features/technical-drawings/types'
async function request<T>(path:string){const r=await fetch(path,{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});const p=await r.json().catch(()=>({}));if(!r.ok||p.success===false)throw new Error(p.error||`HTTP ${r.status}`);return p as T}
export function loadTechnicalDrawings(){return request<{ok:true;desenhos:TechnicalDrawing[]}>('/api/engenharia/desenho-tecnico/todos')}
export function loadTechnicalDrawingsForProduct(code:string){return request<{ok:true;desenhos:TechnicalDrawing[]}>(`/api/engenharia/desenho-tecnico/${encodeURIComponent(code.trim())}`)}
