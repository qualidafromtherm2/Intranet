export type ReceivingMode = 'receiving' | 'received'

export interface ReceivingNfeReference {
  numero_nfe?: string | null
  chave_nfe?: string | null
  valor_nfe?: number | string | null
}

export interface ReceivingRow {
  id: number
  n_cod_ped: number | string
  n_cod_item?: number | string | null
  cnumero: string
  etapa_nf_codigo?: string | null
  etapa_nf?: string | null
  etapa_nf_descricao?: string | null
  etapa_nf_cor?: string | null
  produto_codigo?: string | null
  produto_descricao?: string | null
  quantidade?: number | string | null
  unidade?: string | null
  valor_item?: number | string | null
  valor_total_pedido?: number | string | null
  solicitante?: string | null
  previsao_chegada?: string | null
  resp_inspecao_recebimento?: string | null
  fornecedor_nome_fantasia?: string | null
  fornecedor_razao_social?: string | null
  fornecedor_cnpj_cpf?: string | null
  fornecedor_cidade?: string | null
  fornecedor_estado?: string | null
  fornecedor_telefone1_ddd?: string | null
  fornecedor_telefone1_numero?: string | null
  nfe_vinculada?: string | null
  fornecedor_lista_numeros_nfe?: string | null
  fornecedor_lista_nfes?: ReceivingNfeReference[] | null
  observacao?: string | null
  d_inc_data?: string | null
}

export interface ReceivingOrder {
  key: string
  n_cod_ped: number | string
  cnumero: string
  rows: ReceivingRow[]
  first: ReceivingRow
}

export interface NfeDetailsResponse {
  ok: boolean
  chave_nfe: string
  source?: string
  data: {
    cabec?: Record<string, unknown>
    itensRecebimento?: Array<{ itensCabec?: Record<string, unknown>; itensAjustes?: Record<string, unknown>; [key: string]: unknown }>
    totais?: Record<string, unknown>
    [key: string]: unknown
  }
  etapa_info?: { codigo?: string; descricao?: string; descricao_customizada?: string; cor?: string } | null
  etapas_legenda?: Array<Record<string, unknown>>
}

export interface AssociationInput {
  numero_nfe?: string
  chave_nfe?: string
  numero_pedido?: string
  n_cod_ped?: number
  nova_categoria_compra?: string
  itens_override?: AssociationItemOverride[]
}

export interface AssociationItemOverride { n_sequencia: number; nIdItPedidoExistente?: number; nIdPedidoExistente?: number; nIdProdutoServico?: number; nQtde?: number; cUnidade?: string; conversaoUnidade?: boolean }
export interface AssociationPreviewItem { n_sequencia?: number; nf_codigo_produto?: string; nf_descricao_produto?: string; nf_qtde?: number; nf_unidade?: string; nf_valor_unitario?: number; pedido_item_encontrado?: boolean; requer_revisao?: boolean; criterio_match?: string; pedido_n_cod_item?: number; pedido_n_cod_ped?: number; pedido_numero?: string; pedido_codigo_produto?: string; pedido_descricao_produto?: string; pedido_qtde?: number; pedido_unidade?: string; pedido_c_unidade?: string; pedido_valor_unitario?: number; conversao_unidade_manual?: boolean; conversao_unidade_necessaria?: boolean; item_servico?: boolean; nIdProdutoServico?: number }
export interface PurchaseCategory { codigo: string; descricao?: string; conta_inativa?: string; categoria_superior?: string }

export interface ReceivingLocatorItem {
  codigo?: string | null
  descricao?: string | null
  qtd?: number | string | null
  unidade?: string | null
  vlr_unit?: number | string | null
  vlr_item?: number | string | null
  n_id_pedido?: number | null
}

export interface ReceivingLocatorOrderItem {
  n_cod_item?: number | null
  produto_codigo?: string | null
  produto_descricao?: string | null
  quantidade?: number | string | null
  unidade?: string | null
  valor_item?: number | string | null
}

export interface ReceivingLocatorOrder {
  n_cod_ped: number
  cnumero: string
  fornecedor?: string | null
  d_inc_data?: string | null
  observacao?: string | null
  itens?: ReceivingLocatorOrderItem[]
}

export interface ReceivingLocatorNfe {
  n_id_receb?: number | null
  c_chave_nfe?: string | null
  c_numero_nfe?: string | null
  c_serie_nfe?: string | null
  c_nome_fornecedor?: string | null
  c_cnpj_cpf_fornecedor?: string | null
  d_emissao_nfe?: string | null
  d_rec?: string | null
  n_valor_nfe?: number | string | null
  c_etapa?: string | null
  c_recebido?: string | null
  c_cancelada?: string | null
}

export interface LocateNfeResponse {
  ok: boolean
  nfe: ReceivingLocatorNfe
  itens: ReceivingLocatorItem[]
  pedidos_sugeridos: ReceivingLocatorOrder[]
}

export interface LocateOrderResponse { ok: boolean; pedido: ReceivingLocatorOrder }

export interface AssociationPreviewResponse {
  ok: boolean
  preview: {
    numero_nfe?: string
    n_id_receb?: number
    n_cod_ped?: number
    c_numero_pedido?: string
    fornecedor_nome?: string | null
    valor_total_nfe?: number | null
    itens_nf_total?: number
    itens_pedido_total?: number
    itens_match_total?: number
    itens_sem_match_total?: number
    categoria?: { codigo?: string; descricao?: string; inativa?: boolean } | null
    itens?: AssociationPreviewItem[]
    itens_preview?: AssociationPreviewItem[]
    itens_pedido_informativos?: AssociationPreviewItem[]
    [key: string]: unknown
  }
}

export interface AssociationMutationResponse {
  ok: boolean
  message?: string
  error?: string
  dados?: Record<string, unknown>
}
