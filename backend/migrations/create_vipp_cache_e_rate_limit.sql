-- Cache compartilhado e flag de rate limit para integracoes VIPP.
-- Substitui caches em memoria por estado durado em SQL,
-- visivel entre processos PM2 e instancias.

-- 1) Persistencia do payload usado para gerar etiqueta/declaracao.
ALTER TABLE envios.solicitacoes
  ADD COLUMN IF NOT EXISTS vipp_payload JSONB;

-- 2) Cache compartilhado do retorno de SituacaoPostagem.
CREATE TABLE IF NOT EXISTS etiqueta.vipp_situacao_cache (
  etiqueta         TEXT PRIMARY KEY,
  dados            JSONB        NOT NULL,
  fonte            TEXT         NOT NULL DEFAULT 'soap',
  capturado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expira_em        TIMESTAMPTZ  NOT NULL,
  ultima_consulta  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  hits             INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS vipp_situacao_cache_expira_idx
  ON etiqueta.vipp_situacao_cache (expira_em);

-- 3) Flag global de bloqueio por endpoint VIPP (rate limit, cota diaria, etc).
CREATE TABLE IF NOT EXISTS etiqueta.vipp_rate_limit (
  endpoint         TEXT PRIMARY KEY,
  bloqueado_ate    TIMESTAMPTZ,
  motivo           TEXT,
  http_status      INTEGER,
  detectado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
