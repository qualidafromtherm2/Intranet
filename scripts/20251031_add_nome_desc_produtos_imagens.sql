-- Adiciona metadados de nome e descrição para as fotos do produto
ALTER TABLE public.produtos_omie_imagens
  ADD COLUMN IF NOT EXISTS nome_foto text,
  ADD COLUMN IF NOT EXISTS descricao_foto text;
