export type LogisticsFlow = 'recebimento' | 'expedicao'

export type PrintedReceipt = {
  id: number
  id_rotulo: string | null
  id_pai: number | null
  numero_nfe: string | null
  numero_pedido: string | null
  lote: string | null
  codigo_produto: string | null
  descricao_produto: string | null
  qtd: number
  unidade: string | null
  fornecedor: string | null
  data_emissao: string | null
  impresso_em: string | null
  usuario_criacao: string | null
}

export type ReceiptIdentification = {
  id: number
  numero_nfe: string | null
  numero_pedido: string | null
  lote: string | null
  codigo_produto: string | null
  descricao_produto: string | null
  qtd: number
  unidade: string | null
  data_emissao: string | null
  criado_em: string | null
  oculto: boolean
  impressa: boolean
  pir: boolean
  id_impresso: number | null
}

export type IdentificationPhoto = { url_imagem: string | null; pos: number }

export type PrintedReceiptDetail = {
  id: number
  id_rotulo: string | null
  id_pai: number | null
  qtd: number
  unidade: string
  endereco: string | null
  complemento: string | null
  codigo_omie: string
  descricao: string
  codigo: string
}

export type WarehouseLocation = {
  codigo?: string | null
  descricao?: string | null
  codigo_local_estoque: string
  inativo?: boolean
}

export type ProductAddressReference = {
  endereco: string
  complemento?: string | null
  qtd: number
  unidade: string | null
}

export type PrinterOption = {
  value: string
  label: string
  kind: 'agent' | 'cups' | 'pdf'
}

export type PrinterSetup = {
  options: PrinterOption[]
  defaultValue: string | null
}

export class LogisticsApiError extends Error {
  readonly status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'LogisticsApiError'
    this.status = status
  }
}

type JsonObject = Record<string, unknown>

const defaultWarehouse: WarehouseLocation = {
  codigo: '#ALMOX',
  descricao: 'Porta Pallet (Almoxarifado)',
  codigo_local_estoque: '10717096386',
}

async function responseError(response: Response) {
  const body = await response.text().catch(() => '')
  if (body) {
    try {
      const parsed = JSON.parse(body) as JsonObject
      const detail = parsed.error || parsed.message
      if (detail) return String(detail)
    } catch {
      return body
    }
  }
  if (response.status === 401) return 'Sua sessão expirou. Entre novamente para continuar.'
  if (response.status === 403) return 'Sua conta não tem permissão para executar esta operação.'
  return `A operação falhou (HTTP ${response.status}).`
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
      ...init,
    })
  } catch (error) {
    throw new LogisticsApiError(error instanceof Error ? error.message : 'Não foi possível acessar o backend legado.')
  }

  if (!response.ok) throw new LogisticsApiError(await responseError(response), response.status)
  return response.json() as Promise<T>
}

async function requestBlob(path: string) {
  let response: Response
  try {
    response = await fetch(path, { credentials: 'include', headers: { Accept: 'application/pdf' } })
  } catch (error) {
    throw new LogisticsApiError(error instanceof Error ? error.message : 'Não foi possível acessar o backend legado.')
  }
  if (!response.ok) throw new LogisticsApiError(await responseError(response), response.status)
  return response.blob()
}

export function isPermissionFailure(error: unknown) {
  return error instanceof LogisticsApiError && (error.status === 401 || error.status === 403)
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function normalizeWarehouseAddress(value: string) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '').replace(/_/g, '-')
}

export const warehouseAddressPattern = /^(\d{2})-(\d{2})-(\d{2})-(?:\d{3}|[A-Z]\d{2})$/
export const warehouseAddressHint = 'Use o formato 01-03-21-002 ou 01-03-21-P01.'

export function validateWarehouseAddress(value: string) {
  const normalized = normalizeWarehouseAddress(value)
  if (!warehouseAddressPattern.test(normalized)) throw new Error(warehouseAddressHint)
  return normalized
}

export function extractPrintedReceiptId(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const last = raw.split('|').at(-1) || ''
  const explicit = last.match(/^ID(\d+(?:\.\d+)?)$/i) || raw.match(/ID(\d+(?:\.\d+)?)/i)
  if (explicit) return explicit[1]
  return /^\d+(?:\.\d+)?$/.test(raw) ? raw : null
}

export async function loadPrintedReceipts(input: { query?: string; flow?: LogisticsFlow } = {}) {
  const params = new URLSearchParams()
  if (input.query?.trim()) params.set('q', input.query.trim())
  if (input.flow) params.set('fluxo', input.flow)
  const query = params.toString()
  return requestJson<{ etiquetas: PrintedReceipt[] }>(`/api/etiquetas/rec-impresso${query ? `?${query}` : ''}`)
}

export async function loadReceiptIdentifications(input: {
  query?: string
  flow?: LogisticsFlow
  showHidden?: boolean
  withoutMp?: boolean
} = {}) {
  const params = new URLSearchParams()
  if (input.query?.trim()) params.set('q', input.query.trim())
  if (input.showHidden) params.set('mostrar_ocultos', '1')
  if (input.withoutMp) params.set('sem_mp', '1')
  if (input.flow) params.set('fluxo', input.flow)
  const query = params.toString()
  return requestJson<{ etiquetas: ReceiptIdentification[]; filtro: string }>(
    `/api/etiquetas/recebimento/pendentes${query ? `?${query}` : ''}`,
  )
}

export async function loadIdentificationPhoto(code: string) {
  const response = await requestJson<{ fotos?: IdentificationPhoto[] }>(
    `/api/produtos/${encodeURIComponent(code)}/fotos`,
  )
  return (response.fotos || []).find((photo) => Boolean(photo.url_imagem))?.url_imagem || null
}

export async function setReceiptIdentificationHidden(id: number, hidden: boolean) {
  return requestJson<{ ok: true; id: number; oculto: boolean; codigo_produto: string | null }>(
    `/api/etiquetas/recebimento/${id}/oculto`,
    { method: 'PATCH', body: JSON.stringify({ oculto: hidden }) },
  )
}

export async function reopenReceiptIdentification(id: number) {
  return requestJson<{ ok: true; id: number; impressa: false }>(
    `/api/etiquetas/recebimento/${id}/reimprimir`,
    { method: 'PATCH' },
  )
}

export async function deleteReceiptIdentification(id: number) {
  return requestJson<{ ok: true; identificacao: ReceiptIdentification }>(
    `/api/etiquetas/recebimento/${id}/identificacao`,
    { method: 'DELETE' },
  )
}

export async function loadWarehouseLocations() {
  const response = await requestJson<{ ok: boolean; locais: WarehouseLocation[] }>('/api/armazem/locais?fonte=db')
  const active = (response.locais || []).filter(
    (location) => !location.inativo && String(location.codigo_local_estoque || '') !== '10408201806',
  )
  if (!active.some((location) => String(location.codigo_local_estoque) === defaultWarehouse.codigo_local_estoque)) {
    active.unshift(defaultWarehouse)
  }
  return active
}

export async function loadPrintedReceipt(id: number | string) {
  return requestJson<{ ok: boolean; etiqueta: PrintedReceiptDetail }>(
    `/api/etiquetas/rec-impresso/${encodeURIComponent(String(id))}`,
  )
}

export async function loadProductAddressReferences(code: string) {
  const response = await requestJson<{ ok: boolean; enderecos: ProductAddressReference[] }>(
    `/api/etiquetas/rec-impresso/enderecos-referencia-por-produto?codigo=${encodeURIComponent(code)}`,
  )
  return response.enderecos || []
}

export async function storePrintedReceipt(input: {
  id: number
  address: string
  complement?: string
  destinationCode: string
}) {
  return requestJson<{
    ok: boolean
    id: number
    id_rotulo: string | null
    endereco: string
    local_destino_codigo: string
    local_destino_nome: string
  }>(`/api/etiquetas/rec-impresso/${input.id}/endereco`, {
    method: 'PATCH',
    body: JSON.stringify({
      endereco: validateWarehouseAddress(input.address),
      complemento: input.complement?.trim() || undefined,
      local_destino_codigo: input.destinationCode,
    }),
  })
}

export async function returnPrintedReceipt(id: number, mode: 'uma' | 'todas') {
  return requestJson<{
    ok: boolean
    modo: 'uma' | 'todas'
    saldo_retornado: number
    origem_id: number
    impressos_removidos: number
    origens_consolidadas: number
  }>(`/api/etiquetas/rec-impresso/${id}/retornar`, {
    method: 'POST',
    body: JSON.stringify({ modo: mode }),
  })
}

type Agent = {
  pcName: string
  printers: string[]
  printerAliases?: Record<string, string>
}

function printerKind(value: string): PrinterOption['kind'] {
  if (value === '__PDF__') return 'pdf'
  if (value === '__BP__' || value.startsWith('__AGENT__:')) return 'agent'
  return 'cups'
}

function printerLabel(value: string, agents: Agent[]) {
  if (value === '__PDF__') return 'PDF (baixar arquivo)'
  if (value === '__BP__') return 'Agente local'
  if (value.startsWith('__AGENT__:')) {
    const raw = value.slice('__AGENT__:'.length)
    const separator = raw.indexOf(':')
    const pcName = separator >= 0 ? raw.slice(0, separator) : ''
    const printer = separator >= 0 ? raw.slice(separator + 1) : raw
    const agent = agents.find((item) => item.pcName === pcName)
    return agent?.printerAliases?.[printer]?.trim() || `${printer} (${pcName})`
  }
  return value
}

export async function loadPrinterSetup(username: string): Promise<PrinterSetup> {
  const [agentResult, cupsResult, configResult] = await Promise.allSettled([
    requestJson<{ ok: boolean; agentes: Agent[] }>('/api/etiquetas/agentes-disponiveis'),
    requestJson<{ impressoras: string[] }>('/api/etiquetas/impressoras'),
    requestJson<{ ok: boolean; config: { padrao: string | null; enabled: string[] } }>(
      `/api/etiquetas/usuario-impressoras?usuario=${encodeURIComponent(username)}`,
    ),
  ])

  const agents = agentResult.status === 'fulfilled' ? agentResult.value.agentes || [] : []
  const cups = cupsResult.status === 'fulfilled' ? cupsResult.value.impressoras || [] : []
  const config = configResult.status === 'fulfilled'
    ? configResult.value.config
    : { padrao: null, enabled: [] as string[] }
  const online = agents.flatMap((agent) =>
    (agent.printers || []).map((printer) => `__AGENT__:${agent.pcName}:${printer}`),
  )
  const configured = [config.padrao, ...(config.enabled || [])].filter((value): value is string => Boolean(value))
  const values = configured.length ? configured : [...online, ...cups, '__PDF__']
  const unique = [...new Set(values)]

  return {
    defaultValue: config.padrao || unique[0] || null,
    options: unique.map((value) => ({ value, label: printerLabel(value, agents), kind: printerKind(value) })),
  }
}

function parseAgentDestination(value: string) {
  if (!value.startsWith('__AGENT__:')) return null
  const raw = value.slice('__AGENT__:'.length)
  const separator = raw.indexOf(':')
  if (separator < 0) return null
  return { pcName: raw.slice(0, separator), printer: raw.slice(separator + 1) }
}

export type PrintResult =
  | { kind: 'queued'; quantity: number }
  | { kind: 'download'; blob: Blob; filename: string }

export async function printReceiptIdentifications(input: {
  ids: number[]
  printer: string
  username: string
}): Promise<PrintResult> {
  if (!input.ids.length) throw new LogisticsApiError('Selecione ao menos uma etiqueta.', 400)
  if (!input.printer) throw new LogisticsApiError('Escolha a impressora antes de continuar.', 400)
  if (input.printer === '__PDF__') {
    const blob = await requestBlob(
      `/api/etiquetas/recebimento/pdf-download?ids=${input.ids.join(',')}&usuario=${encodeURIComponent(input.username)}`,
    )
    return { kind: 'download', blob, filename: `etiquetas_${input.ids.join('-')}.pdf` }
  }

  const agent = parseAgentDestination(input.printer)
  if (input.printer === '__BP__' || agent) {
    const body: JsonObject = { ids: input.ids, usuario: input.username }
    if (agent) {
      body.destino_agente = agent.pcName
      body.impressora = agent.printer
    }
    const response = await requestJson<{ ok: boolean; quantidade: number }>('/api/etiquetas/fila', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { kind: 'queued', quantity: response.quantidade || input.ids.length }
  }

  const response = await requestJson<{ ok: boolean; impressas?: number; error?: string }>(
    '/api/etiquetas/recebimento/imprimir-modal',
    {
      method: 'POST',
      body: JSON.stringify({ ids: input.ids, printer: input.printer, usuario: input.username }),
    },
  )
  if (!response.ok) throw new LogisticsApiError(response.error || 'Falha ao imprimir etiqueta(s).')
  return { kind: 'queued', quantity: response.impressas || input.ids.length }
}

export async function printSplitReceiptIdentification(input: {
  id: number
  multiple: number
  printer: string
  username: string
}): Promise<PrintResult> {
  if (!(input.multiple > 0)) throw new LogisticsApiError('Informe um múltiplo válido (> 0).', 400)
  if (!input.printer) throw new LogisticsApiError('Escolha a impressora antes de continuar.', 400)
  if (input.printer === '__PDF__') {
    const blob = await requestBlob(
      `/api/etiquetas/recebimento/pdf-download?ids=${input.id}&multiplo=${input.multiple}&usuario=${encodeURIComponent(input.username)}`,
    )
    return { kind: 'download', blob, filename: `etiqueta_${input.id}_multiplo${input.multiple}.pdf` }
  }

  const agent = parseAgentDestination(input.printer)
  if (input.printer === '__BP__' || agent) {
    const body: JsonObject = { ids: [input.id], multiplo: input.multiple, usuario: input.username }
    if (agent) {
      body.destino_agente = agent.pcName
      body.impressora = agent.printer
    }
    const response = await requestJson<{ ok: boolean; quantidade: number }>('/api/etiquetas/fila', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { kind: 'queued', quantity: response.quantidade || 1 }
  }

  const response = await requestJson<{ ok: boolean; impressas: number; error?: string }>(
    '/api/etiquetas/recebimento/imprimir-multiplo',
    {
      method: 'POST',
      body: JSON.stringify({
        id: input.id,
        multiplo: input.multiple,
        printer: input.printer,
        usuario: input.username,
      }),
    },
  )
  if (!response.ok) throw new LogisticsApiError(response.error || 'Falha ao gerar etiquetas.')
  return { kind: 'queued', quantity: response.impressas || 1 }
}

export async function reprintPrintedReceipt(input: {
  id: number
  format: 'pequena' | 'grande'
  printer: string
  username: string
}) {
  if (!input.printer || input.printer === '__PDF__') {
    throw new LogisticsApiError('Escolha uma impressora física para reimprimir a ETQ.', 400)
  }
  const agent = parseAgentDestination(input.printer)
  const body: JsonObject = {
    ids: [input.id],
    usuario: input.username,
    via_fila: true,
    formato: input.format,
  }
  if (agent) {
    body.destino_agente = agent.pcName
    body.impressora = agent.printer
  } else if (input.printer !== '__BP__') {
    body.printer = input.printer
    body.via_fila = false
  }
  return requestJson<{ ok: boolean; quantidade: number; fila_id?: number; via: string }>(
    '/api/etiquetas/rec-impresso/imprimir-ids',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export function warehouseLocationLabel(location: WarehouseLocation) {
  const shortCode = String(location.codigo || '').trim()
  const description = String(location.descricao || '').trim()
  if (shortCode && description) return `${shortCode} — ${description}`
  return description || shortCode || location.codigo_local_estoque
}
