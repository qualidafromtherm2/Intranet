export interface SalesOrder {
  codigo_pedido: string | number;
  numero_pedido?: string | number | null;
  cliente_nome?: string | null;
  etapa?: string | null;
  etapa_descricao?: string | null;
  created_at?: string | null;
  data_previsao?: string | null;
  origem_pedido?: string | null;
  valor_total_pedido?: number | string | null;
  obs_venda?: string | null;
}

export interface SalesOrderItem {
  codigo?: string | null;
  descricao?: string | null;
  quantidade?: number | string | null;
  valor_total?: number | string | null;
}

export type SalesSortKey =
  | "pedido"
  | "cliente"
  | "etapa"
  | "created_at"
  | "data_previsao"
  | "origem"
  | "valor_total";
export type SortDirection = "asc" | "desc";
export interface SalesFilters {
  pedido: string;
  cliente: string;
  etapa: string;
  dataCriacao: string;
  origem: string;
}
