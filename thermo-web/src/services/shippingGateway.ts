import type { ShippingMutationResponse, ShippingQueueResponse } from '../features/shipping/types'

const apiBase = import.meta.env.VITE_API_BASE_URL || ''
const proxyTarget = import.meta.env.VITE_PROXY_TARGET || 'http://127.0.0.1:5001'
const buildUrl = (path: string) => `${apiBase}${path}`

function friendlyError(path: string, detail?: string) {
  const base = `Falha ao acessar Envio de mercadoria por ${path}.`
  const hint = `Confirme a sessão e o backend legado acessível pelo proxy Vite em ${proxyTarget}.`
  return detail ? `${base} ${detail} ${hint}` : `${base} ${hint}`
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body) headers.set('Content-Type', 'application/json')
    const response = await fetch(buildUrl(path), { ...init, credentials: 'include', cache: 'no-store', headers })
    const raw = await response.text()
    let payload: Record<string, unknown> = {}
    if (raw) {
      try { payload = JSON.parse(raw) as Record<string, unknown> } catch { payload = { error: raw } }
    }
    if (!response.ok || payload.ok === false) {
      const detail = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
      throw new Error(friendlyError(path, detail))
    }
    return payload as T
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Falha ao acessar Envio de mercadoria')) throw error
    throw new Error(friendlyError(path, error instanceof Error ? error.message : undefined))
  }
}

export function loadShippingQueue() {
  return requestJson<ShippingQueueResponse>('/api/sac/solicitacoes?filaLogistica=1')
}

export function markShippingAsSent(id: number) {
  return requestJson<ShippingMutationResponse>(`/api/sac/solicitacoes/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'Enviado' }),
  })
}

export function generateShippingLabel(id: number, separationNumber?: string | null) {
  return requestJson<ShippingMutationResponse>('/api/vipp/gerar-etiqueta', {
    method: 'POST',
    body: JSON.stringify({ envio_id: id, ...(separationNumber ? { n_solic: separationNumber } : {}) }),
  })
}

export function shippingLabelUrl(record: { id: number; identificacao?: string | null; etiqueta_url?: string | null }) {
  if (record.etiqueta_url?.startsWith('http')) return record.etiqueta_url
  const ect = String(record.identificacao || '').replace(/\s+/g, '')
  return ect ? `${apiBase}/api/vipp/etiqueta?id=${encodeURIComponent(ect)}&saida=1` : null
}

export function shippingDeclarationUrl(record: { id: number; declaracao_url?: string | null; id_vipp?: string | null; conteudo?: unknown }) {
  if (record.declaracao_url?.startsWith('http')) return record.declaracao_url
  return record.id_vipp || record.conteudo ? `${apiBase}/api/vipp/declaracao?id=${record.id}` : null
}
