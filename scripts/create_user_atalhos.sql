-- Migração: schema usuario + preferencia_atalho (atalhos flutuantes + cards Início)
-- Execução: psql $DATABASE_URL -f scripts/create_user_atalhos.sql

CREATE SCHEMA IF NOT EXISTS usuario;

CREATE TABLE IF NOT EXISTS usuario.preferencia_atalho (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
  nav_key      TEXT NOT NULL,
  nav_label    TEXT NOT NULL,
  nav_selector TEXT,
  icon_class   TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  flag_atalho  BOOLEAN NOT NULL DEFAULT true,
  flag_inicio  BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT uq_atalho_user_key UNIQUE (user_id, nav_key)
);

-- Bases já existentes: adiciona colunas sem quebrar linhas antigas
ALTER TABLE usuario.preferencia_atalho
  ADD COLUMN IF NOT EXISTS flag_atalho BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE usuario.preferencia_atalho
  ADD COLUMN IF NOT EXISTS flag_inicio BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_atalho_user_id ON usuario.preferencia_atalho (user_id);

COMMENT ON TABLE usuario.preferencia_atalho
  IS 'Preferências por usuário: atalho flutuante (flag_atalho) e card na Início celular (flag_inicio)';
