export type MainManual = { codigo?: string; titulo?: string; nome_arquivo?: string; nome_exibicao?: string; public_url: string; tamanho_bytes?: number };
export type ManualProduct = { codigo_produto?: string; codigo?: string; descricao?: string };
export type ProductManual = { id: number; nome: string; url?: string; paginas?: number; status?: string; criado_em?: string; produtos?: ManualProduct[] };
export type ProductSearchResult = { codigo_produto: string; codigo?: string; descricao?: string };
export type MasterDocument = { id: number; numero_formulario?: string; descricao?: string; autor?: string; classificacao?: string; numero_revisao?: string; data_criacao?: string; revisado?: string; revisado_por?: string; proxima_revisao?: string; documento?: string; status?: string };
export type MasterVersion = { id: number; numero_revisao?: string; descricao_alteracao?: string; inserido_por?: string; inserido_em?: string; documento?: string };
