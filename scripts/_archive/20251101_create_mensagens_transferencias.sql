-- Cria o esquema mensagens e a tabela transferencias para registrar solicitações de transferência de itens.
CREATE SCHEMA IF NOT EXISTS mensagens;

CREATE TABLE IF NOT EXISTS mensagens.transferencias (
    id              BIGSERIAL PRIMARY KEY,
    codigo_produto  BIGINT      NOT NULL REFERENCES public.produtos_omie (codigo_produto),
    codigo          TEXT        NOT NULL,
    descricao       TEXT,
    qtd             NUMERIC(14,4) NOT NULL,
    origem          TEXT        NOT NULL,
    destino         TEXT        NOT NULL,
    solicitante     TEXT
);

CREATE INDEX IF NOT EXISTS transferencias_codigo_produto_idx
    ON mensagens.transferencias (codigo_produto);

CREATE INDEX IF NOT EXISTS transferencias_origem_destino_idx
    ON mensagens.transferencias (origem, destino);
