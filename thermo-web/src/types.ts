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

export interface ProductPurchaseDetailItem {
  id: number
  produto_codigo: string
  produto_descricao: string | null
  quantidade: number | null
  status: string | null
  solicitante: string | null
  responsavel_pela_compra: string | null
  fornecedor_nome: string | null
  numero_pedido: string | null
  c_numero: string | null
  grupo_requisicao: string | null
  prazo_solicitado: string | null
  previsao_chegada: string | null
  departamento: string | null
  objetivo_compra: string | null
  observacao: string | null
  created_at: string | null
}

export interface ProductPurchaseDetailResponse {
  ok: boolean
  codigo: string
  total: number
  compras: ProductPurchaseDetailItem[]
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
  local_codigo: string | null
  local_nome: string | null
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

export interface AuthUser {
  id: string
  username: string
  roles: string[]
  setor: string | null
  sector_id: number | null
  foto_perfil_url?: string | null
  conta_google?: string | null
  email?: string | null
  telefone?: string | null
  funcao_nome?: string | null
}

export interface AuthStatusResponse {
  loggedIn: boolean
  user: AuthUser | null
}

export interface AuthLoginResponse {
  ok: boolean
  user: AuthUser
}

export interface PermissionNode {
  id: number
  parent_id: number | null
  key: string
  label: string
  pos: string | null
  sort: number | null
  allowed: boolean
  user_override: boolean | null
  selector: string | null
}

export interface PermissionTreeResponse {
  userId: string
  nodes: PermissionNode[]
}

export type AppView = 'home' | 'products'

export interface ShellAction {
  id: string
  title: string
  description: string
  selector?: string
  view: 'products' | 'legacy'
  legacyPath?: string
  legacyHint?: string
}

export interface ShellArea {
  id: string
  title: string
  description: string
  accent: string
  actions: ShellAction[]
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

export interface ProductLocationRef {
  codigo: string
  nome: string
}

export interface ProductRecord extends ProductListItem {
  compraStatus: string | null
  purchaseState: 'sem_compra' | 'em_compra'
  origemCodigo: 'N' | 'I' | null
  tipoCodigo: string | null
  imageUrl: string | null
  locaisPositivos: ProductLocationRef[]
  isInactive: boolean
  isObsolete: boolean
  isEngineering: boolean
}

export interface ProductFilterOption {
  value: string
  label: string
  count: number
}

export interface FiltersState {
  search: string
  families: string[]
  typeItems: string[]
  origins: Array<'N' | 'I'>
  purchaseStatus: Array<'sem_compra' | 'em_compra'>
  locationCodes: string[]
  showInactive: boolean
  hideObsolete: boolean
  hideEngineering: boolean
  semEstoqueMin: boolean
  abaixoEstoqueMin: boolean
  acimaEstoqueMin: boolean
  proximoEstoqueMin: boolean
  proximoPercent: number
  estoqueNegativo: boolean
  expedicaoNegativa: boolean
  saldoEnderecoSemOmie: boolean
  saldoDivergenteEndereco: boolean
}

export interface ProductFiltersMeta {
  families: ProductFilterOption[]
  typeItems: ProductFilterOption[]
  locations: ProductFilterOption[]
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
