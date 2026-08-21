import type { FreightLocation, FreightProduct, FreightQuote, FreightRecent, FreightTable } from '../features/freight/types'

const apiBase = import.meta.env.VITE_API_BASE_URL || ''
const proxyTarget = import.meta.env.VITE_PROXY_TARGET || 'http://127.0.0.1:5001'

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body) headers.set('Content-Type', 'application/json')
    const response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' })
    const raw = await response.text()
    const payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    if (!response.ok || payload.ok === false) throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`)
    return payload as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    const detail = error instanceof Error ? error.message : 'erro desconhecido'
    throw new Error(`Falha ao acessar o Simulador de frete. ${detail} Confirme a sessão e o backend legado acessível pelo proxy Vite em ${proxyTarget}.`)
  }
}

export const loadFreightStatus = () => requestJson<{ ok: true; origem: { endereco?: string; logradouro?: string; numero?: string; cidade: string; uf: string; cep: string }; tabelas: FreightTable[] }>('/api/frete/status')
export const searchFreightProducts = (query: string, signal?: AbortSignal) => requestJson<{ ok: true; itens: FreightProduct[] }>(`/api/frete/produtos?q=${encodeURIComponent(query)}&limit=20`, { signal })
export const loadFreightLocations = (uf: string, query = '', signal?: AbortSignal) => requestJson<{ ok: true; itens: FreightLocation[] }>(`/api/frete/localidades?uf=${encodeURIComponent(uf)}&q=${encodeURIComponent(query)}&limit=1000`, { signal })
export const lookupFreightCep = (cep: string) => requestJson<{ cep?: string; localidade?: string; uf?: string; erro?: boolean }>(`/api/viacep/${encodeURIComponent(cep.replace(/\D/g, ''))}`)
export const loadRecentFreightQuotes = () => requestJson<{ ok: true; itens: FreightRecent[] }>('/api/frete/cotacoes?limit=8')
export const reopenFreightQuote = (id: number) => requestJson<{ ok: true; cotacao: FreightRecent; itens: FreightProduct[]; resultados: FreightQuote['resultados'] }>(`/api/frete/cotacoes/${id}`)
export const simulateFreight = (payload: { destino: { cep: string | null; cidade: string; uf: string }; valor_mercadoria: string; itens: { codigo: string; quantidade: number }[] }) => requestJson<FreightQuote>('/api/frete/simular', { method: 'POST', body: JSON.stringify(payload) })
