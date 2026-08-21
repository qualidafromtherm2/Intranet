export type SacShippingStatus = "Pendente" | "Enviado" | "Excluído" | string

export interface SacShippingItem {
  conteudo: string
  quantidade: number | string
}

export interface SacShippingRequest {
  id: number
  created_at?: string | null
  usuario?: string | null
  observacao?: string | null
  numero_sep?: string | null
  rastreio_status?: SacShippingStatus | null
  identificacao?: string | null
  conteudo?: string | SacShippingItem[] | null
  etiqueta_url?: string | null
  declaracao_url?: string | null
  anexos?: string[] | null
  id_vipp?: string | null
  metodo_envio?: string | null
  id_at?: number | null
  sep_status?: string | null
  sla_limite_em?: string | null
}

export interface SacShippingListResponse {
  ok: true
  rows: SacShippingRequest[]
}

export interface StrongConfirmation {
  confirmed: boolean
  phrase: string
}
