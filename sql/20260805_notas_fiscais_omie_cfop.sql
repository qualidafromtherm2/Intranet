-- CFOP das NF-e de vendas (preenchido via webhook + ConsultarNF / payload Omie)
ALTER TABLE "Vendas".notas_fiscais_omie
  ADD COLUMN IF NOT EXISTS cfop VARCHAR(40);

COMMENT ON COLUMN "Vendas".notas_fiscais_omie.cfop IS
  'CFOP(s) da NF-e (ex.: 6.101). Se houver mais de um nos itens, separados por vírgula.';
