-- Schema: funcionarios
-- Tabelas: epi, epi_entrega, conversas
-- Criado em: 2026-04-15

CREATE SCHEMA IF NOT EXISTS funcionarios;

-- Tamanhos de EPI do funcionário
CREATE TABLE IF NOT EXISTS funcionarios.epi (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES public.auth_user(id) ON DELETE CASCADE,
  tam_camiseta  VARCHAR(20),
  tam_calca     VARCHAR(20),
  tam_sapato    VARCHAR(20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Histórico de entregas de EPI
CREATE TABLE IF NOT EXISTS funcionarios.epi_entrega (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
  item          VARCHAR(100) NOT NULL,
  tamanho       VARCHAR(20),
  data_entrega  DATE NOT NULL DEFAULT CURRENT_DATE,
  observacao    TEXT,
  registrado_por VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epi_entrega_user ON funcionarios.epi_entrega(user_id);

-- Histórico de conversas com o funcionário
CREATE TABLE IF NOT EXISTS funcionarios.conversas (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
  tema          VARCHAR(255) NOT NULL,
  descricao     TEXT,
  registrado_por VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversas_user ON funcionarios.conversas(user_id);
