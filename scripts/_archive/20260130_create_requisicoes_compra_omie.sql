-- ============================================================================
-- Script para criar tabelas de Requisições de Compra da Omie
-- Data: 2026-01-30
-- Objetivo: Armazenar requisições de compra vindas da Omie via webhook
-- Eventos tratados: RequisicaoProduto.Incluida, Alterada, Excluida
-- ============================================================================

-- Garantir que o schema compras existe
CREATE SCHEMA IF NOT EXISTS compras;

-- ==========================================================================
-- 1. TABELA PRINCIPAL: CABEÇALHO DA REQUISIÇÃO
-- ==========================================================================
CREATE TABLE IF NOT EXISTS compras.requisicoes_omie (
  cod_req_compra BIGINT PRIMARY KEY,             -- Código da requisição na Omie (codReqCompra)
  cod_int_req_compra VARCHAR(100),               -- Código de integração (codIntReqCompra)
  cod_categ VARCHAR(50),                         -- Código da categoria (codCateg)
  cod_proj BIGINT,                               -- Código do projeto (codProj)
  dt_sugestao DATE,                              -- Data sugerida (dtSugestao)
  obs_req_compra TEXT,                           -- Observações (obsReqCompra)
  obs_int_req_compra TEXT,                       -- Observações internas (obsIntReqCompra)
  cod_status VARCHAR(20),                        -- Código do status (cCodStatus)
  desc_status VARCHAR(100),                      -- Descrição do status (cDesStatus)

  -- Controle
  inativo BOOLEAN DEFAULT FALSE,                 -- Se foi excluído
  data_webhook TIMESTAMP DEFAULT NOW(),          -- Data de recebimento do webhook
  evento_webhook VARCHAR(100),                   -- Último evento recebido
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requisicoes_omie_cod_int
  ON compras.requisicoes_omie(cod_int_req_compra);

CREATE INDEX IF NOT EXISTS idx_requisicoes_omie_dt_sugestao
  ON compras.requisicoes_omie(dt_sugestao);

-- ==========================================================================
-- 2. TABELA DE ITENS DA REQUISIÇÃO
-- ==========================================================================
CREATE TABLE IF NOT EXISTS compras.requisicoes_omie_itens (
  id SERIAL PRIMARY KEY,
  cod_req_compra BIGINT NOT NULL,                -- FK para requisicoes_omie

  cod_item BIGINT,                               -- Código do item (codItem)
  cod_int_item VARCHAR(100),                     -- Código de integração do item (codIntItem)

  cod_prod BIGINT,                               -- Código do produto (codProd)
  cod_int_prod VARCHAR(100),                     -- Código de integração do produto (codIntProd)

  qtde DECIMAL(15,4),                            -- Quantidade (qtde)
  preco_unit DECIMAL(15,2),                      -- Preço unitário (precoUnit)
  obs_item TEXT,                                 -- Observações do item (obsItem)

  -- Controle
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  FOREIGN KEY (cod_req_compra) REFERENCES compras.requisicoes_omie(cod_req_compra) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_requisicoes_omie_itens_req
  ON compras.requisicoes_omie_itens(cod_req_compra);

CREATE INDEX IF NOT EXISTS idx_requisicoes_omie_itens_prod
  ON compras.requisicoes_omie_itens(cod_prod);
