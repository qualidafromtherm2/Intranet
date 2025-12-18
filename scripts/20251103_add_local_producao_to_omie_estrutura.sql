-- Adiciona o campo "local_produção" na tabela public.omie_estrutura
-- Observação: o nome contém acento e por isso é necessário usar aspas.
ALTER TABLE public.omie_estrutura
  ADD COLUMN IF NOT EXISTS "local_produção" text;

COMMENT ON COLUMN public.omie_estrutura."local_produção" IS 'Local de produção (lista Omie → geral/familias.nomeFamilia).';
