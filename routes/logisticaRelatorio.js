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
    ] = await Promise.all([
      safeQuery(`
        SELECT
          COUNT(*)::int AS total_itens,
          COUNT(*) FILTER (WHERE COALESCE(TRIM(status), '') NOT IN ('Concluído', 'Concluido'))::int AS abertos,
          COUNT(*) FILTER (WHERE COALESCE(TRIM(status), '') IN ('Concluído', 'Concluido'))::int AS concluidos,
          COUNT(*) FILTER (WHERE COALESCE(urgente, false))::int AS urgentes
        FROM solicitacao_produto.itens_solicitados
        WHERE COALESCE(criado_em, NOW())::date >= $1::date
          AND COALESCE(criado_em, NOW())::date < $2::date
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(status), ''), 'Sem status') AS status, COUNT(*)::int AS total
        FROM solicitacao_produto.itens_solicitados
        WHERE COALESCE(criado_em, NOW())::date >= $1::date
          AND COALESCE(criado_em, NOW())::date < $2::date
        GROUP BY 1 ORDER BY total DESC, status LIMIT 12
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(status), ''), 'Sem status') AS status, COUNT(*)::int AS total,
               COALESCE(SUM(qtd), 0)::float AS qtd_total
        FROM mensagens.transferencias
        WHERE COALESCE(data_movimentacao, CURRENT_DATE) >= $1::date
          AND COALESCE(data_movimentacao, CURRENT_DATE) < $2::date
        GROUP BY 1 ORDER BY total DESC
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(origem), ''), '?') AS origem,
               COALESCE(NULLIF(TRIM(destino), ''), '?') AS destino,
               COUNT(*)::int AS total,
               COALESCE(SUM(qtd), 0)::float AS qtd_total
        FROM mensagens.transferencias
        WHERE COALESCE(data_movimentacao, CURRENT_DATE) >= $1::date
          AND COALESCE(data_movimentacao, CURRENT_DATE) < $2::date
          AND TRIM(COALESCE(status, '')) = 'Transferido'
        GROUP BY 1, 2 ORDER BY total DESC LIMIT 15
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(status), ''), 'Sem status') AS status, COUNT(*)::int AS total,
               COALESCE(SUM(qtd), 0)::float AS qtd_total
        FROM mensagens.ajustes_estoque
        WHERE COALESCE(data_movimentacao, criado_em::date) >= $1::date
          AND COALESCE(data_movimentacao, criado_em::date) < $2::date
        GROUP BY 1 ORDER BY total DESC
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(tipo_operacao), ''), '?') AS tipo, COUNT(*)::int AS total,
               COALESCE(SUM(qtd), 0)::float AS qtd_total
        FROM mensagens.ajustes_estoque
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
        FROM envios.solicitacoes
        WHERE COALESCE(created_at, NOW())::date >= $1::date
          AND COALESCE(created_at, NOW())::date < $2::date
          AND COALESCE(rastreio_status, '') NOT IN ('Excluído', 'Excluido')
        GROUP BY 1 ORDER BY total DESC
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(metodo_envio), ''), 'Não informado') AS metodo, COUNT(*)::int AS total
        FROM envios.solicitacoes
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
          FROM solicitacao_produto.itens_solicitados
          WHERE COALESCE(criado_em, NOW())::date >= $1::date
            AND COALESCE(criado_em, NOW())::date < $2::date
          UNION ALL
          SELECT COALESCE(data_movimentacao, CURRENT_DATE) AS data_ref
          FROM mensagens.transferencias
          WHERE COALESCE(data_movimentacao, CURRENT_DATE) >= $1::date
            AND COALESCE(data_movimentacao, CURRENT_DATE) < $2::date
          UNION ALL
          SELECT COALESCE(created_at, NOW())::date AS data_ref
          FROM envios.solicitacoes
          WHERE COALESCE(created_at, NOW())::date >= $1::date
            AND COALESCE(created_at, NOW())::date < $2::date
        )
        ${evolucaoSql}
      `, rangeParams),
      safeQuery(`
        SELECT COALESCE(NULLIF(TRIM(codigo_produto), ''), '(sem código)') AS produto,
               COUNT(*)::int AS total,
               COALESCE(SUM(quantidade_solicitada), 0)::float AS qtd_solicitada
        FROM solicitacao_produto.itens_solicitados
        WHERE COALESCE(criado_em, NOW())::date >= $1::date
          AND COALESCE(criado_em, NOW())::date < $2::date
        GROUP BY 1 ORDER BY total DESC, qtd_solicitada DESC LIMIT 15
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
      top_produtos_separacao: rTopSep.rows || [],
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
