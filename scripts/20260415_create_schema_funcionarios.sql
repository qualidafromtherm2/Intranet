-- Schema RH — EPI e conversas (antes: funcionarios.*)
-- Criado em: 2026-04-15 · caminho canônico atualizado 2026-08-07
-- Compat: views funcionarios.* são criadas por utils/organizarSchemasMigracao.js

CREATE SCHEMA IF NOT EXISTS rh;
CREATE SCHEMA IF NOT EXISTS funcionarios;

CREATE TABLE IF NOT EXISTS rh.epi (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES public.auth_user(id) ON DELETE CASCADE,
  tam_camiseta  VARCHAR(20),
  tam_calca     VARCHAR(20),
  tam_sapato    VARCHAR(20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rh.epi_entrega (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
  item          VARCHAR(100) NOT NULL,
  tamanho       VARCHAR(20),
  data_entrega  DATE NOT NULL DEFAULT CURRENT_DATE,
  observacao    TEXT,
  registrado_por VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epi_entrega_user ON rh.epi_entrega(user_id);

CREATE TABLE IF NOT EXISTS rh.conversas (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
  tema          VARCHAR(255) NOT NULL,
  descricao     TEXT,
  registrado_por VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversas_user ON rh.conversas(user_id);

CREATE OR REPLACE VIEW funcionarios.epi AS SELECT * FROM rh.epi;
CREATE OR REPLACE VIEW funcionarios.epi_entrega AS SELECT * FROM rh.epi_entrega;
CREATE OR REPLACE VIEW funcionarios.conversas AS SELECT * FROM rh.conversas;
