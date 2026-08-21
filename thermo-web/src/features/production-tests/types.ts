export interface TestReport {
  id: number;
  criado_em?: string;
  linha?: string;
  modelo?: string;
  num_op?: string;
  operador?: string;
  total_registros?: number;
  arquivo_xlsx?: string;
  cop_medio?: number;
  cop_max?: number;
  delta_t_medio?: number;
  kw_aq_medio?: number;
  leituras_count?: number;
  ftibr_count?: number;
}
export interface TestReading {
  id: number;
  data_hora?: string;
  fase?: string;
  temp_ambiente?: number;
  temp_entrada?: number;
  temp_saida?: number;
  temp_dif?: number;
  cop?: number;
  kw_aquecimento?: number;
  kw_consumo?: number;
  kcal_h?: number;
  vazao?: number;
  pressao_alta?: number;
  pressao_baixa?: number;
  tensao?: number;
  corrente?: number;
  [key: string]: unknown;
}
export interface TestSummary {
  totais: Record<string, unknown>;
  maquinas: Array<{
    modelo: string;
    linha?: string;
    qtd_relatorios?: number;
    qtd_leituras?: number;
    ultimo_teste?: string;
    cop_medio?: number;
    delta_t_medio?: number;
    kw_aq_medio?: number;
    spec?: Record<string, unknown> | null;
  }>;
  recentes: TestReport[];
}
export interface TestDetail {
  relatorio: TestReport;
  leituras: TestReading[];
  leituras_ftibr: TestReading[];
  stats: Record<string, unknown>;
  diagnostico: {
    veredicto: "aprovado" | "reprovado" | "atencao";
    ok: string[];
    alertas: Array<{ nivel: string; texto: string }>;
    infos: string[];
    is_inverter?: boolean;
  };
  comparativo?: Record<string, unknown>;
  spec?: Record<string, unknown> | null;
  comparativo_modelo?: TestReport[];
}
