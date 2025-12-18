-- Adiciona coluna de controle de ativação para anexos de produtos.
ALTER TABLE IF EXISTS public.produtos_omie_anexos
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE;

-- Garante que registros antigos fiquem ativos caso a coluna tenha sido criada sem default.
UPDATE public.produtos_omie_anexos
   SET ativo = TRUE
 WHERE ativo IS NULL;

CREATE INDEX IF NOT EXISTS produtos_omie_anexos_codigo_ativo_idx
    ON public.produtos_omie_anexos (codigo_produto, ativo);
