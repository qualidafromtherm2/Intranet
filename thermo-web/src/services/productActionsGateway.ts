import type { AuthUser, PermissionNode, ProductRecord } from '../types'
import { getAuthStatus, getPermissionTree } from './authGateway'

export type ProductActionKey =
  | 'purchase'
  | 'separation'
  | 'movement'
  | 'dispatch'
  | 'information'
  | 'quickEdit'
  | 'latestPurchases'
  | 'addresses'
  | 'movementHistory'
  | 'stockAudit'
  | 'manualReceipt'
  | 'identificationHistory'
  | 'manuals'

export type ProductActionAccess = Record<ProductActionKey, boolean> & {
  reasons: Partial<Record<ProductActionKey, string>>
}

export interface ProductActionPermissionFallback {
  canOpenCart: boolean
  canOpenSeparation: boolean
  canEditCatalog: boolean
  cartReason: string | null
  separationReason: string | null
}

export interface ProductActionContext {
  user: AuthUser
  nodes: PermissionNode[]
  access: ProductActionAccess
}

export interface ProductMultipleResponse {
  ok: boolean
  codigo: string
  multiplo: number | null
}

export interface ProductDetail {
  codigo?: string
  codigo_produto?: number | string | null
  descricao?: string | null
  unidade?: string | null
  descricao_familia?: string | null
  marca?: string | null
  modelo?: string | null
  ncm?: string | null
  estoque_minimo?: number | string | null
  lead_time?: number | string | null
  altura?: number | string | null
  largura?: number | string | null
  profundidade?: number | string | null
  peso_bruto?: number | string | null
  peso_liq?: number | string | null
  item_limitado?: boolean | string | null
  [key: string]: unknown
}

export interface QuickEditPayload {
  descricao: string
  estoque_minimo: number
  lead_time: number
  altura: number
  largura: number
  profundidade: number
  peso_bruto: number
}

export type ProductMarker = 'OBSOLETO' | 'ENGENHARIA'

export interface ProductPurchaseHistoryItem {
  d_rec: string | null
  c_nome_fornecedor: string | null
  c_numero_nfe: string | null
  c_chave_nfe: string | null
  n_qtde_nfe: number | null
  n_preco_unit: number | null
  v_total_item: number | null
}

export interface ProductManualItem {
  nome: string
  url: string
  path?: string | null
  anexado_em?: string | null
}

export interface ProductAddressItem {
  endereco: string
  saldo: number
  unidade?: string | null
  registros?: number | null
}

export interface ProductAddressesResponse {
  ok: boolean
  produto?: { codigo?: string; descricao?: string; unidade?: string }
  enderecos: ProductAddressItem[]
}

export interface StockAuditResponse {
  ok: boolean
  divergente: boolean
  ajuste_necessario: number
  saldo_omie?: number
  saldo_enderecado?: number
  produto?: { codigo?: string; descricao?: string; unidade?: string }
  enderecos: ProductAddressItem[]
}

export interface IdentificationHistoryItem {
  id: number
  id_rotulo: string | null
  codigo_produto: string
  descricao_produto: string
  qtd: number
  unidade: string
  lote: string
  endereco: string
  complemento: string
  numero_nfe: string
  numero_pedido: string
  fornecedor: string
  data_emissao: string
  impresso_em: string | null
  usuario_criacao: string
  fonte: string
}

export interface PrinterOption {
  value: string
  label: string
  destino_agente: string
  impressora: string
}

export interface WarehouseLocation {
  codigo_local_estoque: string | number
  descricao?: string | null
  inativo?: boolean | null
}

export interface MovementPermissionRule {
  origem_local_codigo?: string | null
  origem_local_codigos?: string[] | null
}

export interface MovementRequest {
  kind: 'ENT' | 'SAI' | 'TRF'
  source?: string
  destination?: string
  quantity: number
  reason: 'INV' | 'INI' | 'PER' | 'TRF' | 'TPQ'
  note?: string
}

const normalizeProfile = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

const hasAllowedKey = (nodes: PermissionNode[], key: string) =>
  nodes.some((node) => node.key === key && node.allowed === true)

export function deriveProductActionAccess(
  user: AuthUser,
  nodes: PermissionNode[],
  fallback: ProductActionPermissionFallback,
): ProductActionAccess {
  const roles = (user.roles || []).map(normalizeProfile)
  const username = normalizeProfile(user.username)
  const sector = normalizeProfile(user.setor)
  const job = normalizeProfile(user.funcao_nome)
  const isAdmin = roles.includes('admin')
  const reasons: ProductActionAccess['reasons'] = {}

  const purchase = hasAllowedKey(nodes, 'system-shortcut:compras-carrinho') || fallback.canOpenCart
  const separation = hasAllowedKey(nodes, 'system-shortcut:separacao-carrinho') || fallback.canOpenSeparation
  const dispatch = hasAllowedKey(nodes, 'side:log:envio-mercadoria')
  const quickEdit =
    hasAllowedKey(nodes, 'top:produto') ||
    hasAllowedKey(nodes, 'side:rh:epi') ||
    fallback.canEditCatalog ||
    isAdmin ||
    sector === 'rh' ||
    sector.includes('recursos humanos')
  const movement =
    job.includes('supervisor') &&
    (job.includes('logistica') || job.includes('qualidade') || sector.includes('logistica') || sector.includes('qualidade'))
  const addresses = sector.includes('logistica')
  const auditUsers = new Set(['denis.m', 'alexsandro.j', 'eduardo6760', 'jair.r', 'leandro.s'])
  const audit = auditUsers.has(username)

  if (!purchase) reasons.purchase = fallback.cartReason || 'Seu usuário não possui permissão para solicitar compras.'
  if (!separation) reasons.separation = fallback.separationReason || 'Seu usuário não possui permissão para solicitar separação.'
  if (!dispatch) reasons.dispatch = 'Seu usuário não possui permissão para realizar expedições.'
  if (!quickEdit) reasons.quickEdit = 'Seu usuário não possui permissão para editar produtos.'
  if (!movement) reasons.movement = 'Somente os supervisores de Logística e Qualidade podem movimentar produtos.'
  if (!addresses) reasons.addresses = 'Somente o setor de Logística pode gerenciar endereços de produtos.'
  if (!audit) {
    reasons.movementHistory = 'Seu usuário não possui permissão para auditar movimentações de produtos.'
    reasons.stockAudit = 'Seu usuário não possui permissão para auditar saldos endereçados.'
  }

  return {
    purchase,
    separation,
    movement,
    dispatch,
    information: true,
    quickEdit,
    latestPurchases: true,
    addresses,
    movementHistory: audit,
    stockAudit: audit,
    manualReceipt: true,
    identificationHistory: true,
    manuals: true,
    reasons,
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'include',
      cache: init?.method ? undefined : 'no-store',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body instanceof FormData ? {} : init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
    })
  } catch (error) {
    throw new Error(`Não foi possível acessar ${path}. ${error instanceof Error ? error.message : ''}`.trim())
  }

  const raw = await response.text()
  let data: unknown = {}
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      data = { error: raw }
    }
  }

  if (!response.ok) {
    const body = data as { error?: string; detail?: string; faultstring?: string }
    throw new Error(body.error || body.detail || body.faultstring || `Falha em ${path} (HTTP ${response.status}).`)
  }

  return data as T
}

const jsonBody = (body: Record<string, unknown>) => JSON.stringify(body)

export async function loadProductActionContext(fallback: ProductActionPermissionFallback) {
  const [auth, tree] = await Promise.all([getAuthStatus(), getPermissionTree()])
  if (!auth.loggedIn || !auth.user) throw new Error('Sessão não autenticada no backend legado.')
  return {
    user: auth.user,
    nodes: tree.nodes || [],
    access: deriveProductActionAccess(auth.user, tree.nodes || [], fallback),
  } satisfies ProductActionContext
}

export async function addProductToCart(product: ProductRecord, quantidade: number) {
  return requestJson<{ ok: boolean; id: number; grupo_requisicao?: string | null }>('/api/compras/carrinho', {
    method: 'POST',
    body: jsonBody({
      produto_codigo: product.codigo,
      produto_descricao: product.descricao,
      quantidade,
      prazo_solicitado: null,
      familia_nome: product.descricao_familia || null,
      observacao: '',
      departamento: '',
      centro_custo: '',
      codigo_produto_omie: null,
      codigo_omie: product.codigo_produto || null,
      url_imagem: product.primeira_imagem || null,
      objetivo_compra: '',
      resp_inspecao_recebimento: '',
      retorno_cotacao: 'Não',
      categoria_compra: '2.14.94',
      categoria_compra_codigo: '2.14.94',
      categoria_compra_nome: '2.14.94 - Outros Materiais',
      grupo_requisicao: null,
      np: null,
      requisicao_direta: false,
    }),
  })
}

export async function requestSeparation(product: ProductRecord, quantidade: number) {
  return requestJson<{ ok: boolean; merged?: boolean; item?: unknown }>('/api/logistica/separacao', {
    method: 'POST',
    body: jsonBody({
      codigo: product.codigo,
      descricao: product.descricao,
      quantidade,
      unidade: String(product.unidade || 'UN').toUpperCase(),
    }),
  })
}

export const loadProductMultiple = (codigo: string) =>
  requestJson<ProductMultipleResponse>(`/api/produtos/${encodeURIComponent(codigo)}/multiplo`)

export const saveProductMultiple = (codigo: string, multiplo: number) =>
  requestJson<ProductMultipleResponse>(`/api/produtos/${encodeURIComponent(codigo)}/multiplo`, {
    method: 'PUT',
    body: jsonBody({ multiplo }),
  })

export const loadProductDetail = (codigo: string) =>
  requestJson<ProductDetail>(`/api/produtos/${encodeURIComponent(codigo)}`)

function validateOmieResponse(data: Record<string, unknown>) {
  const message = data.faultstring || data.error
  if (!message) return
  if (typeof message === 'string') {
    try {
      const parsed = JSON.parse(message) as { faultstring?: string; message?: string }
      throw new Error(parsed.faultstring || parsed.message || message)
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(message)
      throw error
    }
  }
  throw new Error('A Omie recusou a alteração.')
}

export async function saveQuickEdit(product: ProductRecord, current: ProductDetail, values: QuickEditPayload) {
  const productId = Number(product.codigo_produto)
  if (!Number.isFinite(productId) || productId <= 0) throw new Error('Produto sem ID numérico da Omie.')

  const changedProduct =
    values.descricao !== String(current.descricao || product.descricao).trim() ||
    values.lead_time !== Number(current.lead_time || 0) ||
    values.altura !== Number(current.altura || 0) ||
    values.largura !== Number(current.largura || 0) ||
    values.profundidade !== Number(current.profundidade || 0) ||
    values.peso_bruto !== Number(current.peso_bruto ?? current.peso_liq ?? 0)
  const changedMinimum = values.estoque_minimo !== Number(current.estoque_minimo || 0)

  if (changedProduct) {
    const omie = await requestJson<Record<string, unknown>>('/api/produtos/alterar', {
      method: 'POST',
      body: jsonBody({
        produto_servico_cadastro: {
          codigo_produto: productId,
          codigo: product.codigo,
          descricao: values.descricao,
          lead_time: values.lead_time,
          altura: values.altura,
          largura: values.largura,
          profundidade: values.profundidade,
          peso_bruto: values.peso_bruto,
        },
      }),
    })
    validateOmieResponse(omie)
  }

  if (changedMinimum) {
    const minimum = await requestJson<{ ok: boolean; error?: string }>('/api/omie/estoque/minimo-produto', {
      method: 'POST',
      body: jsonBody({ id_prod: productId, codigo: product.codigo, quan_min: values.estoque_minimo }),
    })
    if (!minimum.ok) throw new Error(minimum.error || 'Falha ao alterar estoques mínimos.')
  }

  const local = await requestJson<{ success: boolean; error?: string }>(`/api/produtos/${encodeURIComponent(product.codigo)}`, {
    method: 'PUT',
    body: jsonBody({ ...values }),
  })
  if (!local.success) throw new Error(local.error || 'Alterado na Omie, mas falhou ao atualizar o banco local.')
  return local
}

export async function zeroProductMinimumEverywhere(product: ProductRecord) {
  const productId = Number(product.codigo_produto)
  if (!Number.isFinite(productId) || productId <= 0) throw new Error('Produto sem ID numérico da Omie.')
  const result = await requestJson<{ ok: boolean; error?: string; locais_atualizados?: number }>('/api/omie/estoque/minimo-produto', {
    method: 'POST',
    body: jsonBody({ id_prod: productId, codigo: product.codigo, quan_min: 0 }),
  })
  if (!result.ok) throw new Error(result.error || 'Falha ao zerar os estoques mínimos.')
  return result
}

export const setProductLimited = (codigo: string, item_limitado: boolean) =>
  requestJson<{ ok: boolean; codigo: string; item_limitado: boolean }>(`/api/produtos/${encodeURIComponent(codigo)}/item-limitado`, {
    method: 'PUT',
    body: jsonBody({ item_limitado }),
  })

export function applyProductMarker(description: string, marker: ProductMarker) {
  const clean = String(description || '').trim().replace(/^(OBSOLETO|ENGENHARIA)\s*-\s*/i, '')
  return `${marker} - ${clean}`
}

export async function uploadProductPhoto(product: ProductRecord, file: File, description: string) {
  const form = new FormData()
  form.append('foto', file)
  form.append('nome_foto', file.name || 'Foto principal')
  form.append('descricao_foto', description || product.descricao || 'Foto do produto')
  return requestJson<{ url?: string; detail?: string; error?: string }>(
    `/api/produtos/${encodeURIComponent(product.codigo)}/fotos?pos=0`,
    { method: 'POST', body: form },
  )
}

export const loadLatestPurchases = (codigoProdutoOmie: number | string) =>
  requestJson<{ itens: ProductPurchaseHistoryItem[] }>(
    `/api/produtos/ultimas-compras?codigo_produto=${encodeURIComponent(String(codigoProdutoOmie))}`,
  )

export const loadProductManuals = (codigo: string) =>
  requestJson<{ ok: boolean; manuais: ProductManualItem[] }>(`/api/produtos/${encodeURIComponent(codigo)}/manuais`)

export async function uploadProductManual(codigo: string, nome: string, arquivo: File) {
  const form = new FormData()
  form.append('nome', nome)
  form.append('arquivo', arquivo)
  return requestJson<{ ok: boolean; manual?: ProductManualItem }>(`/api/produtos/${encodeURIComponent(codigo)}/manuais`, {
    method: 'POST',
    body: form,
  })
}

export const removeProductManual = (codigo: string, index: number) =>
  requestJson<{ ok: boolean }>(`/api/produtos/${encodeURIComponent(codigo)}/manuais/${index}`, { method: 'DELETE' })

export const loadProductAddresses = (codigo: string) =>
  requestJson<ProductAddressesResponse>(`/api/logistica/produtos/${encodeURIComponent(codigo)}/enderecos`)

export const moveProductAddress = (codigo: string, origem: string, destino: string, quantidade?: number) =>
  requestJson<{ ok: boolean; saldo_movido?: number }>(`/api/logistica/produtos/${encodeURIComponent(codigo)}/enderecos`, {
    method: 'PATCH',
    body: jsonBody({ origem, destino, ...(quantidade == null ? {} : { quantidade }) }),
  })

export function buildBoxAddress(origin: string, boxCode: string) {
  const prefix = String(origin || '').trim().toUpperCase().split('-').slice(0, 3).join('-')
  const box = String(boxCode || '').trim().toUpperCase()
  if (!/^[A-Z]\d{2}$/.test(box)) throw new Error('Informe o código da caixa com uma letra e dois números, por exemplo P01.')
  const destination = `${prefix}-${box}`
  if (!/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z]\d{2}$/.test(destination)) throw new Error('O endereço de origem não possui corredor, nível e posição válidos.')
  return destination
}

export const changeProductBox = (codigo: string, origem: string, boxCode: string) =>
  moveProductAddress(codigo, origem, buildBoxAddress(origem, boxCode))

export const deleteProductAddress = (codigo: string, endereco: string) =>
  requestJson<{ ok: boolean }>(`/api/logistica/produtos/${encodeURIComponent(codigo)}/enderecos`, {
    method: 'DELETE',
    body: jsonBody({ endereco }),
  })

export const loadStockAudit = (codigo: string) =>
  requestJson<StockAuditResponse>(`/api/logistica/produtos/${encodeURIComponent(codigo)}/auditoria-saldo-endereco`)

export const applyStockAudit = (codigo: string, endereco: string, justificativa: string) =>
  requestJson<{ ok: boolean; depois: StockAuditResponse }>(
    `/api/logistica/produtos/${encodeURIComponent(codigo)}/auditoria-saldo-endereco/ajustar`,
    { method: 'POST', body: jsonBody({ endereco, justificativa }) },
  )

export const loadLatestManualReceiptReason = (codigo: string) =>
  requestJson<{ ok?: boolean; motivo?: string | null }>(
    `/api/etiquetas/recebimento/manual/ultimo-motivo?codigo_produto=${encodeURIComponent(codigo)}`,
  )

export const createManualReceipt = (
  product: ProductRecord,
  input: { qtd: number; unidade: string; nfe: string; pedido: string; motivo: string; usuario?: string },
) =>
  requestJson<{ ok: boolean; id: number; destino: 'identificacao' | 'pir' | string }>('/api/etiquetas/recebimento/manual', {
    method: 'POST',
    body: jsonBody({
      codigo_produto: product.codigo,
      descricao_produto: product.descricao,
      qtd: input.qtd,
      unidade: input.unidade,
      nfe: input.nfe || undefined,
      pedido: input.pedido || undefined,
      motivo: input.motivo,
      usuario: input.usuario,
    }),
  })

export const loadIdentificationHistory = (codigo: string) =>
  requestJson<{ ok: boolean; total: number; etiquetas: IdentificationHistoryItem[] }>(
    `/api/etiquetas/rec-impresso/historico-por-produto?codigo=${encodeURIComponent(codigo)}`,
  )

export async function loadPrinterOptions(): Promise<PrinterOption[]> {
  const data = await requestJson<{
    agentes?: Array<{ pcName?: string; printers?: string[]; printerAliases?: Record<string, string> }>
  }>('/api/etiquetas/agentes-disponiveis')
  return (data.agentes || []).flatMap((agent) =>
    (agent.printers || []).map((printer) => ({
      value: `${agent.pcName || ''}\u0000${printer}`,
      label: `${agent.printerAliases?.[printer] || printer}${agent.pcName ? ` · ${agent.pcName}` : ''}`,
      destino_agente: agent.pcName || '',
      impressora: printer,
    })),
  )
}

export const reprintIdentification = (
  id: number,
  usuario: string,
  formato: 'pequeno' | 'grande',
  printer: PrinterOption,
) =>
  requestJson<{ ok: boolean }>('/api/etiquetas/rec-impresso/imprimir-ids', {
    method: 'POST',
    body: jsonBody({
      ids: [id],
      usuario,
      via_fila: true,
      formato,
      destino_agente: printer.destino_agente,
      impressora: printer.impressora,
    }),
  })

export const loadMovementHistory = (product: ProductRecord) => {
  const query = product.codigo_produto
    ? `id_prod=${encodeURIComponent(String(product.codigo_produto))}`
    : `codigo=${encodeURIComponent(product.codigo)}`
  return requestJson<{
    ok: boolean
    periodo?: { de?: string; ate?: string }
    ajuste_estoque_lista?: Array<Record<string, unknown>>
    saldos_atuais?: Array<{ local_codigo: string; local_nome: string; saldo: number }>
  }>(`/api/ajustes/historico-omie?${query}`)
}

export type MovementCategory = 'receiving' | 'separation' | 'transfer' | 'adjustment'

export function classifyMovement(row: Record<string, unknown>): MovementCategory {
  const type = String(row.tipo || '').toUpperCase()
  const source = String(row.origem || '').toUpperCase()
  const text = `${row.obs || ''} ${row.motivo || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\bsep(?:-|\s)|separacao|saida por separacao/.test(text)) return 'separation'
  if (/nfe|nf-e|nota fiscal|recebimento|fornecedor|entrada sem/.test(text) || source === 'NFE') return 'receiving'
  if (type === 'TRF') return 'transfer'
  return 'adjustment'
}

export function reconcileMovementBalances(
  rows: Array<Record<string, unknown>>,
  official: Array<{ local_codigo: string; saldo: number }>,
) {
  const current = new Map(official.map((item) => [String(item.local_codigo), Number(item.saldo || 0)]))
  return rows.map((row) => {
    const type = String(row.tipo || '').toUpperCase()
    const source = String(row.codigo_local_estoque || row.local_codigo || row.origem || '').trim()
    const destination = String(row.codigo_local_estoque_destino || row.local_destino_codigo || row.destino || '').trim()
    const quantity = Math.abs(Number(row.quantidade ?? row.qtd ?? row.quan) || 0)
    const describe = (code: string, before: number, after: number) => `${code || 'Local'}: ${before} → ${after}`
    const details: string[] = []
    if (type === 'TRF' && source && destination) {
      const sourceAfter = current.get(source) ?? 0
      const destinationAfter = current.get(destination) ?? 0
      details.push(describe(source, sourceAfter + quantity, sourceAfter), describe(destination, destinationAfter - quantity, destinationAfter))
      current.set(source, sourceAfter + quantity)
      current.set(destination, destinationAfter - quantity)
    } else if (source) {
      const after = current.get(source) ?? 0
      const before = type === 'ENT' ? after - quantity : after + quantity
      details.push(describe(source, before, after))
      current.set(source, before)
    }
    return details.join(' | ')
  })
}

export async function loadMovementSetup(product: ProductRecord) {
  const [locations, permission, stock] = await Promise.all([
    requestJson<{ ok: boolean; locais: WarehouseLocation[]; fonte?: string }>('/api/armazem/locais'),
    requestJson<{ ok: boolean; regra: MovementPermissionRule | null }>('/api/movimentacoes/permissao-atual'),
    requestJson<{ dados?: Record<string, Array<Record<string, unknown>>> }>(
      `/api/logistica/estoque/batch?codigos=${encodeURIComponent(product.codigo)}`,
    ),
  ])
  return {
    locations: (locations.locais || []).filter((location) => !location.inativo),
    permission: permission.regra,
    stock: stock.dados?.[product.codigo] || [],
  }
}

async function loadCost(product: ProductRecord, local: string) {
  const data = await requestJson<{ dados?: Array<{ codigo?: string; cmc?: number | string | null }> }>(
    `/api/logistica/estoque?local=${encodeURIComponent(local)}&q=${encodeURIComponent(product.codigo)}`,
  )
  const row = (data.dados || []).find((item) => String(item.codigo || '').trim() === product.codigo.trim())
  const cost = Number(row?.cmc)
  return Number.isFinite(cost) && cost > 0 ? cost : null
}

export async function executeMovement(product: ProductRecord, user: AuthUser, input: MovementRequest) {
  const solicitante = String(user.username || user.id || '').trim()
  if (!solicitante) throw new Error('Não foi possível identificar o usuário logado.')
  const date = new Date().toISOString().slice(0, 10)
  const source = String(input.source || '').trim()
  const destination = String(input.destination || '').trim()

  if (input.kind === 'TRF') {
    if (!source || !destination) throw new Error('Selecione a origem e o destino.')
    if (source === destination) throw new Error('Origem e destino precisam ser diferentes.')
    const cmc = await loadCost(product, source)
    const created = await requestJson<{ ok: boolean; registros?: Array<{ id?: number }> }>('/api/transferencias', {
      method: 'POST',
      body: jsonBody({
        origem: source,
        destino: destination,
        data_movimentacao: date,
        solicitante,
        itens: [{
          codigo: product.codigo,
          descricao: product.descricao,
          qtd: input.quantity,
          cmc,
          codigo_produto: product.codigo_produto || null,
          codOmie: product.codigo_produto || null,
        }],
      }),
    })
    const id = created.registros?.[0]?.id
    if (!id) throw new Error('Solicitação criada sem identificador.')
    const approved = await requestJson<{ ok: boolean; error?: string }>(`/api/transferencias/${id}/aprovar`, {
      method: 'PATCH',
      body: jsonBody({ aprovadoPor: solicitante, motivo: input.reason, obs: input.note || null }),
    })
    if (!approved.ok) throw new Error(approved.error || 'A Omie não confirmou a transferência.')
    return { id, approved: true }
  }

  const local = input.kind === 'ENT' ? destination : source
  if (!local) throw new Error(input.kind === 'ENT' ? 'Selecione o destino.' : 'Selecione a origem.')
  const cmc = await loadCost(product, local)
  const created = await requestJson<{ ok: boolean; registros?: Array<{ id?: number }> }>('/api/ajustes', {
    method: 'POST',
    body: jsonBody({
      tipo_operacao: input.kind,
      local_estoque: local,
      data_movimentacao: date,
      solicitante,
      motivo: input.reason,
      obs: input.note || null,
      itens: [{
        codigo: product.codigo,
        descricao: product.descricao,
        qtd: input.quantity,
        cmc,
        codigo_produto: product.codigo_produto || null,
        codOmie: product.codigo_produto || null,
      }],
    }),
  })
  const id = created.registros?.[0]?.id
  if (!id) throw new Error('Solicitação criada sem identificador.')
  const approved = await requestJson<{ ok: boolean; error?: string }>(`/api/ajustes/${id}/aprovar`, {
    method: 'PATCH',
    body: jsonBody({ aprovadoPor: solicitante }),
  })
  if (!approved.ok) throw new Error(approved.error || 'A Omie não confirmou o ajuste.')
  return { id, approved: true }
}

export const executeDispatch = (product: ProductRecord, user: AuthUser, quantity: number, note: string) =>
  executeMovement(product, user, {
    kind: 'TRF',
    source: '10408747829',
    destination: '10440426539',
    quantity,
    reason: 'TRF',
    note,
  })
