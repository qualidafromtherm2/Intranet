const express = require('express');
const { pool } = require('../src/db');

const router = express.Router();

let _ensureSchemaPromise = null;

async function ensureLogisticaRelatorioSchema() {
  if (_ensureSchemaPromise) return _ensureSchemaPromise;
  _ensureSchemaPromise = pool.query(`
    CREATE SCHEMA IF NOT EXISTS logistica;
    CREATE TABLE IF NOT EXISTS logistica.relatorio_gerencial (
      id BIGSERIAL PRIMARY KEY,
      mes CHAR(7) NOT NULL UNIQUE,
      plano_acao JSONB NOT NULL DEFAULT '[]'::jsonb,
      conclusao_resumo TEXT,
      conclusao_pontos_criticos TEXT,
      conclusao_oportunidades TEXT,
      editado_por TEXT,
      editado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS logistica_relatorio_gerencial_mes_idx
      ON logistica.relatorio_gerencial (mes);
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

function labelMes(yyyymm, nomesMes) {
  const [y, m] = String(yyyymm || '').split('-');
  const mi = parseInt(m, 10);
  return mi >= 1 && mi <= 12 ? `${nomesMes[mi - 1]}/${y}` : yyyymm;
}

async function safeQuery(sql, params = []) {
  try {
    return await pool.query(sql, params);
  } catch (err) {
    console.warn('[LOGISTICA/relatorio] query falhou:', err.message);
    return { rows: [] };
  }
}

// GET /logistica/relatorio-gerencial
router.get('/logistica/relatorio-gerencial', async (req, res) => {
  try {
    await ensureLogisticaRelatorioSchema();
    const modoRaw = String(req.query.modo || 'mes').trim().toLowerCase();
    const periodoCfg = calcPeriodo(modoRaw);
    const {
      inicio: mesInicio,
      fimExclusive: mesFimExclusive,
      label: periodoLabel,
      modo,
      evolucaoTipo,
      mesRef: mesRaw,
    } = periodoCfg;
    const rangeParams = [mesInicio, mesFimExclusive];
    const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    const evolucaoSql = evolucaoTipo === 'mes'
      ? `SELECT TO_CHAR(DATE_TRUNC('month', data_ref), 'YYYY-MM') AS mes_key,
                COUNT(*)::int AS total
           FROM evol_base GROUP BY 1 ORDER BY 1`
      : `SELECT LEAST(5, GREATEST(1, CEIL(EXTRACT(DAY FROM data_ref) / 7.0)::int)) AS semana,
                COUNT(*)::int AS total
           FROM evol_base GROUP BY 1 ORDER BY 1`;

    const [
      rKpiSep,
      rSepStatus,
      rTrfStatus,
      rTrfRotas,
      rAjusteStatus,
      rAjusteTipo,
      rRecebStatus,
      rEnvioStatus,
      rEnvioMetodo,
      rEstoqueMin,
      rEtq,
      rEvolSep,
      rTopSep,
      rTempoEnvio,
      rTempoFaixas,
      rTempoDetalhe,
      rEnvioExecutor,
    ] = await Promise.all([
      safeQuery(`
        SELECT
          COUNT(*)::int AS total_itens,
          COUNT(*) FILTER (WHERE COALESCE(TRIM(status), '') NOT IN ('Concluído', 'Concluido'))::int AS abertos,
          COUNT(*) FILTER (WHERE COALESCE(TRIM(status), '') IN ('Concluído', 'Concluido'))::int AS concluidos,
          COUNT(*) FILTER (WHERE COALESCE(urgente, false))::int AS urgentes
        FROM logistica.itens_solicitados
        WHERE COALESCE(criado_em, NOW())::date >= $1::date
          AND COALESCE(criado_em, NOW())::date < $2::date
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(status), ''), 'Sem status') AS status, COUNT(*)::int AS total
        FROM logistica.itens_solicitados
        WHERE COALESCE(criado_em, NOW())::date >= $1::date
          AND COALESCE(criado_em, NOW())::date < $2::date
        GROUP BY 1 ORDER BY total DESC, status LIMIT 12
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(status), ''), 'Sem status') AS status, COUNT(*)::int AS total,
               COALESCE(SUM(qtd), 0)::float AS qtd_total
        FROM logistica.transferencias
        WHERE COALESCE(data_movimentacao, CURRENT_DATE) >= $1::date
          AND COALESCE(data_movimentacao, CURRENT_DATE) < $2::date
        GROUP BY 1 ORDER BY total DESC
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(origem), ''), '?') AS origem,
               COALESCE(NULLIF(TRIM(destino), ''), '?') AS destino,
               COUNT(*)::int AS total,
               COALESCE(SUM(qtd), 0)::float AS qtd_total
        FROM logistica.transferencias
        WHERE COALESCE(data_movimentacao, CURRENT_DATE) >= $1::date
          AND COALESCE(data_movimentacao, CURRENT_DATE) < $2::date
          AND TRIM(COALESCE(status, '')) = 'Transferido'
        GROUP BY 1, 2 ORDER BY total DESC LIMIT 15
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(status), ''), 'Sem status') AS status, COUNT(*)::int AS total,
               COALESCE(SUM(qtd), 0)::float AS qtd_total
        FROM logistica.ajustes_estoque
        WHERE COALESCE(data_movimentacao, criado_em::date) >= $1::date
          AND COALESCE(data_movimentacao, criado_em::date) < $2::date
        GROUP BY 1 ORDER BY total DESC
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(tipo_operacao), ''), '?') AS tipo, COUNT(*)::int AS total,
               COALESCE(SUM(qtd), 0)::float AS qtd_total
        FROM logistica.ajustes_estoque
        WHERE COALESCE(data_movimentacao, criado_em::date) >= $1::date
          AND COALESCE(data_movimentacao, criado_em::date) < $2::date
        GROUP BY 1 ORDER BY total DESC
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(c_etapa::text), ''), 'Sem etapa') AS etapa,
               COUNT(*)::int AS total,
               COALESCE(SUM(n_valor_nfe), 0)::float AS valor_total
        FROM logistica.recebimentos_nfe_omie
        WHERE COALESCE(d_rec, d_emissao_nfe, CURRENT_DATE) >= $1::date
          AND COALESCE(d_rec, d_emissao_nfe, CURRENT_DATE) < $2::date
          AND COALESCE(c_cancelada, 'N') <> 'S'
        GROUP BY 1 ORDER BY total DESC LIMIT 10
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(rastreio_status), ''), 'Pendente') AS status, COUNT(*)::int AS total
        FROM sac.envios_solicitacoes
        WHERE COALESCE(created_at, NOW())::date >= $1::date
          AND COALESCE(created_at, NOW())::date < $2::date
          AND COALESCE(rastreio_status, '') NOT IN ('Excluído', 'Excluido')
        GROUP BY 1 ORDER BY total DESC
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(metodo_envio), ''), 'Não informado') AS metodo, COUNT(*)::int AS total
        FROM sac.envios_solicitacoes
        WHERE COALESCE(created_at, NOW())::date >= $1::date
          AND COALESCE(created_at, NOW())::date < $2::date
          AND COALESCE(rastreio_status, '') NOT IN ('Excluído', 'Excluido')
        GROUP BY 1 ORDER BY total DESC LIMIT 10
      `, rangeParams),
      safeQuery(`
        SELECT
          COUNT(DISTINCT codigo)::int AS skus_abaixo_minimo,
          COALESCE(SUM(GREATEST(COALESCE(estoque_minimo, 0) - COALESCE(fisico, saldo, 0), 0)), 0)::float AS deficit_total
        FROM logistica.estoque_atual
        WHERE COALESCE(estoque_minimo, 0) > 0
          AND COALESCE(fisico, saldo, 0) < COALESCE(estoque_minimo, 0)
      `),
      safeQuery(`
        SELECT
          (SELECT COUNT(*)::int FROM etiqueta."ETQ_recebimento"
            WHERE COALESCE(status, '') NOT IN ('impressa', 'concluido', 'concluído')
              AND COALESCE(oculto, false) = false) AS etiquetas_pendentes,
          (SELECT COUNT(*)::int FROM etiqueta."ETQ_rec_impresso"
            WHERE COALESCE(qtd, 0) > 0
              AND (endereco IS NULL OR TRIM(endereco) = '')) AS sem_endereco
      `),
      safeQuery(`
        WITH evol_base AS (
          SELECT COALESCE(criado_em, NOW())::date AS data_ref
          FROM logistica.itens_solicitados
          WHERE COALESCE(criado_em, NOW())::date >= $1::date
            AND COALESCE(criado_em, NOW())::date < $2::date
          UNION ALL
          SELECT COALESCE(data_movimentacao, CURRENT_DATE) AS data_ref
          FROM logistica.transferencias
          WHERE COALESCE(data_movimentacao, CURRENT_DATE) >= $1::date
            AND COALESCE(data_movimentacao, CURRENT_DATE) < $2::date
          UNION ALL
          SELECT COALESCE(created_at, NOW())::date AS data_ref
          FROM sac.envios_solicitacoes
          WHERE COALESCE(created_at, NOW())::date >= $1::date
            AND COALESCE(created_at, NOW())::date < $2::date
        )
        ${evolucaoSql}
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(codigo_produto), ''), '(sem código)') AS produto,
               COUNT(*)::int AS total,
               COALESCE(SUM(quantidade_solicitada), 0)::float AS qtd_solicitada
        FROM logistica.itens_solicitados
        WHERE COALESCE(criado_em, NOW())::date >= $1::date
          AND COALESCE(criado_em, NOW())::date < $2::date
        GROUP BY 1 ORDER BY total DESC, qtd_solicitada DESC LIMIT 15
      `, rangeParams),
      safeQuery(`
        WITH sep_fim AS (
          SELECT i.n_solic,
                 MAX(m.movimentado_em) AS separado_em
            FROM logistica.itens_solicitados i
            JOIN logistica.movimentacoes_kanban_itens m
              ON m.solic_id = i.id
           WHERE m.status_destino IN ('Concluído', 'Concluido')
             AND NULLIF(TRIM(i.n_solic), '') IS NOT NULL
           GROUP BY i.n_solic
        ),
        base AS (
          SELECT e.id,
                 e.numero_sep,
                 e.usuario,
                 e.created_at AS criado_em,
                 sf.separado_em,
                 COALESCE(e.rastreio_quando, e.finalizado_em) AS enviado_em,
                 COALESCE(NULLIF(TRIM(e.rastreio_status), ''), 'Pendente') AS status
            FROM sac.envios_solicitacoes e
            LEFT JOIN sep_fim sf ON sf.n_solic = e.numero_sep
           WHERE COALESCE(e.created_at, NOW())::date >= $1::date
             AND COALESCE(e.created_at, NOW())::date < $2::date
             AND COALESCE(e.rastreio_status, '') NOT IN ('Excluído', 'Excluido')
        ),
        calc AS (
          SELECT *,
                 CASE WHEN separado_em IS NOT NULL AND separado_em >= criado_em
                      THEN EXTRACT(EPOCH FROM (separado_em - criado_em)) / 3600.0 END AS h_criado_sep,
                 CASE WHEN enviado_em IS NOT NULL AND separado_em IS NOT NULL AND enviado_em >= separado_em
                      THEN EXTRACT(EPOCH FROM (enviado_em - separado_em)) / 3600.0 END AS h_sep_envio,
                 CASE WHEN enviado_em IS NOT NULL AND enviado_em >= criado_em
                      THEN EXTRACT(EPOCH FROM (enviado_em - criado_em)) / 3600.0 END AS h_ciclo,
                 CASE WHEN enviado_em IS NULL AND status NOT IN ('Enviado', 'Entregue', 'Finalizado')
                      THEN EXTRACT(EPOCH FROM (NOW() - criado_em)) / 3600.0 END AS h_aberto
            FROM base
        )
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE enviado_em IS NOT NULL)::int AS enviados,
          COUNT(*) FILTER (WHERE h_criado_sep IS NOT NULL)::int AS com_sep,
          COUNT(*) FILTER (WHERE h_sep_envio IS NOT NULL)::int AS com_sep_envio,
          COUNT(*) FILTER (WHERE h_ciclo IS NOT NULL)::int AS com_ciclo,
          COUNT(*) FILTER (WHERE h_aberto IS NOT NULL)::int AS pendentes,
          ROUND(AVG(h_criado_sep)::numeric, 1) AS media_h_criado_sep,
          ROUND(AVG(h_sep_envio)::numeric, 1) AS media_h_sep_envio,
          ROUND(AVG(h_ciclo)::numeric, 1) AS media_h_ciclo,
          ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY h_ciclo)
                 FILTER (WHERE h_ciclo IS NOT NULL))::numeric, 1) AS mediana_h_ciclo,
          ROUND(AVG(h_aberto)::numeric, 1) AS media_h_pendente
        FROM calc
      `, rangeParams),
      safeQuery(`
        WITH base AS (
          SELECT e.id,
                 COALESCE(e.rastreio_quando, e.finalizado_em) AS enviado_em,
                 e.created_at AS criado_em
            FROM sac.envios_solicitacoes e
           WHERE COALESCE(e.created_at, NOW())::date >= $1::date
             AND COALESCE(e.created_at, NOW())::date < $2::date
             AND COALESCE(e.rastreio_status, '') NOT IN ('Excluído', 'Excluido')
             AND COALESCE(e.rastreio_quando, e.finalizado_em) IS NOT NULL
             AND COALESCE(e.rastreio_quando, e.finalizado_em) >= e.created_at
        ),
        buckets AS (
          SELECT CASE
                   WHEN EXTRACT(EPOCH FROM (enviado_em - criado_em)) / 3600.0 < 24 THEN 'até 24h'
                   WHEN EXTRACT(EPOCH FROM (enviado_em - criado_em)) / 3600.0 < 48 THEN '1–2 dias'
                   WHEN EXTRACT(EPOCH FROM (enviado_em - criado_em)) / 3600.0 < 120 THEN '2–5 dias'
                   WHEN EXTRACT(EPOCH FROM (enviado_em - criado_em)) / 3600.0 < 240 THEN '5–10 dias'
                   ELSE 'mais de 10 dias'
                 END AS faixa,
                 CASE
                   WHEN EXTRACT(EPOCH FROM (enviado_em - criado_em)) / 3600.0 < 24 THEN 1
                   WHEN EXTRACT(EPOCH FROM (enviado_em - criado_em)) / 3600.0 < 48 THEN 2
                   WHEN EXTRACT(EPOCH FROM (enviado_em - criado_em)) / 3600.0 < 120 THEN 3
                   WHEN EXTRACT(EPOCH FROM (enviado_em - criado_em)) / 3600.0 < 240 THEN 4
                   ELSE 5
                 END AS ord
            FROM base
        )
        SELECT faixa, COUNT(*)::int AS total
          FROM buckets
         GROUP BY faixa, ord
         ORDER BY ord
      `, rangeParams),
      safeQuery(`
        WITH sep_fim AS (
          SELECT i.n_solic, MAX(m.movimentado_em) AS separado_em
            FROM logistica.itens_solicitados i
            JOIN logistica.movimentacoes_kanban_itens m ON m.solic_id = i.id
           WHERE m.status_destino IN ('Concluído', 'Concluido')
             AND NULLIF(TRIM(i.n_solic), '') IS NOT NULL
           GROUP BY i.n_solic
        )
        SELECT e.id,
               e.numero_sep,
               e.usuario,
               e.created_at AS criado_em,
               sf.separado_em,
               COALESCE(e.rastreio_quando, e.finalizado_em) AS enviado_em,
               COALESCE(NULLIF(TRIM(e.rastreio_status), ''), 'Pendente') AS status,
               CASE WHEN sf.separado_em IS NOT NULL AND sf.separado_em >= e.created_at
                    THEN ROUND((EXTRACT(EPOCH FROM (sf.separado_em - e.created_at)) / 3600.0)::numeric, 1) END AS h_criado_sep,
               CASE WHEN COALESCE(e.rastreio_quando, e.finalizado_em) IS NOT NULL
                         AND sf.separado_em IS NOT NULL
                         AND COALESCE(e.rastreio_quando, e.finalizado_em) >= sf.separado_em
                    THEN ROUND((EXTRACT(EPOCH FROM (COALESCE(e.rastreio_quando, e.finalizado_em) - sf.separado_em)) / 3600.0)::numeric, 1) END AS h_sep_envio,
               CASE WHEN COALESCE(e.rastreio_quando, e.finalizado_em) IS NOT NULL
                         AND COALESCE(e.rastreio_quando, e.finalizado_em) >= e.created_at
                    THEN ROUND((EXTRACT(EPOCH FROM (COALESCE(e.rastreio_quando, e.finalizado_em) - e.created_at)) / 3600.0)::numeric, 1)
                    WHEN COALESCE(e.rastreio_quando, e.finalizado_em) IS NULL
                         AND COALESCE(NULLIF(TRIM(e.rastreio_status), ''), 'Pendente') NOT IN ('Enviado', 'Entregue', 'Finalizado')
                    THEN ROUND((EXTRACT(EPOCH FROM (NOW() - e.created_at)) / 3600.0)::numeric, 1)
               END AS h_ciclo_ou_aberto
          FROM sac.envios_solicitacoes e
          LEFT JOIN sep_fim sf ON sf.n_solic = e.numero_sep
         WHERE COALESCE(e.created_at, NOW())::date >= $1::date
           AND COALESCE(e.created_at, NOW())::date < $2::date
           AND COALESCE(e.rastreio_status, '') NOT IN ('Excluído', 'Excluido')
         ORDER BY e.created_at DESC
         LIMIT 25
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(enviado_por), ''), 'Não identificado') AS executor,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (
                 WHERE COALESCE(enviado_em, rastreio_quando, finalizado_em) <= sla_limite_em
               )::int AS dentro_sla
          FROM sac.envios_solicitacoes
         WHERE COALESCE(enviado_em, rastreio_quando, finalizado_em)::date >= $1::date
           AND COALESCE(enviado_em, rastreio_quando, finalizado_em)::date < $2::date
           AND COALESCE(rastreio_status, '') NOT IN ('Excluído', 'Excluido')
         GROUP BY 1
         ORDER BY total DESC, executor
      `, rangeParams),
    ]);

    const kpiSep = rKpiSep.rows[0] || {};
    const kpiEst = rEstoqueMin.rows[0] || {};
    const kpiEtq = rEtq.rows[0] || {};
    const trfRows = rTrfStatus.rows || [];
    const trfPend = trfRows.find(r => r.status === 'Aguardando aprovação')?.total || 0;
    const trfOk = trfRows.find(r => r.status === 'Transferido')?.total || 0;
    const ajusteRows = rAjusteStatus.rows || [];
    const ajustePend = ajusteRows.find(r => r.status === 'Aguardando aprovação')?.total || 0;
    const envioRows = rEnvioStatus.rows || [];
    const envioPend = envioRows.filter(r => !['Enviado', 'Entregue', 'Finalizado'].includes(r.status))
      .reduce((s, r) => s + (r.total || 0), 0);
    const recebTotal = (rRecebStatus.rows || []).reduce((s, r) => s + (r.total || 0), 0);
    const recebValor = (rRecebStatus.rows || []).reduce((s, r) => s + (r.valor_total || 0), 0);
    const tempoRow = rTempoEnvio.rows[0] || {};

    const kpis = {
      separacao_total: kpiSep.total_itens || 0,
      separacao_abertos: kpiSep.abertos || 0,
      separacao_concluidos: kpiSep.concluidos || 0,
      separacao_urgentes: kpiSep.urgentes || 0,
      transferencias_pendentes: trfPend,
      transferencias_executadas: trfOk,
      ajustes_pendentes: ajustePend,
      recebimentos_total: recebTotal,
      recebimentos_valor: Math.round(recebValor * 100) / 100,
      envios_pendentes: envioPend,
      envios_total: envioRows.reduce((s, r) => s + (r.total || 0), 0),
      estoque_abaixo_minimo: kpiEst.skus_abaixo_minimo || 0,
      estoque_deficit: Math.round((kpiEst.deficit_total || 0) * 100) / 100,
      etiquetas_pendentes: kpiEtq.etiquetas_pendentes || 0,
      materiais_sem_endereco: kpiEtq.sem_endereco || 0,
      tempo_envio_media_ciclo_h: tempoRow.media_h_ciclo != null ? Number(tempoRow.media_h_ciclo) : null,
      tempo_envio_mediana_ciclo_h: tempoRow.mediana_h_ciclo != null ? Number(tempoRow.mediana_h_ciclo) : null,
      tempo_envio_media_criado_sep_h: tempoRow.media_h_criado_sep != null ? Number(tempoRow.media_h_criado_sep) : null,
      tempo_envio_media_sep_envio_h: tempoRow.media_h_sep_envio != null ? Number(tempoRow.media_h_sep_envio) : null,
      tempo_envio_media_pendente_h: tempoRow.media_h_pendente != null ? Number(tempoRow.media_h_pendente) : null,
    };

    const tempo_envio = {
      total: tempoRow.total || 0,
      enviados: tempoRow.enviados || 0,
      com_sep: tempoRow.com_sep || 0,
      com_sep_envio: tempoRow.com_sep_envio || 0,
      com_ciclo: tempoRow.com_ciclo || 0,
      pendentes: tempoRow.pendentes || 0,
      media_h_criado_sep: tempoRow.media_h_criado_sep != null ? Number(tempoRow.media_h_criado_sep) : null,
      media_h_sep_envio: tempoRow.media_h_sep_envio != null ? Number(tempoRow.media_h_sep_envio) : null,
      media_h_ciclo: tempoRow.media_h_ciclo != null ? Number(tempoRow.media_h_ciclo) : null,
      mediana_h_ciclo: tempoRow.mediana_h_ciclo != null ? Number(tempoRow.mediana_h_ciclo) : null,
      media_h_pendente: tempoRow.media_h_pendente != null ? Number(tempoRow.media_h_pendente) : null,
      faixas_ciclo: rTempoFaixas.rows || [],
      detalhe: (rTempoDetalhe.rows || []).map((r) => ({
        id: r.id,
        numero_sep: r.numero_sep || null,
        usuario: r.usuario || null,
        criado_em: r.criado_em || null,
        separado_em: r.separado_em || null,
        enviado_em: r.enviado_em || null,
        status: r.status || 'Pendente',
        h_criado_sep: r.h_criado_sep != null ? Number(r.h_criado_sep) : null,
        h_sep_envio: r.h_sep_envio != null ? Number(r.h_sep_envio) : null,
        h_ciclo_ou_aberto: r.h_ciclo_ou_aberto != null ? Number(r.h_ciclo_ou_aberto) : null,
      })),
    };

    const evolRows = rEvolSep.rows || [];
    const evolucao_semanal = evolucaoTipo === 'semana'
      ? evolRows.map(r => ({ semana: `Sem ${r.semana}`, total: r.total }))
      : [];
    const evolucao_mensal = evolucaoTipo === 'mes'
      ? evolRows.map(r => ({ mes: r.mes_key, label: labelMes(r.mes_key, nomesMes), total: r.total }))
      : [];

    const { rows: rTextos } = await pool.query(
      `SELECT plano_acao, conclusao_resumo, conclusao_pontos_criticos, conclusao_oportunidades,
              editado_por, editado_em
         FROM logistica.relatorio_gerencial WHERE mes = $1`,
      [mesRaw]
    ).catch(() => ({ rows: [] }));

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
      periodo: periodoLabel,
      modo,
      evolucao_tipo: evolucaoTipo,
      kpis,
      por_status_separacao: rSepStatus.rows || [],
      por_status_transferencia: trfRows,
      rotas_transferencia: rTrfRotas.rows || [],
      por_status_ajuste: ajusteRows,
      por_tipo_ajuste: rAjusteTipo.rows || [],
      por_etapa_recebimento: rRecebStatus.rows || [],
      por_status_envio: envioRows,
      por_metodo_envio: rEnvioMetodo.rows || [],
      envios_por_executor: rEnvioExecutor.rows || [],
      top_produtos_separacao: rTopSep.rows || [],
      tempo_envio,
      evolucao_semanal,
      evolucao_mensal,
      textos,
    });
  } catch (err) {
    console.error('[LOGISTICA] erro relatorio-gerencial:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Erro ao gerar relatório logística.' });
  }
});

// PUT /logistica/relatorio-gerencial/textos
router.put('/logistica/relatorio-gerencial/textos', async (req, res) => {
  try {
    await ensureLogisticaRelatorioSchema();
    const mes = String(req.body?.mes || '').trim();
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ ok: false, error: 'Mês inválido (use YYYY-MM).' });
    }
    const planoRaw = req.body?.plano_acao;
    const plano_acao = Array.isArray(planoRaw) ? planoRaw : [];
    const editado_por = String(req.user?.username || req.session?.user?.username || req.body?.editado_por || '').trim() || null;

    const { rows } = await pool.query(
      `INSERT INTO logistica.relatorio_gerencial (
         mes, plano_acao, conclusao_resumo, conclusao_pontos_criticos, conclusao_oportunidades, editado_por, editado_em
       ) VALUES ($1, $2::jsonb, $3, $4, $5, $6, NOW())
       ON CONFLICT (mes) DO UPDATE SET
         plano_acao = EXCLUDED.plano_acao,
         conclusao_resumo = EXCLUDED.conclusao_resumo,
         conclusao_pontos_criticos = EXCLUDED.conclusao_pontos_criticos,
         conclusao_oportunidades = EXCLUDED.conclusao_oportunidades,
         editado_por = EXCLUDED.editado_por,
         editado_em = NOW()
       RETURNING plano_acao, conclusao_resumo, conclusao_pontos_criticos, conclusao_oportunidades, editado_por, editado_em`,
      [
        mes,
        JSON.stringify(plano_acao),
        String(req.body?.conclusao_resumo || '').trim(),
        String(req.body?.conclusao_pontos_criticos || '').trim(),
        String(req.body?.conclusao_oportunidades || '').trim(),
        editado_por,
      ]
    );

    const row = rows[0] || {};
    return res.json({
      ok: true,
      textos: {
        plano_acao: Array.isArray(row.plano_acao) ? row.plano_acao : [],
        conclusao_resumo: row.conclusao_resumo || '',
        conclusao_pontos_criticos: row.conclusao_pontos_criticos || '',
        conclusao_oportunidades: row.conclusao_oportunidades || '',
        editado_por: row.editado_por || null,
        editado_em: row.editado_em || null,
        salvo: true,
      },
    });
  } catch (err) {
    console.error('[LOGISTICA] erro salvar textos relatorio-gerencial:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Erro ao salvar textos.' });
  }
});

module.exports = router;
