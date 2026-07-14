#!/usr/bin/env node
/**
 * Gera PDF gerencial de fechamento de Vendas (dados reais do Postgres).
 *
 * Uso:
 *   node scripts/gerar_pdf_fechamento_vendas.js --inicio 2026-05 --fim 2026-07
 *   node scripts/gerar_pdf_fechamento_vendas.js --inicio 2026-05 --fim 2026-07 --etapa todos
 *   node scripts/gerar_pdf_fechamento_vendas.js --modo 6m --etapa entregue
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pool } = require('../src/db');
const { VENDAS_NF_POR_PEDIDO_CTE, vendasNfJoinPedidoSql } = require('../utils/vendasNfJoin');

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const QTD = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const CORES = ['#1e3a5f', '#38bdf8', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { modo: '6m', etapa: 'entregue', output: '', inicio: '', fim: '', titulo: '' };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--modo' && args[i + 1]) { opts.modo = args[++i]; continue; }
    if (args[i] === '--etapa' && args[i + 1] !== undefined) { opts.etapa = args[++i]; continue; }
    if (args[i] === '--inicio' && args[i + 1]) { opts.inicio = args[++i]; continue; }
    if (args[i] === '--fim' && args[i + 1]) { opts.fim = args[++i]; continue; }
    if (args[i] === '--titulo' && args[i + 1]) { opts.titulo = args[++i]; continue; }
    if (args[i] === '--output' && args[i + 1]) { opts.output = args[++i]; continue; }
  }
  if (opts.inicio && !/^\d{4}-\d{2}$/.test(opts.inicio)) throw new Error('--inicio inválido (YYYY-MM)');
  if (opts.fim && !/^\d{4}-\d{2}$/.test(opts.fim)) throw new Error('--fim inválido (YYYY-MM)');
  if ((opts.inicio && !opts.fim) || (!opts.inicio && opts.fim)) {
    throw new Error('Informe --inicio e --fim juntos (YYYY-MM).');
  }
  if (!opts.output) {
    const stamp = opts.inicio && opts.fim
      ? `${opts.inicio}_${opts.fim}`.replace(/-/g, '')
      : new Date().toISOString().slice(0, 10);
    const outDir = path.join(process.cwd(), 'relatorios');
    fs.mkdirSync(outDir, { recursive: true });
    opts.output = path.join(outDir, `Fechamento_Vendas_${stamp}.pdf`);
  }
  return opts;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtData(raw) {
  if (!raw) return '-';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? String(raw).slice(0, 10) : d.toLocaleDateString('pt-BR');
}

function mesLabel(y, m) {
  const pad = (n) => String(n).padStart(2, '0');
  return m >= 1 && m <= 12 ? `${NOMES_MES[m - 1]}/${y}` : `${y}-${pad(m)}`;
}

function calcPeriodoCustom(inicioYm, fimYm) {
  const pad = (n) => String(n).padStart(2, '0');
  const [yi, mi] = inicioYm.split('-').map(Number);
  const [yf, mf] = fimYm.split('-').map(Number);
  if (!yi || !mi || !yf || !mf) throw new Error('Período inválido');
  const inicioDate = new Date(yi, mi - 1, 1);
  const fimDate = new Date(yf, mf - 1, 1);
  if (fimDate < inicioDate) throw new Error('--fim deve ser >= --inicio');
  const meses = [];
  const cursor = new Date(inicioDate);
  while (cursor <= fimDate) {
    meses.push(`${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const next = new Date(yf, mf, 1);
  return {
    modo: 'custom',
    inicio: `${yi}-${pad(mi)}-01`,
    fimExclusive: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`,
    label: meses.length === 1 ? mesLabel(yi, mi) : `${mesLabel(yi, mi)} a ${mesLabel(yf, mf)}`,
    meses,
    evolucaoTipo: meses.length === 1 ? 'semana' : 'mes',
    qtdMeses: meses.length,
  };
}

function calcPeriodoAnteriorCustom(periodo) {
  const qtd = periodo.qtdMeses || periodo.meses?.length || 3;
  const [yi, mi] = periodo.inicio.split('-').map(Number);
  const inicioAnt = new Date(yi, mi - 1 - qtd, 1);
  const fimAnt = new Date(yi, mi - 2, 1);
  const pad = (n) => String(n).padStart(2, '0');
  return calcPeriodoCustom(
    `${inicioAnt.getFullYear()}-${pad(inicioAnt.getMonth() + 1)}`,
    `${fimAnt.getFullYear()}-${pad(fimAnt.getMonth() + 1)}`
  );
}

function calcPeriodo(modoRaw, refDate = new Date()) {
  const modosValidos = new Set(['mes', '3m', '6m', 'anual']);
  const modo = modosValidos.has(modoRaw) ? modoRaw : '6m';
  const ano = refDate.getFullYear();
  const mesNum = refDate.getMonth() + 1;
  const pad = (n) => String(n).padStart(2, '0');
  const fmtYmd = (y, m) => `${y}-${pad(m)}-01`;

  if (modo === 'mes') {
    const nextM = mesNum === 12 ? 1 : mesNum + 1;
    const nextY = mesNum === 12 ? ano + 1 : ano;
    return {
      modo, inicio: fmtYmd(ano, mesNum), fimExclusive: fmtYmd(nextY, nextM),
      label: mesLabel(ano, mesNum), meses: [`${ano}-${pad(mesNum)}`],
      evolucaoTipo: 'semana', qtdMeses: 1,
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
    inicio: fmtYmd(inicioDate.getFullYear(), inicioDate.getMonth() + 1),
    fimExclusive: fmtYmd(ano, mesNum),
    label: `${mesLabel(inicioDate.getFullYear(), inicioDate.getMonth() + 1)} a ${mesLabel(fimY, fimM)}`,
    meses, evolucaoTipo: 'mes', qtdMeses: qtd,
  };
}

function buildEtapaFilter(etapaRaw) {
  const etapa = String(etapaRaw || 'entregue').trim().toLowerCase();
  if (etapa === 'todos' || etapa === '') {
    return { sql: '', label: 'Todos os pedidos' };
  }
  return {
    sql: ` AND TRIM(COALESCE(p.etapa::text, '')) = '70'
           AND nf.data_emissao_dt IS NOT NULL`,
    label: 'Entregues (NF)',
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

function buildItensCte(etapaSql) {
  return `
    WITH ${VENDAS_CTES},
    itens_base AS (
      SELECT
        i.codigo_pedido,
        COALESCE(NULLIF(TRIM(po.descricao_familia), ''), '(sem família)') AS familia,
        COALESCE(i.quantidade, 0)::numeric(14,2) AS quantidade,
        COALESCE(i.valor_total, 0)::numeric(14,2) AS valor_total
      FROM "Vendas".pedidos_venda_itens i
      LEFT JOIN public.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
      WHERE REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') <> '6905'
    ),
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
      SELECT b.codigo_pedido, b.estado, b.cliente, b.data_emissao_dt,
             ib.familia, ib.quantidade, ib.valor_total
      FROM base b
      JOIN itens_base ib ON ib.codigo_pedido = b.codigo_pedido
    )
  `;
}

async function fetchRelatorio(modo, etapa, refDate = new Date(), periodoOverride = null) {
  const periodo = periodoOverride || calcPeriodo(modo, refDate);
  const etapaCfg = buildEtapaFilter(etapa);
  const params = [periodo.inicio, periodo.fimExclusive];
  const baseCte = buildBaseCte(etapaCfg.sql);
  const itensCte = buildItensCte(etapaCfg.sql);

  const evolucaoSql = periodo.evolucaoTipo === 'mes'
    ? `${baseCte}
      SELECT TO_CHAR(DATE_TRUNC('month', data_ref), 'YYYY-MM') AS mes_key,
        COUNT(*)::int AS total_pedidos,
        COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
      FROM base GROUP BY 1 ORDER BY 1`
    : `${baseCte}
      SELECT LEAST(5, GREATEST(1, CEIL(EXTRACT(DAY FROM data_ref) / 7.0)::int)) AS semana,
        COUNT(*)::int AS total_pedidos,
        COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
      FROM base GROUP BY 1 ORDER BY 1`;

  const [rKpi, rEstado, rFamilia, rCliente, rEtapa, rEvolucao, rFinanceiro, rQtdItens] = await Promise.all([
    pool.query(`${baseCte}
      SELECT COUNT(*)::int AS total_pedidos,
        COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total,
        COALESCE(AVG(valor_total_pedido) FILTER (WHERE valor_total_pedido > 0), 0)::float AS ticket_medio,
        COUNT(DISTINCT cliente) FILTER (WHERE cliente <> '(sem cliente)')::int AS clientes,
        COUNT(DISTINCT estado) FILTER (WHERE estado <> 'N/D')::int AS estados_atendidos
      FROM base`, params),
    pool.query(`${baseCte}
      SELECT estado, COUNT(*)::int AS total, COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
      FROM base GROUP BY estado ORDER BY valor_total DESC, total DESC`, params),
    pool.query(`${itensCte}
      SELECT familia, COUNT(DISTINCT codigo_pedido)::int AS total,
        COALESCE(SUM(quantidade), 0)::float AS quantidade,
        COALESCE(SUM(valor_total), 0)::float AS valor_total
      FROM itens GROUP BY familia ORDER BY valor_total DESC LIMIT 15`, params),
    pool.query(`${baseCte}
      SELECT cliente, COUNT(*)::int AS total, COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
      FROM base GROUP BY cliente ORDER BY valor_total DESC LIMIT 15`, params),
    pool.query(`${baseCte}
      SELECT etapa, etapa_descricao, COUNT(*)::int AS total,
        COALESCE(SUM(valor_total_pedido), 0)::float AS valor_total
      FROM base GROUP BY etapa, etapa_descricao ORDER BY total DESC`, params),
    pool.query(evolucaoSql, params),
    pool.query(`${baseCte}
      SELECT codigo_pedido, numero_pedido, cliente, estado, data_ref AS data,
        valor_total_pedido::float AS valor_total
      FROM base WHERE valor_total_pedido > 0
      ORDER BY valor_total_pedido DESC LIMIT 20`, params),
    pool.query(`${itensCte} SELECT COALESCE(SUM(quantidade), 0)::float AS quantidade_itens FROM itens`, params),
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

  const evolucao = periodo.evolucaoTipo === 'mes'
    ? (rEvolucao.rows || []).map((r) => {
      const [y, m] = String(r.mes_key || '').split('-');
      return {
        label: mesLabel(parseInt(y, 10), parseInt(m, 10)),
        total_pedidos: r.total_pedidos,
        valor_total: Math.round((r.valor_total || 0) * 100) / 100,
      };
    })
    : (rEvolucao.rows || []).map((r) => ({
      label: `Sem ${r.semana}`,
      total_pedidos: r.total_pedidos,
      valor_total: Math.round((r.valor_total || 0) * 100) / 100,
    }));

  return {
    periodo: periodo.label,
    modo: periodo.modo,
    etapa: etapaCfg.label,
    titulo: null,
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
    evolucao,
    pareto,
    financeiro: (rFinanceiro.rows || []).map((r) => ({
      numero_pedido: r.numero_pedido || r.codigo_pedido,
      cliente: r.cliente,
      estado: r.estado,
      data: r.data,
      valor_total: Math.round(Number(r.valor_total || 0) * 100) / 100,
    })),
  };
}

function barChartHtml(items, { labelKey = 'label', valueKey = 'total', maxItems = 10, format = 'qtd' } = {}) {
  const rows = (items || []).slice(0, maxItems);
  if (!rows.length) return '<p style="color:#94a3b8;font-size:10px;">Sem dados.</p>';
  const max = Math.max(...rows.map((r) => Number(r[valueKey] || 0)), 1);
  return rows.map((r, i) => {
    const val = Number(r[valueKey] || 0);
    const pct = Math.max(4, Math.round((val / max) * 100));
    const c = CORES[i % CORES.length];
    const shown = format === 'moeda' ? MOEDA.format(val) : QTD.format(val);
    return `<div class="bar-row">
      <div class="bar-lbl">${esc(r[labelKey])}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${c};"></div></div>
      <div class="bar-val">${shown}</div>
    </div>`;
  }).join('');
}

function donutLegendHtml(items, valueKey = 'valor_total') {
  const rows = items || [];
  const total = rows.reduce((s, r) => s + Number(r[valueKey] || 0), 0) || 1;
  return rows.slice(0, 8).map((r, i) => {
    const val = Number(r[valueKey] || 0);
    const pct = Math.round((val / total) * 1000) / 10;
    return `<div class="legend-item"><span class="dot" style="background:${CORES[i % CORES.length]}"></span>${esc(r.estado || r.familia || r.cliente)} <b>${pct}%</b></div>`;
  }).join('');
}

function gerarTextos(data, comparacao) {
  const kpis = data.kpis || {};
  const topFam = (data.pareto || []).slice(0, 3);
  const topEst = (data.por_estado || []).slice(0, 3);
  const topCli = (data.por_cliente || []).slice(0, 3);
  const famTxt = topFam.map((r) => `${r.familia} (${MOEDA.format(r.valor_total || 0)})`).join(', ') || '—';
  const estTxt = topEst.map((r) => `${r.estado} (${MOEDA.format(r.valor_total || 0)})`).join(', ') || '—';
  const cliTxt = topCli.map((r) => `${r.cliente} (${MOEDA.format(r.valor_total || 0)})`).join(', ') || '—';

  let compTxt = '';
  if (comparacao?.kpis?.valor_total) {
    const diff = kpis.valor_total - comparacao.kpis.valor_total;
    const pctDiff = Math.round((diff / comparacao.kpis.valor_total) * 1000) / 10;
    const diffPed = kpis.total_pedidos - comparacao.kpis.total_pedidos;
    compTxt = ` Em relação ao período anterior (${comparacao.periodo}), o faturamento ${diff >= 0 ? 'aumentou' : 'reduziu'} ${Math.abs(pctDiff)}% (${diff >= 0 ? '+' : ''}${MOEDA.format(diff)}) e os pedidos ${diffPed >= 0 ? 'subiram' : 'caíram'} ${diffPed >= 0 ? '+' : ''}${diffPed}.`;
  }

  return {
    resumo: `No período ${data.periodo} (${data.etapa}) foram registrados ${kpis.total_pedidos || 0} pedido(s), com faturamento de ${MOEDA.format(kpis.valor_total || 0)} e ticket médio de ${MOEDA.format(kpis.ticket_medio || 0)}.${compTxt}`,
    criticos: [
      `Famílias com maior faturamento: ${famTxt}`,
      `Estados com maior volume: ${estTxt}`,
      `Principais clientes: ${cliTxt}`,
    ],
    oportunidades: [
      'Expandir presença nos estados com maior potencial de crescimento',
      'Acompanhar mix de famílias no Pareto 80/20',
      'Revisar pedidos de alto valor e concentrar ações comerciais nos top clientes',
      'Monitorar evolução mensal de faturamento e ticket médio',
    ],
    plano: topFam.slice(0, 4).map((r, i) => ({
      acao: `Ação ${i + 1}`,
      descricao: `Reforçar estratégia comercial para família "${r.familia}" (${MOEDA.format(r.valor_total || 0)})`,
      responsavel: 'Comercial / Vendas',
      prazo: 'Próximo trimestre',
      prioridade: i === 0 ? 'ALTA' : (i === 1 ? 'MÉDIA' : 'BAIXA'),
    })),
  };
}

function buildHtml(data, comparacao, textos) {
  const kpis = data.kpis;
  const dataGer = new Date().toLocaleDateString('pt-BR');
  const totalPages = 6;
  const reportTitle = data.titulo || 'Fechamento de Vendas — Relatório Gerencial';
  const coverBadge = 'FECHAMENTO DE VENDAS';

  const hdr = (sub) => `
    <div class="pdf-hdr">
      <div class="pdf-brand"><div class="pdf-logo">FT</div><div><div class="pdf-name">FROMTHERM</div><div class="pdf-sub">BOMBAS DE CALOR</div></div></div>
      <div class="pdf-title"><div class="pdf-type">${esc(reportTitle)}</div><div class="pdf-per">${esc(data.periodo)} · ${esc(data.etapa)}</div>${sub ? `<div class="pdf-subtitle">${esc(sub)}</div>` : ''}</div>
      <div class="pdf-meta"><div><b>Departamento:</b> Comercial / Vendas</div><div><b>Data:</b> ${esc(dataGer)}</div><div><b>Versão:</b> 1.0</div></div>
    </div><div class="pdf-bar"></div>`;

  const ftr = (pg) => `<div class="pdf-ftr"><div class="pdf-slogan">Qualidade que transforma. Conforto que dura.</div><div class="pdf-pg">Página ${pg} de ${totalPages}</div></div>`;

  const kpiCards = [
    ['Pedidos', QTD.format(kpis.total_pedidos)],
    ['Faturamento', MOEDA.format(kpis.valor_total)],
    ['Ticket médio', MOEDA.format(kpis.ticket_medio)],
    ['Clientes', QTD.format(kpis.clientes)],
    ['Estados', QTD.format(kpis.estados_atendidos)],
    ['Qtd. itens', QTD.format(kpis.quantidade_itens)],
  ].map(([l, v]) => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div></div>`).join('');

  const compHtml = comparacao ? `
    <div class="comp-box">
      <h4>Comparativo com período anterior (${esc(comparacao.periodo)})</h4>
      <table class="comp-tbl">
        <thead><tr><th>Indicador</th><th class="r">Período atual</th><th class="r">Período anterior</th><th class="r">Variação</th></tr></thead>
        <tbody>
          ${[
            ['Pedidos', kpis.total_pedidos, comparacao.kpis.total_pedidos],
            ['Faturamento', kpis.valor_total, comparacao.kpis.valor_total, true],
            ['Ticket médio', kpis.ticket_medio, comparacao.kpis.ticket_medio, true],
            ['Clientes', kpis.clientes, comparacao.kpis.clientes],
            ['Qtd. itens', kpis.quantidade_itens, comparacao.kpis.quantidade_itens],
          ].map(([lbl, atual, anterior, moeda]) => {
            const diff = atual - anterior;
            const pct = anterior ? Math.round((diff / anterior) * 1000) / 10 : 0;
            const fmt = moeda ? MOEDA.format : QTD.format;
            const cls = diff > 0 ? 'up' : (diff < 0 ? 'down' : '');
            return `<tr><td>${lbl}</td><td class="r">${fmt(atual)}</td><td class="r">${fmt(anterior)}</td><td class="r ${cls}">${diff >= 0 ? '+' : ''}${moeda ? MOEDA.format(diff) : QTD.format(diff)} (${pct >= 0 ? '+' : ''}${pct}%)</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '';

  const famTbl = (data.por_familia || []).map((r) =>
    `<tr><td>${esc(r.familia)}</td><td class="r">${QTD.format(r.quantidade || 0)}</td><td class="r">${r.total}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`
  ).join('');
  const cliTbl = (data.por_cliente || []).map((r) =>
    `<tr><td>${esc(r.cliente)}</td><td class="r">${r.total}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`
  ).join('');
  const paretoTbl = (data.pareto || []).map((r) =>
    `<tr><td>${esc(r.familia)}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td><td class="r">${r.pct}%</td><td class="r">${r.pct_acum}%</td></tr>`
  ).join('');
  const finTbl = (data.financeiro || []).map((r) =>
    `<tr><td>${esc(r.numero_pedido)}</td><td>${esc(r.cliente)}</td><td>${esc(r.estado)}</td><td>${fmtData(r.data)}</td><td class="r">${MOEDA.format(r.valor_total)}</td></tr>`
  ).join('');
  const etapaTbl = (data.por_etapa || []).map((r) =>
    `<tr><td>${esc(r.etapa_descricao)}</td><td class="r">${r.total}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`
  ).join('');
  const planoTbl = (textos.plano || []).map((r) =>
    `<tr><td>${esc(r.acao)}</td><td>${esc(r.descricao)}</td><td>${esc(r.responsavel)}</td><td>${esc(r.prazo)}</td><td><span class="prio ${r.prioridade.toLowerCase()}">${r.prioridade}</span></td></tr>`
  ).join('');

  const pages = [
    `<div class="pdf-page cover">
      ${hdr('Apresentação gerencial')}
      <div class="cover-main">
        <div class="cover-badge">${esc(coverBadge)}</div>
        <h1>Vendas</h1>
        <h2>${esc(data.periodo)}</h2>
        <p class="cover-desc">Relatório consolidado de pedidos, faturamento, distribuição geográfica, famílias de produto, clientes e plano de ação para reunião de fechamento.</p>
        <div class="cover-kpis">${kpiCards}</div>
      </div>
      <div class="exec-box"><h3>Resumo executivo</h3><p>${esc(textos.resumo)}</p></div>
      ${compHtml}
      ${ftr(1)}
    </div>`,

    `<div class="pdf-page">
      ${hdr('Dashboard e distribuição')}
      <div class="sec">Indicadores principais</div>
      <div class="kpis">${kpiCards}</div>
      <div class="row">
        <div class="box"><h3>Pedidos por etapa</h3><table><thead><tr><th>Etapa</th><th class="r">Qtd</th><th class="r">Valor</th></tr></thead><tbody>${etapaTbl || '<tr><td colspan="3">—</td></tr>'}</tbody></table></div>
        <div class="box"><h3>Valor por estado</h3>${barChartHtml(data.por_estado, { labelKey: 'estado', valueKey: 'valor_total', format: 'moeda', maxItems: 10 })}</div>
      </div>
      <div class="sec">Distribuição geográfica</div>
      <div class="row">
        <div class="box flex2">${barChartHtml(data.por_estado, { labelKey: 'estado', valueKey: 'valor_total', format: 'moeda', maxItems: 12 })}</div>
        <div class="box"><h3>Participação (%)</h3><div class="legend">${donutLegendHtml(data.por_estado)}</div></div>
      </div>
      ${ftr(2)}
    </div>`,

    `<div class="pdf-page">
      ${hdr('Famílias e clientes')}
      <div class="sec">Famílias de produto</div>
      <div class="row">
        <div class="box flex2">${barChartHtml(data.por_familia, { labelKey: 'familia', valueKey: 'valor_total', format: 'moeda' })}</div>
        <div class="box"><table><thead><tr><th>Família</th><th class="r">Qtd</th><th class="r">Pedidos</th><th class="r">Valor</th></tr></thead><tbody>${famTbl || '<tr><td colspan="4">—</td></tr>'}</tbody></table></div>
      </div>
      <div class="sec">Principais clientes</div>
      <div class="row">
        <div class="box flex2">${barChartHtml(data.por_cliente, { labelKey: 'cliente', valueKey: 'valor_total', format: 'moeda', maxItems: 10 })}</div>
        <div class="box"><table><thead><tr><th>Cliente</th><th class="r">Pedidos</th><th class="r">Valor</th></tr></thead><tbody>${cliTbl || '<tr><td colspan="3">—</td></tr>'}</tbody></table></div>
      </div>
      ${ftr(3)}
    </div>`,

    `<div class="pdf-page">
      ${hdr('Evolução e Pareto')}
      <div class="sec">Evolução no período</div>
      <div class="row">
        <div class="box"><h3>Faturamento</h3>${barChartHtml(data.evolucao, { labelKey: 'label', valueKey: 'valor_total', format: 'moeda' })}</div>
        <div class="box"><h3>Pedidos</h3>${barChartHtml(data.evolucao, { labelKey: 'label', valueKey: 'total_pedidos', format: 'qtd' })}</div>
      </div>
      <div class="sec">Pareto 80/20 — famílias</div>
      <table><thead><tr><th>Família</th><th class="r">Valor</th><th class="r">%</th><th class="r">Acum.</th></tr></thead><tbody>${paretoTbl || '<tr><td colspan="4">—</td></tr>'}</tbody></table>
      ${ftr(4)}
    </div>`,

    `<div class="pdf-page">
      ${hdr('Análise financeira e plano')}
      <div class="fin-banner">
        <div><span>Pedidos</span><b>${QTD.format(kpis.total_pedidos)}</b></div>
        <div><span>Faturamento</span><b>${MOEDA.format(kpis.valor_total)}</b></div>
        <div><span>Ticket médio</span><b>${MOEDA.format(kpis.ticket_medio)}</b></div>
        <div class="total"><span>Itens</span><b>${QTD.format(kpis.quantidade_itens)}</b></div>
      </div>
      <div class="sec">Top pedidos por valor</div>
      <table class="sm"><thead><tr><th>Pedido</th><th>Cliente</th><th>UF</th><th>Data</th><th class="r">Valor</th></tr></thead><tbody>${finTbl || '<tr><td colspan="5">—</td></tr>'}</tbody></table>
      <div class="sec">Plano de ação</div>
      <table><thead><tr><th>Ação</th><th>Descrição</th><th>Responsável</th><th>Prazo</th><th>Prioridade</th></tr></thead><tbody>${planoTbl || '<tr><td colspan="5">—</td></tr>'}</tbody></table>
      ${ftr(5)}
    </div>`,

    `<div class="pdf-page">
      ${hdr('Conclusão executiva')}
      <div class="conc-box"><h3>Síntese do período</h3><p>${esc(textos.resumo)}</p></div>
      <div class="row">
        <div class="box"><h3>Pontos críticos</h3><ul>${textos.criticos.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
        <div class="box"><h3>Oportunidades</h3><ul>${textos.oportunidades.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
      </div>
      <div class="total-banner"><div class="lbl">Faturamento no período</div><div class="val">${MOEDA.format(kpis.valor_total)}</div></div>
      <p class="footnote">Documento gerado automaticamente a partir dos dados da intranet Fromtherm (Vendas.pedidos_venda, itens e NF Omie). Filtro padrão: pedidos entregues/faturados com NF (etapa 70), excluindo CFOP 6905.</p>
      ${ftr(6)}
    </div>`,
  ].join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Fechamento Vendas — ${esc(data.periodo)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5px; color: #1e293b; background: #fff; }
  .pdf-page { page-break-after: always; padding: 14px 22px 12px; min-height: 277mm; display: flex; flex-direction: column; }
  .pdf-page:last-child { page-break-after: auto; }
  .pdf-hdr { display: grid; grid-template-columns: 1fr 2fr 1fr; gap: 10px; align-items: center; margin-bottom: 6px; }
  .pdf-brand { display: flex; gap: 8px; align-items: center; }
  .pdf-logo { width: 36px; height: 36px; border-radius: 8px; background: linear-gradient(135deg,#1e3a5f,#0ea5e9); color: #fff; font-weight: 900; display: flex; align-items: center; justify-content: center; font-size: 13px; }
  .pdf-name { font-size: 12px; font-weight: 800; color: #1e3a5f; }
  .pdf-sub { font-size: 7px; color: #64748b; letter-spacing: .08em; font-weight: 700; }
  .pdf-title { text-align: center; }
  .pdf-type { font-size: 9px; font-weight: 800; color: #1e3a5f; text-transform: uppercase; letter-spacing: .04em; }
  .pdf-per { font-size: 15px; font-weight: 900; color: #0284c7; margin-top: 2px; }
  .pdf-subtitle { font-size: 9px; color: #64748b; margin-top: 2px; }
  .pdf-meta { font-size: 8px; color: #475569; text-align: right; line-height: 1.5; }
  .pdf-bar { height: 3px; background: linear-gradient(90deg,#1e3a5f,#0ea5e9,#38bdf8); border-radius: 2px; margin-bottom: 10px; }
  .sec { background: linear-gradient(90deg,#1e3a5f,#0284c7); color: #fff; padding: 7px 12px; border-radius: 6px; font-weight: 800; font-size: 11px; margin: 10px 0 8px; }
  .kpis, .cover-kpis { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; margin-bottom: 10px; }
  .kpi { border: 1px solid #e2e8f0; border-top: 3px solid #0284c7; border-radius: 6px; padding: 7px 8px; background: #f8fafc; }
  .kpi .lbl { font-size: 7px; color: #64748b; text-transform: uppercase; font-weight: 700; }
  .kpi .val { font-size: 12px; font-weight: 900; color: #1e3a5f; margin-top: 2px; }
  .row { display: flex; gap: 10px; margin-bottom: 8px; align-items: stretch; }
  .box { flex: 1; min-width: 0; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
  .box.flex2 { flex: 2; }
  .box h3 { font-size: 10px; color: #1e3a5f; margin-bottom: 6px; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; margin-bottom: 6px; }
  table.sm { font-size: 8px; }
  th { background: #1e3a5f; color: #fff; padding: 4px 6px; text-align: left; font-weight: 700; }
  td { padding: 3px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th.r, td.r { text-align: right; }
  tr:nth-child(even) td { background: #f8fafc; }
  .bar-row { display: grid; grid-template-columns: 100px 1fr 70px; gap: 6px; align-items: center; margin-bottom: 4px; }
  .bar-lbl { font-size: 8px; color: #334155; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { height: 14px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; min-width: 2px; }
  .bar-val { font-size: 7px; font-weight: 800; color: #1e3a5f; text-align: right; }
  .legend-item { font-size: 9px; margin-bottom: 4px; color: #475569; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .cover-main { text-align: center; padding: 20px 10px 14px; }
  .cover-badge { display: inline-block; background: #0284c7; color: #fff; font-size: 9px; font-weight: 800; letter-spacing: .12em; padding: 5px 14px; border-radius: 999px; margin-bottom: 12px; }
  .cover h1 { font-size: 28px; color: #1e3a5f; font-weight: 900; margin-bottom: 4px; }
  .cover h2 { font-size: 18px; color: #0284c7; font-weight: 800; margin-bottom: 12px; }
  .cover-desc { font-size: 11px; color: #64748b; max-width: 520px; margin: 0 auto 16px; line-height: 1.55; }
  .exec-box { background: linear-gradient(135deg,#eff6ff,#f0f9ff); border: 1px solid #bae6fd; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .exec-box h3 { font-size: 11px; color: #1e3a5f; margin-bottom: 6px; }
  .exec-box p { font-size: 10px; line-height: 1.6; color: #475569; }
  .comp-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fafafa; }
  .comp-box h4 { font-size: 10px; color: #1e3a5f; margin-bottom: 6px; }
  .comp-tbl .up { color: #15803d; font-weight: 700; }
  .comp-tbl .down { color: #dc2626; font-weight: 700; }
  .fin-banner { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin: 10px 0; }
  .fin-banner div { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; text-align: center; }
  .fin-banner span { display: block; font-size: 8px; color: #64748b; text-transform: uppercase; font-weight: 700; }
  .fin-banner b { font-size: 11px; color: #1e3a5f; }
  .fin-banner .total { background: #1e3a5f; border-color: #1e3a5f; }
  .fin-banner .total span, .fin-banner .total b { color: #fff; }
  .conc-box { background: #f8fafc; border-left: 4px solid #0284c7; padding: 12px 14px; border-radius: 0 8px 8px 0; margin-bottom: 10px; }
  .conc-box h3 { font-size: 11px; color: #1e3a5f; margin-bottom: 6px; }
  .conc-box p { font-size: 10px; line-height: 1.6; color: #475569; }
  .box ul li { margin-bottom: 4px; line-height: 1.45; color: #475569; font-size: 10px; }
  .total-banner { text-align: center; padding: 16px; background: linear-gradient(135deg,#1e3a5f,#0284c7); color: #fff; border-radius: 8px; margin-top: 12px; }
  .total-banner .lbl { font-size: 9px; opacity: .85; text-transform: uppercase; letter-spacing: .06em; }
  .total-banner .val { font-size: 26px; font-weight: 900; margin-top: 4px; }
  .prio { font-weight: 800; padding: 2px 6px; border-radius: 4px; font-size: 8px; }
  .prio.alta { background: #fee2e2; color: #b91c1c; }
  .prio.média, .prio.media { background: #fef9c3; color: #a16207; }
  .prio.baixa { background: #dcfce7; color: #15803d; }
  .footnote { font-size: 8px; color: #94a3b8; margin-top: 10px; line-height: 1.4; }
  .pdf-ftr { margin-top: auto; padding-top: 8px; border-top: 2px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 8px; color: #64748b; }
  .pdf-slogan { font-style: italic; color: #1e3a5f; font-weight: 600; }
  .pdf-pg { font-weight: 700; color: #0284c7; }
  @page { size: A4; margin: 10mm 8mm; }
</style></head><body>${pages}</body></html>`;
}

function htmlToPdf(htmlPath, pdfPath) {
  const chromePaths = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  const chrome = chromePaths.find((p) => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome/Chromium não encontrado para gerar PDF.');
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--print-to-pdf=${pdfPath}`, '--print-to-pdf-no-header', htmlPath,
  ], { stdio: 'pipe' });
  if (!fs.existsSync(pdfPath)) throw new Error('Falha ao gerar PDF.');
}

async function main() {
  if (!pool) throw new Error('DATABASE_URL não configurada.');
  const opts = parseArgs();
  const refDate = new Date();
  const periodoCustom = opts.inicio && opts.fim ? calcPeriodoCustom(opts.inicio, opts.fim) : null;

  console.log(
    periodoCustom
      ? `Buscando vendas — período ${periodoCustom.label}, etapa "${opts.etapa}"...`
      : `Buscando vendas — modo ${opts.modo}, etapa "${opts.etapa}"...`
  );

  const data = await fetchRelatorio(opts.modo, opts.etapa, refDate, periodoCustom);
  if (opts.titulo) data.titulo = opts.titulo;

  let comparacao = null;
  if (periodoCustom) {
    const prev = calcPeriodoAnteriorCustom(periodoCustom);
    console.log(`Buscando período anterior (${prev.label}) para comparativo...`);
    comparacao = await fetchRelatorio(opts.modo, opts.etapa, refDate, prev);
  } else if (opts.modo === '6m') {
    const prevRef = new Date(refDate.getFullYear(), refDate.getMonth() - 6, 1);
    console.log('Buscando semestre anterior para comparativo...');
    comparacao = await fetchRelatorio('6m', opts.etapa, prevRef);
  }

  const textos = gerarTextos(data, comparacao);
  const html = buildHtml(data, comparacao, textos);
  const htmlPath = opts.output.replace(/\.pdf$/i, '.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  htmlToPdf(path.resolve(htmlPath), path.resolve(opts.output));

  console.log('\n✅ PDF de vendas gerado com sucesso!');
  console.log(`   Período: ${data.periodo}`);
  console.log(`   Etapa: ${data.etapa}`);
  console.log(`   Pedidos: ${data.kpis.total_pedidos}`);
  console.log(`   Faturamento: ${MOEDA.format(data.kpis.valor_total)}`);
  console.log(`   Ticket médio: ${MOEDA.format(data.kpis.ticket_medio)}`);
  console.log(`   PDF: ${opts.output}`);
  console.log(`   HTML: ${htmlPath}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('Erro:', err.message || err);
  try { await pool?.end(); } catch (_) { /* ignore */ }
  process.exit(1);
});
