-- Adiciona colunas para armazenar dados do pedido gerado na Omie
-- nCodPed: Código numérico do pedido na Omie
-- cNumero: Número do pedido na Omie (formato string, ex: "2236")

ALTER TABLE compras.solicitacao_compras
ADD COLUMN IF NOT EXISTS nCodPed BIGINT,
ADD COLUMN IF NOT EXISTS cNumero VARCHAR(50);

-- Adiciona comentários nas colunas
COMMENT ON COLUMN compras.solicitacao_compras.nCodPed IS 'Código do pedido de compra na Omie (retornado ao gerar pedido)';
COMMENT ON COLUMN compras.solicitacao_compras.cNumero IS 'Número do pedido de compra na Omie (exibido para o usuário)';

-- Cria índice para busca por número do pedido Omie
CREATE INDEX IF NOT EXISTS idx_solicitacao_compras_cNumero ON compras.solicitacao_compras(cNumero);
CREATE INDEX IF NOT EXISTS idx_solicitacao_compras_nCodPed ON compras.solicitacao_compras(nCodPed);
