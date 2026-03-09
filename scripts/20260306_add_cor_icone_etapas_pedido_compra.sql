-- ============================================================================
-- Script: Adiciona colunas visuais em compras.etapas_pedido_compra
-- Data: 2026-03-06
-- Objetivo: Permitir cor e ícone no fallback de etapa por c_etapa
-- ============================================================================

ALTER TABLE compras.etapas_pedido_compra
  ADD COLUMN IF NOT EXISTS cor VARCHAR(20),
  ADD COLUMN IF NOT EXISTS icone VARCHAR(50);

-- Cores e ícones solicitados para as etapas de pedido
UPDATE compras.etapas_pedido_compra
SET
  cor = CASE codigo
    WHEN '20' THEN '#FFA500'
    WHEN '15' THEN '#FF8C00'
    WHEN '10' THEN '#FFD700'
    ELSE cor
  END,
  icone = CASE codigo
    WHEN '20' THEN 'clipboard-list'   -- Requisição
    WHEN '15' THEN 'circle-check'     -- Aprovação
    WHEN '10' THEN 'cart-shopping'    -- Pedido de Compra
    ELSE icone
  END
WHERE codigo IN ('10', '15', '20');

COMMENT ON COLUMN compras.etapas_pedido_compra.cor IS
  'Cor hexadecimal para badge da etapa de pedido';

COMMENT ON COLUMN compras.etapas_pedido_compra.icone IS
  'Ícone (nome Font Awesome sem prefixo fa-) para badge da etapa de pedido';

-- Verificação rápida
SELECT codigo, descricao_padrao, descricao_customizada, cor, icone
FROM compras.etapas_pedido_compra
WHERE codigo IN ('10', '15', '20')
ORDER BY ordem;
