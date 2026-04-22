-- ============================================================
-- TABELA DE SESSÕES (connect-pg-simple)
-- Objetivo: Persistir sessões do express-session no Postgres
-- para que login do usuário sobreviva a deploys/restart do app.
--
-- Observação: a aplicação está configurada com createTableIfMissing=true,
-- então este script é apenas uma referência/idempotente para DBA.
-- ============================================================

CREATE TABLE IF NOT EXISTS public."session" (
  sid     varchar      NOT NULL COLLATE "default",
  sess    json         NOT NULL,
  expire  timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'session_pkey'
      AND conrelid = 'public.session'::regclass
  ) THEN
    ALTER TABLE public."session"
      ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON public."session" ("expire");
