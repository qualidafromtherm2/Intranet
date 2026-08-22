export interface InspectionPending {
  op_producao_id: number;
  numero_op: string;
  posto: string;
  col_key: string;
  ri_status?: string | null;
  qtde: string | number;
  obs?: string | null;
  data_abertura?: string | null;
  produto: { identificacao: string; descricao?: string; tipo?: string };
}
export interface InspectionAttachment {
  url: string;
  nome?: string;
  tipo?: string;
}
export interface InspectionCheck {
  id?: number;
  check_nome: string;
  descricao_check?: string | null;
  local?: string;
  anexos?: InspectionAttachment[] | string;
  foto?: string | null;
  video?: string | null;
}
export interface InspectionOccurrence {
  id: number;
  falha_detectada: string;
  numero_op?: string;
  created_at?: string;
  corrigido?: boolean;
  corrigido_por?: string;
  anexos?: InspectionAttachment[] | string;
  foto?: string | null;
  video?: string | null;
}
export interface InspectionDetail {
  ok: true;
  kanban_local?: string;
  template_apenas?: boolean;
  ja_registrado?: boolean;
  ri_ativo: boolean;
  check?: {
    id: number;
    status?: string;
    codigo?: string;
    codigo_produto?: number;
    descricao?: string;
  } | null;
  verificacoes: InspectionCheck[];
  ocorrencias: InspectionOccurrence[];
  produto?: Record<string, unknown>;
}
export interface InspectionPrepareInput {
  op_producao_id: number;
  op_iapp_id: number;
  numero_op: string;
  codigo: string;
  descricao: string;
  codigo_produto?: number | null;
  kanban_local: string;
}
