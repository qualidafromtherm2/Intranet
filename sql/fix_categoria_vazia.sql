-- Atualiza itens antigos sem categoria_compra_codigo com valor padrão
-- Usa a categoria "2.01.03" como padrão (ajuste se necessário)

UPDATE compras.solicitacao_compras
SET 
  categoria_compra_codigo = '2.01.03',
  categoria_compra_nome = 'Compras em Geral',
  updated_at = NOW()
WHERE categoria_compra_codigo IS NULL 
   OR categoria_compra_codigo = '';

-- Mostra resultado
SELECT 
  COUNT(*) FILTER (WHERE categoria_compra_codigo IS NOT NULL AND categoria_compra_codigo != '') as com_categoria,
  COUNT(*) FILTER (WHERE categoria_compra_codigo IS NULL OR categoria_compra_codigo = '') as sem_categoria,
  COUNT(*) as total
FROM compras.solicitacao_compras;
