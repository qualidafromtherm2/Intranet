-- Atualiza codigo_omie para registros existentes
-- Busca codigo_produto na tabela public.produtos_omie usando o campo codigo
-- que corresponde ao produto_codigo salvo em solicitacao_compras

UPDATE compras.solicitacao_compras sc
SET codigo_omie = po.codigo_produto,
    updated_at = NOW()
FROM public.produtos_omie po
WHERE sc.produto_codigo = po.codigo
  AND sc.codigo_omie IS NULL;

-- Mostra quantos registros foram atualizados
SELECT 
  COUNT(*) FILTER (WHERE codigo_omie IS NOT NULL) as com_codigo_omie,
  COUNT(*) FILTER (WHERE codigo_omie IS NULL) as sem_codigo_omie,
  COUNT(*) as total
FROM compras.solicitacao_compras;
