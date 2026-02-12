-- ============================================================================
-- Adiciona campo para deduplicação de webhooks
-- Data: 30/01/2026
-- ============================================================================

-- Adiciona coluna evento_webhook_message_id para evitar processamento duplicado
ALTER TABLE compras.pedidos_omie 
ADD COLUMN IF NOT EXISTS evento_webhook_message_id VARCHAR(100);

-- Cria índice para busca rápida de messageIds duplicados
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_message_id 
ON compras.pedidos_omie(evento_webhook_message_id) 
WHERE evento_webhook_message_id IS NOT NULL;

-- Comentário
COMMENT ON COLUMN compras.pedidos_omie.evento_webhook_message_id IS 
'ID único do webhook (messageId) para evitar processamento duplicado';
