-- Adiciona coluna de conta Google vinculada ao usuario do sistema
ALTER TABLE public.auth_user
ADD COLUMN IF NOT EXISTS conta_google TEXT;

-- Indice para consultas por conta Google vinculada
CREATE INDEX IF NOT EXISTS idx_auth_user_conta_google
ON public.auth_user (conta_google)
WHERE conta_google IS NOT NULL;

COMMENT ON COLUMN public.auth_user.conta_google IS 'Email da conta Google vinculada para convites e sincronizacao de agenda';
