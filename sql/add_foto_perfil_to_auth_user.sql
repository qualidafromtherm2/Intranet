-- Adiciona coluna foto_perfil_url na tabela auth_user
-- Esta coluna armazenará a URL da foto de perfil do usuário hospedada no Supabase

ALTER TABLE public.auth_user 
ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT;

COMMENT ON COLUMN public.auth_user.foto_perfil_url IS 'URL da foto de perfil do usuário armazenada no Supabase';
