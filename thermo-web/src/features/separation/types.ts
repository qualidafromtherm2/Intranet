export const separationWorkflowStatuses = [
  'Solicitado',
  'Stund-by',
  'Em Separação',
  'Separado',
  'Aguardando retirada',
  'Concluído',
  'Devolvido',
] as const

export type SeparationWorkflowStatus = (typeof separationWorkflowStatuses)[number]
export type SeparationKanbanStatus = SeparationWorkflowStatus

export const separationStatusLabels: Record<SeparationWorkflowStatus, string> = {
  Solicitado: 'Solicitado',
  'Stund-by': 'Stand-by',
  'Em Separação': 'Separação',
  Separado: 'Separado',
  'Aguardando retirada': 'Aguardando retirada',
  Concluído: 'Concluído',
  Devolvido: 'Devolvido',
}

export interface RequesterKanbanResponse {
  ok: boolean
  colunas: Record<'carrinho' | 'pendente' | 'Stund-by' | 'Separação' | 'Separado' | 'Aguardando retirada' | 'Concluído' | 'Devolvido', SeparationKanbanCard[]>
  error?: string
}

export interface SeparationStockBalance { local_codigo?: string; local_nome?: string; codigo_local_estoque?: string; descricao_local_estoque?: string; saldo?: number | string; unidade?: string; bloqueado_separacao?: boolean; [key: string]: unknown }
export interface SeparationFifoId { id: number; id_rotulo?: string; endereco?: string; qtd?: number | string; unidade?: string; [key: string]: unknown }

export interface SeparationCartItem {
  id: number
  codigo_produto: string
  descricao: string | null
  unidade: string | null
  quantidade: number | string
  comentario: string | null
  urgente: boolean
  criado_em: string | null
}

export interface SeparationCartResponse {
  ok: boolean
  itens: SeparationCartItem[]
  error?: string
}

export interface SeparationKanbanCard {
  n_solic: string
  nome_user: string
  data_prevista: string | null
  horario: string | null
  total_itens: number
  criado_em_min: string | null
  item_criado_em: string | null
  usuario_separando: string | null
  itens_busca: string | null
  tem_urgente: boolean
  tem_em_compra: boolean
  tem_pendente_sem_local: boolean
  coluna: SeparationKanbanStatus
}

export type SeparationKanbanColumns = Record<SeparationKanbanStatus, SeparationKanbanCard[]>

export interface SeparationKanbanResponse {
  ok: boolean
  colunas: SeparationKanbanColumns
  error?: string
}

export interface SeparationInventoryAddress {
  id: number | string
  endereco: string | null
  completo: string | null
  qtd: number
  unidade: string
  complemento: string | null
}

export interface SeparationItem {
  carr_id: number
  solic_id: number | null
  n_solic?: string
  status: string
  observacao: string | null
  motivo: string | null
  cod_local: string | null
  nome_local: string | null
  usuario_separando: string | null
  comentario_item: string | null
  urgente: boolean
  id_user: string | number | null
  codigo_produto: string
  descricao: string | null
  unidade: string | null
  quantidade: number | string
  quantidade_solicitada: number | string | null
  quantidade_separada: number | string | null
  omie_sep_origem: string | null
  omie_sep_destino: string | null
  omie_sep_qtd: number | string | null
  etq_sep_endereco: string | null
  etq_sep_qtd: number | string | null
  etq_sep_detalhes: unknown
  data_prevista: string | null
  horario: string | null
  criado_em: string | null
  cod_omie: string | number | null
  nome_user: string
  codigo_produto_ant: string | null
  descricao_ant: string | null
  codigo_produto_novo: string | null
  descricao_novo: string | null
  endereco_pp: SeparationInventoryAddress[]
}

export interface SeparationItemsResponse {
  ok: boolean
  itens: SeparationItem[]
  itens_derivados?: SeparationItem[]
  error?: string
}

export interface ActiveUserOption {
  username: string
}

export interface ActiveUsersResponse {
  usuarios: ActiveUserOption[]
  error?: string
}

export interface SeparationStockLocation {
  codigo: string
  descricao: string
  codigo_local_estoque: string
  padrao: boolean
  inativo: boolean
}

export interface SeparationStockLocationsResponse {
  ok: boolean
  locais: SeparationStockLocation[]
  fonte: string
  error?: string
}

export interface AddSeparationCartItemInput {
  codigo: string
  descricao?: string | null
  quantidade: number
  unidade?: string | null
  origem_envio?: string | null
  origem_vipp?: string | null
}

export interface AddSeparationCartItemResponse {
  ok: boolean
  id: number
  merged: boolean
  error?: string
}

export interface SubmitSeparationInput {
  solicitado_para: string
  local_estoque: string
  local_estoque_nome: string
  data_prevista: string | null
  horario: string | null
  observacao: string | null
  item_ids?: number[]
  forcar_novo_sep?: boolean
}

export interface SubmitSeparationResponse {
  ok: boolean
  total: number
  n_solic: string
  reutilizada: boolean
  error?: string
}

export interface SeparationMutationResponse {
  ok: boolean
  error?: string
  atualizados?: number
  revertidos?: number
  concluido_direto?: number
  deleted?: number
  urgente?: boolean
  comentario?: string | null
  usuario_separando?: string
}
