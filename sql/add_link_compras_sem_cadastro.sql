-- Adiciona coluna link para armazenar URLs informadas no catálogo
ALTER TABLE compras.compras_sem_cadastro
  ADD COLUMN IF NOT EXISTS link JSONB;