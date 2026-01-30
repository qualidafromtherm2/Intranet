-- Adiciona coluna de preferência de tema ao usuário
-- Objetivo: Armazenar preferência de tema claro/escuro por usuário

ALTER TABLE public.auth_user 
ADD COLUMN theme_preference VARCHAR(10) DEFAULT 'dark' 
CHECK (theme_preference IN ('dark', 'light'));

-- Criar índice para melhor performance (opcional)
CREATE INDEX idx_auth_user_theme_preference ON public.auth_user(theme_preference);

-- Atualizar qualquer usuário existente com valor padrão
UPDATE public.auth_user SET theme_preference = 'dark' WHERE theme_preference IS NULL;
