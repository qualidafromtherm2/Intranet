export type SalesChartRow = { estado?: string; mes: string; etapa?: string; etapa_descricao?: string; familia?: string; valor_total?: number; quantidade_total?: number }
export type SalesChartDetail = { numero_pedido?: string; codigo_pedido?: string; codigo_item?: string; descricao_item?: string; cfop?: string; quantidade?: number; quantidade_total?: number; valor_total?: number; valor_total_item?: number }
export type SalesChartsData = { ok: true; rows: SalesChartRow[] }
