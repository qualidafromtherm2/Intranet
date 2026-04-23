-- Tabela para registrar verificações de 1ª peça OK / NOK
-- Schema: qualidade (já criado em create_qualidade_pri_pc_ok.sql)

CREATE TABLE IF NOT EXISTS qualidade."Reg_PC_OK" (
  id              BIGSERIAL PRIMARY KEY,
  codigo_produto  TEXT NOT NULL,
  numero_op       TEXT NOT NULL,
  usuario         TEXT NOT NULL,
  itens           JSONB NOT NULL DEFAULT '[]',
  tem_nok         BOOLEAN NOT NULL DEFAULT FALSE,
  user_liberacao  TEXT,
  resolucao       TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reg_pc_ok_codigo ON qualidade."Reg_PC_OK" (codigo_produto);
CREATE INDEX IF NOT EXISTS idx_reg_pc_ok_criado_em ON qualidade."Reg_PC_OK" (criado_em DESC);
