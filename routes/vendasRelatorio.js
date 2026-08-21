const express = require('express');
const { pool } = require('../src/db');
const omieCall = require('../utils/omieCall');
const {
  calcPeriodoComFiltros,
  parseFiltrosRelatorio,
  appendFiltrosSql,
  labelTipoItem,
  CODIGO_VENDEDOR_SQL,
} = require('../utils/vendasRelatorioFiltros');
const { BACKFILL_CODIGO_VENDEDOR_SQL } = require('../utils/nfCodigoVendedor');

const router = express.Router();

let _ensureSchemaPromise = null;
let _cfopSyncAt = 0;
let _statusSyncAt = 0;
let _emissaoDtReady = false;
const CATALOG_SYNC_TTL_MS = 30 * 60 * 1000; // 30 min — evita DISTINCT pesado a cada filtro
const REPORT_CACHE_TTL_MS = 45 * 1000;
const _reportCache = new Map();

function _reportCacheKey(query = {}) {
  const keys = Object.keys(query || {}).sort();
  const norm = {};
  for (const k of keys) {
    const v = query[k];
    if (v == null || v === '') continue;
    norm[k] = Array.isArray(v) ? [...v].map(String).sort() : String(v);
  }
  return JSON.stringify(norm);
}

function _getCachedReport(key) {
  const hit = _reportCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > REPORT_CACHE_TTL_MS) {
    _reportCache.delete(key);
    return null;
  }
  return hit.payload;
}

function _setCachedReport(key, payload) {
  if (_reportCache.size > 80) {
    const oldest = _reportCache.keys().next().value;
    _reportCache.delete(oldest);
  }
  _reportCache.set(key, { at: Date.now(), payload });
}

function _invalidateReportCache() {
  _reportCache.clear();
  _cfopSyncAt = 0;
  _statusSyncAt = 0;
}

function normalizeCfopDigits(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

function formatCfopDisplay(digits) {
  const d = normalizeCfopDigits(digits);
  if (!d) return '';
  if (d.length === 4) return `${d[0]}.${d.slice(1)}`;
  return d;
}

async function ensureVendasRelatorioSchema() {
  if (_ensureSchemaPromise) return _ensureSchemaPromise;
  _ensureSchemaPromise = (async () => {
    // Funde "Vendas" → vendas se ainda estiverem separados (caso de produção)
    try {
      const { organizarSchemasMigracao } = require('../utils/organizarSchemasMigracao');
      await organizarSchemasMigracao(pool);
    } catch (err) {
      console.warn('[vendas] migração de schemas:', err?.message || err);
    }
    await pool.query(`
    CREATE SCHEMA IF NOT EXISTS vendas;
    CREATE TABLE IF NOT EXISTS vendas.relatorio_gerencial (
      id BIGSERIAL PRIMARY KEY,
      mes CHAR(7) NOT NULL UNIQUE,
      plano_acao JSONB NOT NULL DEFAULT '[]'::jsonb,
      conclusao_resumo TEXT,
      conclusao_pontos_criticos TEXT,
      conclusao_oportunidades TEXT,
      editado_por TEXT,
      editado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS vendas_relatorio_gerencial_mes_idx
      ON vendas.relatorio_gerencial (mes);

    CREATE TABLE IF NOT EXISTS vendas.relatorio_gerencial_cfop (
      cfop VARCHAR(10) PRIMARY KEY,
      incluido BOOLEAN NOT NULL DEFAULT TRUE,
      descricao TEXT,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_por TEXT
    );
    CREATE INDEX IF NOT EXISTS vendas_relatorio_gerencial_cfop_incluido_idx
      ON vendas.relatorio_gerencial_cfop (incluido);

    CREATE TABLE IF NOT EXISTS vendas.relatorio_gerencial_status (
      status VARCHAR(40) PRIMARY KEY,
      incluido BOOLEAN NOT NULL DEFAULT TRUE,
      descricao TEXT,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_por TEXT
    );
    CREATE INDEX IF NOT EXISTS vendas_relatorio_gerencial_status_incluido_idx
      ON vendas.relatorio_gerencial_status (incluido);
    ALTER TABLE vendas.relatorio_gerencial_status
      ADD COLUMN IF NOT EXISTS descricao TEXT;

    CREATE TABLE IF NOT EXISTS vendas.vendedores_omie (
      codigo BIGINT PRIMARY KEY,
      nome TEXT,
      email TEXT,
      inativo BOOLEAN NOT NULL DEFAULT FALSE,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE vendas.vendedores_omie
      ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();

    -- Acelera filtro por período (data_emissao é texto; coluna date + índice)
    ALTER TABLE vendas.notas_fiscais_omie
      ADD COLUMN IF NOT EXISTS data_emissao_dt DATE;
    ALTER TABLE vendas.notas_fiscais_omie
      ADD COLUMN IF NOT EXISTS cfop VARCHAR(40);
    ALTER TABLE vendas.notas_fiscais_omie
      ADD COLUMN IF NOT EXISTS codigo_vendedor TEXT;
    CREATE INDEX IF NOT EXISTS idx_notas_fiscais_omie_data_emissao_dt
      ON vendas.notas_fiscais_omie (data_emissao_dt)
      WHERE ativa IS DISTINCT FROM FALSE;
    CREATE INDEX IF NOT EXISTS idx_notas_fiscais_omie_status_ultimo
      ON vendas.notas_fiscais_omie (status_ultimo);
    CREATE INDEX IF NOT EXISTS idx_notas_fiscais_omie_id_pedido_omie
      ON vendas.notas_fiscais_omie (id_pedido_omie)
      WHERE id_pedido_omie IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_notas_fiscais_omie_codigo_vendedor
      ON vendas.notas_fiscais_omie (codigo_vendedor)
      WHERE codigo_vendedor IS NOT NULL;
  `);

    // Backfill leve: preenche vendedor a partir dos títulos da NF (idempotente)
    try {
      await pool.query(BACKFILL_CODIGO_VENDEDOR_SQL);
    } catch (errBf) {
      console.warn('[vendas] backfill codigo_vendedor:', errBf?.message || errBf);
    }

    try {
      await pool.query(`
        CREATE OR REPLACE FUNCTION vendas.trg_nf_set_data_emissao_dt()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          NEW.data_emissao_dt := CASE
            WHEN TRIM(COALESCE(NEW.data_emissao, '')) ~ '^\\d{4}-\\d{2}-\\d{2}'
              THEN LEFT(TRIM(NEW.data_emissao), 10)::date
            WHEN TRIM(COALESCE(NEW.data_emissao, '')) ~ '^\\d{1,2}/\\d{1,2}/\\d{4}'
              THEN to_date(
                regexp_replace(SUBSTRING(TRIM(NEW.data_emissao) FROM 1 FOR 10), ' .*', ''),
                'DD/MM/YYYY'
              )
            ELSE NULL
          END;
          RETURN NEW;
        END;
        $fn$;
      `);
      await pool.query(`DROP TRIGGER IF EXISTS trg_nf_set_data_emissao_dt ON vendas.notas_fiscais_omie`);
      try {
        await pool.query(`
          CREATE TRIGGER trg_nf_set_data_emissao_dt
            BEFORE INSERT OR UPDATE OF data_emissao
            ON vendas.notas_fiscais_omie
            FOR EACH ROW
            EXECUTE FUNCTION vendas.trg_nf_set_data_emissao_dt()
        `);
      } catch (_) {
        await pool.query(`
          CREATE TRIGGER trg_nf_set_data_emissao_dt
            BEFORE INSERT OR UPDATE OF data_emissao
            ON vendas.notas_fiscais_omie
            FOR EACH ROW
            EXECUTE PROCEDURE vendas.trg_nf_set_data_emissao_dt()
        `);
      }
    } catch (err) {
      console.warn('[vendas] trigger data_emissao_dt:', err?.message || err);
    }
  })().catch((err) => {
    _ensureSchemaPromise = null;
    throw err;
  });
  return _ensureSchemaPromise;
}

/** Preenche data_emissao_dt nas NFs antigas (uma vez por processo). */
async function ensureDataEmissaoDtBackfill() {
  await ensureVendasRelatorioSchema();
  if (_emissaoDtReady) return;
  await pool.query(`
    UPDATE vendas.notas_fiscais_omie nf
       SET data_emissao_dt = CASE
         WHEN TRIM(COALESCE(nf.data_emissao, '')) ~ '^\\d{4}-\\d{2}-\\d{2}'
           THEN LEFT(TRIM(nf.data_emissao), 10)::date
         WHEN TRIM(COALESCE(nf.data_emissao, '')) ~ '^\\d{1,2}/\\d{1,2}/\\d{4}'
           THEN to_date(
             regexp_replace(SUBSTRING(TRIM(nf.data_emissao) FROM 1 FOR 10), ' .*', ''),
             'DD/MM/YYYY'
           )
         ELSE NULL
       END
     WHERE nf.data_emissao_dt IS NULL
       AND COALESCE(TRIM(nf.data_emissao), '') <> ''
  `);
  _emissaoDtReady = true;
}

/** Garante catálogo de CFOPs a partir dos itens de pedido (6905 começa desmarcado). */
async function syncRelatorioCfopCatalog(force = false) {
  await ensureVendasRelatorioSchema();
  const now = Date.now();
  if (!force && _cfopSyncAt && (now - _cfopSyncAt) < CATALOG_SYNC_TTL_MS) return;
  await pool.query(`
    INSERT INTO vendas.relatorio_gerencial_cfop (cfop, incluido, descricao)
    SELECT DISTINCT
      REGEXP_REPLACE(TRIM(i.cfop), '\\D', '', 'g') AS cfop,
      (REGEXP_REPLACE(TRIM(i.cfop), '\\D', '', 'g') <> '6905') AS incluido,
      NULL
    FROM vendas.pedidos_venda_itens i
    WHERE COALESCE(TRIM(i.cfop), '') <> ''
      AND REGEXP_REPLACE(TRIM(i.cfop), '\\D', '', 'g') <> ''
    ON CONFLICT (cfop) DO NOTHING
  `);
  try {
    await pool.query(`
      UPDATE vendas.relatorio_gerencial_cfop c
         SET descricao = cfg.descricao
        FROM configuracoes.cfop cfg
       WHERE REGEXP_REPLACE(TRIM(cfg.codigo), '\\D', '', 'g') = c.cfop
         AND COALESCE(TRIM(c.descricao), '') = ''
         AND COALESCE(TRIM(cfg.descricao), '') <> ''
    `);
  } catch (_) {
    /* configuracoes.cfop pode não existir em algum ambiente */
  }
  _cfopSyncAt = now;
}

/** Catálogo de status NF a partir das notas (Autorizada incluída por padrão). */
async function syncRelatorioStatusCatalog(force = false) {
  await ensureVendasRelatorioSchema();
  const now = Date.now();
  if (!force && _statusSyncAt && (now - _statusSyncAt) < CATALOG_SYNC_TTL_MS) return;
  await pool.query(`
    INSERT INTO vendas.relatorio_gerencial_status (status, incluido)
    SELECT DISTINCT
      TRIM(n.status_ultimo) AS status,
      (TRIM(n.status_ultimo) = 'Autorizada') AS incluido
    FROM vendas.notas_fiscais_omie n
    WHERE COALESCE(TRIM(n.status_ultimo), '') <> ''
    ON CONFLICT (status) DO NOTHING
  `);
  _statusSyncAt = now;
}

async function syncVendedoresOmieIfNeeded(force = false) {
  await ensureVendasRelatorioSchema();
  if (!force) {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM vendas.vendedores_omie`);
    if ((rows[0]?.n || 0) > 0) return;
  }
  const appKey = process.env.OMIE_APP_KEY;
  const appSecret = process.env.OMIE_APP_SECRET;
  if (!appKey || !appSecret) return;

  let pagina = 1;
  let totalPaginas = 1;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (force) {
      await client.query(`DELETE FROM vendas.vendedores_omie`);
    }
    while (pagina <= totalPaginas) {
      const data = await omieCall('https://app.omie.com.br/api/v1/geral/vendedores/', {
        call: 'ListarVendedores',
        app_key: appKey,
        app_secret: appSecret,
        param: [{ pagina, registros_por_pagina: 50, apenas_importado_api: 'N' }],
      });
      totalPaginas = Math.max(1, Number(data?.total_de_paginas || 1));
      const cadastro = Array.isArray(data?.cadastro) ? data.cadastro : [];
      for (const v of cadastro) {
        const codigoRaw = String(v?.codigo ?? v?.codigo_vendedor ?? '').replace(/\D/g, '').trim();
        if (!codigoRaw) continue;
        const codigo = Number(codigoRaw);
        if (!Number.isFinite(codigo)) continue;
        const nome = String(v?.nome ?? v?.nome_vendedor ?? '').trim() || null;
        const email = String(v?.email ?? '').trim() || null;
        const inativo = String(v?.inativo ?? 'N').trim().toUpperCase() === 'S';
        await client.query(
          `INSERT INTO vendas.vendedores_omie (codigo, nome, email, inativo, atualizado_em)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (codigo) DO UPDATE SET
             nome = EXCLUDED.nome,
             email = EXCLUDED.email,
             inativo = EXCLUDED.inativo,
             atualizado_em = NOW()`,
          [codigo, nome, email, inativo]
        );
      }
      pagina += 1;
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

function buildEtapaFilter(etapaRaw) {
  const etapa = String(etapaRaw || 'entregue').trim().toLowerCase();
  if (etapa === 'todos' || etapa === '') {
    return {
      sql: '',
      label: 'Todos',
    };
  }
  // Entregues = NF do período (já em nf_emitidas) + pedido faturado/entregue.
  // Aceita faturado=S mesmo com etapa antiga (Omie muda etapa depois do faturamento;
  // sync antigo deixava etapa 60 e excluía NF autorizada do relatório).
  return {
    sql: ` AND (
             p.codigo_pedido IS NULL
             OR TRIM(COALESCE(p.etapa::text, '')) IN ('70', '80')
             OR UPPER(TRIM(COALESCE(p.faturado::text, ''))) IN ('S', '1', 'SIM', 'TRUE')
             OR UPPER(TRIM(COALESCE(p.raw_payload->'infoCadastro'->>'faturado', ''))) IN ('S', '1', 'SIM', 'TRUE')
           )`,
    label: 'Entregues',
  };
}

const NF_DATA_EMISSAO_SQL = `CASE
  WHEN TRIM(COALESCE(nf.data_emissao, '')) ~ '^\\d{4}-\\d{2}-\\d{2}'
    THEN LEFT(TRIM(nf.data_emissao), 10)::date
  WHEN TRIM(COALESCE(nf.data_emissao, '')) ~ '^\\d{1,2}/\\d{1,2}/\\d{4}'
    THEN to_date(regexp_replace(SUBSTRING(TRIM(nf.data_emissao) FROM 1 FOR 10), ' .*', ''), 'DD/MM/YYYY')
  ELSE NULL
END`;

/** Prefere coluna indexada; cai no parse do texto só se ainda não preenchida. */
const NF_DATA_EMISSAO_RESOLVED_SQL = `COALESCE(nf.data_emissao_dt, ${NF_DATA_EMISSAO_SQL})`;

/** Faturamento = notas fiscais de saída no período (não depende do pedido ter sido sincronizado). */
function nfJsonNumSql(...exprs) {
  const parts = exprs.map((expr) =>
    `NULLIF(REGEXP_REPLACE(TRIM(COALESCE(${expr}, '')), ',', '.', 'g'), '')::numeric`
  );
  return `COALESCE(${parts.join(', ')}, 0)`;
}

/** Valor final do item: VProd + VFrete + VOutro + Vseg + VIPI − VDesc. */
const NF_ITEM_LIQUIDO_SQL = `(
  ${nfJsonNumSql(`d->'prod'->>'vProd'`)}
  + ${nfJsonNumSql(`d->'prod'->>'vFrete'`)}
  + ${nfJsonNumSql(`d->'prod'->>'vOutro'`, `d->'prod'->>'vOutros'`)}
  + ${nfJsonNumSql(`d->'prod'->>'vSeg'`, `d->'prod'->>'vSeguro'`)}
  + ${nfJsonNumSql(
    `d->'prod'->>'vIPI'`,
    `d->'imposto'->'IPI'->'IPITrib'->>'vIPI'`,
    `d->'imposto'->'IPI'->>'vIPI'`
  )}
  - ${nfJsonNumSql(`d->'prod'->>'vDesc'`)}
)`;

const NF_ITEM_CFOP_DIGITS_SQL = `REGEXP_REPLACE(TRIM(COALESCE(d->'prod'->>'CFOP', '')), '\\D', '', 'g')`;

/** Item conta no faturamento se CFOP vazio ou marcado como incluído na config. */
const NF_ITEM_CFOP_INCLUIDO_SQL = `(
  ${NF_ITEM_CFOP_DIGITS_SQL} = ''
  OR EXISTS (
    SELECT 1
      FROM vendas.relatorio_gerencial_cfop c
     WHERE c.cfop = ${NF_ITEM_CFOP_DIGITS_SQL}
       AND c.incluido IS TRUE
  )
)`;

const NF_DET_LATERAL_SQL = `jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(nf.payload_ultimo->'det') = 'array' THEN nf.payload_ultimo->'det'
    ELSE '[]'::jsonb
  END
) AS d`;

const NF_DET_FROM_PAYLOAD_SQL = `jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(p.payload_ultimo->'det') = 'array' THEN p.payload_ultimo->'det'
    ELSE '[]'::jsonb
  END
) AS d`;

/**
 * Expande o JSON de itens UMA vez (antes eram 4–5 correlacionados por NF).
 * Depois agrega valor/qtd só dos CFOPs incluídos.
 */
const VENDAS_CTES = `
  nf_periodo AS (
    SELECT
      nf.id,
      nf.numero_nota,
      nf.numero_pedido,
      nf.id_pedido_omie,
      nf.valor_total,
      nf.cfop,
      nf.status_ultimo,
      nf.payload_ultimo,
      NULLIF(TRIM(nf.codigo_vendedor), '') AS codigo_vendedor,
      ${NF_DATA_EMISSAO_RESOLVED_SQL} AS data_emissao_dt
    FROM vendas.notas_fiscais_omie nf
    WHERE nf.ativa IS DISTINCT FROM FALSE
      AND nf.data_emissao_dt IS NOT NULL
      AND nf.data_emissao_dt >= $1::date
      AND nf.data_emissao_dt < $2::date
      AND COALESCE(nf.payload_ultimo->'ide'->>'tpNF', '1') <> '0'
      -- Inutilizada / cancelada / denegada NÃO entram no faturamento
      AND NULLIF(TRIM(COALESCE(nf.payload_ultimo->'ide'->>'dInut', '')), '') IS NULL
      AND NULLIF(TRIM(COALESCE(nf.payload_ultimo->'ide'->>'dCan', '')), '') IS NULL
      AND UPPER(TRIM(COALESCE(nf.payload_ultimo->'ide'->>'cDeneg', 'N'))) NOT IN ('S', '1', 'Y')
      AND UPPER(TRIM(COALESCE(nf.status_ultimo, ''))) NOT IN (
        'CANCELADA', 'DENEGADA', 'INUTILIZADA', 'INUTILIZACAO', 'INUTILIZAÇÃO'
      )
      AND (
        nf.status_ultimo IN (
          SELECT s.status FROM vendas.relatorio_gerencial_status s WHERE s.incluido IS TRUE
        )
        OR NOT EXISTS (SELECT 1 FROM vendas.relatorio_gerencial_status LIMIT 1)
      )
  ),
  nf_det_exp AS (
    SELECT
      p.id AS nf_id,
      ${NF_ITEM_CFOP_DIGITS_SQL} AS cfop_digits,
      GREATEST(0::numeric, ${NF_ITEM_LIQUIDO_SQL}) AS valor_liquido,
      COALESCE(
        NULLIF(REGEXP_REPLACE(TRIM(COALESCE(d->'prod'->>'qCom', d->'prod'->>'nQtde', '')), ',', '.', 'g'), '')::numeric,
        0
      ) AS qtd,
      (
        ${NF_ITEM_CFOP_DIGITS_SQL} = ''
        OR EXISTS (
          SELECT 1
            FROM vendas.relatorio_gerencial_cfop c
           WHERE c.cfop = ${NF_ITEM_CFOP_DIGITS_SQL}
             AND c.incluido IS TRUE
        )
      ) AS cfop_incluido
    FROM nf_periodo p
    CROSS JOIN LATERAL ${NF_DET_FROM_PAYLOAD_SQL}
  ),
  nf_agg AS (
    SELECT
      nf_id,
      TRUE AS tem_itens_payload,
      COALESCE(SUM(valor_liquido) FILTER (WHERE cfop_incluido), 0)::numeric(14,2) AS valor_itens_incluidos,
      COALESCE(SUM(qtd) FILTER (WHERE cfop_incluido), 0)::numeric(14,2) AS qtd_itens_incluidos,
      BOOL_OR(cfop_incluido) AS tem_item_incluido
    FROM nf_det_exp
    GROUP BY nf_id
  ),
  nf_emitidas AS (
    SELECT
      p.id,
      p.numero_nota,
      p.numero_pedido,
      p.id_pedido_omie,
      p.valor_total,
      p.cfop,
      p.status_ultimo,
      p.payload_ultimo,
      p.codigo_vendedor,
      p.data_emissao_dt,
      COALESCE(a.tem_itens_payload, FALSE) AS tem_itens_payload,
      COALESCE(a.valor_itens_incluidos, 0)::numeric(14,2) AS valor_itens_incluidos,
      COALESCE(a.qtd_itens_incluidos, 0)::numeric(14,2) AS qtd_itens_incluidos
    FROM nf_periodo p
    LEFT JOIN nf_agg a ON a.nf_id = p.id
    WHERE
      -- Regra correta: CFOP do ITEM (não do cabeçalho).
      COALESCE(a.tem_item_incluido, FALSE)
      OR (
        -- Legado: payload sem itens → usa CFOP do cabeçalho
        a.nf_id IS NULL
        AND (
          TRIM(COALESCE(p.cfop, '')) = ''
          OR EXISTS (
            SELECT 1
              FROM unnest(string_to_array(p.cfop, ',')) AS raw(cf)
              JOIN vendas.relatorio_gerencial_cfop c
                ON c.cfop = REGEXP_REPLACE(TRIM(raw.cf), '\\D', '', 'g')
               AND c.incluido IS TRUE
          )
        )
      )
  )
`;

function buildBaseCte(etapaSql, pedidoSql = '') {
  return `
    WITH ${VENDAS_CTES},
    base AS (
      SELECT
        COALESCE(p.codigo_pedido, nf.id_pedido_omie, (-nf.id)) AS codigo_pedido,
        COALESCE(NULLIF(TRIM(p.numero_pedido), ''), NULLIF(TRIM(nf.numero_nota), ''), TRIM(nf.id::text)) AS numero_pedido,
        TRIM(${CODIGO_VENDEDOR_SQL}) AS codigo_vendedor,
        CASE
          WHEN p.codigo_pedido IS NULL THEN '70'
          ELSE TRIM(COALESCE(p.etapa::text, ''))
        END AS etapa,
        CASE
          WHEN p.codigo_pedido IS NULL THEN 'Faturado/Entregue'
          WHEN TRIM(COALESCE(p.etapa::text, '')) = '00' THEN 'Aberto'
          WHEN TRIM(COALESCE(p.etapa::text, '')) = '10' THEN 'Em análise'
          WHEN TRIM(COALESCE(p.etapa::text, '')) = '20' THEN 'Aprovado'
          WHEN TRIM(COALESCE(p.etapa::text, '')) = '50' THEN 'Em processamento'
          WHEN TRIM(COALESCE(p.etapa::text, '')) = '60' THEN 'Em separação'
          WHEN TRIM(COALESCE(p.etapa::text, '')) = '70' THEN 'Faturado/Entregue'
          WHEN TRIM(COALESCE(p.etapa::text, '')) = '80' THEN 'Concluído'
          ELSE 'Outras'
        END AS etapa_descricao,
        CASE
          WHEN nf.tem_itens_payload THEN nf.valor_itens_incluidos
          ELSE COALESCE(
            NULLIF(nf.valor_total, 0),
            NULLIF(p.valor_total_pedido, 0),
            0
          )
        END::numeric(14,2) AS valor_total_pedido,
        nf.qtd_itens_incluidos,
        nf.tem_itens_payload,
        COALESCE(NULLIF(TRIM(f.estado), ''), 'N/D') AS estado,
        COALESCE(
          NULLIF(TRIM(f.nome_fantasia), ''),
          NULLIF(TRIM(f.razao_social), ''),
          NULLIF(TRIM(nf.payload_ultimo->'nfDestInt'->>'cRazao'), ''),
          '(sem cliente)'
        ) AS cliente,
        nf.data_emissao_dt,
        nf.data_emissao_dt AS data_ref,
        NULLIF(TRIM(nf.numero_nota), '') AS numero_nf,
        nf.id AS nf_id
      FROM nf_emitidas nf
      LEFT JOIN vendas.pedidos_venda p
        ON p.codigo_pedido = nf.id_pedido_omie
      LEFT JOIN omie.fornecedores f
        ON TRIM(COALESCE(f.codigo_cliente_omie::text, '')) = TRIM(COALESCE(
             p.codigo_cliente::text,
             nf.payload_ultimo->'nfDestInt'->>'nCodCli'
           ))
      WHERE 1=1
        ${etapaSql}
        ${pedidoSql}
    )
  `;
}

const ITENS_CTE = `
  itens_de_nf AS (
    SELECT
      b.codigo_pedido,
      b.estado,
      b.cliente,
      b.data_emissao_dt,
      COALESCE(NULLIF(TRIM(po.descricao_familia), ''), '(sem família)') AS familia,
      COALESCE(
        NULLIF(REGEXP_REPLACE(TRIM(COALESCE(d->'prod'->>'qCom', d->'prod'->>'nQtde', '')), ',', '.', 'g'), '')::numeric,
        0
      )::numeric(14,2) AS quantidade,
      GREATEST(0::numeric, ${NF_ITEM_LIQUIDO_SQL})::numeric(14,2) AS valor_total
    FROM base b
    JOIN vendas.notas_fiscais_omie nf ON nf.id = b.nf_id
    CROSS JOIN LATERAL ${NF_DET_LATERAL_SQL}
    LEFT JOIN produto.produtos_omie po
      ON TRIM(po.codigo) = TRIM(COALESCE(d->'prod'->>'cProd', ''))
    WHERE b.tem_itens_payload IS TRUE
      AND ${NF_ITEM_CFOP_INCLUIDO_SQL}
      __ITEM_SQL__
  ),
  itens_de_pedido AS (
    SELECT
      b.codigo_pedido,
      b.estado,
      b.cliente,
      b.data_emissao_dt,
      COALESCE(NULLIF(TRIM(po.descricao_familia), ''), '(sem família)') AS familia,
      COALESCE(i.quantidade, 0)::numeric(14,2) AS quantidade,
      COALESCE(i.valor_total, 0)::numeric(14,2) AS valor_total
    FROM base b
    JOIN vendas.pedidos_venda_itens i
      ON i.codigo_pedido = b.codigo_pedido
     AND b.codigo_pedido > 0
    LEFT JOIN produto.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
    WHERE b.tem_itens_payload IS NOT TRUE
      AND (
        REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') = ''
        OR REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') IN (
          SELECT c.cfop FROM vendas.relatorio_gerencial_cfop c WHERE c.incluido IS TRUE
        )
      )
      __ITEM_SQL__
  ),
  itens_fallback AS (
    SELECT
      b.codigo_pedido,
      b.estado,
      b.cliente,
      b.data_emissao_dt,
      '(sem família)'::text AS familia,
      0::numeric(14,2) AS quantidade,
      b.valor_total_pedido AS valor_total
    FROM base b
    WHERE b.tem_itens_payload IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1
          FROM vendas.pedidos_venda_itens i
         WHERE i.codigo_pedido = b.codigo_pedido
           AND b.codigo_pedido > 0
      )
      __FALLBACK_GUARD__
  ),
  itens AS (
    SELECT * FROM itens_de_nf
    UNION ALL
    SELECT * FROM itens_de_pedido
    UNION ALL
    SELECT * FROM itens_fallback
  )
`;

function buildItensCte(etapaSql, pedidoSql = '', itemSql = '') {
  const sqlItem = itemSql || '';
  // Com filtro de família/tipo o fallback (pedido inteiro sem itens) distorce KPI/vendedores.
  const fallbackGuard = sqlItem ? 'AND FALSE' : '';
  const itensBlock = ITENS_CTE
    .replace(/__ITEM_SQL__/g, sqlItem)
    .replace(/__FALLBACK_GUARD__/g, fallbackGuard);
  return `
    ${buildBaseCte(etapaSql, pedidoSql).replace(/\s+$/, '')},
    ${itensBlock}
  `;
}

/** Monta itens a partir de vend_rel_base já materializada (evita recalcular nf_emitidas). */
function buildItensFromTempBase(itemSql = '') {
  const sqlItem = itemSql || '';
  const fallbackGuard = sqlItem ? 'AND FALSE' : '';
  const itensBlock = ITENS_CTE
    .replace(/__ITEM_SQL__/g, sqlItem)
    .replace(/__FALLBACK_GUARD__/g, fallbackGuard);
  return `
    WITH base AS (
      SELECT * FROM vend_rel_base
    ),
    ${itensBlock}
  `;
}

function temFiltroItemRelatorio(filtros = {}) {
  const famLista = Array.isArray(filtros.familia) ? filtros.familia : [];
  return !!(
    famLista.length
    || filtros.familia
    || String(filtros.familia_nome || '').trim()
    || String(filtros.tipo || '').trim()
  );
}

function labelMes(yyyymm, nomesMes) {
  const [y, m] = String(yyyymm || '').split('-');
  const mi = parseInt(m, 10);
  return mi >= 1 && mi <= 12 ? `${nomesMes[mi - 1]}/${y}` : yyyymm;
}

function usuarioDaSessao(req) {
  return req.session?.user?.fullName
    || req.session?.user?.username
    || req.session?.user?.login
    || 'sistema';
}

// GET /vendas/relatorio-gerencial/config/cfop
router.get('/vendas/relatorio-gerencial/config/cfop', async (req, res) => {
  try {
    await syncRelatorioCfopCatalog();
    const { rows } = await pool.query(`
      SELECT c.cfop, c.incluido, c.descricao, c.atualizado_em, c.atualizado_por
        FROM vendas.relatorio_gerencial_cfop c
       ORDER BY c.cfop
    `);
    return res.json({
      ok: true,
      cfops: rows.map((r) => ({
        cfop: r.cfop,
        cfop_exibicao: formatCfopDisplay(r.cfop),
        incluido: r.incluido !== false,
        descricao: r.descricao || '',
        atualizado_em: r.atualizado_em || null,
        atualizado_por: r.atualizado_por || null,
      })),
    });
  } catch (err) {
    console.error('[VENDAS] erro listar config CFOP:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /vendas/relatorio-gerencial/config/cfop
router.put('/vendas/relatorio-gerencial/config/cfop', async (req, res) => {
  try {
    await syncRelatorioCfopCatalog();
    const lista = Array.isArray(req.body?.cfops) ? req.body.cfops : null;
    if (!lista) {
      return res.status(400).json({ ok: false, error: 'Informe cfops: [{ cfop, incluido }].' });
    }

    const usuario = usuarioDaSessao(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of lista) {
        const cfop = normalizeCfopDigits(item?.cfop);
        if (!cfop) continue;
        const incluido = item?.incluido !== false && item?.incluido !== 'false' && item?.incluido !== 0;
        await client.query(
          `INSERT INTO vendas.relatorio_gerencial_cfop (cfop, incluido, atualizado_em, atualizado_por)
           VALUES ($1, $2, NOW(), $3)
           ON CONFLICT (cfop) DO UPDATE SET
             incluido = EXCLUDED.incluido,
             atualizado_em = NOW(),
             atualizado_por = EXCLUDED.atualizado_por`,
          [cfop, !!incluido, usuario]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }

    _invalidateReportCache();

    const { rows } = await pool.query(`
      SELECT c.cfop, c.incluido, c.descricao, c.atualizado_em, c.atualizado_por
        FROM vendas.relatorio_gerencial_cfop c
       ORDER BY c.cfop
    `);
    return res.json({
      ok: true,
      cfops: rows.map((r) => ({
        cfop: r.cfop,
        cfop_exibicao: formatCfopDisplay(r.cfop),
        incluido: r.incluido !== false,
        descricao: r.descricao || '',
        atualizado_em: r.atualizado_em || null,
        atualizado_por: r.atualizado_por || null,
      })),
    });
  } catch (err) {
    console.error('[VENDAS] erro salvar config CFOP:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/relatorio-gerencial/config/status
router.get('/vendas/relatorio-gerencial/config/status', async (req, res) => {
  try {
    await syncRelatorioStatusCatalog();
    const { rows } = await pool.query(`
      SELECT s.status, s.incluido, s.atualizado_em, s.atualizado_por
        FROM vendas.relatorio_gerencial_status s
       ORDER BY s.status
    `);
    return res.json({
      ok: true,
      status_list: rows.map((r) => ({
        status: r.status,
        incluido: r.incluido !== false,
        atualizado_em: r.atualizado_em || null,
        atualizado_por: r.atualizado_por || null,
      })),
    });
  } catch (err) {
    console.error('[VENDAS] erro listar config status NF:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /vendas/relatorio-gerencial/config/status
router.put('/vendas/relatorio-gerencial/config/status', async (req, res) => {
  try {
    await syncRelatorioStatusCatalog();
    const lista = Array.isArray(req.body?.status_list) ? req.body.status_list : null;
    if (!lista) {
      return res.status(400).json({ ok: false, error: 'Informe status_list: [{ status, incluido }].' });
    }

    const usuario = usuarioDaSessao(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of lista) {
        const status = String(item?.status || '').trim();
        if (!status) continue;
        const incluido = item?.incluido !== false && item?.incluido !== 'false' && item?.incluido !== 0;
        await client.query(
          `INSERT INTO vendas.relatorio_gerencial_status (status, incluido, atualizado_em, atualizado_por)
           VALUES ($1, $2, NOW(), $3)
           ON CONFLICT (status) DO UPDATE SET
             incluido = EXCLUDED.incluido,
             atualizado_em = NOW(),
             atualizado_por = EXCLUDED.atualizado_por`,
          [status, !!incluido, usuario]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }

    _invalidateReportCache();

    const { rows } = await pool.query(`
      SELECT s.status, s.incluido, s.atualizado_em, s.atualizado_por
        FROM vendas.relatorio_gerencial_status s
       ORDER BY s.status
    `);
    return res.json({
      ok: true,
      status_list: rows.map((r) => ({
        status: r.status,
        incluido: r.incluido !== false,
        atualizado_em: r.atualizado_em || null,
        atualizado_por: r.atualizado_por || null,
      })),
    });
  } catch (err) {
    console.error('[VENDAS] erro salvar config status NF:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/relatorio-gerencial/registros — lista dos pedidos do KPI Pedidos/Faturamento
router.get('/vendas/relatorio-gerencial/registros', async (req, res) => {
  try {
    await ensureDataEmissaoDtBackfill();
    await Promise.all([
      syncRelatorioCfopCatalog(),
      syncRelatorioStatusCatalog(),
    ]);
    const filtros = parseFiltrosRelatorio(req.query);
    const periodoCfg = calcPeriodoComFiltros(filtros);
    const etapaCfg = buildEtapaFilter(filtros.etapa);
    const rangeParams = [periodoCfg.inicio, periodoCfg.fimExclusive];
    const { pedidoSql, itemSql } = appendFiltrosSql(filtros, rangeParams);
    const LIMITE = 5000;
    const comFiltroItem = temFiltroItemRelatorio(filtros);
    const sql = comFiltroItem
      ? `
      ${buildItensCte(etapaCfg.sql, pedidoSql, itemSql)}
      , base_filtrada AS (
        SELECT
          b.*,
          COALESCE((
            SELECT SUM(i.valor_total)::numeric(14,2)
              FROM itens i
             WHERE i.codigo_pedido = b.codigo_pedido
          ), 0) AS valor_filtrado,
          COALESCE((
            SELECT SUM(i.quantidade)::float
              FROM itens i
             WHERE i.codigo_pedido = b.codigo_pedido
          ), 0) AS qtd_filtrada
        FROM base b
        WHERE EXISTS (
          SELECT 1 FROM itens i WHERE i.codigo_pedido = b.codigo_pedido
        )
      )
      SELECT
        b.codigo_pedido,
        b.numero_pedido,
        b.cliente,
        b.data_ref AS data,
        b.valor_filtrado::float AS valor_total,
        b.numero_nf,
        b.nf_id,
        COALESCE(
          NULLIF(TRIM(v.nome), ''),
          NULLIF(TRIM(b.codigo_vendedor), ''),
          '—'
        ) AS vendedor,
        b.qtd_filtrada AS qtd
      FROM base_filtrada b
      LEFT JOIN vendas.vendedores_omie v
        ON TRIM(v.codigo::text) = TRIM(b.codigo_vendedor)
      ORDER BY b.data_ref DESC NULLS LAST, b.valor_filtrado DESC, b.numero_pedido
      LIMIT ${LIMITE}
    `
      : `
      ${buildBaseCte(etapaCfg.sql, pedidoSql)}
      SELECT
        b.codigo_pedido,
        b.numero_pedido,
        b.cliente,
        b.data_ref AS data,
        b.valor_total_pedido::float AS valor_total,
        b.numero_nf,
        b.nf_id,
        COALESCE(
          NULLIF(TRIM(v.nome), ''),
          NULLIF(TRIM(b.codigo_vendedor), ''),
          '—'
        ) AS vendedor,
        CASE
          WHEN b.tem_itens_payload THEN b.qtd_itens_incluidos::float
          ELSE COALESCE(
            (
              SELECT SUM(COALESCE(i.quantidade, 0))::float
                FROM vendas.pedidos_venda_itens i
               WHERE i.codigo_pedido = b.codigo_pedido
                 AND b.codigo_pedido > 0
            ),
            0
          )
        END AS qtd
      FROM base b
      LEFT JOIN vendas.vendedores_omie v
        ON TRIM(v.codigo::text) = TRIM(b.codigo_vendedor)
      ORDER BY b.data_ref DESC NULLS LAST, b.valor_total_pedido DESC, b.numero_pedido
      LIMIT ${LIMITE}
    `;
    const { rows } = await pool.query(sql, rangeParams);
    let registros = (rows || []).map((r) => ({
      codigo_pedido: r.codigo_pedido,
      numero_pedido: r.numero_pedido,
      cliente: r.cliente,
      data: r.data,
      qtd: Math.round(Number(r.qtd || 0) * 100) / 100,
      vendedor: r.vendedor,
      nf: r.numero_nf || '',
      nf_id: r.nf_id || null,
      valor_total: Math.round(Number(r.valor_total || 0) * 100) / 100,
    }));

    // Excel / export detalhado: anexa produtos em 1–2 queries (não 1 por pedido).
    const comItens = String(req.query.com_itens || '').trim() === '1';
    if (comItens && registros.length) {
      registros = await anexarItensNosRegistros(registros);
    }

    const valor_total = Math.round(
      registros.reduce((s, r) => s + (Number(r.valor_total) || 0), 0) * 100
    ) / 100;
    return res.json({
      ok: true,
      periodo: periodoCfg.label,
      etapa: etapaCfg.label,
      total_pedidos: registros.length,
      valor_total,
      truncated: registros.length >= LIMITE,
      com_itens: comItens,
      registros,
    });
  } catch (err) {
    console.error('[VENDAS] erro registros relatorio-gerencial:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/** Carrega itens de vários pedidos/NFs de uma vez (para Excel). */
async function anexarItensNosRegistros(registros) {
  const { rows: cfopRows } = await pool.query(`
    SELECT cfop FROM vendas.relatorio_gerencial_cfop WHERE incluido IS TRUE
  `);
  const cfopsIncluidos = new Set((cfopRows || []).map((r) => String(r.cfop || '')));

  const nfIds = [...new Set(
    registros.map((r) => Number(r.nf_id)).filter((n) => Number.isFinite(n) && n > 0)
  )];
  const byNf = new Map();
  if (nfIds.length) {
    const { rows: nfRows } = await pool.query(`
      SELECT id, payload_ultimo
        FROM vendas.notas_fiscais_omie
       WHERE id = ANY($1::bigint[])
    `, [nfIds]);
    for (const nf of nfRows || []) {
      byNf.set(
        String(nf.id),
        itensFromNfPayload(nf.payload_ultimo || {}, { cfopsIncluidos, somenteIncluidos: true })
      );
    }
  }

  const byPedido = new Map();
  const precisaPedido = registros.filter((r) => {
    const nfItens = r.nf_id ? byNf.get(String(r.nf_id)) : null;
    return !Array.isArray(nfItens) || nfItens.length === 0;
  });
  const codigos = [...new Set(
    precisaPedido
      .map((r) => Number(r.codigo_pedido))
      .filter((n) => Number.isFinite(n) && n > 0)
  )];
  if (codigos.length) {
    const { rows } = await pool.query(`
      SELECT
        i.codigo_pedido,
        i.codigo,
        COALESCE(po.descricao, i.descricao, '-') AS descricao,
        i.quantidade,
        COALESCE(i.valor_total, 0)::numeric(14,2) AS valor_total,
        REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') AS cfop_digits
      FROM vendas.pedidos_venda_itens i
      LEFT JOIN produto.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
      WHERE i.codigo_pedido = ANY($1::bigint[])
      ORDER BY i.codigo_pedido, i.descricao NULLS LAST, i.codigo
    `, [codigos]);
    for (const row of rows || []) {
      const cfopDigits = String(row.cfop_digits || '');
      if (cfopDigits && !cfopsIncluidos.has(cfopDigits)) continue;
      const key = String(row.codigo_pedido);
      if (!byPedido.has(key)) byPedido.set(key, []);
      byPedido.get(key).push({
        codigo: row.codigo || '',
        descricao: row.descricao || '-',
        quantidade: Math.round(Number(row.quantidade || 0) * 100) / 100,
        valor_total: Math.round(Number(row.valor_total || 0) * 100) / 100,
        cfop: cfopDigits,
      });
    }
  }

  return registros.map((r) => {
    const nfItens = r.nf_id ? (byNf.get(String(r.nf_id)) || []) : [];
    const itens = nfItens.length
      ? nfItens
      : (byPedido.get(String(r.codigo_pedido || '')) || []);
    return { ...r, itens };
  });
}

function mapItensPedidoRows(rows) {
  return (rows || []).map((r) => ({
    codigo: r.codigo || '',
    descricao: r.descricao || '-',
    quantidade: Math.round(Number(r.quantidade || 0) * 100) / 100,
    valor_total: Math.round(Number(r.valor_total || 0) * 100) / 100,
    cfop: r.cfop || '',
  }));
}

function nfNumCampo(valor) {
  return Number.parseFloat(String(valor ?? '0').replace(',', '.')) || 0;
}

function valorLiquidoItemProd(prod = {}, det = {}) {
  const ipi = det?.imposto?.IPI || {};
  const bruto = nfNumCampo(prod.vProd)
    + nfNumCampo(prod.vFrete)
    + nfNumCampo(prod.vOutro ?? prod.vOutros)
    + nfNumCampo(prod.vSeg ?? prod.vSeguro)
    + nfNumCampo(prod.vIPI ?? ipi?.IPITrib?.vIPI ?? ipi?.vIPI);
  const desc = nfNumCampo(prod.vDesc);
  return Math.round(Math.max(0, bruto - desc) * 100) / 100;
}

/**
 * Itens do payload da NF.
 * Valor final: VProd + VFrete + VOutro + Vseg + VIPI − VDesc.
 * somenteIncluidos=true → só CFOPs marcados na config (CFOP vazio entra).
 */
function itensFromNfPayload(payload, opts = {}) {
  const det = Array.isArray(payload?.det)
    ? payload.det
    : (Array.isArray(payload?.event?.det) ? payload.event.det : []);
  const somenteIncluidos = opts.somenteIncluidos === true;
  const cfopsIncluidos = opts.cfopsIncluidos instanceof Set ? opts.cfopsIncluidos : null;
  const out = [];
  for (const d of det) {
    const prod = d?.prod || {};
    const cfopDigits = String(prod.CFOP || '').replace(/\D/g, '');
    if (somenteIncluidos && cfopsIncluidos) {
      if (cfopDigits && !cfopsIncluidos.has(cfopDigits)) continue;
    }
    const qRaw = String(prod.qCom ?? prod.nQtde ?? '0').replace(',', '.');
    out.push({
      codigo: String(prod.cProd || prod.codigo || '').trim(),
      descricao: String(prod.xProd || prod.descricao || '-').trim() || '-',
      quantidade: Math.round((Number.parseFloat(qRaw) || 0) * 100) / 100,
      valor_total: valorLiquidoItemProd(prod, d),
      cfop: cfopDigits,
    });
  }
  return out;
}

// GET /vendas/relatorio-gerencial/pedido-itens/:codigoPedido — produtos do pedido/NF
router.get('/vendas/relatorio-gerencial/pedido-itens/:codigoPedido', async (req, res) => {
  const codigoPedido = String(req.params.codigoPedido || '').trim();
  const nfIdRaw = String(req.query.nf_id || '').trim();
  if (!codigoPedido && !nfIdRaw) {
    return res.status(400).json({ ok: false, error: 'codigoPedido ou nf_id é obrigatório.' });
  }
  try {
    const codigoNum = Number(codigoPedido);
    let nfId = Number.parseInt(nfIdRaw, 10);
    if (!Number.isFinite(nfId) || nfId <= 0) {
      if (Number.isFinite(codigoNum) && codigoNum < 0) nfId = Math.abs(codigoNum);
    }

    // Prefere itens da NF (valor final VProd+frete+outros+seguro+IPI−desconto) quando houver nf_id.
    if (Number.isFinite(nfId) && nfId > 0) {
      const { rows: nfRows } = await pool.query(`
        SELECT payload_ultimo, numero_nota, numero_pedido, id_pedido_omie
          FROM vendas.notas_fiscais_omie
         WHERE id = $1
         LIMIT 1
      `, [nfId]);
      const nf = nfRows[0];
      if (nf) {
        const rowsNf = itensFromNfPayload(nf.payload_ultimo || {});
        if (rowsNf.length) {
          return res.json({
            ok: true,
            origem: 'nf',
            nf: nf.numero_nota || '',
            numero_pedido: nf.numero_pedido || '',
            rows: rowsNf,
          });
        }
        if (nf.id_pedido_omie) {
          const { rows } = await pool.query(`
            SELECT
              i.codigo,
              COALESCE(po.descricao, i.descricao, '-') AS descricao,
              i.quantidade,
              COALESCE(i.valor_total, 0)::numeric(14,2) AS valor_total,
              REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') AS cfop
            FROM vendas.pedidos_venda_itens i
            LEFT JOIN produto.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
            WHERE i.codigo_pedido = $1
            ORDER BY i.descricao NULLS LAST, i.codigo
          `, [nf.id_pedido_omie]);
          if (rows.length) {
            return res.json({
              ok: true,
              origem: 'pedido',
              nf: nf.numero_nota || '',
              numero_pedido: nf.numero_pedido || '',
              rows: mapItensPedidoRows(rows),
            });
          }
        }
      }
    }

    if (Number.isFinite(codigoNum) && codigoNum > 0) {
      const { rows } = await pool.query(`
        SELECT
          i.codigo,
          COALESCE(po.descricao, i.descricao, '-') AS descricao,
          i.quantidade,
          COALESCE(i.valor_total, 0)::numeric(14,2) AS valor_total,
          REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') AS cfop
        FROM vendas.pedidos_venda_itens i
        LEFT JOIN produto.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
        WHERE i.codigo_pedido = $1
        ORDER BY i.descricao NULLS LAST, i.codigo
      `, [codigoPedido]);
      if (rows.length) {
        return res.json({ ok: true, origem: 'pedido', rows: mapItensPedidoRows(rows) });
      }
    }

    return res.json({ ok: true, origem: 'vazio', rows: [] });
  } catch (err) {
    console.error('[VENDAS] erro pedido-itens relatorio-gerencial:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/relatorio-gerencial/filtros-opcoes
router.get('/vendas/relatorio-gerencial/filtros-opcoes', async (req, res) => {
  try {
    await syncVendedoresOmieIfNeeded();
    const syncVendedores = String(req.query.sync_vendedores || '').trim() === '1';
    if (syncVendedores) {
      await syncVendedoresOmieIfNeeded(true);
    }

    const [rAnos, rVendedores, rFamilias, rEstados, rTipos] = await Promise.all([
      pool.query(`
        SELECT DISTINCT EXTRACT(YEAR FROM p.updated_at)::int AS ano
          FROM vendas.pedidos_venda p
         WHERE p.updated_at IS NOT NULL
         ORDER BY 1 DESC
         LIMIT 15
      `),
      pool.query(`
        SELECT codigo, nome
          FROM vendas.vendedores_omie
         WHERE inativo IS DISTINCT FROM TRUE
         ORDER BY nome NULLS LAST, codigo
      `),
      pool.query(`
        SELECT DISTINCT
          TRIM(po.codigo_familia::text) AS codigo,
          COALESCE(NULLIF(TRIM(po.descricao_familia), ''), TRIM(po.codigo_familia::text)) AS descricao
          FROM produto.produtos_omie po
         WHERE po.codigo_familia IS NOT NULL
           AND TRIM(po.codigo_familia::text) <> ''
         ORDER BY 2, 1
         LIMIT 500
      `),
      pool.query(`
        SELECT DISTINCT UPPER(TRIM(f.estado)) AS uf
          FROM omie.fornecedores f
         WHERE COALESCE(TRIM(f.estado), '') <> ''
         ORDER BY 1
      `),
      pool.query(`
        SELECT DISTINCT LPAD(TRIM(COALESCE(po.tipoitem, '')), 2, '0') AS codigo
          FROM produto.produtos_omie po
         WHERE TRIM(COALESCE(po.tipoitem, '')) <> ''
         ORDER BY 1
      `),
    ]);

    return res.json({
      ok: true,
      anos: (rAnos.rows || []).map((r) => r.ano).filter(Boolean),
      vendedores: (rVendedores.rows || []).map((r) => ({
        codigo: r.codigo,
        nome: r.nome || r.codigo,
      })),
      familias: (rFamilias.rows || []).map((r) => ({
        codigo: r.codigo,
        descricao: r.descricao || r.codigo,
      })),
      estados: (rEstados.rows || []).map((r) => r.uf),
      tipos: (rTipos.rows || []).map((r) => ({
        codigo: r.codigo,
        label: labelTipoItem(r.codigo),
      })),
    });
  } catch (err) {
    console.error('[VENDAS] erro filtros-opcoes relatorio-gerencial:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/relatorio-gerencial
router.get('/vendas/relatorio-gerencial', async (req, res) => {
  const t0 = Date.now();
  try {
    const cacheKey = _reportCacheKey(req.query);
    const cached = _getCachedReport(cacheKey);
    if (cached) {
      res.setHeader('X-Vendas-Relatorio-Cache', 'HIT');
      res.setHeader('X-Vendas-Relatorio-Ms', String(Date.now() - t0));
      return res.json(cached);
    }

    await ensureDataEmissaoDtBackfill();
    await Promise.all([
      syncRelatorioCfopCatalog(),
      syncRelatorioStatusCatalog(),
    ]);
    const filtros = parseFiltrosRelatorio(req.query);
    const etapaParam = filtros.etapa;
    const periodoCfg = calcPeriodoComFiltros(filtros);
    const etapaCfg = buildEtapaFilter(etapaParam);
    const {
      inicio: mesInicio,
      fimExclusive: mesFimExclusive,
      label: periodoLabel,
      modo,
      meses: mesesPeriodo,
      evolucaoTipo,
      mesRef: mesRaw,
    } = periodoCfg;
    const rangeParams = [mesInicio, mesFimExclusive];
    const {
      pedidoSql,
      itemSqlStandalone,
      nBaseParams,
      itemParams,
    } = appendFiltrosSql(filtros, rangeParams);
    const baseParams = rangeParams.slice(0, nBaseParams);
    const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    const baseCte = buildBaseCte(etapaCfg.sql, pedidoSql);
    const itensFromBaseSql = buildItensFromTempBase(itemSqlStandalone);

    const evolucaoSql = evolucaoTipo === 'mes'
      ? `SELECT
          TO_CHAR(DATE_TRUNC('month', data_ref), 'YYYY-MM') AS mes_key,
          COUNT(*)::int AS total_pedidos,
          COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
        FROM vend_rel_base
        GROUP BY 1
        ORDER BY 1`
      : `SELECT
          LEAST(5, GREATEST(1, CEIL(EXTRACT(DAY FROM data_ref) / 7.0)::int)) AS semana,
          COUNT(*)::int AS total_pedidos,
          COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
        FROM vend_rel_base
        GROUP BY 1
        ORDER BY 1`;

    const client = await pool.connect();
    let rKpi;
    let rEstado;
    let rFamilia;
    let rCliente;
    let rEtapa;
    let rEvolucao;
    let rFinanceiro;
    let rFamiliaEstado;
    let rMesFamilia;
    let rMesTotal;
    let rFamiliaCliente;
    let rQtdItens;
    let rCfopCfg;
    let rVendedor;
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TEMP TABLE vend_rel_base ON COMMIT DROP AS
        ${baseCte}
        SELECT * FROM base
      `, baseParams);
      await client.query(`CREATE INDEX ON vend_rel_base (codigo_pedido)`);
      await client.query(`
        CREATE TEMP TABLE vend_rel_itens ON COMMIT DROP AS
        ${itensFromBaseSql}
        SELECT * FROM itens
      `, itemParams);
      await client.query(`CREATE INDEX ON vend_rel_itens (codigo_pedido)`);
      await client.query(`CREATE INDEX ON vend_rel_itens (familia)`);

      // Com filtro de família/tipo: KPI e vendedores usam só o valor dos itens filtrados
      // (senão o pedido inteiro entrava quando havia produto de outra família no mesmo pedido).
      if (temFiltroItemRelatorio(filtros)) {
        await client.query(`
          DELETE FROM vend_rel_base b
          WHERE NOT EXISTS (
            SELECT 1 FROM vend_rel_itens i WHERE i.codigo_pedido = b.codigo_pedido
          )
        `);
        await client.query(`
          UPDATE vend_rel_base b
             SET valor_total_pedido = COALESCE((
               SELECT SUM(i.valor_total)::numeric(14,2)
                 FROM vend_rel_itens i
                WHERE i.codigo_pedido = b.codigo_pedido
             ), 0)
        `);
      }

      rKpi = await client.query(`
        SELECT
          COUNT(*)::int AS total_pedidos,
          COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total,
          COALESCE(AVG(valor_total_pedido) FILTER (WHERE valor_total_pedido > 0), 0)::float AS ticket_medio,
          COUNT(DISTINCT cliente) FILTER (WHERE cliente <> '(sem cliente)')::int AS clientes,
          COUNT(DISTINCT estado) FILTER (WHERE estado <> 'N/D')::int AS estados_atendidos
        FROM vend_rel_base
      `);
      rEstado = await client.query(`
        SELECT estado, COUNT(*)::int AS total, COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
        FROM vend_rel_base
        GROUP BY estado
        ORDER BY valor_total DESC, total DESC, estado
      `);
      rFamilia = await client.query(`
        SELECT familia,
          COUNT(DISTINCT codigo_pedido)::int AS total,
          COALESCE(SUM(quantidade), 0)::float AS quantidade,
          COALESCE(SUM(valor_total), 0)::float AS valor_total
        FROM vend_rel_itens
        GROUP BY familia
        ORDER BY valor_total DESC, quantidade DESC, familia
        LIMIT 15
      `);
      rCliente = await client.query(`
        SELECT cliente, COUNT(*)::int AS total, COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
        FROM vend_rel_base
        GROUP BY cliente
        ORDER BY valor_total DESC, total DESC, cliente
        LIMIT 15
      `);
      rEtapa = await client.query(`
        SELECT etapa, etapa_descricao, COUNT(*)::int AS total,
          COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
        FROM vend_rel_base
        GROUP BY etapa, etapa_descricao
        ORDER BY total DESC
      `);
      rEvolucao = await client.query(evolucaoSql);
      rFinanceiro = await client.query(`
        SELECT codigo_pedido, numero_pedido, cliente, estado, data_ref AS data,
          valor_total_pedido::float AS valor_total
        FROM vend_rel_base
        WHERE valor_total_pedido > 0
        ORDER BY valor_total_pedido DESC
        LIMIT 20
      `);
      rFamiliaEstado = await client.query(`
        SELECT familia, estado, COALESCE(SUM(valor_total), 0)::float AS valor_total
        FROM vend_rel_itens
        GROUP BY familia, estado
        ORDER BY familia, valor_total DESC
      `);
      rMesFamilia = await client.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', data_emissao_dt), 'YYYY-MM') AS mes,
          familia,
          COALESCE(SUM(quantidade), 0)::float AS quantidade,
          COALESCE(SUM(valor_total), 0)::float AS valor_total
        FROM vend_rel_itens
        WHERE data_emissao_dt IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1, 4 DESC, 2
      `);
      rMesTotal = await client.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', data_emissao_dt), 'YYYY-MM') AS mes,
          COALESCE(SUM(quantidade), 0)::float AS quantidade,
          COALESCE(SUM(valor_total), 0)::float AS valor_total
        FROM vend_rel_itens
        WHERE data_emissao_dt IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `);
      rFamiliaCliente = await client.query(`
        SELECT familia, cliente, COALESCE(SUM(valor_total), 0)::float AS valor_total
        FROM vend_rel_itens
        GROUP BY familia, cliente
        ORDER BY familia, valor_total DESC
      `);
      rQtdItens = await client.query(`
        SELECT COALESCE(SUM(quantidade), 0)::float AS quantidade_itens
        FROM vend_rel_itens
      `);
      rCfopCfg = await client.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE incluido IS TRUE)::int AS incluidos,
          COUNT(*) FILTER (WHERE incluido IS FALSE)::int AS excluidos
        FROM vendas.relatorio_gerencial_cfop
      `);
      rVendedor = await client.query(`
        SELECT
          b.codigo_vendedor,
          COALESCE(
            NULLIF(TRIM(v.nome), ''),
            NULLIF(TRIM(b.codigo_vendedor), ''),
            '(sem vendedor)'
          ) AS vendedor,
          COUNT(*)::int AS total_pedidos,
          COALESCE(SUM(b.valor_total_pedido), 0)::float AS valor_total,
          COALESCE(AVG(b.valor_total_pedido) FILTER (WHERE b.valor_total_pedido > 0), 0)::float AS ticket_medio,
          COUNT(DISTINCT b.cliente) FILTER (WHERE b.cliente <> '(sem cliente)')::int AS clientes,
          COUNT(DISTINCT b.estado) FILTER (WHERE b.estado <> 'N/D')::int AS estados
        FROM vend_rel_base b
        LEFT JOIN vendas.vendedores_omie v
          ON TRIM(v.codigo::text) = TRIM(b.codigo_vendedor)
        GROUP BY b.codigo_vendedor, v.nome
        ORDER BY valor_total DESC, total_pedidos DESC, vendedor
      `);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }

    const kpi = rKpi.rows[0] || {};
    const familias = rFamilia.rows || [];
    const famTotal = familias.reduce((s, r) => s + (r.valor_total || 0), 0);
    let acum = 0;
    const pareto = familias.map((r) => {
      acum += r.valor_total || 0;
      return {
        familia: r.familia,
        total: r.total,
        valor_total: Math.round((r.valor_total || 0) * 100) / 100,
        pct: famTotal ? Math.round((r.valor_total / famTotal) * 1000) / 10 : 0,
        pct_acum: famTotal ? Math.round((acum / famTotal) * 1000) / 10 : 0,
      };
    });

    const janelaFimLabel = (() => {
      const d = new Date(mesFimExclusive);
      d.setDate(d.getDate() - 1);
      return d.toLocaleDateString('pt-BR');
    })();

    const { rows: rTextos } = await pool.query(
      `SELECT plano_acao, conclusao_resumo, conclusao_pontos_criticos, conclusao_oportunidades,
              editado_por, editado_em
         FROM vendas.relatorio_gerencial
        WHERE mes = $1`,
      [mesRaw]
    );
    const txtRow = rTextos[0];
    const textos = txtRow ? {
      plano_acao: Array.isArray(txtRow.plano_acao) ? txtRow.plano_acao : [],
      conclusao_resumo: txtRow.conclusao_resumo || '',
      conclusao_pontos_criticos: txtRow.conclusao_pontos_criticos || '',
      conclusao_oportunidades: txtRow.conclusao_oportunidades || '',
      editado_por: txtRow.editado_por || null,
      editado_em: txtRow.editado_em || null,
      salvo: true,
    } : {
      plano_acao: [],
      conclusao_resumo: '',
      conclusao_pontos_criticos: '',
      conclusao_oportunidades: '',
      editado_por: null,
      editado_em: null,
      salvo: false,
    };

    const cfgCfop = rCfopCfg.rows[0] || {};

    const payload = {
      ok: true,
      mes: mesRaw,
      modo,
      etapa: etapaCfg.label,
      periodo: periodoLabel,
      evolucao_tipo: evolucaoTipo,
      filtros_aplicados: {
        modo: filtros.modo,
        etapa: etapaParam,
        data_inicio: filtros.data_inicio || null,
        data_fim: filtros.data_fim || null,
        trimestre: filtros.trimestre || null,
        vendedor: filtros.vendedor || null,
        familia: (Array.isArray(filtros.familia) && filtros.familia.length) ? filtros.familia : null,
        familia_nome: filtros.familia_nome || null,
        estado: filtros.estado || null,
        tipo: filtros.tipo || null,
        cliente: filtros.cliente || null,
        etapa_pedido: filtros.etapa_pedido || null,
      },
      cfop_config: {
        total: cfgCfop.total || 0,
        incluidos: cfgCfop.incluidos || 0,
        excluidos: cfgCfop.excluidos || 0,
      },
      kpis: {
        total_pedidos: kpi.total_pedidos || 0,
        valor_total: Math.round((kpi.valor_total || 0) * 100) / 100,
        ticket_medio: Math.round((kpi.ticket_medio || 0) * 100) / 100,
        clientes: kpi.clientes || 0,
        estados_atendidos: kpi.estados_atendidos || 0,
        quantidade_itens: Math.round((rQtdItens.rows[0]?.quantidade_itens || 0) * 100) / 100,
      },
      por_estado: rEstado.rows || [],
      por_familia: familias,
      por_cliente: rCliente.rows || [],
      por_vendedor: (rVendedor.rows || []).map((r) => ({
        codigo_vendedor: r.codigo_vendedor || '',
        vendedor: r.vendedor,
        total_pedidos: r.total_pedidos,
        valor_total: Math.round((r.valor_total || 0) * 100) / 100,
        ticket_medio: Math.round((r.ticket_medio || 0) * 100) / 100,
        clientes: r.clientes,
        estados: r.estados,
      })),
      por_etapa: rEtapa.rows || [],
      familia_por_estado: rFamiliaEstado.rows || [],
      evolucao_semanal: evolucaoTipo === 'semana'
        ? (rEvolucao.rows || []).map((r) => ({
          semana: `Sem ${r.semana}`,
          total_pedidos: r.total_pedidos,
          valor_total: Math.round((r.valor_total || 0) * 100) / 100,
        }))
        : [],
      evolucao_mensal: evolucaoTipo === 'mes'
        ? (rEvolucao.rows || []).map((r) => ({
          mes: r.mes_key,
          label: labelMes(r.mes_key, nomesMes),
          total_pedidos: r.total_pedidos,
          valor_total: Math.round((r.valor_total || 0) * 100) / 100,
        }))
        : [],
      pareto,
      financeiro: (rFinanceiro.rows || []).map((r) => ({
        codigo_pedido: r.codigo_pedido,
        numero_pedido: r.numero_pedido,
        cliente: r.cliente,
        estado: r.estado,
        data: r.data,
        valor_total: Math.round(Number(r.valor_total || 0) * 100) / 100,
      })),
      analise_itens: {
        por_mes_familia: (rMesFamilia.rows || []).map((r) => ({
          mes: r.mes,
          label: labelMes(r.mes, nomesMes),
          familia: r.familia,
          quantidade: r.quantidade,
          valor_total: Math.round((r.valor_total || 0) * 100) / 100,
        })),
        por_mes_entrega: (rMesTotal.rows || []).map((r) => ({
          mes: r.mes,
          label: labelMes(r.mes, nomesMes),
          quantidade: r.quantidade,
          valor_total: Math.round((r.valor_total || 0) * 100) / 100,
        })),
        familia_por_cliente: rFamiliaCliente.rows || [],
        janela: {
          inicio: new Date(mesInicio).toLocaleDateString('pt-BR'),
          fim: janelaFimLabel,
          meses: mesesPeriodo,
          total_itens: Math.round((rQtdItens.rows[0]?.quantidade_itens || 0) * 100) / 100,
        },
      },
      textos,
    };
    _setCachedReport(cacheKey, payload);
    res.setHeader('X-Vendas-Relatorio-Cache', 'MISS');
    res.setHeader('X-Vendas-Relatorio-Ms', String(Date.now() - t0));
    return res.json(payload);
  } catch (err) {
    console.error('[VENDAS] erro relatorio-gerencial:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /vendas/relatorio-gerencial/textos
router.put('/vendas/relatorio-gerencial/textos', async (req, res) => {
  try {
    await ensureVendasRelatorioSchema();
    const mesRaw = String(req.body?.mes || '').trim();
    if (!/^\d{4}-\d{2}$/.test(mesRaw)) {
      return res.status(400).json({ ok: false, error: 'Parâmetro mes inválido (use YYYY-MM).' });
    }

    const planoRaw = req.body?.plano_acao;
    if (!Array.isArray(planoRaw)) {
      return res.status(400).json({ ok: false, error: 'plano_acao deve ser uma lista.' });
    }

    const prioridadesValidas = new Set(['alta', 'media', 'baixa']);
    const plano_acao = planoRaw.map((item) => {
      const prioridade = String(item?.prioridade || 'media').toLowerCase().trim();
      return {
        acao: String(item?.acao || '').trim().slice(0, 200),
        descricao: String(item?.descricao || '').trim().slice(0, 500),
        responsavel: String(item?.responsavel || '').trim().slice(0, 120),
        prazo: String(item?.prazo || '').trim().slice(0, 40),
        prioridade: prioridadesValidas.has(prioridade) ? prioridade : 'media',
      };
    }).filter((item) => item.acao || item.descricao || item.responsavel || item.prazo);

    const conclusao_resumo = String(req.body?.conclusao_resumo || '').trim().slice(0, 4000);
    const conclusao_pontos_criticos = String(req.body?.conclusao_pontos_criticos || '').trim().slice(0, 4000);
    const conclusao_oportunidades = String(req.body?.conclusao_oportunidades || '').trim().slice(0, 4000);

    const usuarioLogado = usuarioDaSessao(req);

    const { rows } = await pool.query(
      `INSERT INTO vendas.relatorio_gerencial (
         mes, plano_acao, conclusao_resumo, conclusao_pontos_criticos, conclusao_oportunidades, editado_por, editado_em
       ) VALUES ($1, $2::jsonb, $3, $4, $5, $6, NOW())
       ON CONFLICT (mes) DO UPDATE SET
         plano_acao = EXCLUDED.plano_acao,
         conclusao_resumo = EXCLUDED.conclusao_resumo,
         conclusao_pontos_criticos = EXCLUDED.conclusao_pontos_criticos,
         conclusao_oportunidades = EXCLUDED.conclusao_oportunidades,
         editado_por = EXCLUDED.editado_por,
         editado_em = NOW()
       RETURNING mes, plano_acao, conclusao_resumo, conclusao_pontos_criticos, conclusao_oportunidades, editado_por, editado_em`,
      [
        mesRaw,
        JSON.stringify(plano_acao),
        conclusao_resumo || null,
        conclusao_pontos_criticos || null,
        conclusao_oportunidades || null,
        usuarioLogado,
      ]
    );

    const row = rows[0];
    _invalidateReportCache();
    return res.json({
      ok: true,
      textos: {
        plano_acao: row.plano_acao || [],
        conclusao_resumo: row.conclusao_resumo || '',
        conclusao_pontos_criticos: row.conclusao_pontos_criticos || '',
        conclusao_oportunidades: row.conclusao_oportunidades || '',
        editado_por: row.editado_por,
        editado_em: row.editado_em,
        salvo: true,
      },
    });
  } catch (err) {
    console.error('[VENDAS] erro salvar textos relatorio-gerencial:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
