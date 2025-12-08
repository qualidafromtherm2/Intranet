-- ============================================================================
-- SISTEMA DE CHAT/MENSAGENS - Estrutura completa
-- Data: 21/11/2025
-- Objetivo: Criar tabelas e funções para sistema de mensagens interno
-- ============================================================================

-- Tabela principal de mensagens
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id BIGSERIAL PRIMARY KEY,
    from_user_id BIGINT NOT NULL,
    to_user_id BIGINT NOT NULL,
    message_text TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys para garantir integridade
    CONSTRAINT fk_from_user FOREIGN KEY (from_user_id) 
        REFERENCES public.auth_user(id) ON DELETE CASCADE,
    CONSTRAINT fk_to_user FOREIGN KEY (to_user_id) 
        REFERENCES public.auth_user(id) ON DELETE CASCADE,
    
    -- Índices para performance
    CONSTRAINT chk_different_users CHECK (from_user_id != to_user_id)
);

-- Comentários descritivos
COMMENT ON TABLE public.chat_messages IS 'Armazena todas as mensagens trocadas entre usuários do sistema';
COMMENT ON COLUMN public.chat_messages.from_user_id IS 'ID do usuário que enviou a mensagem';
COMMENT ON COLUMN public.chat_messages.to_user_id IS 'ID do usuário que recebeu a mensagem';
COMMENT ON COLUMN public.chat_messages.message_text IS 'Conteúdo da mensagem';
COMMENT ON COLUMN public.chat_messages.is_read IS 'Indica se a mensagem foi lida pelo destinatário';

-- Índices para otimizar consultas
CREATE INDEX IF NOT EXISTS idx_chat_from_user ON public.chat_messages(from_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_to_user ON public.chat_messages(to_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_created_at ON public.chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_unread ON public.chat_messages(to_user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_chat_conversation ON public.chat_messages(from_user_id, to_user_id, created_at);

-- ============================================================================
-- FUNÇÃO: Listar usuários ativos disponíveis para chat
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_active_chat_users(
    p_current_user_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
    id BIGINT,
    username TEXT,
    email TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    unread_count BIGINT
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.username::TEXT,
        u.email,
        u.created_at,
        -- Conta mensagens não lidas do usuário para o usuário atual
        COALESCE(
            (SELECT COUNT(*) 
             FROM public.chat_messages m 
             WHERE m.from_user_id = u.id 
               AND m.to_user_id = p_current_user_id 
               AND m.is_read = FALSE),
            0
        ) as unread_count
    FROM 
        public.auth_user u
    WHERE 
        u.is_active = TRUE
        AND (p_current_user_id IS NULL OR u.id != p_current_user_id)
    ORDER BY 
        u.username;
END;
$$;

COMMENT ON FUNCTION public.get_active_chat_users IS 'Retorna lista de usuários ativos disponíveis para chat, excluindo o usuário atual';

-- ============================================================================
-- FUNÇÃO: Obter conversa entre dois usuários
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_conversation(
    p_user1_id BIGINT,
    p_user2_id BIGINT,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    id BIGINT,
    from_user_id BIGINT,
    to_user_id BIGINT,
    message_text TEXT,
    is_read BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id,
        m.from_user_id,
        m.to_user_id,
        m.message_text,
        m.is_read,
        m.created_at
    FROM 
        public.chat_messages m
    WHERE 
        (m.from_user_id = p_user1_id AND m.to_user_id = p_user2_id)
        OR 
        (m.from_user_id = p_user2_id AND m.to_user_id = p_user1_id)
    ORDER BY 
        m.created_at ASC
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.get_conversation IS 'Retorna histórico de mensagens entre dois usuários, ordenado cronologicamente';

-- ============================================================================
-- FUNÇÃO: Enviar nova mensagem
-- ============================================================================
CREATE OR REPLACE FUNCTION public.send_chat_message(
    p_from_user_id BIGINT,
    p_to_user_id BIGINT,
    p_message_text TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_message_id BIGINT;
    v_from_active BOOLEAN;
    v_to_active BOOLEAN;
BEGIN
    -- Valida se ambos os usuários estão ativos
    SELECT is_active INTO v_from_active FROM public.auth_user WHERE id = p_from_user_id;
    SELECT is_active INTO v_to_active FROM public.auth_user WHERE id = p_to_user_id;
    
    IF v_from_active IS NULL THEN
        RAISE EXCEPTION 'Usuário remetente não encontrado (ID: %)', p_from_user_id;
    END IF;
    
    IF v_to_active IS NULL THEN
        RAISE EXCEPTION 'Usuário destinatário não encontrado (ID: %)', p_to_user_id;
    END IF;
    
    IF NOT v_from_active THEN
        RAISE EXCEPTION 'Usuário remetente está inativo';
    END IF;
    
    IF NOT v_to_active THEN
        RAISE EXCEPTION 'Usuário destinatário está inativo';
    END IF;
    
    IF p_from_user_id = p_to_user_id THEN
        RAISE EXCEPTION 'Não é possível enviar mensagem para si mesmo';
    END IF;
    
    IF LENGTH(TRIM(p_message_text)) = 0 THEN
        RAISE EXCEPTION 'Mensagem não pode ser vazia';
    END IF;
    
    -- Insere a mensagem
    INSERT INTO public.chat_messages (from_user_id, to_user_id, message_text)
    VALUES (p_from_user_id, p_to_user_id, TRIM(p_message_text))
    RETURNING id INTO v_message_id;
    
    RETURN v_message_id;
END;
$$;

COMMENT ON FUNCTION public.send_chat_message IS 'Envia uma nova mensagem validando usuários ativos';

-- ============================================================================
-- FUNÇÃO: Marcar mensagens como lidas
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mark_messages_as_read(
    p_user_id BIGINT,
    p_from_user_id BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated_count INTEGER;
BEGIN
    -- Marca como lidas todas as mensagens não lidas do remetente para o usuário
    UPDATE public.chat_messages
    SET 
        is_read = TRUE,
        updated_at = CURRENT_TIMESTAMP
    WHERE 
        to_user_id = p_user_id
        AND from_user_id = p_from_user_id
        AND is_read = FALSE;
    
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    
    RETURN v_updated_count;
END;
$$;

COMMENT ON FUNCTION public.mark_messages_as_read IS 'Marca todas as mensagens não lidas de um remetente específico como lidas';

-- ============================================================================
-- FUNÇÃO: Contar mensagens não lidas
-- ============================================================================
CREATE OR REPLACE FUNCTION public.count_unread_messages(
    p_user_id BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO v_count
    FROM public.chat_messages
    WHERE to_user_id = p_user_id
      AND is_read = FALSE;
    
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.count_unread_messages IS 'Retorna total de mensagens não lidas para um usuário';

-- ============================================================================
-- FUNÇÃO: Obter últimas conversas do usuário
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_recent_conversations(
    p_user_id BIGINT,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    other_user_id BIGINT,
    other_username TEXT,
    last_message TEXT,
    last_message_time TIMESTAMP WITH TIME ZONE,
    unread_count BIGINT,
    is_from_me BOOLEAN
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH latest_messages AS (
        SELECT 
            CASE 
                WHEN m.from_user_id = p_user_id THEN m.to_user_id
                ELSE m.from_user_id
            END as other_user_id,
            m.message_text,
            m.created_at,
            m.from_user_id = p_user_id as is_from_me,
            ROW_NUMBER() OVER (
                PARTITION BY 
                    CASE 
                        WHEN m.from_user_id = p_user_id THEN m.to_user_id
                        ELSE m.from_user_id
                    END
                ORDER BY m.created_at DESC
            ) as rn
        FROM public.chat_messages m
        WHERE m.from_user_id = p_user_id OR m.to_user_id = p_user_id
    )
    SELECT 
        lm.other_user_id,
        u.username::TEXT,
        lm.message_text,
        lm.created_at,
        COALESCE(
            (SELECT COUNT(*) 
             FROM public.chat_messages m2 
             WHERE m2.from_user_id = lm.other_user_id 
               AND m2.to_user_id = p_user_id 
               AND m2.is_read = FALSE),
            0
        ) as unread_count,
        lm.is_from_me
    FROM latest_messages lm
    JOIN public.auth_user u ON u.id = lm.other_user_id
    WHERE lm.rn = 1
      AND u.is_active = TRUE
    ORDER BY lm.created_at DESC
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.get_recent_conversations IS 'Retorna lista das conversas recentes do usuário com preview da última mensagem';

-- ============================================================================
-- TRIGGER: Atualizar timestamp automaticamente
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_chat_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_chat_timestamp ON public.chat_messages;
CREATE TRIGGER trigger_update_chat_timestamp
    BEFORE UPDATE ON public.chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.update_chat_updated_at();

COMMENT ON FUNCTION public.update_chat_updated_at IS 'Atualiza automaticamente o campo updated_at quando uma mensagem é modificada';

-- ============================================================================
-- Dados de exemplo (COMENTADO - remova os -- para executar)
-- ============================================================================
/*
-- Exemplo de envio de mensagem
SELECT public.send_chat_message(1, 2, 'Olá! Como está o projeto?');
SELECT public.send_chat_message(2, 1, 'Tudo bem! Estou trabalhando na nova feature.');

-- Exemplo de listagem de usuários
SELECT * FROM public.get_active_chat_users(1);

-- Exemplo de obter conversa
SELECT * FROM public.get_conversation(1, 2);

-- Exemplo de marcar como lido
SELECT public.mark_messages_as_read(1, 2);

-- Exemplo de contar não lidas
SELECT public.count_unread_messages(1);

-- Exemplo de conversas recentes
SELECT * FROM public.get_recent_conversations(1);
*/

-- ============================================================================
-- FIM DO SCRIPT
-- ============================================================================
