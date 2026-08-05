-- Configuração compartilhada de CFOP do Relatório Gerencial de Vendas
CREATE SCHEMA IF NOT EXISTS "Vendas";

CREATE TABLE IF NOT EXISTS "Vendas".relatorio_gerencial_cfop (
  cfop VARCHAR(10) PRIMARY KEY,
  incluido BOOLEAN NOT NULL DEFAULT TRUE,
  descricao TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_por TEXT
);

CREATE INDEX IF NOT EXISTS vendas_relatorio_gerencial_cfop_incluido_idx
  ON "Vendas".relatorio_gerencial_cfop (incluido);

COMMENT ON TABLE "Vendas".relatorio_gerencial_cfop IS
  'Padrão de CFOPs incluídos no Relatório Gerencial de Vendas (válido para todos os usuários).';
