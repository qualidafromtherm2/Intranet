export interface WarehouseLocation { codigo?: string; descricao?: string; codigo_local_estoque: string; inativo?: boolean; padrao?: boolean }
export interface WarehouseStock { codigo: string; descricao?: string; min?: number; fisico?: number; reservado?: number; saldo?: number; cmc?: number; codOmie?: number|string; preco_definido?: number; familiaCodigo?: string; familiaNome?: string }
export interface MovementRule { origem_local_codigo?: string|null; destino_transferencia_codigo?: string|null; origem_local_codigos?: string[]|null; destino_transferencia_codigos?: string[]|null; restringir_ajustes?: boolean }
export interface MovementItem { codigo: string; descricao?: string; qtd: number; cmc?: number; codigo_produto?: number|string|null; codOmie?: number|string|null }
export interface TransferInput { origem: string; destino: string; data_movimentacao: string; solicitante?: string|null; itens: MovementItem[] }
export interface AdjustmentInput { tipo_operacao:'ENT'|'SAI'; local_estoque:string; local_nome?:string|null; data_movimentacao:string; solicitante?:string|null; obs?:string|null; motivo?:'INV'|'OPE'|'PDV'|'INI'|'PER'|'OPS'; itens:MovementItem[] }
export interface StockPosition { codigo:string; descricao:string; local_codigo:string; fisico:number; saldo:number; cmc?:number; min?:number }
export interface StockOscillation { data:string; armazem:string; local_codigo?:string; total_fisico?:number; total_valor?:number; entrada?:number; saida?:number; liquido?:number; valor_liquido?:number }
export interface OccupancyItem { id?:number; codigo_produto:string; descricao?:string; qtd:number; unidade?:string; data_emissao?:string; foto_url?:string; complemento?:string }
export interface BulkLine { line:number; code:string; type:'ENT'|'SAI'|'TRF'|null; quantity:number|null; warehouse?:string|null; origin?:string|null; destination?:string|null; cmc?:number|null }
