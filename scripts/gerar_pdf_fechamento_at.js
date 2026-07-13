#!/usr/bin/env node
/**
 * Gera PDF gerencial da Assistência Técnica (dados reais do Postgres).
 *
 * Uso:
 *   node scripts/gerar_pdf_fechamento_at.js
 *   node scripts/gerar_pdf_fechamento_at.js --modo 6m --tipo Qualidade
 *   node scripts/gerar_pdf_fechamento_at.js --inicio 2026-05 --fim 2026-07
 *   node scripts/gerar_pdf_fechamento_at.js --output ~/Desktop/Fechamento_AT.pdf
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pool } = require('../src/db');

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const QTD = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const CORES = ['#1e3a5f', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { modo: '6m', tipo: '', output: '', inicio: '', fim: '', titulo: '' };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--modo' && args[i + 1]) { opts.modo = args[++i]; continue; }
    if (args[i] === '--tipo' && args[i + 1] !== undefined) { opts.tipo = args[++i]; continue; }
    if (args[i] === '--inicio' && args[i + 1]) { opts.inicio = args[++i]; continue; }
    if (args[i] === '--fim' && args[i + 1]) { opts.fim = args[++i]; continue; }
    if (args[i] === '--titulo' && args[i + 1]) { opts.titulo = args[++i]; continue; }
    if (args[i] === '--output' && args[i + 1]) { opts.output = args[++i]; continue; }
  }
  if (opts.inicio && !/^\d{4}-\d{2}$/.test(opts.inicio)) {
    throw new Error('--inicio inválido (use YYYY-MM)');
  }
  if (opts.fim && !/^\d{4}-\d{2}$/.test(opts.fim)) {
    throw new Error('--fim inválido (use YYYY-MM)');
  }
  if ((opts.inicio && !opts.fim) || (!opts.inicio && opts.fim)) {
    throw new Error('Informe --inicio e --fim juntos (YYYY-MM).');
  }
  if (!opts.output) {
    const stamp = opts.inicio && opts.fim
      ? `${opts.inicio}_${opts.fim}`.replace(/-/g, '')
      : new Date().toISOString().slice(0, 10);
    opts.output = path.join(process.cwd(), `Fechamento_AT_${stamp}.pdf`);
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

function mesAtualReferencia(refDate = new Date()) {
  const ano = refDate.getFullYear();
  const mesNum = refDate.getMonth() + 1;
  const pad = (n) => String(n).padStart(2, '0');
  return { ano, mesNum, mesRaw: `${ano}-${pad(mesNum)}` };
}

function calcPeriodoCustom(inicioYm, fimYm) {
  const pad = (n) => String(n).padStart(2, '0');
  const mesLabel = (y, m) => (m >= 1 && m <= 12 ? `${NOMES_MES[m - 1]}/${y}` : `${y}-${pad(m)}`);
  const [yi, mi] = inicioYm.split('-').map(Number);
  const [yf, mf] = fimYm.split('-').map(Number);
  if (!yi || !mi || !yf || !mf || mi < 1 || mi > 12 || mf < 1 || mf > 12) {
    throw new Error('Período inválido em --inicio/--fim');
  }
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
    mesRef: fimYm,
    inicio: `${yi}-${pad(mi)}-01`,
    fimExclusive: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`,
    label: meses.length === 1
      ? mesLabel(yi, mi)
      : `${mesLabel(yi, mi)} a ${mesLabel(yf, mf)}`,
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
  const { ano, mesNum, mesRaw } = mesAtualReferencia(refDate);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtYmd = (y, m, d = 1) => `${y}-${pad(m)}-${pad(d)}`;
  const mesLabel = (y, m) => (m >= 1 && m <= 12 ? `${NOMES_MES[m - 1]}/${y}` : `${y}-${pad(m)}`);

  if (modo === 'mes') {
    const nextM = mesNum === 12 ? 1 : mesNum + 1;
    const nextY = mesNum === 12 ? ano + 1 : ano;
    return {
      modo, mesRef: mesRaw, inicio: fmtYmd(ano, mesNum), fimExclusive: fmtYmd(nextY, nextM),
      label: mesLabel(ano, mesNum), meses: [mesRaw], evolucaoTipo: 'semana', qtdMeses: 1,
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
    modo, mesRef: mesRaw,
    inicio: fmtYmd(inicioDate.getFullYear(), inicioDate.getMonth() + 1),
    fimExclusive: fmtYmd(ano, mesNum),
    label: `${mesLabel(inicioDate.getFullYear(), inicioDate.getMonth() + 1)} a ${mesLabel(fimY, fimM)}`,
    meses, evolucaoTipo: 'mes', qtdMeses: qtd,
  };
}

function buildTipoFilter(tipoRaw) {
  const tipo = String(tipoRaw || '').trim();
  if (!tipo) return '';
  const safe = tipo.replace(/'/g, "''");
  // Inclui variantes (ex.: Qualidade/QUALIDADE, Extensão de garantia/EXTENSÃO_GARANTIA)
  return ` AND (${sqlNormalizaTipoAt('a.tipo')}) = (${sqlNormalizaTipoAt(`'${safe}'`)})`;
}

/** Normaliza tipo de AT para agrupar aliases (maiúsculas, underscore, sinônimos). */
function sqlNormalizaTipoAt(expr) {
  return `
    CASE
      WHEN NULLIF(TRIM(${expr}), '') IS NULL THEN '(sem tipo)'
      WHEN LOWER(TRIM(REGEXP_REPLACE(${expr}, '[_]+', ' ', 'g')))
           ~ 'extens[aã]o[[:space:]]*(de[[:space:]]*)?garantia'
        THEN 'Extensão de garantia'
      WHEN LOWER(TRIM(REGEXP_REPLACE(${expr}, '[_]+', ' ', 'g')))
           ~ 'instala[cç][aã]o[[:space:]]*equipamento'
        THEN 'Instalação equipamento'
      WHEN LOWER(TRIM(${expr})) IN ('qualidade') THEN 'Qualidade'
      WHEN LOWER(TRIM(${expr})) IN ('atendimento rápido', 'atendimento rapido') THEN 'Atendimento rápido'
      WHEN LOWER(TRIM(${expr})) = 'comercial' THEN 'Comercial'
      WHEN LOWER(TRIM(${expr})) IN ('logistica', 'logística') THEN 'Logística'
      WHEN LOWER(TRIM(${expr})) = 'engenharia' THEN 'Engenharia'
      WHEN LOWER(TRIM(${expr})) IN ('devolução', 'devolucao') THEN 'Devolução'
      ELSE INITCAP(LOWER(TRIM(REGEXP_REPLACE(${expr}, '[_]+', ' ', 'g'))))
    END
  `;
}

/**
 * Família de modelo para gráficos/ranking.
 * - UPPER no prefixo (fti/FTi → FTI)
 * - typos só-letras (DTI/FTIO/FTIW → FTI)
 * - texto inválido (ALEXANDRE/MODELO/SEM MODELO → sem modelo)
 * - sufixo BR/W sem duplicar (FTIBR, FH160W → FHW)
 */
function sqlFamiliaModeloAt(modeloExpr) {
  const m = `TRIM(COALESCE(${modeloExpr}, ''))`;
  return `
    COALESCE(
      NULLIF(
        (
          CASE
            WHEN ${m} = '' THEN NULL
            WHEN UPPER(REGEXP_REPLACE(${m}, '[[:space:]_-]+', '', 'g'))
                 ~ '^(ALEXANDRE|MODELO|SEMMODELO|NA|N/?A)$'
              THEN NULL
            WHEN UPPER(${m}) IN ('DTI', 'FTIO', 'FTIW', 'FTO', 'FIT', 'FT1') THEN 'FTI'
            WHEN UPPER(${m}) IN ('FTWW') THEN 'FTW'
            WHEN UPPER(${m}) IN ('FHWW') THEN 'FHW'
            ELSE
              CONCAT(
                UPPER(COALESCE(SUBSTRING(${m} FROM '^[A-Za-z]+'), '')),
                CASE
                  WHEN UPPER(${m}) ~ 'BR$'
                    AND UPPER(COALESCE(SUBSTRING(${m} FROM '^[A-Za-z]+'), '')) !~ 'BR$'
                  THEN 'BR'
                  WHEN UPPER(${m}) ~ 'W$'
                    AND UPPER(COALESCE(SUBSTRING(${m} FROM '^[A-Za-z]+'), '')) !~ 'W$'
                  THEN 'W'
                  ELSE ''
                END
              )
          END
        ),
        ''
      ),
      '(sem modelo)'
    )
  `;
}

function baseCte(tipoSql) {
  return `
    WITH base AS (
      SELECT DISTINCT ON (a.id)
        a.id, a.data,
        COALESCE(NULLIF(TRIM(a.estado), ''), 'N/D') AS estado,
        COALESCE(NULLIF(TRIM(a.tag_problema), ''), '(sem tag)') AS tag,
        ${sqlFamiliaModeloAt("COALESCE(s.modelo, a.modelo, '')")} AS modelo,
        TRIM(COALESCE(a.status, '')) AS status_os,
        f.valor_total_mao_obra,
        CASE
          WHEN LOWER(COALESCE(f.status_os, '')) IN ('finalizado', 'fechado')
            OR f.data_conclusao_servico IS NOT NULL
          THEN 'concluida'
          ELSE 'em_andamento'
        END AS status_grupo
      FROM sac.at a
      LEFT JOIN sac.at_busca_selecionada s ON s.id_at = a.id
      LEFT JOIN sac.fechamento f ON f.id_at = a.id
      WHERE a.data >= $1::date AND a.data < $2::date${tipoSql}
      ORDER BY a.id, f.id DESC NULLS LAST
    )
  `;
}

async function fetchRelatorio(modo, tipo, refDate = new Date(), periodoOverride = null) {
  const tipoSql = buildTipoFilter(tipo);
  const periodo = periodoOverride || calcPeriodo(modo, refDate);
  const params = [periodo.inicio, periodo.fimExclusive];
  const cte = baseCte(tipoSql);

  const evolucaoSql = periodo.evolucaoTipo === 'mes'
    ? `${cte} SELECT TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM') AS mes_key, COUNT(*)::int AS total FROM base GROUP BY 1 ORDER BY 1`
    : `${cte} SELECT LEAST(5, GREATEST(1, CEIL(EXTRACT(DAY FROM data) / 7.0)::int)) AS semana, COUNT(*)::int AS total FROM base GROUP BY 1 ORDER BY 1`;

  const [
    rKpi, rEstado, rModelo, rTag, rStatus, rEvolucao, rFinanceiro, rTopPecas, rTipo,
  ] = await Promise.all([
    pool.query(`${cte}
      SELECT COUNT(*)::int AS total_os,
        COUNT(*) FILTER (WHERE status_grupo = 'concluida')::int AS concluidas,
        COUNT(*) FILTER (WHERE status_grupo = 'em_andamento')::int AS em_andamento,
        COUNT(DISTINCT estado) FILTER (WHERE estado <> 'N/D')::int AS estados_atendidos,
        COUNT(DISTINCT modelo) FILTER (WHERE modelo <> '(sem modelo)')::int AS modelos_atendidos,
        COUNT(*) FILTER (WHERE status_os = 'Aguardando NF AT')::int AS pendente_fechamento_tecnico,
        COALESCE(SUM(valor_total_mao_obra) FILTER (WHERE status_grupo = 'concluida'), 0)::float AS total_mo,
        COALESCE(AVG(valor_total_mao_obra) FILTER (
          WHERE status_grupo = 'concluida' AND valor_total_mao_obra IS NOT NULL AND valor_total_mao_obra > 0
        ), 0)::float AS custo_medio
      FROM base`, params),
    pool.query(`${cte} SELECT estado, COUNT(*)::int AS total FROM base GROUP BY estado ORDER BY total DESC`, params),
    pool.query(`${cte} SELECT modelo, COUNT(*)::int AS total FROM base GROUP BY modelo ORDER BY total DESC, modelo LIMIT 12`, params),
    pool.query(`${cte} SELECT tag, COUNT(*)::int AS total FROM base GROUP BY tag ORDER BY total DESC`, params),
    pool.query(`${cte} SELECT status_grupo, COUNT(*)::int AS total FROM base GROUP BY status_grupo`, params),
    pool.query(evolucaoSql, params),
    pool.query(`${cte}
      SELECT b.id, b.estado, b.data, b.valor_total_mao_obra, b.status_grupo,
        COALESCE(env.total_envio, 0)::float AS valor_envio,
        COALESCE(cp.total_pecas, 0)::float AS valor_pecas
      FROM base b
      LEFT JOIN (SELECT id_at, SUM(COALESCE(valor_envio, 0))::float AS total_envio FROM envios.solicitacoes WHERE id_at IS NOT NULL GROUP BY id_at) env ON env.id_at = b.id
      LEFT JOIN (SELECT id_at, SUM(COALESCE(valor_total, 0))::float AS total_pecas FROM envios.custo_pecas WHERE id_at IS NOT NULL GROUP BY id_at) cp ON cp.id_at = b.id
      WHERE COALESCE(b.valor_total_mao_obra, 0) > 0 OR COALESCE(env.total_envio, 0) > 0 OR COALESCE(cp.total_pecas, 0) > 0
      ORDER BY b.data ASC`, params),
    pool.query(`
      SELECT COALESCE(NULLIF(TRIM(cp.codigo_produto), ''), '(sem código)') AS codigo,
        COALESCE(NULLIF(TRIM(cp.descricao), ''), '(sem descrição)') AS descricao,
        SUM(COALESCE(cp.quantidade, 0))::float AS quantidade,
        SUM(COALESCE(cp.valor_total, 0))::float AS valor_total,
        COUNT(DISTINCT cp.id_at)::int AS qtd_os
      FROM envios.custo_pecas cp
      INNER JOIN sac.at a ON a.id = cp.id_at
      WHERE a.data >= $1::date AND a.data < $2::date${tipoSql}
        AND COALESCE(cp.valor_total, 0) > 0
      GROUP BY 1, 2 ORDER BY valor_total DESC LIMIT 12`, params),
    pool.query(`
      SELECT (${sqlNormalizaTipoAt('a2.tipo')}) AS tipo, COUNT(*)::int AS total
      FROM sac.at a2
      WHERE a2.data >= $1::date AND a2.data < $2::date${tipoSql.replace(/a\./g, 'a2.')}
      GROUP BY 1
      ORDER BY total DESC, tipo`, params),
  ]);

  const kpi = rKpi.rows[0] || {};
  const tags = rTag.rows || [];
  const tagTotal = tags.reduce((s, r) => s + (r.total || 0), 0);
  let acum = 0;
  const pareto = tags.map((r) => {
    acum += r.total || 0;
    return {
      tag: r.tag, total: r.total,
      pct: tagTotal ? Math.round((r.total / tagTotal) * 1000) / 10 : 0,
      pct_acum: tagTotal ? Math.round((acum / tagTotal) * 1000) / 10 : 0,
    };
  });

  const financeiroRows = (rFinanceiro.rows || []).map((r) => {
    const valorMo = Math.round(Number(r.valor_total_mao_obra || 0) * 100) / 100;
    const valorEnvio = Math.round(Number(r.valor_envio || 0) * 100) / 100;
    const valorPecas = Math.round(Number(r.valor_pecas || 0) * 100) / 100;
    return {
      id: r.id,
      os: `${String(new Date(r.data).getFullYear()).slice(-2)} - ${r.id}`,
      estado: r.estado, data: r.data, status_grupo: r.status_grupo,
      valor_mo: valorMo, valor_envio: valorEnvio, valor_pecas: valorPecas,
      valor_total: Math.round((valorMo + valorEnvio + valorPecas) * 100) / 100,
    };
  });

  const totalEnvio = financeiroRows.reduce((s, r) => s + (r.valor_envio || 0), 0);
  const totalPecas = financeiroRows.reduce((s, r) => s + (r.valor_pecas || 0), 0);
  const totalMo = Math.round(Number(kpi.total_mo || 0) * 100) / 100;
  const totalGeral = Math.round((totalMo + totalEnvio + totalPecas) * 100) / 100;

  const evolucao = periodo.evolucaoTipo === 'mes'
    ? (rEvolucao.rows || []).map((r) => {
      const [y, m] = String(r.mes_key || '').split('-');
      const mi = parseInt(m, 10);
      return { label: mi >= 1 && mi <= 12 ? `${NOMES_MES[mi - 1]}/${y}` : r.mes_key, total: r.total };
    })
    : (rEvolucao.rows || []).map((r) => ({ label: `Sem ${r.semana}`, total: r.total }));

  return {
    periodo: periodo.label,
    modo: periodo.modo,
    tipo: tipo || 'Todos',
    titulo: null,
    kpis: {
      total_os: kpi.total_os || 0,
      concluidas: kpi.concluidas || 0,
      em_andamento: kpi.em_andamento || 0,
      estados_atendidos: kpi.estados_atendidos || 0,
      modelos_atendidos: kpi.modelos_atendidos || 0,
      pendente_fechamento_tecnico: kpi.pendente_fechamento_tecnico || 0,
      total_mo: totalMo,
      custo_medio: Math.round((kpi.custo_medio || 0) * 100) / 100,
      total_envio: Math.round(totalEnvio * 100) / 100,
      total_pecas: Math.round(totalPecas * 100) / 100,
      total_custo_geral: totalGeral,
      pct_concluidas: kpi.total_os ? Math.round((kpi.concluidas / kpi.total_os) * 100) : 0,
    },
    por_estado: rEstado.rows,
    por_modelo: rModelo.rows,
    por_tag: tags,
    por_status: rStatus.rows,
    por_tipo: rTipo.rows,
    evolucao,
    pareto,
    financeiro: financeiroRows.sort((a, b) => (b.valor_total || 0) - (a.valor_total || 0)).slice(0, 25),
    top_pecas: (rTopPecas.rows || []).map((r) => ({
      codigo: r.codigo, descricao: r.descricao,
      quantidade: Math.round(Number(r.quantidade || 0) * 1000) / 1000,
      valor_total: Math.round(Number(r.valor_total || 0) * 100) / 100,
      qtd_os: r.qtd_os || 0,
    })),
  };
}

function barChartHtml(items, { labelKey = 'label', valueKey = 'total', maxItems = 10, color = CORES[0] } = {}) {
  const rows = (items || []).slice(0, maxItems);
  if (!rows.length) return '<p style="color:#94a3b8;font-size:10px;">Sem dados.</p>';
  const max = Math.max(...rows.map((r) => Number(r[valueKey] || 0)), 1);
  return rows.map((r, i) => {
    const val = Number(r[valueKey] || 0);
    const pct = Math.max(4, Math.round((val / max) * 100));
    const c = CORES[i % CORES.length];
    return `<div class="bar-row">
      <div class="bar-lbl">${esc(r[labelKey])}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${c};"></div></div>
      <div class="bar-val">${QTD.format(val)}</div>
    </div>`;
  }).join('');
}

function donutLegendHtml(items, valueKey = 'total') {
  const rows = items || [];
  const total = rows.reduce((s, r) => s + (r.total || r[valueKey] || 0), 0) || 1;
  return rows.slice(0, 8).map((r, i) => {
    const val = r.total || r[valueKey] || 0;
    const pct = Math.round((val / total) * 1000) / 10;
    return `<div class="legend-item"><span class="dot" style="background:${CORES[i % CORES.length]}"></span>${esc(r.estado || r.tag || r.modelo || r.tipo)} <b>${pct}%</b> (${val})</div>`;
  }).join('');
}

function gerarTextos(data, comparacao) {
  const kpis = data.kpis || {};
  const topTags = (data.pareto || []).slice(0, 5);
  const topEst = (data.por_estado || []).slice(0, 3);
  const topMod = (data.por_modelo || []).slice(0, 3);
  const tagsCrit = topTags.slice(0, 3).map((r) => r.tag).join(', ') || '—';
  const estTop = topEst.map((r) => `${r.estado} (${r.total})`).join(', ') || '—';
  const modTop = topMod.map((r) => `${r.modelo} (${r.total})`).join(', ') || '—';

  let compTxt = '';
  if (comparacao?.kpis?.total_os) {
    const diff = kpis.total_os - comparacao.kpis.total_os;
    const pctDiff = Math.round((diff / comparacao.kpis.total_os) * 1000) / 10;
    compTxt = ` Em relação ao período anterior (${comparacao.periodo}), o volume ${diff >= 0 ? 'aumentou' : 'reduziu'} ${Math.abs(pctDiff)}% (${diff >= 0 ? '+' : ''}${diff} O.S.).`;
  }

  return {
    resumo: `No período ${data.periodo} (${data.tipo}) foram registradas ${kpis.total_os || 0} ordens de serviço, com ${kpis.concluidas || 0} concluídas (${kpis.pct_concluidas}%) e ${kpis.em_andamento || 0} em andamento.${compTxt} O custo total registrado (M.O. + peças + frete) foi de ${MOEDA.format(kpis.total_custo_geral || 0)}, sendo ${MOEDA.format(kpis.total_mo || 0)} em mão de obra.`,
    criticos: [
      `Defeitos mais frequentes (Pareto): ${tagsCrit}`,
      `Estados com maior volume: ${estTop}`,
      `Modelos com maior incidência: ${modTop}`,
      `${kpis.pendente_fechamento_tecnico || 0} O.S. aguardando fechamento técnico (NF AT)`,
    ],
    oportunidades: [
      'Atacar os 20% de tags que concentram 80% das ocorrências (análise Pareto)',
      'Reforçar treinamento técnico nos modelos e regiões de maior incidência',
      'Reduzir O.S. em andamento e padronizar registro de custos nas conclusões',
      'Monitorar lotes de produção com maior taxa de retorno na análise de qualidade',
    ],
    plano: topTags.slice(0, 4).map((r, i) => ({
      acao: `Ação ${i + 1}`,
      descricao: `Plano de contenção para "${r.tag}" — ${r.total} ocorrência(s) (${r.pct}% do total)`,
      responsavel: 'Qualidade / AT',
      prazo: 'Próximo semestre',
      prioridade: i === 0 ? 'ALTA' : (i === 1 ? 'MÉDIA' : 'BAIXA'),
    })),
  };
}

function buildHtml(data, comparacao, textos) {
  const kpis = data.kpis;
  const tipoLabel = data.tipo === 'Todos' || !data.tipo ? 'Consolidado' : data.tipo;
  const dataGer = new Date().toLocaleDateString('pt-BR');
  const totalPages = 6;
  const reportTitle = data.titulo
    || (data.modo === '6m' ? 'Fechamento Semestral — Assistência Técnica' : 'Relatório Gerencial — Assistência Técnica');
  const coverBadge = data.modo === '6m' ? 'FECHAMENTO SEMESTRAL' : 'RELATÓRIO GERENCIAL';
  const periodoAtualLbl = data.modo === '6m' ? 'Semestre atual' : 'Período atual';
  const periodoAntLbl = data.modo === '6m' ? 'Semestre anterior' : 'Período anterior';

  const hdr = (sub) => `
    <div class="pdf-hdr">
      <div class="pdf-brand"><div class="pdf-logo">FT</div><div><div class="pdf-name">FROMTHERM</div><div class="pdf-sub">BOMBAS DE CALOR</div></div></div>
      <div class="pdf-title"><div class="pdf-type">${esc(reportTitle)}</div><div class="pdf-per">${esc(data.periodo)} · ${esc(tipoLabel)}</div>${sub ? `<div class="pdf-subtitle">${esc(sub)}</div>` : ''}</div>
      <div class="pdf-meta"><div><b>Departamento:</b> Qualidade / AT</div><div><b>Data:</b> ${esc(dataGer)}</div><div><b>Versão:</b> 1.0</div></div>
    </div><div class="pdf-bar"></div>`;

  const ftr = (pg) => `<div class="pdf-ftr"><div class="pdf-slogan">Qualidade que transforma. Conforto que dura.</div><div class="pdf-pg">Página ${pg} de ${totalPages}</div></div>`;

  const kpiCards = [
    ['Total O.S.', QTD.format(kpis.total_os)],
    ['Concluídas', `${QTD.format(kpis.concluidas)} (${kpis.pct_concluidas}%)`],
    ['Em andamento', QTD.format(kpis.em_andamento)],
    ['Estados atendidos', QTD.format(kpis.estados_atendidos)],
    ['Modelos distintos', QTD.format(kpis.modelos_atendidos)],
    ['Pend. fechamento', QTD.format(kpis.pendente_fechamento_tecnico)],
    ['Total M.O.', MOEDA.format(kpis.total_mo)],
    ['Custo total', MOEDA.format(kpis.total_custo_geral)],
  ].map(([l, v]) => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div></div>`).join('');

  const compHtml = comparacao ? `
    <div class="comp-box">
      <h4>Comparativo com ${esc(periodoAntLbl.toLowerCase())} (${esc(comparacao.periodo)})</h4>
      <table class="comp-tbl">
        <thead><tr><th>Indicador</th><th class="r">${esc(periodoAtualLbl)}</th><th class="r">${esc(periodoAntLbl)}</th><th class="r">Variação</th></tr></thead>
        <tbody>
          ${[
            ['Total O.S.', kpis.total_os, comparacao.kpis.total_os],
            ['Concluídas', kpis.concluidas, comparacao.kpis.concluidas],
            ['Em andamento', kpis.em_andamento, comparacao.kpis.em_andamento],
            ['Total M.O.', kpis.total_mo, comparacao.kpis.total_mo, true],
            ['Custo total', kpis.total_custo_geral, comparacao.kpis.total_custo_geral, true],
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

  const modTbl = (data.por_modelo || []).map((r) => `<tr><td>${esc(r.modelo)}</td><td class="r">${r.total}</td></tr>`).join('');
  const tagTbl = (data.por_tag || []).slice(0, 15).map((r) => {
    const tot = (data.por_tag || []).reduce((s, x) => s + x.total, 0);
    const pct = tot ? Math.round((r.total / tot) * 1000) / 10 : 0;
    return `<tr><td>${esc(r.tag)}</td><td class="r">${r.total}</td><td class="r">${pct}%</td></tr>`;
  }).join('');
  const paretoTbl = (data.pareto || []).slice(0, 12).map((r) =>
    `<tr><td>${esc(r.tag)}</td><td class="r">${r.total}</td><td class="r">${r.pct}%</td><td class="r">${r.pct_acum}%</td></tr>`
  ).join('');
  const finTbl = (data.financeiro || []).map((r) =>
    `<tr><td>${esc(r.os)}</td><td>${esc(r.estado)}</td><td>${fmtData(r.data)}</td>` +
    `<td class="r">${MOEDA.format(r.valor_mo)}</td><td class="r">${MOEDA.format(r.valor_pecas)}</td>` +
    `<td class="r">${MOEDA.format(r.valor_envio)}</td><td class="r"><b>${MOEDA.format(r.valor_total)}</b></td></tr>`
  ).join('');
  const pecasTbl = (data.top_pecas || []).map((r) =>
    `<tr><td>${esc(r.codigo)}</td><td>${esc(r.descricao)}</td><td class="r">${r.quantidade}</td><td class="r">${r.qtd_os}</td><td class="r">${MOEDA.format(r.valor_total)}</td></tr>`
  ).join('');
  const tipoTbl = (data.por_tipo || []).map((r) => `<tr><td>${esc(r.tipo)}</td><td class="r">${r.total}</td></tr>`).join('');
  const planoTbl = (textos.plano || []).map((r) =>
    `<tr><td>${esc(r.acao)}</td><td>${esc(r.descricao)}</td><td>${esc(r.responsavel)}</td><td>${esc(r.prazo)}</td><td><span class="prio ${r.prioridade.toLowerCase()}">${r.prioridade}</span></td></tr>`
  ).join('');

  const pages = [
    // Capa + resumo executivo
    `<div class="pdf-page cover">
      ${hdr('Apresentação gerencial')}
      <div class="cover-main">
        <div class="cover-badge">${esc(coverBadge)}</div>
        <h1>Assistência Técnica</h1>
        <h2>${esc(data.periodo)}</h2>
        <p class="cover-desc">Relatório consolidado de ordens de serviço, indicadores operacionais, análise de defeitos, custos e plano de ação para reunião de fechamento.</p>
        <div class="cover-kpis">${kpiCards}</div>
      </div>
      <div class="exec-box"><h3>Resumo executivo</h3><p>${esc(textos.resumo)}</p></div>
      ${compHtml}
      ${ftr(1)}
    </div>`,

    // Dashboard + geográfico + tipos
    `<div class="pdf-page">
      ${hdr('Dashboard e distribuição')}
      <div class="sec">Indicadores principais</div>
      <div class="kpis">${kpiCards}</div>
      <div class="row">
        <div class="box"><h3>Status das O.S.</h3>${barChartHtml(
          (data.por_status || []).map((r) => ({ label: r.status_grupo === 'concluida' ? 'Concluídas' : 'Em andamento', total: r.total })),
          { color: '#10b981' }
        )}</div>
        <div class="box"><h3>O.S. por tipo de atendimento</h3><table><thead><tr><th>Tipo</th><th class="r">Qtd</th></tr></thead><tbody>${tipoTbl || '<tr><td colspan="2">—</td></tr>'}</tbody></table></div>
      </div>
      <div class="sec">Distribuição geográfica</div>
      <div class="row">
        <div class="box flex2"><h3>O.S. por estado</h3>${barChartHtml(data.por_estado, { labelKey: 'estado' })}</div>
        <div class="box"><h3>Participação (%)</h3><div class="legend">${donutLegendHtml(data.por_estado)}</div></div>
      </div>
      ${ftr(2)}
    </div>`,

    // Modelos + defeitos + evolução
    `<div class="pdf-page">
      ${hdr('Modelos, defeitos e evolução')}
      <div class="sec">Modelos com maior incidência</div>
      <div class="row">
        <div class="box flex2">${barChartHtml(data.por_modelo, { labelKey: 'modelo' })}</div>
        <div class="box"><table><thead><tr><th>Modelo</th><th class="r">Qtd</th></tr></thead><tbody>${modTbl || '<tr><td colspan="2">—</td></tr>'}</tbody></table></div>
      </div>
      <div class="sec">Análise por tipo de defeito (tags)</div>
      <div class="row">
        <div class="box flex2">${barChartHtml(data.por_tag, { labelKey: 'tag', maxItems: 12 })}</div>
        <div class="box"><table><thead><tr><th>Tag</th><th class="r">Qtd</th><th class="r">%</th></tr></thead><tbody>${tagTbl || '<tr><td colspan="3">—</td></tr>'}</tbody></table></div>
      </div>
      <div class="sec">Evolução mensal de chamados</div>
      <div class="box">${barChartHtml(data.evolucao, { labelKey: 'label', color: '#38bdf8' })}</div>
      ${ftr(3)}
    </div>`,

    // Pareto + financeiro
    `<div class="pdf-page">
      ${hdr('Pareto e análise financeira')}
      <div class="sec">Pareto 80/20 — defeitos</div>
      <table><thead><tr><th>Tag / Defeito</th><th class="r">Qtd</th><th class="r">%</th><th class="r">Acum.</th></tr></thead><tbody>${paretoTbl || '<tr><td colspan="4">—</td></tr>'}</tbody></table>
      <div class="fin-banner">
        <div><span>M.O.</span><b>${MOEDA.format(kpis.total_mo)}</b></div>
        <div><span>Peças (CMC)</span><b>${MOEDA.format(kpis.total_pecas)}</b></div>
        <div><span>Frete VIPP</span><b>${MOEDA.format(kpis.total_envio)}</b></div>
        <div class="total"><span>Custo total</span><b>${MOEDA.format(kpis.total_custo_geral)}</b></div>
      </div>
      <div class="sec">Top O.S. por custo total</div>
      <table class="sm"><thead><tr><th>O.S.</th><th>UF</th><th>Data</th><th class="r">M.O.</th><th class="r">Peças</th><th class="r">Envio</th><th class="r">Total</th></tr></thead><tbody>${finTbl || '<tr><td colspan="7">—</td></tr>'}</tbody></table>
      <div class="sec">Top peças por custo (CMC)</div>
      <table class="sm"><thead><tr><th>Código</th><th>Descrição</th><th class="r">Qtd</th><th class="r">O.S.</th><th class="r">Custo</th></tr></thead><tbody>${pecasTbl || '<tr><td colspan="5">—</td></tr>'}</tbody></table>
      ${ftr(4)}
    </div>`,

    // Plano de ação
    `<div class="pdf-page">
      ${hdr('Plano de ação')}
      <div class="sec">Ações prioritárias — próximo semestre</div>
      <table><thead><tr><th>Ação</th><th>Descrição</th><th>Responsável</th><th>Prazo</th><th>Prioridade</th></tr></thead><tbody>${planoTbl || '<tr><td colspan="5">—</td></tr>'}</tbody></table>
      <div class="sec">Pontos críticos identificados</div>
      <ul class="obs">${textos.criticos.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      ${ftr(5)}
    </div>`,

    // Conclusão
    `<div class="pdf-page">
      ${hdr('Conclusão executiva')}
      <div class="conc-box"><h3>Síntese do semestre</h3><p>${esc(textos.resumo)}</p></div>
      <div class="row">
        <div class="box"><h3>Pontos críticos</h3><ul>${textos.criticos.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
        <div class="box"><h3>Oportunidades de melhoria</h3><ul>${textos.oportunidades.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
      </div>
      <div class="total-banner"><div class="lbl">Total de O.S. no semestre</div><div class="val">${QTD.format(kpis.total_os)}</div></div>
      <p class="footnote">Documento gerado automaticamente a partir dos dados da intranet Fromtherm (sac.at, fechamentos, custos de peças e envios). Valores de peças conforme CMC registrado; fretes conforme postagens VIPP.</p>
      ${ftr(6)}
    </div>`,
  ].join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Fechamento Semestral AT — ${esc(data.periodo)}</title>
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
  .pdf-per { font-size: 15px; font-weight: 900; color: #ea580c; margin-top: 2px; }
  .pdf-subtitle { font-size: 9px; color: #64748b; margin-top: 2px; }
  .pdf-meta { font-size: 8px; color: #475569; text-align: right; line-height: 1.5; }
  .pdf-bar { height: 3px; background: linear-gradient(90deg,#1e3a5f,#0ea5e9,#f59e0b); border-radius: 2px; margin-bottom: 10px; }
  .sec { background: linear-gradient(90deg,#1e3a5f,#2563eb); color: #fff; padding: 7px 12px; border-radius: 6px; font-weight: 800; font-size: 11px; margin: 10px 0 8px; }
  .sec:first-of-type { margin-top: 0; }
  .kpis, .cover-kpis { display: grid; grid-template-columns: repeat(4,1fr); gap: 6px; margin-bottom: 10px; }
  .kpi { border: 1px solid #e2e8f0; border-top: 3px solid #1e3a5f; border-radius: 6px; padding: 7px 8px; background: #f8fafc; }
  .kpi .lbl { font-size: 7px; color: #64748b; text-transform: uppercase; font-weight: 700; letter-spacing: .03em; }
  .kpi .val { font-size: 13px; font-weight: 900; color: #1e3a5f; margin-top: 2px; }
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
  .bar-row { display: grid; grid-template-columns: 90px 1fr 36px; gap: 6px; align-items: center; margin-bottom: 4px; }
  .bar-lbl { font-size: 8px; color: #334155; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { height: 14px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; min-width: 2px; }
  .bar-val { font-size: 8px; font-weight: 800; color: #1e3a5f; text-align: right; }
  .legend-item { font-size: 9px; margin-bottom: 4px; color: #475569; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .cover-main { text-align: center; padding: 24px 10px 16px; }
  .cover-badge { display: inline-block; background: #ea580c; color: #fff; font-size: 9px; font-weight: 800; letter-spacing: .12em; padding: 5px 14px; border-radius: 999px; margin-bottom: 12px; }
  .cover h1 { font-size: 28px; color: #1e3a5f; font-weight: 900; margin-bottom: 4px; }
  .cover h2 { font-size: 18px; color: #ea580c; font-weight: 800; margin-bottom: 12px; }
  .cover-desc { font-size: 11px; color: #64748b; max-width: 520px; margin: 0 auto 16px; line-height: 1.55; }
  .exec-box { background: linear-gradient(135deg,#eff6ff,#f0fdf4); border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .exec-box h3 { font-size: 11px; color: #1e3a5f; margin-bottom: 6px; }
  .exec-box p { font-size: 10px; line-height: 1.6; color: #475569; }
  .comp-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fafafa; }
  .comp-box h4 { font-size: 10px; color: #1e3a5f; margin-bottom: 6px; }
  .comp-tbl .up { color: #dc2626; font-weight: 700; }
  .comp-tbl .down { color: #15803d; font-weight: 700; }
  .fin-banner { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin: 10px 0; }
  .fin-banner div { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; text-align: center; }
  .fin-banner span { display: block; font-size: 8px; color: #64748b; text-transform: uppercase; font-weight: 700; }
  .fin-banner b { font-size: 12px; color: #1e3a5f; }
  .fin-banner .total { background: #1e3a5f; border-color: #1e3a5f; }
  .fin-banner .total span, .fin-banner .total b { color: #fff; }
  .obs li, .box ul li { margin-bottom: 4px; line-height: 1.45; color: #475569; font-size: 10px; }
  .obs { padding-left: 16px; margin-top: 6px; }
  .conc-box { background: #f8fafc; border-left: 4px solid #f59e0b; padding: 12px 14px; border-radius: 0 8px 8px 0; margin-bottom: 10px; }
  .conc-box h3 { font-size: 11px; color: #1e3a5f; margin-bottom: 6px; }
  .conc-box p { font-size: 10px; line-height: 1.6; color: #475569; }
  .total-banner { text-align: center; padding: 16px; background: linear-gradient(135deg,#1e3a5f,#2563eb); color: #fff; border-radius: 8px; margin-top: 12px; }
  .total-banner .lbl { font-size: 9px; opacity: .85; text-transform: uppercase; letter-spacing: .06em; }
  .total-banner .val { font-size: 32px; font-weight: 900; margin-top: 4px; }
  .prio { font-weight: 800; padding: 2px 6px; border-radius: 4px; font-size: 8px; }
  .prio.alta { background: #fee2e2; color: #b91c1c; }
  .prio.média, .prio.media { background: #fef9c3; color: #a16207; }
  .prio.baixa { background: #dcfce7; color: #15803d; }
  .footnote { font-size: 8px; color: #94a3b8; margin-top: 10px; line-height: 1.4; }
  .pdf-ftr { margin-top: auto; padding-top: 8px; border-top: 2px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 8px; color: #64748b; }
  .pdf-slogan { font-style: italic; color: #1e3a5f; font-weight: 600; }
  .pdf-pg { font-weight: 700; color: #ea580c; }
  @page { size: A4; margin: 10mm 8mm; }
</style></head><body>${pages}</body></html>`;
}

function htmlToPdf(htmlPath, pdfPath) {
  const chromePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  const chrome = chromePaths.find((p) => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome/Chromium não encontrado para gerar PDF.');

  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--print-to-pdf=${pdfPath}`,
    '--print-to-pdf-no-header',
    htmlPath,
  ], { stdio: 'pipe' });

  if (!fs.existsSync(pdfPath)) throw new Error('Falha ao gerar PDF.');
}

async function main() {
  if (!pool) throw new Error('DATABASE_URL não configurada.');

  const opts = parseArgs();
  const refDate = new Date();
  const periodoCustom = opts.inicio && opts.fim
    ? calcPeriodoCustom(opts.inicio, opts.fim)
    : null;

  console.log(
    periodoCustom
      ? `Buscando dados AT — período ${periodoCustom.label}, tipo "${opts.tipo || 'Todos'}"...`
      : `Buscando dados AT — modo ${opts.modo}, tipo "${opts.tipo || 'Todos'}"...`
  );
  const data = await fetchRelatorio(opts.modo, opts.tipo, refDate, periodoCustom);
  if (opts.titulo) data.titulo = opts.titulo;
  else if (periodoCustom) {
    data.titulo = `Relatório Gerencial — Assistência Técnica`;
  }

  let comparacao = null;
  if (periodoCustom) {
    const prevPeriodo = calcPeriodoAnteriorCustom(periodoCustom);
    console.log(`Buscando período anterior (${prevPeriodo.label}) para comparativo...`);
    comparacao = await fetchRelatorio(opts.modo, opts.tipo, refDate, prevPeriodo);
  } else if (opts.modo === '6m') {
    const prevRef = new Date(refDate.getFullYear(), refDate.getMonth() - 6, 1);
    console.log('Buscando semestre anterior para comparativo...');
    comparacao = await fetchRelatorio('6m', opts.tipo, prevRef);
  }

  const textos = gerarTextos(data, comparacao);
  const html = buildHtml(data, comparacao, textos);

  const htmlPath = opts.output.replace(/\.pdf$/i, '.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  htmlToPdf(path.resolve(htmlPath), path.resolve(opts.output));

  console.log('\n✅ PDF gerado com sucesso!');
  console.log(`   Período: ${data.periodo}`);
  console.log(`   Total O.S.: ${data.kpis.total_os}`);
  console.log(`   Concluídas: ${data.kpis.concluidas} (${data.kpis.pct_concluidas}%)`);
  console.log(`   Custo total: ${MOEDA.format(data.kpis.total_custo_geral)}`);
  console.log(`   PDF: ${opts.output}`);
  console.log(`   HTML: ${htmlPath}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('Erro:', err.message || err);
  try { await pool?.end(); } catch (_) { /* ignore */ }
  process.exit(1);
});
