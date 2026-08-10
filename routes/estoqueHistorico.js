/**
 * routes/estoqueHistorico.js
 *
 * APIs usadas pelas abas Armazéns → Posição de Estoque / Oscilação.
 *
 * GET /api/estoque/datas-disponiveis
 * GET /api/estoque/posicao-por-data?data=YYYY-MM-DD&pagina=1&limite=200
 * GET /api/estoque/oscilacao-nivel?periodo=30|60|90|tudo
 * GET /api/estoque/oscilacao-fluxo?periodo=30|60|90|tudo
 * GET /api/estoque/oscilacao-diaria  → alias de oscilacao-nivel (compat)
 */
const express = require('express');
const router = express.Router();
const { dbQuery } = require('../src/db');

const TAG = '[estoqueHistorico]';

function parsePeriodoDias(periodoRaw) {
  const p = String(periodoRaw || '30').trim().toLowerCase();
  if (p === 'tudo' || p === 'all') return null;
  const n = parseInt(p, 10);
  if ([30, 60, 90].includes(n)) return n;
  return 30;
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return toIsoDate(dt);
}

function listarDatasAsc(dataInicio, dataFim) {
  const out = [];
  let cur = dataInicio;
  while (cur <= dataFim) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

async function mapaNomesLocais() {
  const { rows } = await dbQuery(`
    SELECT local_codigo::text AS codigo, NULLIF(TRIM(nome), '') AS nome
      FROM omie.omie_locais_estoque
  `);
  const map = new Map();
  for (const r of rows) {
    if (r.codigo) map.set(String(r.codigo), r.nome || String(r.codigo));
  }
  // Fallback: nomes em estoque_atual
  const { rows: atuais } = await dbQuery(`
    SELECT DISTINCT local_codigo::text AS codigo, NULLIF(TRIM(local_nome), '') AS nome
      FROM logistica.estoque_atual
     WHERE local_codigo IS NOT NULL
  `);
  for (const r of atuais) {
    if (r.codigo && !map.has(String(r.codigo)) && r.nome) {
      map.set(String(r.codigo), r.nome);
    }
  }
  return map;
}

function nomeArmazem(codigo, nomes) {
  const c = String(codigo || '').trim();
  if (!c) return 'Sem armazém';
  return nomes.get(c) || c;
}

/** Datas com snapshot disponível (mais recente primeiro) — aba Posição. */
router.get('/datas-disponiveis', async (_req, res) => {
  try {
    const { rows } = await dbQuery(`
      SELECT DISTINCT data_posicao::text AS data
        FROM omie.omie_estoque_posicao
       WHERE data_posicao IS NOT NULL
       ORDER BY data DESC
    `);
    return res.json({ ok: true, datas: rows.map(r => r.data) });
  } catch (err) {
    console.error(TAG, 'datas-disponiveis:', err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || 'Erro ao listar datas' });
  }
});

/** Posição de estoque em uma data (paginado) — aba Posição. */
router.get('/posicao-por-data', async (req, res) => {
  try {
    const data = String(req.query.data || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return res.status(400).json({ ok: false, error: 'Informe data no formato YYYY-MM-DD' });
    }

    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const limite = Math.min(500, Math.max(1, parseInt(req.query.limite, 10) || 200));
    const offset = (pagina - 1) * limite;

    const { rows: countRows } = await dbQuery(
      `SELECT COUNT(*)::int AS total
         FROM omie.omie_estoque_posicao
        WHERE data_posicao = $1::date`,
      [data]
    );
    const totalRegistros = countRows[0]?.total || 0;
    const totalPaginas = Math.max(1, Math.ceil(totalRegistros / limite));

    const { rows } = await dbQuery(
      `SELECT
         p.codigo,
         COALESCE(p.descricao, '') AS descricao,
         p.local_codigo,
         COALESCE(p.fisico, 0) AS fisico,
         COALESCE(p.saldo, 0) AS saldo,
         COALESCE(p.cmc, 0) AS cmc,
         COALESCE(p.estoque_minimo, 0) AS min
       FROM omie.omie_estoque_posicao p
       WHERE p.data_posicao = $1::date
       ORDER BY p.local_codigo, p.codigo
       LIMIT $2 OFFSET $3`,
      [data, limite, offset]
    );

    return res.json({
      ok: true,
      dados: rows,
      pagina,
      totalPaginas,
      totalRegistros,
    });
  } catch (err) {
    console.error(TAG, 'posicao-por-data:', err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || 'Erro ao buscar posição' });
  }
});

/**
 * Deltas diários por local_codigo (fisico e valor).
 * ENT +, SAI −, TRF origem − / destino +.
 * SLD ignorado na reconstrução (não dá para inverter sem saldo anterior).
 */
async function carregarDeltasPorDia(dataInicio) {
  const params = [dataInicio];
  const { rows } = await dbQuery(
    `
    WITH mov AS (
      SELECT
        COALESCE(a.data_movimentacao, a.criado_em::date) AS dia,
        a.local_estoque::text AS local_codigo,
        CASE UPPER(COALESCE(a.tipo_operacao, ''))
          WHEN 'ENT' THEN COALESCE(a.qtd, 0)
          WHEN 'SAI' THEN -COALESCE(a.qtd, 0)
          ELSE 0
        END AS delta_fisico,
        CASE UPPER(COALESCE(a.tipo_operacao, ''))
          WHEN 'ENT' THEN COALESCE(a.qtd, 0) * COALESCE(a.cmc, 0)
          WHEN 'SAI' THEN -COALESCE(a.qtd, 0) * COALESCE(a.cmc, 0)
          ELSE 0
        END AS delta_valor
      FROM logistica.ajustes_estoque a
      WHERE lower(COALESCE(a.status, '')) = 'executado'
        AND UPPER(COALESCE(a.tipo_operacao, '')) IN ('ENT', 'SAI')
        AND COALESCE(a.data_movimentacao, a.criado_em::date) >= $1::date
        AND a.local_estoque IS NOT NULL
        AND TRIM(a.local_estoque::text) <> ''

      UNION ALL

      SELECT
        t.data_movimentacao AS dia,
        t.origem::text AS local_codigo,
        -COALESCE(t.qtd, 0) AS delta_fisico,
        -COALESCE(t.qtd, 0) * COALESCE(t.cmc, 0) AS delta_valor
      FROM logistica.transferencias t
      WHERE lower(COALESCE(t.status, '')) = 'transferido'
        AND t.data_movimentacao >= $1::date
        AND t.origem IS NOT NULL
        AND TRIM(t.origem::text) <> ''

      UNION ALL

      SELECT
        t.data_movimentacao AS dia,
        t.destino::text AS local_codigo,
        COALESCE(t.qtd, 0) AS delta_fisico,
        COALESCE(t.qtd, 0) * COALESCE(t.cmc, 0) AS delta_valor
      FROM logistica.transferencias t
      WHERE lower(COALESCE(t.status, '')) = 'transferido'
        AND t.data_movimentacao >= $1::date
        AND t.destino IS NOT NULL
        AND TRIM(t.destino::text) <> ''
    )
    SELECT
      dia::text AS data,
      local_codigo,
      ROUND(SUM(delta_fisico)::numeric, 4) AS delta_fisico,
      ROUND(SUM(delta_valor)::numeric, 2) AS delta_valor
    FROM mov
    WHERE dia IS NOT NULL
    GROUP BY dia, local_codigo
    ORDER BY dia ASC, local_codigo ASC
    `,
    params
  );
  return rows;
}

async function saldoAtualPorLocal() {
  const { rows } = await dbQuery(`
    SELECT
      local_codigo::text AS local_codigo,
      ROUND(SUM(COALESCE(fisico, 0))::numeric, 4) AS total_fisico,
      ROUND(SUM(COALESCE(fisico, 0) * COALESCE(cmc, 0))::numeric, 2) AS total_valor
    FROM logistica.estoque_atual
    WHERE local_codigo IS NOT NULL
      AND TRIM(local_codigo::text) <> ''
    GROUP BY local_codigo
  `);
  return rows;
}

/**
 * Nível: estoque físico total por armazém dia a dia (reconstruído do SQL).
 * saldo[d] = saldo[d+1] - delta[d+1]; hoje = estoque_atual.
 */
async function montarOscilacaoNivel(periodoRaw) {
  const dias = parsePeriodoDias(periodoRaw);
  const hoje = toIsoDate(new Date());
  let dataInicio;
  if (dias == null) {
    const { rows: minRows } = await dbQuery(`
      SELECT LEAST(
        (SELECT MIN(COALESCE(data_movimentacao, criado_em::date)) FROM logistica.ajustes_estoque WHERE lower(status)='executado'),
        (SELECT MIN(data_movimentacao) FROM logistica.transferencias WHERE lower(status)='transferido')
      )::text AS min_d
    `);
    dataInicio = minRows[0]?.min_d || addDaysIso(hoje, -90);
  } else {
    dataInicio = addDaysIso(hoje, -(dias - 1));
  }

  const [nomes, saldosHoje, deltas] = await Promise.all([
    mapaNomesLocais(),
    saldoAtualPorLocal(),
    carregarDeltasPorDia(dataInicio),
  ]);

  const locais = new Set([
    ...saldosHoje.map(r => String(r.local_codigo)),
    ...deltas.map(r => String(r.local_codigo)),
  ]);

  /** deltaMap[data][local] = { fisico, valor } */
  const deltaMap = new Map();
  for (const r of deltas) {
    const d = String(r.data).slice(0, 10);
    if (!deltaMap.has(d)) deltaMap.set(d, new Map());
    deltaMap.get(d).set(String(r.local_codigo), {
      fisico: Number(r.delta_fisico) || 0,
      valor: Number(r.delta_valor) || 0,
    });
  }

  const saldo = new Map();
  for (const r of saldosHoje) {
    saldo.set(String(r.local_codigo), {
      fisico: Number(r.total_fisico) || 0,
      valor: Number(r.total_valor) || 0,
    });
  }
  for (const loc of locais) {
    if (!saldo.has(loc)) saldo.set(loc, { fisico: 0, valor: 0 });
  }

  const datas = listarDatasAsc(dataInicio, hoje);
  const rows = [];

  // Grava hoje primeiro (saldo atual), depois anda para trás aplicando o inverso do delta do dia seguinte
  for (let i = datas.length - 1; i >= 0; i--) {
    const data = datas[i];
    for (const loc of locais) {
      const s = saldo.get(loc) || { fisico: 0, valor: 0 };
      const nome = nomeArmazem(loc, nomes);
      rows.push({
        data,
        armazem: nome,
        total_fisico: s.fisico,
        total_valor: s.valor,
      });
    }
    if (i === 0) break;
    // Para obter saldo do dia anterior: remove o efeito dos movimentos do dia atual
    const deltasDoDia = deltaMap.get(data);
    if (deltasDoDia) {
      for (const [loc, dlt] of deltasDoDia.entries()) {
        const s = saldo.get(loc) || { fisico: 0, valor: 0 };
        saldo.set(loc, {
          fisico: s.fisico - dlt.fisico,
          valor: s.valor - dlt.valor,
        });
      }
    }
  }

  rows.sort((a, b) => (a.data === b.data ? a.armazem.localeCompare(b.armazem) : a.data.localeCompare(b.data)));

  const aviso = dias == null || dias > 90
    ? 'Reconstruído a partir do SQL (transferências e ajustes). Movimentos feitos só na Omie podem não aparecer.'
    : null;

  return {
    ok: true,
    fonte: 'reconstruido_sql',
    aviso,
    periodo: { de: dataInicio, ate: hoje, dias },
    rows,
  };
}

/**
 * Fluxo: entradas / saídas / líquido por dia e armazém.
 */
async function montarOscilacaoFluxo(periodoRaw) {
  const dias = parsePeriodoDias(periodoRaw);
  const hoje = toIsoDate(new Date());
  let dataInicio;
  if (dias == null) {
    const { rows: minRows } = await dbQuery(`
      SELECT LEAST(
        (SELECT MIN(COALESCE(data_movimentacao, criado_em::date)) FROM logistica.ajustes_estoque WHERE lower(status)='executado'),
        (SELECT MIN(data_movimentacao) FROM logistica.transferencias WHERE lower(status)='transferido')
      )::text AS min_d
    `);
    dataInicio = minRows[0]?.min_d || addDaysIso(hoje, -90);
  } else {
    dataInicio = addDaysIso(hoje, -(dias - 1));
  }

  const nomes = await mapaNomesLocais();
  const { rows } = await dbQuery(
    `
    WITH mov AS (
      SELECT
        COALESCE(a.data_movimentacao, a.criado_em::date) AS dia,
        a.local_estoque::text AS local_codigo,
        CASE WHEN UPPER(COALESCE(a.tipo_operacao, '')) = 'ENT' THEN COALESCE(a.qtd, 0) ELSE 0 END AS entrada,
        CASE WHEN UPPER(COALESCE(a.tipo_operacao, '')) = 'SAI' THEN COALESCE(a.qtd, 0) ELSE 0 END AS saida,
        0::numeric AS transferencia,
        CASE WHEN UPPER(COALESCE(a.tipo_operacao, '')) = 'ENT' THEN COALESCE(a.qtd, 0) * COALESCE(a.cmc, 0)
             WHEN UPPER(COALESCE(a.tipo_operacao, '')) = 'SAI' THEN -COALESCE(a.qtd, 0) * COALESCE(a.cmc, 0)
             ELSE 0 END AS valor_liquido
      FROM logistica.ajustes_estoque a
      WHERE lower(COALESCE(a.status, '')) = 'executado'
        AND UPPER(COALESCE(a.tipo_operacao, '')) IN ('ENT', 'SAI')
        AND COALESCE(a.data_movimentacao, a.criado_em::date) >= $1::date
        AND a.local_estoque IS NOT NULL

      UNION ALL

      SELECT
        t.data_movimentacao AS dia,
        t.origem::text AS local_codigo,
        0::numeric AS entrada,
        COALESCE(t.qtd, 0) AS saida,
        COALESCE(t.qtd, 0) AS transferencia,
        -COALESCE(t.qtd, 0) * COALESCE(t.cmc, 0) AS valor_liquido
      FROM logistica.transferencias t
      WHERE lower(COALESCE(t.status, '')) = 'transferido'
        AND t.data_movimentacao >= $1::date
        AND t.origem IS NOT NULL

      UNION ALL

      SELECT
        t.data_movimentacao AS dia,
        t.destino::text AS local_codigo,
        COALESCE(t.qtd, 0) AS entrada,
        0::numeric AS saida,
        COALESCE(t.qtd, 0) AS transferencia,
        COALESCE(t.qtd, 0) * COALESCE(t.cmc, 0) AS valor_liquido
      FROM logistica.transferencias t
      WHERE lower(COALESCE(t.status, '')) = 'transferido'
        AND t.data_movimentacao >= $1::date
        AND t.destino IS NOT NULL
    )
    SELECT
      dia::text AS data,
      local_codigo,
      ROUND(SUM(entrada)::numeric, 4) AS entrada,
      ROUND(SUM(saida)::numeric, 4) AS saida,
      ROUND(SUM(transferencia)::numeric, 4) AS transferencia,
      ROUND(SUM(entrada - saida)::numeric, 4) AS liquido,
      ROUND(SUM(valor_liquido)::numeric, 2) AS valor_liquido
    FROM mov
    WHERE dia IS NOT NULL
      AND local_codigo IS NOT NULL
      AND TRIM(local_codigo) <> ''
    GROUP BY dia, local_codigo
    ORDER BY dia ASC, local_codigo ASC
    `,
    [dataInicio]
  );

  const normalized = rows.map(r => ({
    data: String(r.data).slice(0, 10),
    armazem: nomeArmazem(r.local_codigo, nomes),
    entrada: Number(r.entrada) || 0,
    saida: Number(r.saida) || 0,
    transferencia: Number(r.transferencia) || 0,
    liquido: Number(r.liquido) || 0,
    valor_liquido: Number(r.valor_liquido) || 0,
  }));

  return {
    ok: true,
    fonte: 'sql_movimentacoes',
    periodo: { de: dataInicio, ate: hoje, dias },
    rows: normalized,
  };
}

router.get('/oscilacao-nivel', async (req, res) => {
  try {
    const payload = await montarOscilacaoNivel(req.query.periodo);
    return res.json(payload);
  } catch (err) {
    console.error(TAG, 'oscilacao-nivel:', err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || 'Erro ao carregar nível' });
  }
});

router.get('/oscilacao-fluxo', async (req, res) => {
  try {
    const payload = await montarOscilacaoFluxo(req.query.periodo);
    return res.json(payload);
  } catch (err) {
    console.error(TAG, 'oscilacao-fluxo:', err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || 'Erro ao carregar fluxo' });
  }
});

/** Compat: gráfico antigo apontava para oscilacao-diaria */
router.get('/oscilacao-diaria', async (req, res) => {
  try {
    const payload = await montarOscilacaoNivel(req.query.periodo);
    return res.json(payload);
  } catch (err) {
    console.error(TAG, 'oscilacao-diaria:', err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || 'Erro ao carregar oscilação' });
  }
});

module.exports = router;
