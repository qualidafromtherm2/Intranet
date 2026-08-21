export type ProductionColumn='programado'|'solicitado'|'produzindo'|'teste'|'inspecao_final'|'embalagem'|'finalizado'
export interface ProductionOrder { id:number; identificacao?:string; n_op?:string; status?:string; quantidade?:number; ordem_producao?:string; from_op_producao?:boolean; produto?:{identificacao?:string;descricao?:string;quantidade?:number}; created_at?:string }
export interface ProductionProgram { id:number; op_producao_id?:number; numero_op?:string; codigo?:string; codigo_produto?:number; descricao?:string; quantidade_programado?:number; status?:string; postos?:string[]|string; observacao?:string; ri?:boolean }
export interface ProductionSaleItem { codigo_produto?:number; codigo:string; descricao?:string; quantidade:number }
export interface ProductionSaleOrder { codigo_pedido:number; numero_pedido?:string; obs_venda?:string; updated_at?:string; itens:ProductionSaleItem[] }
export interface ProductionStop { id:number; numero_op?:string; tipo_parada?:string; motivo?:string; parada_inicio?:string; operacao?:string }
export interface ProductionSnapshot { orders:ProductionOrder[]; sales:ProductionSaleOrder[]; programs:ProductionProgram[]; riByOrder:Record<string,unknown>; stopsByOrder:Record<string,ProductionStop>; occurrencesByOrder:Record<string,unknown>; timesByOrder:Record<string,unknown> }
export interface ProductionActionInput { op_producao_id:number; numero_op:string; kanban_programacao_id:number|null; usuario:string }
