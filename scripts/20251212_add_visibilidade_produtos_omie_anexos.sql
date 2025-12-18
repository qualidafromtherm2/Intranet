-- Adiciona colunas de visibilidade por área para anexos de produtos.
ALTER TABLE IF EXISTS public.produtos_omie_anexos
  ADD COLUMN IF NOT EXISTS visivel_producao BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS visivel_assistencia_tecnica BOOLEAN NOT NULL DEFAULT TRUE;

-- Garante valores preenchidos para registros existentes.
UPDATE public.produtos_omie_anexos
   SET visivel_producao = COALESCE(visivel_producao, TRUE),
       visivel_assistencia_tecnica = COALESCE(visivel_assistencia_tecnica, TRUE)
 WHERE visivel_producao IS NULL
    OR visivel_assistencia_tecnica IS NULL;
