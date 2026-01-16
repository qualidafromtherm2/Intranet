-- ============================================================================
-- Adicionar coluna de email na tabela auth_user
-- Data: 16/01/2026
-- Objetivo: Armazenar o e-mail dos colaboradores na tabela de usuários
-- ============================================================================

-- Adiciona a coluna email se ela não existir
ALTER TABLE public.auth_user 
ADD COLUMN IF NOT EXISTS email TEXT;

-- Adiciona comentário descritivo na coluna
COMMENT ON COLUMN public.auth_user.email IS 'Endereço de e-mail do colaborador';

-- Opcional: criar índice para busca por email (útil para futuras implementações)
CREATE INDEX IF NOT EXISTS idx_auth_user_email ON public.auth_user(email) WHERE email IS NOT NULL;

-- ============================================================================
-- Para aplicar este script, execute:
-- psql -h <host> -U <user> -d <database> -f scripts/add_email_column_to_auth_user.sql
-- ============================================================================
