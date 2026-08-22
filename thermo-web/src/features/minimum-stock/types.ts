export type MinimumStockStatus = 'sem-minimo' | 'abaixo' | 'proximo' | 'acima'
export interface MinimumStockItem { codigo: string; codigo_produto?: string|number; descricao?: string; familia?: string; estoque_minimo?: number; saldo_almox?: number; saldo?: number; fisico?: number; inativo?: string; item_limitado_local?: boolean }
export interface MinimumStockFilters { query?: string; status?: MinimumStockStatus|'todos'; nearPercent?: number; page?: number; limit?: number }
export interface MinimumStockResponse { ok: true; total: number; itens: MinimumStockItem[]; pagina?: number; totalPaginas?: number }
