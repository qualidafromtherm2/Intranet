export type IncidentStatusFilter = "" | "aberta" | "corrigida";
export interface IncidentAttachment {
  url: string;
  tipo?: string | null;
  nome?: string | null;
}
export interface ProductionIncident {
  id: number;
  codigo_produto?: string | number | null;
  op_iapp_id?: number | null;
  numero_op?: string | null;
  falha_detectada: string;
  foto?: string | null;
  video?: string | null;
  anexos?: IncidentAttachment[] | string | null;
  usuario?: string | null;
  created_at?: string | null;
  corrigido?: boolean | string | null;
  corrigido_por?: string | null;
  corrigido_em?: string | null;
}
export interface IncidentCounts {
  total: number;
  aberta: number;
  corrigida: number;
}
export interface IncidentListResponse {
  ok: true;
  ocorrencias: ProductionIncident[];
  contagens: IncidentCounts;
  limit: number;
  offset: number;
}
export interface CreateIncidentInput {
  op_producao_id: number;
  numero_op?: string;
  codigo?: string;
  codigo_produto?: number;
  falha_detectada: string;
  arquivos?: File[];
}
