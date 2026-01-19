-- ============================================================================
-- Script para criar tabela de etapas de pedidos de compra da Omie
-- Data: 2025-01-18
-- Objetivo: Mapear códigos de etapa para descrições legíveis
-- ============================================================================

-- Criar tabela de etapas
CREATE TABLE IF NOT EXISTS compras.etapas_pedido_compra (
  codigo VARCHAR(10) PRIMARY KEY,
  descricao_padrao VARCHAR(100),
  descricao_customizada VARCHAR(100),
  ordem INTEGER,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Inserir as etapas de Compra de Produto (cCodOperacao = 21)
INSERT INTO compras.etapas_pedido_compra (codigo, descricao_padrao, descricao_customizada, ordem, ativo)
VALUES
  ('10', 'Pedido de Compra', 'Pedido de Compra', 1, true),
  ('15', 'Aprovação', 'Aprovação', 2, true),
  ('20', 'Requisição', 'Requisição', 3, true),
  ('30', 'Marketplace', 'Marketplace', 4, false),
  ('40', 'Faturado pelo Fornecedor', 'Faturado pelo Fornecedor', 5, true),
  ('60', 'Recebido', 'Recebido', 6, true),
  ('80', 'Conferido', 'Conferido', 7, true)
ON CONFLICT (codigo) DO UPDATE SET
  descricao_padrao = EXCLUDED.descricao_padrao,
  descricao_customizada = EXCLUDED.descricao_customizada,
  ordem = EXCLUDED.ordem,
  ativo = EXCLUDED.ativo;

-- Criar índice
CREATE INDEX IF NOT EXISTS idx_etapas_ordem ON compras.etapas_pedido_compra(ordem);

-- Comentários
COMMENT ON TABLE compras.etapas_pedido_compra IS 
  'Etapas dos pedidos de compra (Operação 21 da Omie)';
COMMENT ON COLUMN compras.etapas_pedido_compra.codigo IS 
  'Código da etapa (10, 15, 20, 40, 60, 80)';
COMMENT ON COLUMN compras.etapas_pedido_compra.descricao_padrao IS 
  'Descrição padrão da Omie';
COMMENT ON COLUMN compras.etapas_pedido_compra.ordem IS 
  'Ordem sequencial das etapas';

-- ============================================================================
-- VIEW para consultar pedidos com descrição da etapa
-- ============================================================================

CREATE OR REPLACE VIEW compras.v_pedidos_omie_completo AS
SELECT 
  p.n_cod_ped,
  p.c_numero,
  p.c_etapa as codigo_etapa,
  e.descricao_customizada as etapa_descricao,
  e.ordem as etapa_ordem,
  p.d_dt_previsao,
  p.d_inc_data,
  p.n_cod_for,
  p.c_cnpj_cpf_for,
  p.evento_webhook,
  p.data_webhook,
  p.inativo,
  -- Contar produtos do pedido
  (SELECT COUNT(*) FROM compras.pedidos_omie_produtos prod WHERE prod.n_cod_ped = p.n_cod_ped) as qtd_produtos,
  -- Contar parcelas
  (SELECT COUNT(*) FROM compras.pedidos_omie_parcelas parc WHERE parc.n_cod_ped = p.n_cod_ped) as qtd_parcelas
FROM compras.pedidos_omie p
LEFT JOIN compras.etapas_pedido_compra e ON p.c_etapa = e.codigo
ORDER BY p.n_cod_ped DESC;

COMMENT ON VIEW compras.v_pedidos_omie_completo IS 
  'View com pedidos de compra incluindo descrição da etapa';

-- ============================================================================
-- Verificação
-- ============================================================================

-- Ver as etapas cadastradas
SELECT * FROM compras.etapas_pedido_compra ORDER BY ordem;

-- Ver pedidos com descrição da etapa
SELECT 
  codigo_etapa,
  etapa_descricao,
  etapa_ordem,
  COUNT(*) as quantidade
FROM compras.v_pedidos_omie_completo
GROUP BY codigo_etapa, etapa_descricao, etapa_ordem
ORDER BY etapa_ordem;

-- Exemplo de consulta completa
SELECT 
  n_cod_ped,
  c_numero,
  codigo_etapa,
  etapa_descricao,
  d_dt_previsao,
  qtd_produtos
FROM compras.v_pedidos_omie_completo
LIMIT 10;
