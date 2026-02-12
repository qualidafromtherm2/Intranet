-- Cria schema qualidade se não existir
CREATE SCHEMA IF NOT EXISTS qualidade;

-- Cria tabela RI (Registro de Inspeção) no schema qualidade
CREATE TABLE IF NOT EXISTS qualidade.ri (
    id              BIGSERIAL PRIMARY KEY,
    id_omie         BIGINT NOT NULL,
    codigo          TEXT NOT NULL,
    item_verificado TEXT NOT NULL,
    o_que_verificar TEXT NOT NULL,
    local_verificacao TEXT NOT NULL,
    prioridade      TEXT NOT NULL,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para busca por id_omie
CREATE INDEX IF NOT EXISTS ri_id_omie_idx
    ON qualidade.ri (id_omie);

-- Índice para busca por código
CREATE INDEX IF NOT EXISTS ri_codigo_idx
    ON qualidade.ri (codigo);

-- Comentários nas colunas para documentação
COMMENT ON TABLE qualidade.ri IS 'Tabela de Registro de Inspeção - RI';
COMMENT ON COLUMN qualidade.ri.id IS 'ID sequencial único';
COMMENT ON COLUMN qualidade.ri.id_omie IS 'ID do produto no sistema Omie';
COMMENT ON COLUMN qualidade.ri.codigo IS 'Código do produto';
COMMENT ON COLUMN qualidade.ri.item_verificado IS 'Item que deve ser verificado';
COMMENT ON COLUMN qualidade.ri.o_que_verificar IS 'Descrição do que deve ser verificado';
COMMENT ON COLUMN qualidade.ri.local_verificacao IS 'Local onde a verificação deve ser realizada';
COMMENT ON COLUMN qualidade.ri.prioridade IS 'Prioridade da verificação';
COMMENT ON COLUMN qualidade.ri.criado_em IS 'Data e hora de criação do registro';
COMMENT ON COLUMN qualidade.ri.atualizado_em IS 'Data e hora da última atualização';
