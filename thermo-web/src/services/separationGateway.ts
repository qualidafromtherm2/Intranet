import { relativeLabel } from '../lib/format'

const apiBase = import.meta.env.VITE_API_BASE_URL || ''
const proxyTarget = import.meta.env.VITE_PROXY_TARGET || 'http://127.0.0.1:5001'
const buildUrl = (path: string) => `${apiBase}${path}`

function buildFriendlyError(path: string, detail?: string) {
  const base = `Não foi possível carregar os dados reais de Separação por ${path}.`
  const hint = `Confirme se o backend legado está ativo e acessível em ${proxyTarget}.`
  return detail ? `${base} ${detail} ${hint}` : `${base} ${hint}`
}

async function getJson<T>(path: string): Promise<T> {
  try {
    const response = await fetch(buildUrl(path), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    if (!response.ok) {
      const detail = (await response.text()).trim()
      throw new Error(buildFriendlyError(path, detail || `HTTP ${response.status}`))
    }

    return response.json() as Promise<T>
  } catch (error) {
    if (error instanceof Error && error.message.includes('Separação')) throw error
    throw new Error(buildFriendlyError(path, error instanceof Error ? error.message : undefined))
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function asNullableText(value: unknown) {
  const text = asText(value).trim()
  return text ? text : null
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function asBoolean(value: unknown) {
  return Boolean(value)
}

function statusOrder(status: SeparationColumnKey) {
  return SEPARATION_COLUMN_ORDER.indexOf(status)
}

export type SeparationColumnKey =
  | 'pendente'
  | 'Stund-by'
  | 'Separação'
  | 'Separado'
  | 'Aguardando retirada'
  | 'Concluído'

export interface SeparationPermissionSummary {
  userId: string | null
  username: string | null
  canRequest: boolean
  reason: string | null
  destinations: Array<{
    code: string
    label: string
    isDefault: boolean
  }>
}

export interface SeparationCartItem {
  id: number
  codigoProduto: string
  descricao: string
  unidade: string
  quantidade: number
  comentario: string | null
  urgente: boolean
  dataPrevista: string | null
  horario: string | null
  retiradaPor: string | null
  nomeUser: string | null
}

export interface SeparationCardItem {
  solicId: number
  carrId: number
  idUser: string | null
  nomeUser: string
  codigoProduto: string
  descricao: string
  unidade: string
  quantidade: number
  status: string
  comentario: string | null
  urgente: boolean
  nSolic: string | null
  dataPrevista: string | null
  horario: string | null
  itemCriadoEm: string | null
  usuarioSeparando: string | null
  nomeLocal: string | null
  codLocal: string | null
  quantidadeSolicitada: number | null
  quantidadeSeparada: number | null
}

export interface SeparationRequestCard {
  nSolic: string
  status: SeparationColumnKey
  statusLabel: string
  nomeUser: string
  totalItens: number
  itensCount: number
  dataPrevista: string | null
  horario: string | null
  criadoEm: string | null
  atualizadoEm: string | null
  itemCriadoEm: string | null
  usuarioSeparando: string | null
  hasUrgent: boolean
  hasPurchase: boolean
  itemIds: number[]
  carrIds: number[]
  itens: SeparationCardItem[]
}

export interface SeparationKanbanBoard {
  columns: Record<SeparationColumnKey, SeparationRequestCard[]>
  totalCards: number
}

export interface SeparationActionPreview {
  id: string
  title: string
  method: 'POST' | 'PATCH' | 'DELETE'
  endpoint: string
  confirmation: string
  payload: Record<string, unknown>
  destructive?: boolean
  statusTarget?: string
}

export const SEPARATION_COLUMN_ORDER: SeparationColumnKey[] = [
  'pendente',
  'Stund-by',
  'Separação',
  'Separado',
  'Aguardando retirada',
  'Concluído',
]

export const SEPARATION_COLUMN_LABELS: Record<SeparationColumnKey, string> = {
  pendente: 'Solicitado',
  'Stund-by': 'Stund-by',
  'Separação': 'Em Separação',
  Separado: 'Separado',
  'Aguardando retirada': 'Aguardando retirada',
  'Concluído': 'Concluído',
}

function normalizeCardItem(raw: unknown): SeparationCardItem {
  const item = asRecord(raw)
  return {
    solicId: asNumber(item.solic_id || item.id),
    carrId: asNumber(item.carr_id),
    idUser: asNullableText(item.id_user),
    nomeUser: asText(item.nome_user || item.solicitante || '—'),
    codigoProduto: asText(item.codigo_produto),
    descricao: asText(item.descricao),
    unidade: asText(item.unidade || 'UN') || 'UN',
    quantidade: asNumber(item.quantidade),
    status: asText(item.status || 'pendente'),
    comentario: asNullableText(item.comentario || item.observacao),
    urgente: asBoolean(item.urgente),
    nSolic: asNullableText(item.n_solic),
    dataPrevista: asNullableText(item.data_prevista),
    horario: asNullableText(item.horario),
    itemCriadoEm: asNullableText(item.item_criado_em || item.criado_em),
    usuarioSeparando: asNullableText(item.usuario_separando),
    nomeLocal: asNullableText(item.nome_local),
    codLocal: asNullableText(item.cod_local),
    quantidadeSolicitada: item.quantidade_solicitada == null ? null : asNumber(item.quantidade_solicitada),
    quantidadeSeparada: item.quantidade_separada == null ? null : asNumber(item.quantidade_separada),
  }
}

function normalizeRequestCard(raw: unknown, fallbackStatus?: SeparationColumnKey): SeparationRequestCard {
  const card = asRecord(raw)
  const rawStatus = asText(card.status || card.status_sep || fallbackStatus || 'pendente') as SeparationColumnKey
  const status = SEPARATION_COLUMN_ORDER.includes(rawStatus) ? rawStatus : (fallbackStatus || 'pendente')
  const itens = asArray<unknown>(card.itens).map(normalizeCardItem)
  const itemIds = itens.map((item) => item.solicId).filter((id) => id > 0)
  const carrIds = itens.map((item) => item.carrId).filter((id) => id > 0)

  return {
    nSolic: asText(card.n_solic || card.nSolic || `SEP-${itemIds[0] || 'sem-numero'}`),
    status,
    statusLabel: SEPARATION_COLUMN_LABELS[status],
    nomeUser: asText(card.nome_user || card.solicitante || '—'),
    totalItens: asNumber(card.total_itens || card.totalItens || itens.length),
    itensCount: itens.length || asNumber(card.total_itens || 0),
    dataPrevista: asNullableText(card.data_prevista),
    horario: asNullableText(card.horario),
    criadoEm: asNullableText(card.criado_em || card.criado_em_min),
    atualizadoEm: asNullableText(card.atualizado_em),
    itemCriadoEm: asNullableText(card.item_criado_em || card.criado_em_min),
    usuarioSeparando: asNullableText(card.usuario_separando),
    hasUrgent: asBoolean(card.tem_urgente || card.hasUrgent || itens.some((item) => item.urgente)),
    hasPurchase: asBoolean(card.tem_em_compra),
    itemIds,
    carrIds,
    itens,
  }
}

export async function loadSeparationPermissions(): Promise<SeparationPermissionSummary> {
  const auth = await getJson<{ user?: { id?: string; username?: string } | null }>('/api/auth/status')
  const userId = asNullableText(auth?.user?.id)
  const username = asNullableText(auth?.user?.username)

  if (!userId) {
    return {
      userId: null,
      username: null,
      canRequest: false,
      reason: 'Sessão não autenticada no legado.',
      destinations: [],
    }
  }

  const [permissionResponse, destinationsResponse] = await Promise.all([
    getJson<Record<string, unknown>>(`/api/colaboradores/${encodeURIComponent(userId)}/separacao-permissao`),
    getJson<Record<string, unknown>>('/api/colaboradores/separacao-destinos'),
  ])

  const destinations = asArray<unknown>(destinationsResponse.destinos).map((entry) => {
    const row = asRecord(entry)
    const code = asText(row.codigo || row.code)
    const label = asText(row.descricao || row.nome || row.label || code)
    const defaultCode = asText(destinationsResponse.destino_padrao_codigo)
    return {
      code,
      label,
      isDefault: Boolean(code && defaultCode && code === defaultCode),
    }
  }).filter((entry) => entry.code)

  return {
    userId,
    username,
    canRequest: !permissionResponse.error,
    reason: asNullableText(permissionResponse.error),
    destinations,
  }
}

export async function loadSeparationCart(): Promise<SeparationCartItem[]> {
  const response = await getJson<Record<string, unknown>>('/api/logistica/carrinho')
  return asArray<unknown>(response.itens).map((entry) => {
    const item = asRecord(entry)
    return {
      id: asNumber(item.id),
      codigoProduto: asText(item.codigo_produto),
      descricao: asText(item.descricao),
      unidade: asText(item.unidade || 'UN') || 'UN',
      quantidade: asNumber(item.quantidade),
      comentario: asNullableText(item.comentario),
      urgente: asBoolean(item.urgente),
      dataPrevista: asNullableText(item.data_prevista),
      horario: asNullableText(item.horario),
      retiradaPor: asNullableText(item.retirada_por),
      nomeUser: asNullableText(item.nome_user),
    }
  })
}

export async function loadSeparationRequests(): Promise<SeparationRequestCard[]> {
  const response = await getJson<Record<string, unknown>>('/api/logistica/solicitacoes-kanban')
  const groups = asArray<unknown>(response.grupos)
  const cards = groups.map((group) => normalizeRequestCard(group))
  return cards.sort((a, b) => {
    const statusDelta = statusOrder(a.status) - statusOrder(b.status)
    if (statusDelta !== 0) return statusDelta
    return (b.criadoEm || '').localeCompare(a.criadoEm || '')
  })
}

export async function loadSeparationKanban(): Promise<SeparationKanbanBoard> {
  const response = await getJson<Record<string, unknown>>('/api/logistica/kanban')
  const payload = asRecord(response.colunas)

  const columns = SEPARATION_COLUMN_ORDER.reduce<Record<SeparationColumnKey, SeparationRequestCard[]>>((acc, status) => {
    const cards = asArray<unknown>(payload[status]).map((entry) => normalizeRequestCard(entry, status))
    acc[status] = cards
    return acc
  }, {
    pendente: [],
    'Stund-by': [],
    'Separação': [],
    Separado: [],
    'Aguardando retirada': [],
    'Concluído': [],
  })

  const totalCards = SEPARATION_COLUMN_ORDER.reduce((sum, status) => sum + columns[status].length, 0)
  return { columns, totalCards }
}

export async function loadSeparationItems(nSolic: string, options?: { includeDerivados?: boolean; escopoItens?: string }) {
  const params = new URLSearchParams({ n_solic: nSolic })
  if (options?.includeDerivados) params.set('includeDerivados', '1')
  if (options?.escopoItens) params.set('escopoItens', options.escopoItens)

  const response = await getJson<Record<string, unknown>>(`/api/logistica/kanban/itens?${params.toString()}`)
  return {
    itens: asArray<unknown>(response.itens).map(normalizeCardItem),
    itensDerivados: asArray<unknown>(response.itens_derivados).map(normalizeCardItem),
  }
}

export function buildSeparationActionPreviews(card: SeparationRequestCard): SeparationActionPreview[] {
  const firstItem = card.itens[0]
  const primarySolicId = firstItem?.solicId || card.itemIds[0] || 0
  const firstQuantity = firstItem?.quantidadeSeparada || firstItem?.quantidade || 1
  const firstLocalCode = firstItem?.codLocal || ''
  const firstLocalName = firstItem?.nomeLocal || ''
  const previews: SeparationActionPreview[] = []

  if (card.status === 'pendente') {
    previews.push({
      id: 'iniciar',
      title: 'Iniciar separação',
      method: 'PATCH',
      endpoint: '/api/logistica/itens_solicitados/separacao',
      confirmation: `Confirme o início da SEP ${card.nSolic} com ${card.itemIds.length} item(ns).`,
      payload: { solic_ids: card.itemIds },
      statusTarget: 'Separação',
    })
  }

  if (card.status === 'Separação' || card.status === 'Separado') {
    previews.push({
      id: 'assumir',
      title: 'Assumir separação',
      method: 'PATCH',
      endpoint: '/api/logistica/itens_solicitados/assumir-separacao',
      confirmation: `Confirme a transferência da SEP ${card.nSolic} para o seu usuário.`,
      payload: { solic_ids: card.itemIds },
      statusTarget: 'Separação',
    })
    previews.push({
      id: 'cancelar',
      title: 'Cancelar separação',
      method: 'PATCH',
      endpoint: '/api/logistica/itens_solicitados/cancelar-separacao',
      confirmation: `Confirme o cancelamento da SEP ${card.nSolic}; ela volta para Solicitado.`,
      payload: { solic_ids: card.itemIds },
      destructive: true,
      statusTarget: 'pendente',
    })
  }

  if (card.status === 'Separação') {
    previews.push({
      id: 'qtd-manual',
      title: 'Informar quantidade manual',
      method: 'POST',
      endpoint: '/api/logistica/itens_solicitados/registrar-qtd-manual',
      confirmation: `Confirme o registro manual de quantidade da SEP ${card.nSolic}.`,
      payload: {
        carr_ids: card.carrIds,
        solic_ids: card.itemIds,
        quantidade_separada: firstQuantity,
        motivo: firstItem?.comentario || null,
      },
      statusTarget: 'Separação',
    })
    previews.push({
      id: 'separar-total',
      title: 'Separar total',
      method: 'PATCH',
      endpoint: '/api/logistica/itens_solicitados/separar',
      confirmation: `Confirme a separação total da SEP ${card.nSolic}.`,
      payload: {
        solic_ids: card.itemIds,
        codigo_produto: firstItem?.codigoProduto || null,
        cod_local_origem: firstLocalCode || null,
      },
      statusTarget: 'Separado',
    })
    previews.push({
      id: 'separar-parcial',
      title: 'Separar parcial',
      method: 'POST',
      endpoint: '/api/logistica/itens_solicitados/separar-parcial',
      confirmation: `Confirme a separação parcial da SEP ${card.nSolic}; o restante volta à fila.`,
      payload: {
        carr_ids: card.carrIds,
        solic_ids: card.itemIds,
        quantidade_separada: firstQuantity,
        motivo: 'Qtd parcial informada no piloto',
        codigo_produto: firstItem?.codigoProduto || null,
        cod_local_origem: firstLocalCode || null,
      },
      statusTarget: 'Separado + pendente',
    })
    previews.push({
      id: 'nao-separar',
      title: 'Não separar',
      method: 'POST',
      endpoint: '/api/logistica/itens_solicitados/nao-separar',
      confirmation: `Confirme a justificativa de não separação para o item ${firstItem?.codigoProduto || primarySolicId}.`,
      payload: {
        solic_id: primarySolicId,
        justificativa: 'Justificativa obrigatória coletada na UI antes da execução.',
      },
      destructive: true,
      statusTarget: 'Stund-by',
    })
    previews.push({
      id: 'trocar',
      title: 'Trocar produto',
      method: 'POST',
      endpoint: '/api/logistica/itens_solicitados/trocar',
      confirmation: `Confirme a troca do primeiro item da SEP ${card.nSolic}.`,
      payload: {
        solic_id: primarySolicId,
        codigo_novo: 'CODIGO-NOVO',
        descricao_novo: 'Descrição do novo produto',
        unidade_novo: firstItem?.unidade || 'UN',
        quantidade_nova: firstItem?.quantidade || 1,
      },
      destructive: true,
      statusTarget: 'Separação',
    })
  }

  if (card.status === 'Separado') {
    previews.push({
      id: 'aguardando-retirada',
      title: 'Marcar aguardando retirada',
      method: 'PATCH',
      endpoint: '/api/logistica/itens_solicitados/aguardando-retirada',
      confirmation: `Confirme o envio da SEP ${card.nSolic} para Aguardando retirada.`,
      payload: {
        solic_ids: card.itemIds,
        cod_local: firstLocalCode || null,
        nome_local: firstLocalName || null,
        quantidade: firstQuantity,
      },
      statusTarget: 'Aguardando retirada',
    })
    previews.push({
      id: 'reverter-separacao',
      title: 'Retificar para Em Separação',
      method: 'PATCH',
      endpoint: '/api/logistica/itens_solicitados/reverter-separacao',
      confirmation: `Confirme a retificação da SEP ${card.nSolic} para Em Separação.`,
      payload: { solic_ids: card.itemIds },
      destructive: true,
      statusTarget: 'Separação',
    })
  }

  if (card.status === 'Aguardando retirada') {
    previews.push({
      id: 'recebido',
      title: 'Concluir / recebido',
      method: 'PATCH',
      endpoint: '/api/logistica/itens_solicitados/concluido',
      confirmation: `Confirme o recebimento da SEP ${card.nSolic}.`,
      payload: { solic_ids: card.itemIds },
      statusTarget: 'Concluído',
    })
    previews.push({
      id: 'reverter-conferido',
      title: 'Retificar aguardando retirada',
      method: 'PATCH',
      endpoint: '/api/logistica/itens_solicitados/reverter-conferido',
      confirmation: `Confirme a volta da SEP ${card.nSolic} para Separado.`,
      payload: { solic_ids: card.itemIds },
      destructive: true,
      statusTarget: 'Separado',
    })
  }

  return previews
}

export function summarizeRequest(card: SeparationRequestCard) {
  const prazo = card.dataPrevista ? relativeLabel(card.dataPrevista) : 'Sem prazo'
  const separador = card.usuarioSeparando ? ` · separando: ${card.usuarioSeparando}` : ''
  return `${card.statusLabel} · ${card.itensCount} item(ns) · ${prazo}${separador}`
}
