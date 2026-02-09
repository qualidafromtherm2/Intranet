-- Altera coluna item_verificado para frequencia (inteiro) na tabela qualidade.pir
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'qualidade'
      AND table_name = 'pir'
      AND column_name = 'item_verificado'
  ) THEN
    ALTER TABLE qualidade.pir
      RENAME COLUMN item_verificado TO frequencia;
  END IF;
END $$;

-- Converte conteúdo para inteiro (ex.: "10%" -> 10)
ALTER TABLE qualidade.pir
  ALTER COLUMN frequencia TYPE INTEGER
  USING NULLIF(REGEXP_REPLACE(frequencia::text, '[^0-9]', '', 'g'), '')::INTEGER;

-- Preenche valores nulos com 10 (padrão)
UPDATE qualidade.pir
SET frequencia = 10
WHERE frequencia IS NULL;

COMMENT ON COLUMN qualidade.pir.frequencia IS 'Frequência de inspeção (percentual)';
