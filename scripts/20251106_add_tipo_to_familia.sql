-- Adiciona coluna 'tipo' na tabela configuracoes.familia
-- Para ser executado após a criação inicial da tabela

ALTER TABLE configuracoes.familia 
ADD COLUMN IF NOT EXISTS tipo text;
