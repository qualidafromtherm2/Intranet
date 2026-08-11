const express = require('express');
const { pool } = require('../src/db');
const omieCall = require('../utils/omieCall');
const {
  calcPeriodoComFiltros,
  parseFiltrosRelatorio,
  appendFiltrosSql,
  labelTipoItem,
} = require('../utils/vendasRelatorioFiltros');

const router = express.Router();

let _ensureSchemaPromise = null;

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
  `);
  })().catch((err) => {
    _ensureSchemaPromise = null;
    throw err;
  });
  return _ensureSchemaPromise;
}

/** Garante catálogo de CFOPs a partir dos itens de pedido (6905 começa desmarcado). */
async function syncRelatorioCfopCatalog() {
  await ensureVendasRelatorioSchema();
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
}

/** Catálogo de status NF a partir das notas (Autorizada incluída por padrão). */
async function syncRelatorioStatusCatalog() {
  await ensureVendasRelatorioSchema();
  await pool.query(`
    INSERT INTO vendas.relatorio_gerencial_status (status, incluido)
    SELECT DISTINCT
      TRIM(n.status_ultimo) AS status,
      (TRIM(n.status_ultimo) = 'Autorizada') AS incluido
    FROM vendas.notas_fiscais_omie n
    WHERE COALESCE(TRIM(n.status_ultimo), '') <> ''
    ON CONFLICT (status) DO NOTHING
  `);
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
  return {
    sql: ` AND (
             p.codigo_pedido IS NULL
             OR TRIM(COALESCE(p.etapa::text, '')) = '70'
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

/** Faturamento = notas fiscais de saída no período (não depende do pedido ter sido sincronizado). */
const VENDAS_CTES = `
  nf_emitidas AS (
    SELECT
      nf.id,
      nf.numero_nota,
      nf.numero_pedido,
      nf.id_pedido_omie,
      nf.valor_total,
      nf.cfop,
      nf.status_ultimo,
      nf.payload_ultimo,
      ${NF_DATA_EMISSAO_SQL} AS data_emissao_dt
    FROM vendas.notas_fiscais_omie nf
    WHERE nf.ativa IS DISTINCT FROM FALSE
      AND ${NF_DATA_EMISSAO_SQL} >= $1::date
      AND ${NF_DATA_EMISSAO_SQL} < $2::date
      AND COALESCE(nf.payload_ultimo->'ide'->>'tpNF', '1') <> '0'
      AND (
        nf.status_ultimo IN (
          SELECT s.status FROM vendas.relatorio_gerencial_status s WHERE s.incluido IS TRUE
        )
        OR NOT EXISTS (SELECT 1 FROM vendas.relatorio_gerencial_status LIMIT 1)
      )
      AND (
        TRIM(COALESCE(nf.cfop, '')) = ''
        OR EXISTS (
          SELECT 1
            FROM unnest(string_to_array(nf.cfop, ',')) AS raw(cf)
            JOIN vendas.relatorio_gerencial_cfop c
              ON c.cfop = REGEXP_REPLACE(TRIM(raw.cf), '\\D', '', 'g')
             AND c.incluido IS TRUE
        )
      )
      AND NOT EXISTS (
        SELECT 1
          FROM unnest(string_to_array(COALESCE(nf.cfop, ''), ',')) AS raw(cf)
          JOIN vendas.relatorio_gerencial_cfop c
            ON c.cfop = REGEXP_REPLACE(TRIM(raw.cf), '\\D', '', 'g')
           AND c.incluido IS FALSE
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
        TRIM(COALESCE(p.informacoes_adicionais->>'codVend', '')) AS codigo_vendedor,
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
        COALESCE(
          NULLIF(nf.valor_total, 0),
          NULLIF(p.valor_total_pedido, 0),
          0
        )::numeric(14,2) AS valor_total_pedido,
        COALESCE(NULLIF(TRIM(f.estado), ''), 'N/D') AS estado,
        COALESCE(
          NULLIF(TRIM(f.nome_fantasia), ''),
          NULLIF(TRIM(f.razao_social), ''),
          NULLIF(TRIM(nf.payload_ultimo->'nfDestInt'->>'cRazao'), ''),
          '(sem cliente)'
        ) AS cliente,
        nf.data_emissao_dt,
        nf.data_emissao_dt AS data_ref
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
  itens_base AS (
    SELECT
      i.codigo_pedido,
      COALESCE(NULLIF(TRIM(po.descricao_familia), ''), '(sem família)') AS familia,
      COALESCE(i.quantidade, 0)::numeric(14,2) AS quantidade,
      COALESCE(i.valor_total, 0)::numeric(14,2) AS valor_total
    FROM vendas.pedidos_venda_itens i
    LEFT JOIN produto.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
    WHERE (
      REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') = ''
      OR REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') IN (
        SELECT c.cfop FROM vendas.relatorio_gerencial_cfop c WHERE c.incluido IS TRUE
      )
    )
    __ITEM_SQL__
  )
`;

function buildItensCte(etapaSql, pedidoSql = '', itemSql = '') {
  const itensBlock = ITENS_CTE.replace('__ITEM_SQL__', itemSql || '');
  return `
    ${buildBaseCte(etapaSql, pedidoSql).replace(/\s+$/, '')},
    ${itensBlock},
    itens AS (
      SELECT
        b.codigo_pedido,
        b.estado,
        b.cliente,
        b.data_emissao_dt,
        COALESCE(ib.familia, '(sem família)') AS familia,
        COALESCE(ib.quantidade, 0)::numeric(14,2) AS quantidade,
        COALESCE(ib.valor_total, b.valor_total_pedido) AS valor_total
      FROM base b
      LEFT JOIN itens_base ib ON ib.codigo_pedido = b.codigo_pedido
    )
  `;
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
  try {
    await syncRelatorioCfopCatalog();
    await syncRelatorioStatusCatalog();
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
    const { pedidoSql, itemSql } = appendFiltrosSql(filtros, rangeParams);
    const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    const baseCte = buildBaseCte(etapaCfg.sql, pedidoSql);
    const itensCte = buildItensCte(etapaCfg.sql, pedidoSql, itemSql);

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
      `, rangeParams);
      await client.query(`
        CREATE TEMP TABLE vend_rel_itens ON COMMIT DROP AS
        ${itensCte}
        SELECT * FROM itens
      `, rangeParams);

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
        LIMIT 30
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

    return res.json({
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
        familia: filtros.familia || null,
        estado: filtros.estado || null,
        tipo: filtros.tipo || null,
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
    });
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
