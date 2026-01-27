-- Adiciona colunas de categoria da compra na tabela solicitacao_compras
-- Necessário para integração com Omie (campo codCateg obrigatório)

ALTER TABLE compras.solicitacao_compras 
ADD COLUMN IF NOT EXISTS categoria_compra_codigo VARCHAR(50),
ADD COLUMN IF NOT EXISTS categoria_compra_nome VARCHAR(255);

-- Adiciona índice para melhorar performance de queries
CREATE INDEX IF NOT EXISTS idx_solicitacao_compras_categoria 
ON compras.solicitacao_compras(categoria_compra_codigo);

-- Comentários para documentação
COMMENT ON COLUMN compras.solicitacao_compras.categoria_compra_codigo IS 'Código da categoria da compra na Omie (campo codCateg)';
COMMENT ON COLUMN compras.solicitacao_compras.categoria_compra_nome IS 'Nome descritivo da categoria da compra';
