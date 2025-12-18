-- Adiciona colunas de status e aprovador às solicitações de transferência.
ALTER TABLE mensagens.transferencias
    ADD COLUMN IF NOT EXISTS status TEXT;

ALTER TABLE mensagens.transferencias
    ADD COLUMN IF NOT EXISTS aprovado_pro TEXT;

UPDATE mensagens.transferencias
   SET status = 'Aguardando aprovação'
 WHERE status IS NULL;

ALTER TABLE mensagens.transferencias
    ALTER COLUMN status SET DEFAULT 'Aguardando aprovação';

ALTER TABLE mensagens.transferencias
    ALTER COLUMN status SET NOT NULL;
