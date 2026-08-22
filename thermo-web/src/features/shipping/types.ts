export type ShippingStatus = 'Pendente' | 'Enviado'

export interface ShippingItem {
  conteudo?: string
  descricao?: string
  quantidade?: number | string
  codigo?: string
}

export interface ShippingRecord {
  id: number
  created_at?: string | null
  usuario?: string | null
  observacao?: string | null
  numero_sep?: string | null
  sep_status?: string | null
  rastreio_status?: string | null
  identificacao?: string | null
  etiqueta_url?: string | null
  declaracao_url?: string | null
  conteudo?: string | ShippingItem[] | null
  id_vipp?: string | null
  metodo_envio?: string | null
  sla_limite_em?: string | null
  valor_envio?: number | string | null
}

export interface ShippingMetrics {
  meta_hoje?: number
  pendentes?: number
  atrasados?: number
  enviados_hoje?: number
  sla_percentual_7d?: number
  mediana_horas_7d?: number
  media_horas_7d?: number
}

export interface ShippingExecutorMetric {
  executor?: string
  usuario?: string
  total?: number
}

export interface ShippingQueueResponse {
  ok: boolean
  rows: ShippingRecord[]
  metricas?: ShippingMetrics
  por_executor?: ShippingExecutorMetric[]
}

export interface ShippingMutationResponse {
  ok: boolean
  rastreio_status?: string
  ectCode?: string
  valor_envio?: number | null
}
