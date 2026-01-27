-- Adiciona coluna codigo_omie na tabela solicitacao_compras
-- Este campo armazena o codigo_produto da tabela public.produtos_omie
-- Será usado como codItem na integração com a Omie

ALTER TABLE compras.solicitacao_compras 
ADD COLUMN IF NOT EXISTS codigo_omie BIGINT;

-- Adiciona índice para melhorar performance
CREATE INDEX IF NOT EXISTS idx_solicitacao_compras_codigo_omie 
ON compras.solicitacao_compras(codigo_omie);

-- Comentário para documentação
COMMENT ON COLUMN compras.solicitacao_compras.codigo_omie IS 'Código do produto na Omie (codigo_produto da tabela produtos_omie) - usado como codItem na API';
