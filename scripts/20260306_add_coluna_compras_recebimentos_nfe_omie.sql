ALTER TABLE logistica.recebimentos_nfe_omie
ADD COLUMN IF NOT EXISTS compras VARCHAR(3) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'recebimentos_nfe_omie_compras_check'
  ) THEN
    ALTER TABLE logistica.recebimentos_nfe_omie
    ADD CONSTRAINT recebimentos_nfe_omie_compras_check
    CHECK (compras IS NULL OR compras IN ('sim', 'nao'));
  END IF;
END $$;