-- Adiciona coluna NFe na tabela qualidade.produtos_liberado
ALTER TABLE IF EXISTS qualidade.produtos_liberado
ADD COLUMN IF NOT EXISTS nfe TEXT;

COMMENT ON COLUMN qualidade.produtos_liberado.nfe IS 'Número da NFe relacionado à inspeção de qualidade';
