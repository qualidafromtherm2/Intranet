-- Relatório Gerencial Vendas: status NF e cadastro de vendedores Omie
CREATE SCHEMA IF NOT EXISTS vendas;

CREATE TABLE IF NOT EXISTS vendas.relatorio_gerencial_status (
  status VARCHAR(40) PRIMARY KEY,
  incluido BOOLEAN NOT NULL DEFAULT TRUE,
  descricao TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_por TEXT
);

ALTER TABLE vendas.relatorio_gerencial_status
  ADD COLUMN IF NOT EXISTS descricao TEXT;

CREATE INDEX IF NOT EXISTS vendas_relatorio_gerencial_status_incluido_idx
  ON vendas.relatorio_gerencial_status (incluido);

CREATE TABLE IF NOT EXISTS vendas.vendedores_omie (
  codigo BIGINT PRIMARY KEY,
  nome TEXT,
  email TEXT,
  inativo BOOLEAN NOT NULL DEFAULT FALSE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vendas.vendedores_omie
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();

INSERT INTO vendas.relatorio_gerencial_status (status, incluido, descricao) VALUES
  ('Autorizada', TRUE, 'NF autorizada'),
  ('Cancelada', FALSE, 'NF cancelada'),
  ('Denegada', FALSE, 'NF denegada'),
  ('DevolucaoAutorizada', FALSE, 'Devolução autorizada')
ON CONFLICT (status) DO NOTHING;
