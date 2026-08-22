export interface ProductionRecord { id:number; numero_op:string; codigo:string; descricao:string; status:string; ri:boolean; op_producao_id?:number|null; estoque_maq:boolean; created_at?:string|null }
export interface ProductionPost { posto:string; tempo_formatado:string; inicio?:string|null; fim?:string|null; aberto?:boolean; operadores:string[] }
export interface ProductionDetail { success:true; maquina:ProductionRecord & { observacao?:string }; postos:ProductionPost[]; colaboradores:string[]; tempo_total_formatado?:string }
