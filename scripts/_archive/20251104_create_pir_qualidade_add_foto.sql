-- Adiciona coluna de foto na tabela RI
ALTER TABLE qualidade.ri 
ADD COLUMN IF NOT EXISTS foto_url TEXT;

COMMENT ON COLUMN qualidade.ri.foto_url IS 'URL da foto armazenada no Supabase (pasta RI)';

-- Cria tabela PIR (Plano de Inspeção e Recebimento) no schema qualidade
CREATE TABLE IF NOT EXISTS qualidade.pir (
    id              BIGSERIAL PRIMARY KEY,
    id_omie         BIGINT NOT NULL,
    codigo          TEXT NOT NULL,
    frequencia      INTEGER NOT NULL,
    o_que_verificar TEXT NOT NULL,
    foto_url        TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para busca por id_omie
CREATE INDEX IF NOT EXISTS pir_id_omie_idx
    ON qualidade.pir (id_omie);

-- Índice para busca por código
CREATE INDEX IF NOT EXISTS pir_codigo_idx
    ON qualidade.pir (codigo);

-- Comentários nas colunas para documentação
COMMENT ON TABLE qualidade.pir IS 'Tabela de Plano de Inspeção e Recebimento - PIR';
COMMENT ON COLUMN qualidade.pir.id IS 'ID sequencial único';
COMMENT ON COLUMN qualidade.pir.id_omie IS 'ID do produto no sistema Omie';
COMMENT ON COLUMN qualidade.pir.codigo IS 'Código do produto';
COMMENT ON COLUMN qualidade.pir.frequencia IS 'Frequência de inspeção (percentual)';
COMMENT ON COLUMN qualidade.pir.o_que_verificar IS 'Descrição do que deve ser verificado';
COMMENT ON COLUMN qualidade.pir.foto_url IS 'URL da foto armazenada no Supabase (pasta PIR)';
COMMENT ON COLUMN qualidade.pir.criado_em IS 'Data e hora de criação do registro';
COMMENT ON COLUMN qualidade.pir.atualizado_em IS 'Data e hora da última atualização';
