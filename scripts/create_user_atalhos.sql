-- Migração: cria schema "User" e tabela preferencia_atalho
-- Execução: psql $DATABASE_URL -f scripts/create_user_atalhos.sql

CREATE SCHEMA IF NOT EXISTS "User";

CREATE TABLE IF NOT EXISTS "User".preferencia_atalho (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
  nav_key      TEXT NOT NULL,
  nav_label    TEXT NOT NULL,
  nav_selector TEXT,
  icon_class   TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT uq_atalho_user_key UNIQUE (user_id, nav_key)
);

CREATE INDEX IF NOT EXISTS idx_atalho_user_id ON "User".preferencia_atalho (user_id);

COMMENT ON TABLE "User".preferencia_atalho
  IS 'Atalhos rápidos personalizados por usuário (zona flutuante de drag-and-drop)';
