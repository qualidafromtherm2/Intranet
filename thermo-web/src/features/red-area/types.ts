export type RedAreaStatus =
  | "registrado"
  | "aguardando_aprovacao"
  | "scrapado"
  | "retrabalho"
  | "liberado"
  | "reprovado";
export interface RedAreaItem {
  id: number;
  origem: "niq" | "pir";
  codigo_produto: string;
  codigo?: string;
  descricao?: string;
  quantidade?: number;
  descricao_falha?: string;
  lote?: string;
  numero_op?: string;
  numero_nfe?: string;
  status: RedAreaStatus;
  status_label?: string;
  definido_por?: string;
  definido_em?: string;
  ids_armazem?: string;
  foto_url?: string | null;
  video_url?: string | null;
  analise_por?: string;
  analise_em?: string | null;
  analise_foto_url?: string | null;
  analise_video_url?: string | null;
  analise_obs?: string;
  decisao_por?: string;
  decisao_em?: string | null;
  omie_trf_codigo?: string;
  omie_sai_codigo?: string;
  local_origem_codigo?: string;
  local_origem_nome?: string;
  local_destino_codigo?: string;
  local_destino_nome?: string;
}
export interface RedAreaProduct {
  codigo: string;
  codigo_produto?: string | number;
  descricao?: string;
  url_imagem?: string;
}
export interface RedAreaEntry {
  codigo: string;
  codigo_produto?: string;
  descricao?: string;
  quantidade: number;
  descricao_falha: string;
  produto_grupo?: string;
  op_producao_id?: number;
  numero_op?: string;
  local_origem_codigo: string;
  fotos: File[];
  videos: File[];
}
export interface RedAreaAnalysis {
  analise_por: string;
  analise_obs?: string;
  fotos: File[];
  videos: File[];
}
export type RedAreaDecision = "scrap" | "retrabalho" | "liberar";
