-- Cria tabela para vincular OPs aos anexos ativos no momento da geração.
CREATE TABLE IF NOT EXISTS "OrdemProducao".tab_op_anexos (
    id           BIGSERIAL PRIMARY KEY,
    numero_op    TEXT NOT NULL,
    id_anexo     BIGINT NOT NULL REFERENCES public.produtos_omie_anexos(id) ON DELETE RESTRICT,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tab_op_anexos_numero_idx ON "OrdemProducao".tab_op_anexos (numero_op);
CREATE INDEX IF NOT EXISTS tab_op_anexos_anexo_idx  ON "OrdemProducao".tab_op_anexos (id_anexo);
