-- =============================================================================
-- TABELA UNIFICADA DE HISTÓRICO DE COMPRAS
-- Objetivo:
--   - Consolidar registros de compras.solicitacao_compras e compras.compras_sem_cadastro
--   - Registrar automaticamente novas inserções de ambas as tabelas
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS compras;

CREATE TABLE IF NOT EXISTS compras.historico_compras (
  id BIGSERIAL PRIMARY KEY,
  grupo_requisicao VARCHAR(100) NOT NULL,
  status VARCHAR(100),
  d_dt_previsao DATE,
  tabela_origem TEXT NOT NULL CHECK (tabela_origem IN ('solicitacao_compras', 'compras_sem_cadastro')),
  dados JSONB NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE compras.historico_compras
ADD COLUMN IF NOT EXISTS status VARCHAR(100);

ALTER TABLE compras.historico_compras
DROP COLUMN IF EXISTS registro_origem_id;

DROP INDEX IF EXISTS compras.uq_historico_compras_origem;

DROP INDEX IF EXISTS compras.uq_historico_compras_grupo;

CREATE INDEX IF NOT EXISTS idx_historico_compras_grupo_requisicao
  ON compras.historico_compras(grupo_requisicao);

CREATE INDEX IF NOT EXISTS idx_historico_compras_created_at
  ON compras.historico_compras(created_at DESC);

COMMENT ON TABLE compras.historico_compras IS 'Histórico unificado de registros de compras das tabelas solicitacao_compras e compras_sem_cadastro';
COMMENT ON COLUMN compras.historico_compras.grupo_requisicao IS 'Grupo de requisição vindo da tabela de origem';
COMMENT ON COLUMN compras.historico_compras.status IS 'Status vindo da tabela de origem';
COMMENT ON COLUMN compras.historico_compras.tabela_origem IS 'Tabela de origem do registro (solicitacao_compras ou compras_sem_cadastro)';
COMMENT ON COLUMN compras.historico_compras.dados IS 'Snapshot completo do registro da tabela de origem no momento da inserção';

-- Carga inicial consolidada: mantém apenas o PRIMEIRO registro de cada grupo_requisicao
TRUNCATE TABLE compras.historico_compras RESTART IDENTITY;

WITH origem AS (
  SELECT
    NULLIF(BTRIM(to_jsonb(s)->>'grupo_requisicao'), '') AS grupo_requisicao,
    to_jsonb(s)->>'status' AS status,
    'solicitacao_compras'::text AS tabela_origem,
    to_jsonb(s) AS dados,
    COALESCE(
      NULLIF(to_jsonb(s)->>'created_at', '')::timestamp,
      NULLIF(to_jsonb(s)->>'criado_em', '')::timestamp,
      NOW()
    ) AS origem_created_at
  FROM compras.solicitacao_compras s

  UNION ALL

  SELECT
    NULLIF(BTRIM(to_jsonb(c)->>'grupo_requisicao'), '') AS grupo_requisicao,
    to_jsonb(c)->>'status' AS status,
    'compras_sem_cadastro'::text AS tabela_origem,
    to_jsonb(c) AS dados,
    COALESCE(
      NULLIF(to_jsonb(c)->>'created_at', '')::timestamp,
      NULLIF(to_jsonb(c)->>'criado_em', '')::timestamp,
      NOW()
    ) AS origem_created_at
  FROM compras.compras_sem_cadastro c
), primeiro_por_grupo AS (
  SELECT DISTINCT ON (origem.grupo_requisicao)
    origem.grupo_requisicao,
    origem.status,
    origem.tabela_origem,
    origem.dados,
    origem.origem_created_at
  FROM origem
  WHERE origem.grupo_requisicao IS NOT NULL
  ORDER BY origem.grupo_requisicao, origem.origem_created_at ASC, origem.tabela_origem ASC
)
INSERT INTO compras.historico_compras (
  grupo_requisicao,
  status,
  tabela_origem,
  dados,
  created_at
)
SELECT
  p.grupo_requisicao,
  p.status,
  p.tabela_origem,
  p.dados,
  p.origem_created_at
FROM primeiro_por_grupo p
ORDER BY p.origem_created_at ASC, p.grupo_requisicao ASC;

ALTER TABLE compras.historico_compras
ALTER COLUMN grupo_requisicao SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_historico_compras_grupo
  ON compras.historico_compras(grupo_requisicao);

-- Função única de sincronização automática
CREATE OR REPLACE FUNCTION compras.fn_sync_historico_compras_insert()
RETURNS TRIGGER AS $fn$
DECLARE
  v_created_at TIMESTAMP;
  v_grupo_requisicao TEXT;
BEGIN
  v_grupo_requisicao := NULLIF(BTRIM(to_jsonb(NEW)->>'grupo_requisicao'), '');

  IF v_grupo_requisicao IS NULL THEN
    RETURN NEW;
  END IF;

  v_created_at := COALESCE(
    NULLIF(to_jsonb(NEW)->>'created_at', '')::timestamp,
    NULLIF(to_jsonb(NEW)->>'criado_em', '')::timestamp,
    NOW()
  );

  INSERT INTO compras.historico_compras (
    grupo_requisicao,
    status,
    tabela_origem,
    dados,
    created_at
  ) VALUES (
    v_grupo_requisicao,
    to_jsonb(NEW)->>'status',
    TG_TABLE_NAME,
    to_jsonb(NEW),
    v_created_at
  )
  ON CONFLICT (grupo_requisicao) DO NOTHING;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historico_compras_solicitacao_insert ON compras.solicitacao_compras;
CREATE TRIGGER trg_historico_compras_solicitacao_insert
AFTER INSERT ON compras.solicitacao_compras
FOR EACH ROW
EXECUTE FUNCTION compras.fn_sync_historico_compras_insert();

DROP TRIGGER IF EXISTS trg_historico_compras_sem_cadastro_insert ON compras.compras_sem_cadastro;
CREATE TRIGGER trg_historico_compras_sem_cadastro_insert
AFTER INSERT ON compras.compras_sem_cadastro
FOR EACH ROW
EXECUTE FUNCTION compras.fn_sync_historico_compras_insert();
