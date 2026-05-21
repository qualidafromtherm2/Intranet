-- Migração: cria tabela sac.sac_atalhos para links/atalhos de URL por usuário
-- Execução: node -e "require('dotenv').config(); const {Pool}=require('pg'); const fs=require('fs'); const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); p.query(fs.readFileSync('./scripts/create_sac_atalhos.sql','utf8')).then(()=>{console.log('OK');p.end()}).catch(e=>{console.error(e.message);p.end()})"

CREATE SCHEMA IF NOT EXISTS sac;

CREATE TABLE IF NOT EXISTS sac.sac_atalhos (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  url         TEXT NOT NULL,
  icon_class  TEXT NOT NULL DEFAULT 'fa-solid fa-link',
  icon_color  TEXT NOT NULL DEFAULT '#38bdf8',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sac_atalhos_user_id ON sac.sac_atalhos (user_id);

COMMENT ON TABLE sac.sac_atalhos
  IS 'Links/atalhos de URL salvos por usuário no painel SAC';
