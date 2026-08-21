export interface WarehouseLocation { codigo?: string; descricao?: string; codigo_local_estoque: string; inativo?: boolean; padrao?: boolean }
export interface WarehouseStock { codigo: string; descricao?: string; min?: number; fisico?: number; reservado?: number; saldo?: number; cmc?: number; codOmie?: number|string; preco_definido?: number; familiaCodigo?: string; familiaNome?: string }
export interface MovementRule { origem_local_codigo?: string|null; destino_transferencia_codigo?: string|null; origem_local_codigos?: string[]|null; destino_transferencia_codigos?: string[]|null; restringir_ajustes?: boolean }
export interface MovementItem { codigo: string; descricao?: string; qtd: number; cmc?: number; codigo_produto?: number|string|null; codOmie?: number|string|null }
export interface TransferInput { origem: string; destino: string; data_movimentacao: string; solicitante?: string|null; itens: MovementItem[] }
export interface AdjustmentInput { tipo_operacao:'ENT'|'SAI'; local_estoque:string; local_nome?:string|null; data_movimentacao:string; solicitante?:string|null; obs?:string|null; motivo?:'INV'|'OPE'|'PDV'|'INI'|'PER'|'OPS'; itens:MovementItem[] }
