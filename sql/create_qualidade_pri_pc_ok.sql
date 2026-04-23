-- Cria schema qualidade se não existir
CREATE SCHEMA IF NOT EXISTS qualidade;

-- Tabela de registros de 1ª peça OK
CREATE TABLE IF NOT EXISTS qualidade.pri_pc_ok (
  id              BIGSERIAL PRIMARY KEY,
  codigo_produto  TEXT        NOT NULL,
  usuario         TEXT        NOT NULL,
  o_que_verificar TEXT        NOT NULL,
  especificacao   TEXT,
  arquivo_url     TEXT,
  arquivo_path_key TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index para facilitar consultas por produto
CREATE INDEX IF NOT EXISTS idx_pri_pc_ok_codigo_produto
  ON qualidade.pri_pc_ok (codigo_produto);
