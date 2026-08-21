import type {ChatbotMonitor, MonitorDetails} from '../features/chatbot-monitor/types'

async function get<T>(path: string): Promise<T> { const response=await fetch(path,{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}}); const payload=await response.json().catch(()=>({})); if(!response.ok||payload.ok===false) throw new Error(payload.error||`HTTP ${response.status}`); return payload as T }
export const loadChatbotMonitor=()=>get<ChatbotMonitor>('/api/ai/monitor')
export const loadChatbotMonitorDetails=(params:Record<string,string|number>)=>get<MonitorDetails>(`/api/ai/monitor/details?${new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]))}`)
