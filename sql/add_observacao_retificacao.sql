-- Adiciona coluna para armazenar observação de retificação
-- Objetivo: Registrar o motivo da retificação quando um item é enviado para revisão

ALTER TABLE compras.solicitacao_compras 
ADD COLUMN IF NOT EXISTS observacao_retificacao TEXT;

-- Comentário da coluna
COMMENT ON COLUMN compras.solicitacao_compras.observacao_retificacao 
IS 'Observação/motivo informado pelo usuário ao solicitar retificação do item';
