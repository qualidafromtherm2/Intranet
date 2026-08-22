export interface PreparationStation {
  id: number;
  nome: string;
  created_at?: string | null;
}
export interface PreparationOrder {
  id: number;
  identificacao?: string;
  n_op?: string;
  quantidade?: number;
  ordem_producao?: string;
  from_op_producao?: boolean;
  produto?: {
    identificacao?: string;
    descricao?: string;
    quantidade?: number;
    codigo_produto?: number;
  };
}
export interface PreparationProgram {
  id: number;
  op_producao_id?: number;
  numero_op?: string;
  status?: string;
  postos?: string[] | string;
  observacao?: string;
  ri?: boolean;
  quantidade_programado?: number;
}
export interface PreparationMaterial {
  codigo_original?: string;
  codigo: string;
  descricao: string;
  unidade?: string;
  quantidade: number;
  operacao?: string;
  perc_perda?: number;
  customizado?: boolean;
  substituido_por?: string | null;
}
export interface PreparationSnapshot {
  stations: PreparationStation[];
  orders: PreparationOrder[];
  programs: PreparationProgram[];
}
