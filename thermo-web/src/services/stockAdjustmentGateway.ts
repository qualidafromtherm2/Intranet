export type AdjustmentType = 'ENT' | 'SAI'
export type AdjustmentStatus = 'Aguardando aprovação' | 'Executado' | 'Reprovado' | string

export interface StockAdjustment {
  id: number
  tipo_operacao: AdjustmentType
  codigo_produto?: number | null
  codigo: string
  descricao?: string | null
  qtd: number
  local_estoque: string
  local_nome?: string | null
  data_movimentacao?: string | null
  cmc?: number | null
  motivo?: string | null
  obs?: string | null
  solicitante?: string | null
  status: AdjustmentStatus
  aprovado_por?: string | null
  aprovado_em?: string | null
  reprovado_por?: string | null
  reprovado_em?: string | null
  motivo_reprovacao?: string | null
  criado_em?: string | null
}

export interface AdjustmentProduct { codigo: string; descricao?: string; codigo_produto?: number | string | null; codOmie?: number | string | null; cmc?: number | null; fisico?: number | null; saldo?: number | null }
export interface AdjustmentLocation { codigo_local_estoque: string | number; descricao?: string | null; inativo?: boolean | null }
export interface AdjustmentItem extends AdjustmentProduct { qtd: number; cmc?: number | null }
export interface CreateAdjustmentInput { tipo_operacao: AdjustmentType; local_estoque: string; local_nome?: string | null; data_movimentacao: string; solicitante: string; motivo: string; obs: string; itens: AdjustmentItem[] }

export const reasonsByType = {
  ENT: [{ value: 'INV', label: 'INV · Inventário' }, { value: 'OPE', label: 'OPE · Entrada operacional' }, { value: 'PDV', label: 'PDV · Devolução' }, { value: 'INI', label: 'INI · Estoque inicial' }],
  SAI: [{ value: 'INV', label: 'INV · Inventário' }, { value: 'PER', label: 'PER · Perda/quebra' }, { value: 'OPS', label: 'OPS · Saída operacional' }, { value: 'PDV', label: 'PDV · Devolução' }],
} as const

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: init?.method ? undefined : 'no-store', ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) } })
  const text = await response.text()
  let data: Record<string, unknown> = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: text } }
  if (!response.ok || data.ok === false) throw new Error(String(data.error || data.detail || `Falha HTTP ${response.status}.`))
  return data as T
}

export const loadAdjustments = () => request<{ ok: true; registros: StockAdjustment[] }>('/api/ajustes')
export const loadAdjustmentLocations = () => request<{ ok: true; locais: AdjustmentLocation[] }>('/api/armazem/locais')
export const searchAdjustmentProducts = (query: string) => request<{ data: AdjustmentProduct[] }>(`/api/produtos/search?q=${encodeURIComponent(query)}&limit=40`)

function assertActor(actor: string) { if (!actor.trim()) throw new Error('Usuário autenticado obrigatório.') }
function assertConfirmation(actual: string, expected: string) { if (actual !== expected) throw new Error(`Confirmação inválida. Digite ${expected}.`) }

export function validateAdjustment(input: CreateAdjustmentInput) {
  assertActor(input.solicitante)
  if (!['ENT', 'SAI'].includes(input.tipo_operacao)) throw new Error('Tipo deve ser ENT ou SAI.')
  if (!input.local_estoque.trim()) throw new Error('Selecione o local de estoque.')
  if (!reasonsByType[input.tipo_operacao].some((reason) => reason.value === input.motivo)) throw new Error('Motivo incompatível com o tipo de ajuste.')
  if (!input.obs.trim()) throw new Error('A justificativa do ajuste é obrigatória.')
  if (!input.itens.length) throw new Error('Adicione ao menos um produto.')
  for (const item of input.itens) {
    if (!item.codigo.trim()) throw new Error('Produto sem código.')
    if (!Number.isFinite(item.qtd) || item.qtd <= 0) throw new Error(`Quantidade inválida para ${item.codigo}.`)
    if (item.cmc != null && (!Number.isFinite(item.cmc) || item.cmc < 0)) throw new Error(`CMC inválido para ${item.codigo}.`)
  }
}

export async function createAdjustment(input: CreateAdjustmentInput, confirmation: string) {
  validateAdjustment(input)
  assertConfirmation(confirmation, `SOLICITAR ${input.tipo_operacao}`)
  return request<{ ok: true; registros: StockAdjustment[] }>('/api/ajustes', { method: 'POST', body: JSON.stringify(input) })
}

export async function approveAdjustment(id: number, actor: string, confirmation: string) {
  assertActor(actor); if (!Number.isInteger(id) || id <= 0) throw new Error('Identificador inválido.')
  assertConfirmation(confirmation, `EXECUTAR ${id}`)
  return request<{ ok: true; registro: StockAdjustment; descricao_status?: string | null }>(`/api/ajustes/${id}/aprovar`, { method: 'PATCH', body: JSON.stringify({ aprovadoPor: actor }) })
}

export async function rejectAdjustment(id: number, actor: string, reason: string, confirmation: string) {
  assertActor(actor); if (!Number.isInteger(id) || id <= 0) throw new Error('Identificador inválido.')
  if (reason.trim().length < 5) throw new Error('Informe uma justificativa de reprovação com pelo menos 5 caracteres.')
  assertConfirmation(confirmation, `REPROVAR ${id}`)
  return request<{ ok: true; registro: StockAdjustment }>(`/api/ajustes/${id}/reprovar`, { method: 'PATCH', body: JSON.stringify({ reprovadoPor: actor, motivo: reason.trim() }) })
}
