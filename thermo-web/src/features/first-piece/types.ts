export type FirstPieceResult = "ok" | "nok" | null;

export interface FirstPieceItem {
  id: number;
  o_que_verificar: string;
  especificacao?: string | null;
  arquivo_url?: string | null;
  resultado: FirstPieceResult;
}

export interface FirstPieceProduct {
  codigo_produto: string;
  descricao?: string | null;
  itens: FirstPieceItem[];
}

export interface FirstPieceUser {
  username: string;
}

export interface FirstPieceDecision {
  codigo_produto: string;
  numero_op: string;
  itens: Array<{
    id: number;
    o_que_verificar: string;
    resultado: "ok" | "nok";
  }>;
  tem_nok: boolean;
  user_liberacao?: string;
  senha_liberacao?: string;
  resolucao?: string;
}
