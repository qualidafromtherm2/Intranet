-- Cria schema qualidade se não existir
CREATE SCHEMA IF NOT EXISTS qualidade;

-- Cria tabela Produtos_liberado no schema qualidade
CREATE TABLE IF NOT EXISTS qualidade.produtos_liberado (
    id              BIGSERIAL PRIMARY KEY,
    cod_produto     TEXT NOT NULL,
    data_inspecao   DATE,
    frequencia      TEXT,
    status          TEXT,
    quantidade_ok   INTEGER,
    quantidade_nok  INTEGER
);

-- Comentários para documentação
COMMENT ON TABLE qualidade.produtos_liberado IS 'Produtos liberados pela inspeção de qualidade';
COMMENT ON COLUMN qualidade.produtos_liberado.id IS 'ID sequencial único';
COMMENT ON COLUMN qualidade.produtos_liberado.cod_produto IS 'Código do produto';
COMMENT ON COLUMN qualidade.produtos_liberado.data_inspecao IS 'Data da inspeção';
COMMENT ON COLUMN qualidade.produtos_liberado.frequencia IS 'Frequência de inspeção';
COMMENT ON COLUMN qualidade.produtos_liberado.status IS 'Status do produto na inspeção';
COMMENT ON COLUMN qualidade.produtos_liberado.quantidade_ok IS 'Quantidade aprovada';
COMMENT ON COLUMN qualidade.produtos_liberado.quantidade_nok IS 'Quantidade reprovada';
