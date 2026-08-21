import type {
  AssociationInput,
  AssociationMutationResponse,
  AssociationPreviewResponse,
  NfeDetailsResponse,
  ReceivingRow,
  PurchaseCategory,
} from '../features/receiving/types'

const apiBase = import.meta.env.VITE_API_BASE_URL || ''

export class ReceivingGatewayError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) { super(message); this.status = status }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' })
  } catch (error) {
    throw new ReceivingGatewayError(error instanceof Error ? error.message : 'Falha de conexão com o backend legado.')
  }
  const raw = await response.text()
  let payload: unknown = {}
  try { payload = raw ? JSON.parse(raw) : {} } catch { payload = { error: raw } }
  if (!response.ok || (payload && typeof payload === 'object' && 'ok' in payload && payload.ok === false)) {
    const detail = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `Falha HTTP ${response.status}`
    throw new ReceivingGatewayError(detail, response.status)
  }
  return payload as T
}

function normalizeRows(payload: unknown): ReceivingRow[] {
  if (Array.isArray(payload)) return payload as ReceivingRow[]
  if (payload && typeof payload === 'object') {
    const record = payload as { solicitacoes?: unknown; items?: unknown }
    if (Array.isArray(record.solicitacoes)) return record.solicitacoes as ReceivingRow[]
    if (Array.isArray(record.items)) return record.items as ReceivingRow[]
  }
  return []
}

export async function loadPendingReceipts() {
  return normalizeRows(await requestJson<unknown>('/api/compras/solicitacoes-recebimento'))
}

export async function loadReceivedProducts() {
  return normalizeRows(await requestJson<unknown>('/api/compras/pedidos-recebidos'))
}

export function findNfeKey(numeroNfe: string) {
  const query = new URLSearchParams({ numero_nfe: numeroNfe.trim() })
  return requestJson<{ ok: true; chave_nfe: string; numero_nfe?: string }>(`/api/compras/nfe-buscar-chave?${query}`)
}

export function loadNfeDetails(chaveNfe: string, numeroNfe = '') {
  const query = new URLSearchParams({ chave_nfe: chaveNfe.replace(/\D/g, '') })
  if (numeroNfe.trim()) query.set('numero_nfe', numeroNfe.trim())
  return requestJson<NfeDetailsResponse>(`/api/compras/nfe-xml-detalhes?${query}`)
}

export function previewNfeAssociation(input: AssociationInput) {
  return requestJson<AssociationPreviewResponse>('/api/compras/pedidos-omie/nfe-associar-pedido/preview', {
    method: 'POST', body: JSON.stringify(input),
  })
}

export function loadActivePurchaseCategories() {
  return requestJson<{ ok: boolean; categorias: PurchaseCategory[] }>('/api/compras/categorias')
}

export function confirmNfeAssociation(input: AssociationInput) {
  return requestJson<AssociationMutationResponse>('/api/compras/pedidos-omie/nfe-associar-pedido', {
    method: 'POST', body: JSON.stringify(input),
  })
}
