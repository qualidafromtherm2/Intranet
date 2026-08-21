import type {
  ActiveUsersResponse,
  AddSeparationCartItemInput,
  AddSeparationCartItemResponse,
  SeparationCartResponse,
  SeparationItemsResponse,
  SeparationInventoryAddress,
  SeparationKanbanResponse,
  SeparationMutationResponse,
  SeparationStockLocationsResponse,
  RequesterKanbanResponse,
  SeparationStockBalance,
  SeparationFifoId,
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
    const response = await fetch(buildUrl(path), { ...init, credentials: 'include', cache: 'no-store', headers })
    const raw = await response.text()
    let payload: Record<string, unknown> = {}
    if (raw) {
      try { payload = JSON.parse(raw) as Record<string, unknown> } catch { payload = { error: raw } }
    }
    if (!response.ok || payload.ok === false) {
      const detail = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
      throw new Error(buildFriendlyError(path, detail))
    }
    return payload as T
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Falha ao acessar o fluxo real de separação')) throw error
    throw new Error(buildFriendlyError(path, error instanceof Error ? error.message : undefined))
  }
}

const jsonBody = (value: unknown) => JSON.stringify(value)

export interface SeparationOperatorContext {
  id: string
  username: string
  restringir_destinos: boolean
  destinos_codigos: string[]
  destinos_chaves: string[]
}

export interface SeparationProductOption {
  codigo: string
  descricao: string
  unidade: string
}

export interface SeparationExecutionInput {
  solic_ids: number[]
  carr_ids?: number[]
  cod_local_origem: string
  codigo_produto: string
  etq_enderecos?: Array<{ etq_id?: number; endereco?: string; qtd: number }>
  etq_id?: number
  endereco_origem?: string
  ignorar_saldo_etq?: true
}

export interface SeparationQuantityInput extends SeparationExecutionInput {
  carr_ids: number[]
  quantidade_separada: number
  motivo: string
}

export function loadSeparationCart() { return requestJson<SeparationCartResponse>('/api/logistica/carrinho') }

export function loadSeparationKanban(search = '') {
  const params = new URLSearchParams()
  if (search.trim()) params.set('q', search.trim())
  const query = params.toString()
  return requestJson<SeparationKanbanResponse>(`/api/logistica/solicitacoes-kanban${query ? `?${query}` : ''}`)
}

export function loadRequesterSeparationKanban() { return requestJson<RequesterKanbanResponse>('/api/logistica/kanban') }

export function loadSeparationOperationalData(codes: string[]) {
  const value = [...new Set(codes.map(String).map((code) => code.trim()).filter(Boolean))].join(',')
  const query = encodeURIComponent(value)
  return Promise.all([
    requestJson<{ ok: boolean; dados: Record<string, SeparationStockBalance[]> }>(`/api/logistica/estoque/batch?codigos=${query}`),
    requestJson<{ ok: boolean; dados: Record<string, SeparationInventoryAddress[]> }>(`/api/logistica/endereco-pp/batch?codigos=${query}`),
    requestJson<{ ok: boolean; dados: Record<string, SeparationFifoId[]> }>(`/api/etiquetas/rec-impresso/ids-fifo-batch?codigos=${query}`),
  ]).then(([stock, addresses, fifo]) => ({
    stock: Object.fromEntries(Object.entries(stock.dados || {}).map(([code, rows]) => [code, rows.map((row) => ({ ...row, codigo_local_estoque: row.local_codigo, descricao_local_estoque: row.local_nome }))])),
    addresses: addresses.dados || {}, fifo: fifo.dados || {},
  }))
}

export function loadSeparationPlan(nSolic: string) {
  return requestJson<{ ok: boolean; n_solic: string | null; codigos: string[]; itens: Array<{ codigo: string; descricao?: string; seps: number; quantidade: number | string }> }>(`/api/logistica/planejar-sep/codigos?n_solic=${encodeURIComponent(nSolic)}`)
}

export function printSeparationLabels(ids: number[], usuario: string) {
  return requestJson<SeparationMutationResponse>('/api/etiquetas/rec-impresso/imprimir-ids', { method: 'POST', body: jsonBody({ ids, usuario, via_fila: true }) })
}

export function returnCompletedSeparationItem(input: { solic_id: number; quantidade: number; motivo: string; etq_modo: 'mesmo_id' | 'novo_id' }) {
  return requestJson<SeparationMutationResponse & { etiquetas_criadas?: Array<{ id: number; id_rotulo?: string; endereco?: string }> }>('/api/logistica/itens_solicitados/devolver', { method: 'POST', body: jsonBody(input) })
}

export function loadSeparationItems(nSolic: string, options: { includeDerived?: boolean } = {}) {
  const params = new URLSearchParams({ n_solic: nSolic, escopo: 'global' })
  if (options.includeDerived) params.set('include_derivados', '1')
  return requestJson<SeparationItemsResponse>(`/api/logistica/kanban/itens?${params.toString()}`)
}

export function loadSeparationActiveUsers() { return requestJson<ActiveUsersResponse>('/api/usuarios/ativos') }
export function loadSeparationStockLocations() { return requestJson<SeparationStockLocationsResponse>('/api/armazem/locais') }

export async function loadSeparationOperatorContext(): Promise<SeparationOperatorContext> {
  const auth = await requestJson<{ loggedIn: boolean; user: { id: string | number; username: string } | null }>('/api/auth/status')
  if (!auth.loggedIn || !auth.user) throw new Error(buildFriendlyError('/api/auth/status', 'Não autenticado.'))
  const rule = await requestJson<{ restringir_destinos?: boolean; destinos_codigos?: string[]; destinos_chaves?: string[] }>(`/api/colaboradores/${encodeURIComponent(String(auth.user.id))}/separacao-permissao`)
  return {
    id: String(auth.user.id),
    username: String(auth.user.username || '').trim(),
    restringir_destinos: rule.restringir_destinos === true,
    destinos_codigos: Array.isArray(rule.destinos_codigos) ? rule.destinos_codigos.map(String) : [],
    destinos_chaves: Array.isArray(rule.destinos_chaves) ? rule.destinos_chaves.map(String) : [],
  }
}

export function searchSeparationProducts(query: string) {
  const params = new URLSearchParams({ q: query.trim() })
  return requestJson<{ ok: boolean; resultados: SeparationProductOption[] }>(`/api/logistica/produtos/buscar?${params.toString()}`)
}

export function addSeparationCartItem(input: AddSeparationCartItemInput) {
  return requestJson<AddSeparationCartItemResponse>('/api/logistica/separacao', { method: 'POST', body: jsonBody(input) })
}

export function updateSeparationCartQuantity(itemId: number, quantidade: number) {
  return requestJson<SeparationMutationResponse>(`/api/logistica/carrinho/${itemId}/quantidade`, { method: 'PATCH', body: jsonBody({ quantidade }) })
}

export function updateSeparationCartComment(itemId: number, comentario: string) {
  return requestJson<SeparationMutationResponse>(`/api/logistica/carrinho/${itemId}/comentario`, { method: 'PATCH', body: jsonBody({ comentario }) })
}

export function updateSeparationCartUrgency(itemId: number, urgente: boolean) {
  return requestJson<SeparationMutationResponse>(`/api/logistica/carrinho/${itemId}/urgente`, { method: 'PATCH', body: jsonBody({ urgente }) })
}

export function removeSeparationCartItem(itemId: number) { return requestJson<SeparationMutationResponse>(`/api/logistica/carrinho/${itemId}`, { method: 'DELETE' }) }
export function clearSeparationCart() { return requestJson<SeparationMutationResponse>('/api/logistica/carrinho', { method: 'DELETE' }) }

export function submitSeparation(input: SubmitSeparationInput) {
  return requestJson<SubmitSeparationResponse>('/api/logistica/separacao/enviar', { method: 'POST', body: jsonBody(input) })
}

function mutateSeparationItems(path: string, solicIds: number[]) {
  return requestJson<SeparationMutationResponse>(path, { method: 'PATCH', body: jsonBody({ solic_ids: solicIds }) })
}

export function startSeparation(solicIds: number[]) { return mutateSeparationItems('/api/logistica/itens_solicitados/separacao', solicIds) }
export function moveSeparationToAwaitingPickup(solicIds: number[]) { return mutateSeparationItems('/api/logistica/itens_solicitados/aguardando-retirada', solicIds) }
export function completeSeparation(solicIds: number[]) { return mutateSeparationItems('/api/logistica/itens_solicitados/concluido', solicIds) }
export function assumeSeparation(solicIds: number[]) { return mutateSeparationItems('/api/logistica/itens_solicitados/assumir-separacao', solicIds) }
export function cancelSeparation(solicIds: number[]) { return mutateSeparationItems('/api/logistica/itens_solicitados/cancelar-separacao', solicIds) }
export function reverseSeparatedItem(solicIds: number[]) { return mutateSeparationItems('/api/logistica/itens_solicitados/reverter-separacao', solicIds) }
export function reverseCheckedItem(solicIds: number[]) { return mutateSeparationItems('/api/logistica/itens_solicitados/reverter-conferido', solicIds) }

export function registerManualSeparationQuantity(input: SeparationQuantityInput) {
  return requestJson<SeparationMutationResponse>('/api/logistica/itens_solicitados/registrar-qtd-manual', { method: 'POST', body: jsonBody(input) })
}

export function separateItem(input: SeparationExecutionInput) {
  return requestJson<SeparationMutationResponse>('/api/logistica/itens_solicitados/separar', { method: 'PATCH', body: jsonBody(input) })
}

export function separateItemPartially(input: SeparationQuantityInput) {
  return requestJson<SeparationMutationResponse>('/api/logistica/itens_solicitados/separar-parcial', { method: 'POST', body: jsonBody(input) })
}

export function declineSeparationItem(solicId: number, justificativa: string) {
  return requestJson<SeparationMutationResponse>('/api/logistica/itens_solicitados/nao-separar', { method: 'POST', body: jsonBody({ solic_id: solicId, justificativa }) })
}

export function swapSeparationProduct(input: { solic_id: number; codigo_novo: string; descricao_novo: string; unidade_novo: string; quantidade_nova: number | null }) {
  return requestJson<SeparationMutationResponse>('/api/logistica/itens_solicitados/trocar', { method: 'POST', body: jsonBody(input) })
}

export function deleteSeparationItem(solicId: number) {
  return requestJson<SeparationMutationResponse>(`/api/logistica/itens_solicitados/${solicId}/sep`, { method: 'DELETE' })
}

export function deleteSeparation(nSolic: string) {
  return requestJson<SeparationMutationResponse>(`/api/logistica/sep/${encodeURIComponent(nSolic)}`, { method: 'DELETE' })
}
