-- ============================================================================
-- Script: Correção da tabela de etapas de pedido de compra
-- Data: 18/01/2026
-- Objetivo: Remover etapas inexistentes (40, 60, 80) após investigação da API
-- ============================================================================

-- Após testes exaustivos com 14 combinações de filtros da API Omie,
-- confirmamos que NENHUMA retorna pedidos nas etapas 40, 60, 80.
-- Esses códigos não existem na prática - todos os pedidos estão em etapas 10, 15, 20.

-- 1. Remove etapas que não existem na API da Omie
DELETE FROM compras.etapas_pedido_compra 
WHERE codigo IN ('40', '60', '80');

-- 2. Atualiza descrição da etapa 15 para refletir que ela agrupa vários status
UPDATE compras.etapas_pedido_compra
SET 
  descricao_padrao = 'Aprovação',
  descricao_customizada = 'Aprovação (inclui: Pendentes, Faturados, Recebidos, Conferidos)'
WHERE codigo = '15';

-- 3. Atualiza descrições das demais etapas
UPDATE compras.etapas_pedido_compra
SET 
  descricao_padrao = 'Pedido de Compra',
  descricao_customizada = 'Pedido de Compra (recém-criado, não aprovado)'
WHERE codigo = '10';

UPDATE compras.etapas_pedido_compra
SET 
  descricao_padrao = 'Requisição',
  descricao_customizada = 'Requisição de Compra (pedido transformado)'
WHERE codigo = '20';

-- 4. Verifica resultado
SELECT 
  codigo,
  descricao_padrao,
  descricao_customizada,
  ativo,
  CASE 
    WHEN codigo IN ('10', '15', '20') THEN '✓ Existe'
    ELSE '✗ Não existe'
  END as status
FROM compras.etapas_pedido_compra
ORDER BY codigo;

-- 5. Mostra distribuição real de pedidos por etapa
SELECT 
  e.codigo,
  e.descricao,
  COUNT(p.n_cod_ped) as total_pedidos
FROM compras.etapas_pedido_compra e
LEFT JOIN compras.pedidos_omie p ON p.c_etapa = e.codigo
GROUP BY e.codigo, e.descricao
ORDER BY e.codigo;

COMMIT;
