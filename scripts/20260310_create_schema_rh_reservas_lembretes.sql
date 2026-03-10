-- Objetivo: criar/atualizar estrutura RH para reservas e lembretes do calendário

CREATE SCHEMA IF NOT EXISTS rh;

CREATE TABLE IF NOT EXISTS rh.reservas_ambientes (
  id BIGSERIAL PRIMARY KEY,
  tipo_espaco TEXT NOT NULL CHECK (tipo_espaco IN ('Auditório', 'Sala de reunião')),
  tema_reuniao TEXT NOT NULL,
  data_reserva DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL,
  repetir BOOLEAN NOT NULL DEFAULT false,
  repetir_todos_meses BOOLEAN NOT NULL DEFAULT false,
  dias_semana TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  cafe BOOLEAN NOT NULL DEFAULT false,
  criado_por TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reservas_ambientes_hora_ck CHECK (hora_fim > hora_inicio)
);

ALTER TABLE rh.reservas_ambientes
  ADD COLUMN IF NOT EXISTS repetir_todos_meses BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS rh.reservas_participantes (
  id BIGSERIAL PRIMARY KEY,
  reserva_id BIGINT NOT NULL REFERENCES rh.reservas_ambientes(id) ON DELETE CASCADE,
  username TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS reservas_participantes_unq
ON rh.reservas_participantes (reserva_id, username);

CREATE INDEX IF NOT EXISTS reservas_ambientes_data_tipo_idx
ON rh.reservas_ambientes (data_reserva, tipo_espaco);

CREATE TABLE IF NOT EXISTS rh.lembretes_calendario (
  id BIGSERIAL PRIMARY KEY,
  data_lembrete DATE NOT NULL,
  texto TEXT NOT NULL,
  criado_por TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rh.lembretes_destinatarios (
  id BIGSERIAL PRIMARY KEY,
  lembrete_id BIGINT NOT NULL REFERENCES rh.lembretes_calendario(id) ON DELETE CASCADE,
  username TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS lembretes_destinatarios_unq
ON rh.lembretes_destinatarios (lembrete_id, username);

CREATE INDEX IF NOT EXISTS lembretes_calendario_data_idx
ON rh.lembretes_calendario (data_lembrete);
