-- Cria tabela para anexos de produtos vinculados ao código Omie.
CREATE TABLE IF NOT EXISTS public.produtos_omie_anexos (
    id              BIGSERIAL PRIMARY KEY,
    codigo_produto  BIGINT NOT NULL REFERENCES public.produtos_omie (codigo_produto) ON DELETE CASCADE,
    nome_anexo      TEXT   NOT NULL,
    descricao_anexo TEXT   NOT NULL,
    url_anexo       TEXT   NOT NULL,
    path_key        TEXT   NOT NULL,
    tamanho_bytes   BIGINT,
    content_type    TEXT,
    visivel_producao BOOLEAN NOT NULL DEFAULT TRUE,
    visivel_assistencia_tecnica BOOLEAN NOT NULL DEFAULT TRUE,
    ativo           BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS produtos_omie_anexos_codigo_idx
    ON public.produtos_omie_anexos (codigo_produto);
