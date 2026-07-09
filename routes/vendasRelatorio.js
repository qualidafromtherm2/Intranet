const express = require('express');
const { pool } = require('../src/db');
const { VENDAS_NF_POR_PEDIDO_CTE, vendasNfJoinPedidoSql } = require('../utils/vendasNfJoin');

const router = express.Router();

let _ensureSchemaPromise = null;

async function ensureVendasRelatorioSchema() {
  if (_ensureSchemaPromise) return _ensureSchemaPromise;
  _ensureSchemaPromise = pool.query(`
    CREATE SCHEMA IF NOT EXISTS "Vendas";
    CREATE TABLE IF NOT EXISTS "Vendas".relatorio_gerencial (
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
      ON "Vendas".relatorio_gerencial (mes);
  `).then(() => undefined).catch((err) => {
    _ensureSchemaPromise = null;
    throw err;
  });
  return _ensureSchemaPromise;
}

function mesAtualReferencia(refDate = new Date()) {
  const ano = refDate.getFullYear();
  const mesNum = refDate.getMonth() + 1;
  const pad = (n) => String(n).padStart(2, '0');
  return { ano, mesNum, mesRaw: `${ano}-${pad(mesNum)}` };
}

function calcPeriodo(modoRaw, refDate = new Date()) {
  const modosValidos = new Set(['mes', '3m', '6m', 'anual']);
  const modo = modosValidos.has(modoRaw) ? modoRaw : 'mes';
  const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const { ano, mesNum, mesRaw } = mesAtualReferencia(refDate);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtYmd = (y, m, d = 1) => `${y}-${pad(m)}-${pad(d)}`;
  const mesLabel = (y, m) => (m >= 1 && m <= 12 ? `${nomesMes[m - 1]}/${y}` : `${y}-${pad(m)}`);

  if (modo === 'mes') {
    const nextM = mesNum === 12 ? 1 : mesNum + 1;
    const nextY = mesNum === 12 ? ano + 1 : ano;
    return {
      modo,
      mesRef: mesRaw,
      inicio: fmtYmd(ano, mesNum),
      fimExclusive: fmtYmd(nextY, nextM),
      label: mesLabel(ano, mesNum),
      meses: [mesRaw],
      evolucaoTipo: 'semana',
    };
  }

  const qtd = modo === '3m' ? 3 : (modo === '6m' ? 6 : 12);
  const inicioDate = new Date(ano, mesNum - 1 - qtd, 1);
  const meses = [];
  for (let i = 0; i < qtd; i += 1) {
    const d = new Date(inicioDate.getFullYear(), inicioDate.getMonth() + i, 1);
    meses.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  const fimY = mesNum === 1 ? ano - 1 : ano;
  const fimM = mesNum === 1 ? 12 : mesNum - 1;

  return {
    modo,
    mesRef: mesRaw,
    inicio: fmtYmd(inicioDate.getFullYear(), inicioDate.getMonth() + 1),
    fimExclusive: fmtYmd(ano, mesNum),
    label: `${mesLabel(inicioDate.getFullYear(), inicioDate.getMonth() + 1)} a ${mesLabel(fimY, fimM)}`,
    meses,
    evolucaoTipo: 'mes',
  };
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
    sql: ` AND TRIM(COALESCE(p.etapa::text, '')) = '70'
           AND nf.data_emissao_dt IS NOT NULL`,
    label: 'Entregues',
  };
}

const VENDAS_CTES = `
  ${VENDAS_NF_POR_PEDIDO_CTE},
  pedidos_cfop_ignorado AS (
    SELECT DISTINCT codigo_pedido
    FROM "Vendas".pedidos_venda_itens
    WHERE REGEXP_REPLACE(TRIM(COALESCE(cfop, '')), '\\D', '', 'g') = '6905'
  )
`;

function buildBaseCte(etapaSql) {
  return `
    WITH ${VENDAS_CTES},
    base AS (
      SELECT DISTINCT ON (p.codigo_pedido)
        p.codigo_pedido,
        p.numero_pedido,
        TRIM(COALESCE(p.etapa::text, '')) AS etapa,
        CASE TRIM(COALESCE(p.etapa::text, ''))
          WHEN '00' THEN 'Aberto'
          WHEN '10' THEN 'Em análise'
          WHEN '20' THEN 'Aprovado'
          WHEN '50' THEN 'Em processamento'
          WHEN '60' THEN 'Em separação'
          WHEN '70' THEN 'Faturado/Entregue'
          WHEN '80' THEN 'Concluído'
          ELSE 'Outras'
        END AS etapa_descricao,
        COALESCE(p.valor_total_pedido, 0)::numeric(14,2) AS valor_total_pedido,
        COALESCE(NULLIF(TRIM(f.estado), ''), 'N/D') AS estado,
        COALESCE(
          NULLIF(TRIM(f.nome_fantasia), ''),
          NULLIF(TRIM(f.razao_social), ''),
          '(sem cliente)'
        ) AS cliente,
        nf.data_emissao_dt,
        COALESCE(nf.data_emissao_dt, p.updated_at::date) AS data_ref
      FROM "Vendas".pedidos_venda p
      LEFT JOIN omie.fornecedores f
        ON TRIM(COALESCE(f.codigo_cliente_omie::text, '')) = TRIM(COALESCE(p.codigo_cliente::text, ''))
      LEFT JOIN nf_por_pedido nf
        ON ${vendasNfJoinPedidoSql('nf', 'p')}
      WHERE p.codigo_pedido NOT IN (SELECT codigo_pedido FROM pedidos_cfop_ignorado)
        AND COALESCE(nf.data_emissao_dt, p.updated_at::date) >= $1::date
        AND COALESCE(nf.data_emissao_dt, p.updated_at::date) < $2::date
        ${etapaSql}
      ORDER BY p.codigo_pedido
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
    FROM "Vendas".pedidos_venda_itens i
    LEFT JOIN public.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
    WHERE REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') <> '6905'
  )
`;

function buildItensCte(etapaSql) {
  return `
    WITH ${VENDAS_CTES},
    ${ITENS_CTE},
    base AS (
      SELECT DISTINCT ON (p.codigo_pedido)
        p.codigo_pedido,
        COALESCE(NULLIF(TRIM(f.estado), ''), 'N/D') AS estado,
        COALESCE(
          NULLIF(TRIM(f.nome_fantasia), ''),
          NULLIF(TRIM(f.razao_social), ''),
          '(sem cliente)'
        ) AS cliente,
        nf.data_emissao_dt,
        COALESCE(nf.data_emissao_dt, p.updated_at::date) AS data_ref
      FROM "Vendas".pedidos_venda p
      LEFT JOIN omie.fornecedores f
        ON TRIM(COALESCE(f.codigo_cliente_omie::text, '')) = TRIM(COALESCE(p.codigo_cliente::text, ''))
      LEFT JOIN nf_por_pedido nf
        ON ${vendasNfJoinPedidoSql('nf', 'p')}
      WHERE p.codigo_pedido NOT IN (SELECT codigo_pedido FROM pedidos_cfop_ignorado)
        AND COALESCE(nf.data_emissao_dt, p.updated_at::date) >= $1::date
        AND COALESCE(nf.data_emissao_dt, p.updated_at::date) < $2::date
        ${etapaSql}
      ORDER BY p.codigo_pedido
    ),
    itens AS (
      SELECT
        b.codigo_pedido,
        b.estado,
        b.cliente,
        b.data_emissao_dt,
        ib.familia,
        ib.quantidade,
        ib.valor_total
      FROM base b
      JOIN itens_base ib ON ib.codigo_pedido = b.codigo_pedido
    )
  `;
}

function labelMes(yyyymm, nomesMes) {
  const [y, m] = String(yyyymm || '').split('-');
  const mi = parseInt(m, 10);
  return mi >= 1 && mi <= 12 ? `${nomesMes[mi - 1]}/${y}` : yyyymm;
}

// GET /vendas/relatorio-gerencial
router.get('/vendas/relatorio-gerencial', async (req, res) => {
  try {
    await ensureVendasRelatorioSchema();
    const modoRaw = String(req.query.modo || 'mes').trim().toLowerCase();
    const etapaParam = String(req.query.etapa || 'entregue').trim().toLowerCase();
    const periodoCfg = calcPeriodo(modoRaw);
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
    const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    const baseCte = buildBaseCte(etapaCfg.sql);
    const itensCte = buildItensCte(etapaCfg.sql);

    const evolucaoSql = evolucaoTipo === 'mes'
      ? `${baseCte}
        SELECT
          TO_CHAR(DATE_TRUNC('month', data_ref), 'YYYY-MM') AS mes_key,
          COUNT(*)::int AS total_pedidos,
          COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
        FROM base
        GROUP BY 1
        ORDER BY 1`
      : `${baseCte}
        SELECT
          LEAST(5, GREATEST(1, CEIL(EXTRACT(DAY FROM data_ref) / 7.0)::int)) AS semana,
          COUNT(*)::int AS total_pedidos,
          COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
        FROM base
        GROUP BY 1
        ORDER BY 1`;

    const [
      rKpi,
      rEstado,
      rFamilia,
      rCliente,
      rEtapa,
      rEvolucao,
      rFinanceiro,
      rFamiliaEstado,
      rMesFamilia,
      rMesTotal,
      rFamiliaCliente,
      rQtdItens,
    ] = await Promise.all([
      pool.query(`${baseCte}
        SELECT
          COUNT(*)::int AS total_pedidos,
          COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total,
          COALESCE(AVG(valor_total_pedido) FILTER (WHERE valor_total_pedido > 0), 0)::float AS ticket_medio,
          COUNT(DISTINCT cliente) FILTER (WHERE cliente <> '(sem cliente)')::int AS clientes,
          COUNT(DISTINCT estado) FILTER (WHERE estado <> 'N/D')::int AS estados_atendidos
        FROM base
      `, rangeParams),
      pool.query(`${baseCte}
        SELECT estado, COUNT(*)::int AS total, COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
        FROM base
        GROUP BY estado
        ORDER BY valor_total DESC, total DESC, estado
      `, rangeParams),
      pool.query(`${itensCte}
        SELECT familia,
          COUNT(DISTINCT codigo_pedido)::int AS total,
          COALESCE(SUM(quantidade), 0)::float AS quantidade,
          COALESCE(SUM(valor_total), 0)::float AS valor_total
        FROM itens
        GROUP BY familia
        ORDER BY valor_total DESC, quantidade DESC, familia
        LIMIT 15
      `, rangeParams),
      pool.query(`${baseCte}
        SELECT cliente, COUNT(*)::int AS total, COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
        FROM base
        GROUP BY cliente
        ORDER BY valor_total DESC, total DESC, cliente
        LIMIT 15
      `, rangeParams),
      pool.query(`${baseCte}
        SELECT etapa, etapa_descricao, COUNT(*)::int AS total,
          COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
        FROM base
        GROUP BY etapa, etapa_descricao
        ORDER BY total DESC
      `, rangeParams),
      pool.query(evolucaoSql, rangeParams),
      pool.query(`${baseCte}
        SELECT codigo_pedido, numero_pedido, cliente, estado, data_ref AS data,
          valor_total_pedido::float AS valor_total
        FROM base
        WHERE valor_total_pedido > 0
        ORDER BY valor_total_pedido DESC
        LIMIT 20
      `, rangeParams),
      pool.query(`${itensCte}
        SELECT familia, estado, COALESCE(SUM(valor_total), 0)::float AS valor_total
        FROM itens
        GROUP BY familia, estado
        ORDER BY familia, valor_total DESC
      `, rangeParams),
      pool.query(`${itensCte}
        SELECT
          TO_CHAR(DATE_TRUNC('month', data_emissao_dt), 'YYYY-MM') AS mes,
          familia,
          COALESCE(SUM(quantidade), 0)::float AS quantidade,
          COALESCE(SUM(valor_total), 0)::float AS valor_total
        FROM itens
        WHERE data_emissao_dt IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1, 4 DESC, 2
      `, rangeParams),
      pool.query(`${itensCte}
        SELECT
          TO_CHAR(DATE_TRUNC('month', data_emissao_dt), 'YYYY-MM') AS mes,
          COALESCE(SUM(quantidade), 0)::float AS quantidade,
          COALESCE(SUM(valor_total), 0)::float AS valor_total
        FROM itens
        WHERE data_emissao_dt IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `, rangeParams),
      pool.query(`${itensCte}
        SELECT familia, cliente, COALESCE(SUM(valor_total), 0)::float AS valor_total
        FROM itens
        GROUP BY familia, cliente
        ORDER BY familia, valor_total DESC
      `, rangeParams),
      pool.query(`${itensCte}
        SELECT COALESCE(SUM(quantidade), 0)::float AS quantidade_itens
        FROM itens
      `, rangeParams),
    ]);

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
         FROM "Vendas".relatorio_gerencial
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

    return res.json({
      ok: true,
      mes: mesRaw,
      modo,
      etapa: etapaCfg.label,
      periodo: periodoLabel,
      evolucao_tipo: evolucaoTipo,
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

    const usuarioLogado = req.session?.user?.fullName
      || req.session?.user?.username
      || req.session?.user?.login
      || 'sistema';

    const { rows } = await pool.query(
      `INSERT INTO "Vendas".relatorio_gerencial (
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
