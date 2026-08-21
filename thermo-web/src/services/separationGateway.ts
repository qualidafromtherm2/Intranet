import type {
  ActiveUsersResponse,
  AddSeparationCartItemInput,
  AddSeparationCartItemResponse,
  SeparationCartResponse,
  SeparationItemsResponse,
  SeparationKanbanResponse,
  SeparationMutationResponse,
  SeparationStockLocationsResponse,
  SubmitSeparationInput,
  SubmitSeparationResponse,
} from '../features/separation/types'

const apiBase = import.meta.env.VITE_API_BASE_URL || ''
const proxyTarget = import.meta.env.VITE_PROXY_TARGET || 'http://127.0.0.1:5001'

const buildUrl = (path: string) => `${apiBase}${path}`

function buildFriendlyError(path: string, detail?: string) {
  const base = `Falha ao acessar o fluxo real de separação por ${path}.`
  const hint = `Confirme a sessão e o backend legado acessível pelo proxy Vite em ${proxyTarget}.`
  return detail ? `${base} ${detail} ${hint}` : `${base} ${hint}`
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body) headers.set('Content-Type', 'application/json')

    const response = await fetch(buildUrl(path), {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers,
    })

    const raw = await response.text()
    let payload: Record<string, unknown> = {}
    if (raw) {
      try {
        payload = JSON.parse(raw) as Record<string, unknown>
      } catch {
        payload = { error: raw }
      }
    }

    if (!response.ok || payload.ok === false) {
      const detail = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
      throw new Error(buildFriendlyError(path, detail))
    }

    return payload as T
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Falha ao acessar o fluxo real de separação')) {
      throw error
    }
    throw new Error(buildFriendlyError(path, error instanceof Error ? error.message : undefined))
  }
}

const jsonBody = (value: unknown) => JSON.stringify(value)

export function loadSeparationCart() {
  return requestJson<SeparationCartResponse>('/api/logistica/carrinho')
}

export function loadSeparationKanban(search = '') {
  const params = new URLSearchParams()
  if (search.trim()) params.set('q', search.trim())
  const query = params.toString()
  return requestJson<SeparationKanbanResponse>(`/api/logistica/solicitacoes-kanban${query ? `?${query}` : ''}`)
}

export function loadSeparationItems(nSolic: string, options: { includeDerived?: boolean } = {}) {
  const params = new URLSearchParams({ n_solic: nSolic, escopo: 'global' })
  if (options.includeDerived) params.set('include_derivados', '1')
  return requestJson<SeparationItemsResponse>(`/api/logistica/kanban/itens?${params.toString()}`)
}

export function loadSeparationActiveUsers() {
  return requestJson<ActiveUsersResponse>('/api/usuarios/ativos')
}

export function loadSeparationStockLocations() {
  return requestJson<SeparationStockLocationsResponse>('/api/armazem/locais')
}

export function addSeparationCartItem(input: AddSeparationCartItemInput) {
  return requestJson<AddSeparationCartItemResponse>('/api/logistica/separacao', {
    method: 'POST',
    body: jsonBody(input),
  })
}

export function updateSeparationCartQuantity(itemId: number, quantidade: number) {
  return requestJson<SeparationMutationResponse>(`/api/logistica/carrinho/${itemId}/quantidade`, {
    method: 'PATCH',
    body: jsonBody({ quantidade }),
  })
}

export function updateSeparationCartComment(itemId: number, comentario: string) {
  return requestJson<SeparationMutationResponse>(`/api/logistica/carrinho/${itemId}/comentario`, {
    method: 'PATCH',
    body: jsonBody({ comentario }),
  })
}

export function updateSeparationCartUrgency(itemId: number, urgente: boolean) {
  return requestJson<SeparationMutationResponse>(`/api/logistica/carrinho/${itemId}/urgente`, {
    method: 'PATCH',
    body: jsonBody({ urgente }),
  })
}

export function removeSeparationCartItem(itemId: number) {
  return requestJson<SeparationMutationResponse>(`/api/logistica/carrinho/${itemId}`, { method: 'DELETE' })
}

export function clearSeparationCart() {
  return requestJson<SeparationMutationResponse>('/api/logistica/carrinho', { method: 'DELETE' })
}

export function submitSeparation(input: SubmitSeparationInput) {
  return requestJson<SubmitSeparationResponse>('/api/logistica/separacao/enviar', {
    method: 'POST',
    body: jsonBody(input),
  })
}

function mutateSeparationItems(path: string, solicIds: number[]) {
  return requestJson<SeparationMutationResponse>(path, {
    method: 'PATCH',
    body: jsonBody({ solic_ids: solicIds }),
  })
}

export function startSeparation(solicIds: number[]) {
  return mutateSeparationItems('/api/logistica/itens_solicitados/separacao', solicIds)
}

export function moveSeparationToAwaitingPickup(solicIds: number[]) {
  return mutateSeparationItems('/api/logistica/itens_solicitados/aguardando-retirada', solicIds)
}

export function completeSeparation(solicIds: number[]) {
  return mutateSeparationItems('/api/logistica/itens_solicitados/concluido', solicIds)
}
