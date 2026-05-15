export type Product = {
  codigo_produto: string | number | null;
  codigo_produto_integracao?: string | null;
  codigo: string;
  descricao: string;
  descricao_familia?: string | null;
  unidade?: string | null;
  tipoitem?: string | null;
  ncm?: string | null;
  valor_unitario?: string | number | null;
  quantidade_estoque?: string | number | null;
  estoque_minimo?: string | number | null;
  inativo?: string | null;
  bloqueado?: string | boolean | null;
  marca?: string | null;
  modelo?: string | null;
  primeira_imagem?: string | null;
};

export type ProductsResponse = {
  total: number;
  page: number;
  limit: number;
  itens: Product[];
};

export type ProductFilters = {
  q: string;
  searchMode: 'tags' | 'contains' | 'starts';
  inativo: Array<'N' | 'S'>;
  familia: string[];
  estoque: Array<'com-estoque' | 'sem-estoque'>;
  utilidade: Array<'obsoleto' | 'engenharia' | 'sem-minimo'>;
};

export type PurchaseCartItem = {
  id: number;
  produto_codigo: string;
  produto_descricao: string;
  quantidade: string | number;
  familia_produto?: string | null;
  objetivo_compra?: string | null;
  solicitante?: string | null;
  departamento?: string | null;
  centro_custo?: string | null;
  prazo_solicitado?: string | null;
  grupo_requisicao?: string | null;
  created_at?: string | null;
};

export type SeparationCartItem = {
  id: number;
  codigo_produto: string;
  descricao: string;
  unidade?: string | null;
  quantidade: string | number;
  comentario?: string | null;
  criado_em?: string | null;
};
