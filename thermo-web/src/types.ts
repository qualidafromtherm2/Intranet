export type DataMode = 'demo' | 'proxy'

export interface ProductListItem {
  codigo_produto: number
  codigo_produto_integracao: string | null
  codigo: string
  descricao: string
  descricao_familia: string | null
  unidade: string | null
  tipoitem: string | null
  ncm: string | null
  valor_unitario: number | null
  quantidade_estoque: number | null
  estoque_minimo: number
  saldo_almox: number
  saldo_expedicao: number
  saldo_enderecado: number
  abaixo_minimo: boolean
  estoque_negativo: boolean
  expedicao_negativa: boolean
  saldo_endereco_sem_omie: boolean
  saldo_divergente_endereco: boolean
  diferenca_saldo_endereco: number
  item_limitado: boolean
  inativo: string | null
  bloqueado: string | null
  marca: string | null
  modelo: string | null
  dalt: number | null
  halt: number | null
  dinc: number | null
  hinc: number | null
  primeira_imagem: string | null
}

export interface ProductListResponse {
  total: number
  page: number
  limit: number
  itens: ProductListItem[]
}

export interface ProductPurchaseFlag {
  codigo: string
  status: string
}

export interface ProductPurchaseResponse {
  ok: boolean
  total: number
  itens: ProductPurchaseFlag[]
}

export interface CartItem {
  id: number
  produto_codigo: string
  produto_descricao: string
  quantidade: number
  prazo_solicitado: string | null
  familia_produto: string | null
  observacao: string | null
  departamento: string | null
  centro_custo: string | null
  objetivo_compra: string | null
  responsavel_pela_compra: string | null
  retorno_cotacao: string | null
  grupo_requisicao: string | null
  created_at: string | null
}

export interface CartResponse {
  ok: boolean
  itens: CartItem[]
}

export interface InventoryLocation {
  local_codigo: string
  local_nome: string
  codigos: string[]
  total: number
}

export interface InventoryLocationsResponse {
  ok: boolean
  locais: InventoryLocation[]
}

export interface ProductStreamEvent {
  type: string
  codigo?: string
  message?: string
  progress?: number
}

export interface PilotPermissions {
  canRequestPurchase: boolean
  canViewPurchaseFlow: boolean
  canEditCatalog: boolean
}

export interface PilotUserContext {
  displayName: string
  roleLabel: string
  permissions: PilotPermissions
}

export type InventoryHealth =
  | 'normal'
  | 'abaixo-minimo'
  | 'estoque-negativo'
  | 'expedicao-negativa'
  | 'divergente'

export interface ProductRecord extends ProductListItem {
  compraStatus: string | null
  locaisPositivos: string[]
  health: InventoryHealth
  imageUrl: string | null
}

export interface FiltersState {
  search: string
  family: string[]
  purchaseStatus: Array<'sem_compra' | 'em_compra'>
  locations: string[]
  health: InventoryHealth[]
  limitedOnly: boolean
  inactiveVisible: boolean
}

export type ViewMode = 'grid' | 'list'

export interface PilotSnapshot {
  products: ProductListResponse
  purchases: ProductPurchaseResponse
  cart: CartResponse
  locations: InventoryLocationsResponse
  user: PilotUserContext
  sseEvents: ProductStreamEvent[]
}
