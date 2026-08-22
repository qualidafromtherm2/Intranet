export type FreightProduct = {
  codigo_produto?: number
  codigo: string
  descricao: string
  unidade?: string
  altura: number
  largura: number
  profundidade: number
  peso_bruto?: number
  peso_liq?: number
  url_imagem?: string | null
  apto_simulacao: boolean
  quantidade?: number
}

export type FreightLocation = { cidade: string; uf: string; codigo_ibge?: string; transportadoras?: number }
export type FreightTable = { id: number; transportadora: string; nome?: string; versao: string; status: 'ativa' | 'em_revisao' | 'inativa'; coberturas?: number; faixas?: number; arquivo_origem?: string | null; fontes_auxiliares?: FreightTable[]; diagnostico?: { coberturas?: number; tarifas?: number; bloqueios?: string[]; alertas?: string[] } }
export type FreightPendingProduct = FreightProduct & { pendencias: string[] }
export type FreightPendingSummary = { total_pendentes: number; sem_altura: number; sem_largura: number; sem_profundidade: number; sem_peso: number; unidade_suspeita: number }
export type FreightResult = {
  tabela_id: number
  transportadora: string
  versao: string
  ok: boolean
  homologado: boolean
  tipo_resultado?: string
  motivo?: string
  valor_total?: number
  frete_peso?: number
  adicionais_detalhe?: { codigo: string; nome: string; valor: number }[]
  subtotal_sem_icms?: number
  icms_percentual?: number
  icms_valor?: number
  icms_estimado?: boolean
  icms_origem_uf?: string
  icms_destino_uf?: string
  peso_cubado_kg?: number
  peso_cobravel_kg?: number
  prazo_min_dias?: number | null
  prazo_max_dias?: number | null
}

export type FreightQuote = {
  cotacao_id?: number
  destino?: { cep?: number | null; cidade: string; uf: string }
  valor_mercadoria?: number
  romaneio?: { volumes: number; peso_real_kg: number; volume_m3: number }
  resultados: FreightResult[]
  avisos?: string[]
}

export type FreightRecent = {
  id: number; criado_em: string; destino_cep?: number | null; destino_cidade: string; destino_uf: string
  valor_mercadoria: number; peso_real_kg: number; volume_m3: number; itens: number
  melhor_valor?: number | null; melhor_previa?: number | null
}
