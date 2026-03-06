-- Objetivo: criar tabela local de CFOP para consulta rápida no modal "NFe dos pedidos"
CREATE SCHEMA IF NOT EXISTS configuracoes;

CREATE TABLE IF NOT EXISTS configuracoes.cfop (
  id BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(10) NOT NULL,
  descricao TEXT NOT NULL,
  aplicacao TEXT NOT NULL,
  fonte_url TEXT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cfop_codigo_unico UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS idx_cfop_codigo ON configuracoes.cfop (codigo);
CREATE INDEX IF NOT EXISTS idx_cfop_ativo ON configuracoes.cfop (ativo);

-- Exemplo de carga (ajuste conforme sua base oficial)
-- INSERT INTO configuracoes.cfop (codigo, descricao, aplicacao, fonte_url)
-- VALUES ('1102', 'Compra para comercialização', 'Entrada de mercadoria para revenda', 'https://www.sefaz.pe.gov.br/legislacao/tributaria/documents/legislacao/tabelas/cfop.htm')
-- ON CONFLICT (codigo) DO UPDATE
-- SET descricao = EXCLUDED.descricao,
--     aplicacao = EXCLUDED.aplicacao,
--     fonte_url = EXCLUDED.fonte_url,
--     ativo = TRUE,
--     atualizado_em = NOW(),
--     updated_at = NOW();
