-- Adiciona colunas de reprovação na tabela compras_sem_cadastro
-- Objetivo: Permitir que itens de compras_sem_cadastro possam ser reprovados com motivo e usuário

ALTER TABLE compras.compras_sem_cadastro 
ADD COLUMN IF NOT EXISTS observacao_reprovacao TEXT,
ADD COLUMN IF NOT EXISTS usuario_comentario TEXT;

-- Comentário: observacao_reprovacao armazena o motivo da reprovação
-- Comentário: usuario_comentario armazena o usuário que reprovou o item
