/**
 * Relatório Gerencial Produção — tempos por posto / RI / ciclo da OP.
 * Fonte: producao."Registro_tempo" (tipos: posto, ri, trabalho).
 */
const express = require('express');
const { pool } = require('../src/db');
const {
  garantirSchemaTempoProducao,
  calcularTempoUtilMs,
  buscarTurnosNoPeriodo,
  formatarDuracao,
  lookupMo,
  buscarMapaMoPeriodo,
  buscarPeriodosMoPeriodo,
  calcularTempoUtilComMo,
  periodosMoDoPosto,
  dateKeyInTz,
} = require('../utils/tempoProducao');

const router = express.Router();

let _ensureSchemaPromise = null;

async function ensureProducaoRelatorioSchema() {
  if (_ensureSchemaPromise) return _ensureSchemaPromise;
  _ensureSchemaPromise = pool.query(`
    CREATE SCHEMA IF NOT EXISTS producao;
    CREATE TABLE IF NOT EXISTS producao.relatorio_gerencial (
      id BIGSERIAL PRIMARY KEY,
      mes CHAR(7) NOT NULL UNIQUE,
      plano_acao JSONB NOT NULL DEFAULT '[]'::jsonb,
      conclusao_resumo TEXT,
      conclusao_pontos_criticos TEXT,
      conclusao_oportunidades TEXT,
      editado_por TEXT,
      editado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS producao_relatorio_gerencial_mes_idx
      ON producao.relatorio_gerencial (mes);
  `).then(() => pool.query(
    `ALTER TABLE producao."Kanban_programacao"
        ADD COLUMN IF NOT EXISTS estoque_maq_entrada_em TIMESTAMPTZ`
  ).catch((err) => {
    console.warn('[PRODUCAO] coluna estoque_maq_entrada_em:', err.message);
  })).then(() => undefined).catch((err) => {
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

function msToHoras(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.round((ms / 3600000) * 10) / 10;
}

function media(arr) {
  const vals = (arr || []).filter((v) => Number.isFinite(v) && v >= 0);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function mediana(arr) {
  const vals = (arr || []).filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

function faixaCiclo(h) {
  if (h == null || !Number.isFinite(h)) return null;
  if (h < 2) return '< 2h';
  if (h < 8) return '2–8h';
  if (h < 24) return '8–24h';
  if (h < 48) return '1–2 dias';
  return '> 2 dias';
}

function qtdMaquinasOp(q) {
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.round(n));
}

function listarDiasYmd(inicio, fimExclusive) {
  const out = [];
  let cur = String(inicio || '').slice(0, 10);
  const end = String(fimExclusive || '').slice(0, 10);
  while (cur && end && cur < end) {
    out.push(cur);
    const [y, m, d] = cur.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    cur = dt.toISOString().slice(0, 10);
  }
  return out;
}

// GET /producao/relatorio-gerencial
router.get('/producao/relatorio-gerencial', async (req, res) => {
  try {
    await ensureProducaoRelatorioSchema();
    await garantirSchemaTempoProducao();

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
    const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    const { rows: regs } = await pool.query(
      `SELECT id, kanban_programacao_id, op_producao_id, numero_op,
              posto_origem, tipo_registro, operacao,
              inicio::text AS inicio, fim::text AS fim,
              usuario_inicio, usuario_fim
         FROM producao."Registro_tempo"
        WHERE inicio >= $1::date
          AND inicio < $2::date
          AND tipo_registro = ANY(ARRAY['posto','ri','trabalho']::text[])
        ORDER BY inicio ASC`,
      [mesInicio, mesFimExclusive]
    );

    const agora = new Date();
    const periodoFim = new Date(`${mesFimExclusive}T00:00:00-03:00`);
    const fimRefTurnos = periodoFim > agora ? agora : periodoFim;
    const turnos = regs.length
      ? await buscarTurnosNoPeriodo(mesInicio, fimRefTurnos.toISOString())
      : [];
    const moMap = await buscarMapaMoPeriodo(mesInicio, fimRefTurnos.toISOString()).catch(() => new Map());
    const moPeriodos = await buscarPeriodosMoPeriodo(mesInicio, fimRefTurnos.toISOString()).catch(() => new Map());

    const enriquecidos = regs.map((r) => {
      const fimEff = r.fim || agora.toISOString();
      const diaMo = dateKeyInTz(new Date(r.inicio));
      const qtdMo = lookupMo(moMap, diaMo, r.posto_origem);
      const msBrutoUtil = calcularTempoUtilMs(r.inicio, fimEff, turnos);
      const msUtil = calcularTempoUtilComMo(
        r.inicio,
        fimEff,
        turnos,
        periodosMoDoPosto(moPeriodos, r.posto_origem),
        qtdMo
      );
      const msBruto = Math.max(0, new Date(fimEff).getTime() - new Date(r.inicio).getTime());
      return {
        ...r,
        aberto: !r.fim,
        qtd_mo: qtdMo,
        ms_util_bruto: msBrutoUtil,
        ms_util: msUtil,
        ms_bruto: msBruto,
        h_util: msToHoras(msUtil),
        h_bruto: msToHoras(msBruto),
        tempo_formatado: formatarDuracao(msUtil),
      };
    });

    const fechados = enriquecidos.filter((r) => !r.aberto);
    const postos = fechados.filter((r) => r.tipo_registro === 'posto');
    const ris = fechados.filter((r) => r.tipo_registro === 'ri');
    const trabalhos = fechados.filter((r) => r.tipo_registro === 'trabalho');
    const abertosPosto = enriquecidos.filter((r) => r.aberto && r.tipo_registro === 'posto');
    const abertosRi = enriquecidos.filter((r) => r.aberto && r.tipo_registro === 'ri');

    const opsSet = new Set();
    for (const r of enriquecidos) {
      const key = r.numero_op
        ? `op:${String(r.numero_op).toUpperCase()}`
        : (r.op_producao_id ? `id:${r.op_producao_id}` : null);
      if (key) opsSet.add(key);
    }

    // Ciclo total por OP (soma dos tempos de posto fechados)
    const cicloPorOp = new Map();
    for (const r of postos) {
      const key = r.numero_op
        ? String(r.numero_op).toUpperCase()
        : (r.op_producao_id ? `ID:${r.op_producao_id}` : null);
      if (!key) continue;
      if (!cicloPorOp.has(key)) {
        cicloPorOp.set(key, {
          numero_op: r.numero_op || key,
          op_producao_id: r.op_producao_id,
          ms_posto: 0,
          ms_ri: 0,
          ms_trabalho: 0,
          postos: new Set(),
          ciclos_posto: 0,
        });
      }
      const c = cicloPorOp.get(key);
      c.ms_posto += r.ms_util || 0;
      c.ciclos_posto += 1;
      if (r.posto_origem) c.postos.add(r.posto_origem);
    }
    for (const r of ris) {
      const key = r.numero_op
        ? String(r.numero_op).toUpperCase()
        : (r.op_producao_id ? `ID:${r.op_producao_id}` : null);
      if (!key || !cicloPorOp.has(key)) continue;
      cicloPorOp.get(key).ms_ri += r.ms_util || 0;
    }
    for (const r of trabalhos) {
      const key = r.numero_op
        ? String(r.numero_op).toUpperCase()
        : (r.op_producao_id ? `ID:${r.op_producao_id}` : null);
      if (!key || !cicloPorOp.has(key)) continue;
      cicloPorOp.get(key).ms_trabalho += r.ms_util || 0;
    }

    const ciclosOp = [...cicloPorOp.values()].map((c) => ({
      numero_op: c.numero_op,
      op_producao_id: c.op_producao_id,
      postos: [...c.postos],
      ciclos_posto: c.ciclos_posto,
      h_posto: msToHoras(c.ms_posto),
      h_ri: msToHoras(c.ms_ri),
      h_trabalho: msToHoras(c.ms_trabalho),
      h_ciclo: msToHoras(c.ms_posto),
      tempo_posto_fmt: formatarDuracao(c.ms_posto),
      tempo_ri_fmt: formatarDuracao(c.ms_ri),
      tempo_trabalho_fmt: formatarDuracao(c.ms_trabalho),
      tempo_ciclo_fmt: formatarDuracao(c.ms_posto),
    })).sort((a, b) => (b.h_ciclo || 0) - (a.h_ciclo || 0));

    // Agregado por posto
    const porPostoMap = new Map();
    const ensurePosto = (nome) => {
      const k = String(nome || '—').trim() || '—';
      if (!porPostoMap.has(k)) {
        porPostoMap.set(k, {
          posto: k,
          posto_ms: [],
          ri_ms: [],
          trabalho_ms: [],
          ciclos: 0,
          ops: new Set(),
        });
      }
      return porPostoMap.get(k);
    };
    for (const r of postos) {
      const p = ensurePosto(r.posto_origem);
      p.posto_ms.push(r.ms_util || 0);
      p.ciclos += 1;
      if (r.numero_op) p.ops.add(String(r.numero_op).toUpperCase());
    }
    for (const r of ris) {
      const p = ensurePosto(r.posto_origem);
      p.ri_ms.push(r.ms_util || 0);
    }
    for (const r of trabalhos) {
      const p = ensurePosto(r.posto_origem);
      p.trabalho_ms.push(r.ms_util || 0);
    }

    const por_posto = [...porPostoMap.values()]
      .map((p) => {
        const mediaPosto = media(p.posto_ms);
        const mediaRi = media(p.ri_ms);
        const mediaTrab = media(p.trabalho_ms);
        return {
          posto: p.posto,
          ciclos: p.ciclos,
          ops: p.ops.size,
          media_h_posto: msToHoras(mediaPosto),
          media_h_ri: msToHoras(mediaRi),
          media_h_trabalho: msToHoras(mediaTrab),
          mediana_h_posto: msToHoras(mediana(p.posto_ms)),
          mediana_h_ri: msToHoras(mediana(p.ri_ms)),
          tempo_medio_posto_fmt: formatarDuracao(mediaPosto || 0),
          tempo_medio_ri_fmt: formatarDuracao(mediaRi || 0),
          tempo_medio_trabalho_fmt: formatarDuracao(mediaTrab || 0),
        };
      })
      .sort((a, b) => (b.media_h_posto || 0) - (a.media_h_posto || 0));

    const faixasMap = new Map();
    for (const f of ['< 2h', '2–8h', '8–24h', '1–2 dias', '> 2 dias']) faixasMap.set(f, 0);
    for (const r of postos) {
      const f = faixaCiclo(r.h_util);
      if (f) faixasMap.set(f, (faixasMap.get(f) || 0) + 1);
    }
    const faixas_posto = [...faixasMap.entries()].map(([faixa, total]) => ({ faixa, total }));

    const mediaPostoMs = media(postos.map((r) => r.ms_util));
    const mediaRiMs = media(ris.map((r) => r.ms_util));
    const mediaTrabMs = media(trabalhos.map((r) => r.ms_util));
    const mediaCicloOpMs = media([...cicloPorOp.values()].map((c) => c.ms_posto));

    // Produção: OP liberada na Inspeção final (RI registrada → estoque de máquinas).
    let producao_diaria = listarDiasYmd(mesInicio, mesFimExclusive).map((dia) => ({
      data: dia,
      total: 0,
      modelos: [],
    }));
    let producao_liberacoes = [];
    try {
      const { rows: prodRows } = await pool.query(
        `SELECT kp.estoque_maq_entrada_em::text AS liberado_em,
                kp.numero_op,
                kp.op_producao_id,
                COALESCE(NULLIF(TRIM(kp.codigo), ''), 'Sem modelo') AS modelo,
                kp.quantidade
           FROM producao."Kanban_programacao" kp
          WHERE kp.estoque_maq_entrada_em IS NOT NULL
            AND kp.estoque_maq_entrada_em >= $1::date
            AND kp.estoque_maq_entrada_em < $2::date
          ORDER BY kp.estoque_maq_entrada_em ASC, kp.id ASC`,
        [mesInicio, mesFimExclusive]
      );
      const porDia = new Map();
      const opsVistas = new Set();
      for (const row of prodRows) {
        const opKey = String(row.numero_op || row.op_producao_id || '').trim().toUpperCase();
        if (!opKey || opsVistas.has(opKey)) continue;
        opsVistas.add(opKey);
        const dt = new Date(row.liberado_em);
        if (Number.isNaN(dt.getTime())) continue;
        const dia = dateKeyInTz(dt);
        if (!dia) continue;
        const modelo = String(row.modelo || '').trim() || 'Sem modelo';
        const qtd = qtdMaquinasOp(row.quantidade);
        if (!porDia.has(dia)) porDia.set(dia, new Map());
        porDia.get(dia).set(modelo, (porDia.get(dia).get(modelo) || 0) + qtd);
        producao_liberacoes.push({
          data: dia,
          liberado_em: row.liberado_em,
          numero_op: row.numero_op || opKey,
          modelo,
          qtd,
        });
      }
      producao_diaria = listarDiasYmd(mesInicio, mesFimExclusive).map((dia) => {
        const modelosMap = porDia.get(dia) || new Map();
        const modelos = [...modelosMap.entries()]
          .map(([modelo, qtd]) => ({ modelo, qtd }))
          .sort((a, b) => b.qtd - a.qtd || a.modelo.localeCompare(b.modelo));
        const total = modelos.reduce((s, r) => s + (r.qtd || 0), 0);
        return { data: dia, total, modelos };
      });
    } catch (errProd) {
      console.warn('[PRODUCAO] producao diaria:', errProd.message);
    }
    const maquinasProduzidas = producao_diaria.reduce((s, d) => s + (d.total || 0), 0);

    // Evolução: mesmas liberações da Inspeção final, agregadas por semana/mês (fuso de Brasília).
    let evolucao_semanal = [];
    let evolucao_mensal = [];
    if (evolucaoTipo === 'semana') {
      const map = new Map();
      for (let s = 1; s <= 5; s += 1) map.set(s, 0);
      for (const r of producao_liberacoes) {
        const diaNum = parseInt(String(r.data || '').slice(8, 10), 10);
        if (!diaNum) continue;
        const semana = Math.min(5, Math.max(1, Math.ceil(diaNum / 7)));
        map.set(semana, (map.get(semana) || 0) + (r.qtd || 1));
      }
      evolucao_semanal = [...map.entries()].map(([semana, total]) => ({
        semana: `Semana ${semana}`,
        total,
      }));
    } else {
      const map = new Map();
      for (const m of periodoCfg.meses) map.set(m, 0);
      for (const r of producao_liberacoes) {
        const key = String(r.data || '').slice(0, 7);
        if (map.has(key)) map.set(key, (map.get(key) || 0) + (r.qtd || 1));
      }
      evolucao_mensal = [...map.entries()].map(([mesKey, total]) => {
        const [y, m] = mesKey.split('-');
        const mi = parseInt(m, 10);
        return {
          mes: mesKey,
          label: mi >= 1 && mi <= 12 ? `${nomesMes[mi - 1]}/${y}` : mesKey,
          total,
        };
      });
    }

    const kpis = {
      ops_com_tempo: opsSet.size,
      ciclos_posto_fechados: postos.length,
      ciclos_ri_fechados: ris.length,
      postos_distintos: por_posto.length,
      em_andamento_posto: abertosPosto.length,
      aguardando_ri: abertosRi.length,
      maquinas_produzidas: maquinasProduzidas,
      media_h_posto: msToHoras(mediaPostoMs),
      media_h_ri: msToHoras(mediaRiMs),
      media_h_trabalho: msToHoras(mediaTrabMs),
      media_h_ciclo_op: msToHoras(mediaCicloOpMs),
      mediana_h_posto: msToHoras(mediana(postos.map((r) => r.ms_util))),
      mediana_h_ri: msToHoras(mediana(ris.map((r) => r.ms_util))),
      media_posto_fmt: formatarDuracao(mediaPostoMs || 0),
      media_ri_fmt: formatarDuracao(mediaRiMs || 0),
      media_trabalho_fmt: formatarDuracao(mediaTrabMs || 0),
      media_ciclo_op_fmt: formatarDuracao(mediaCicloOpMs || 0),
    };

    // Detalhe recente (últimos 80 ciclos de posto fechados)
    const detalhe_postos = postos
      .slice()
      .sort((a, b) => new Date(b.fim || b.inicio) - new Date(a.fim || a.inicio))
      .slice(0, 80)
      .map((r) => ({
        id: r.id,
        numero_op: r.numero_op,
        posto: r.posto_origem,
        inicio: r.inicio,
        fim: r.fim,
        h_util: r.h_util,
        tempo_fmt: r.tempo_formatado,
        usuario_inicio: r.usuario_inicio,
        usuario_fim: r.usuario_fim,
        operacao: r.operacao,
        qtd_mo: r.qtd_mo || 1,
      }));

    const detalhe_ri = ris
      .slice()
      .sort((a, b) => new Date(b.fim || b.inicio) - new Date(a.fim || a.inicio))
      .slice(0, 80)
      .map((r) => ({
        id: r.id,
        numero_op: r.numero_op,
        posto: r.posto_origem,
        inicio: r.inicio,
        fim: r.fim,
        h_util: r.h_util,
        tempo_fmt: r.tempo_formatado,
        usuario_fim: r.usuario_fim,
        operacao: r.operacao,
      }));

    const { rows: txtRows } = await pool.query(
      `SELECT plano_acao, conclusao_resumo, conclusao_pontos_criticos, conclusao_oportunidades,
              editado_por, editado_em::text AS editado_em
         FROM producao.relatorio_gerencial
        WHERE mes = $1
        LIMIT 1`,
      [mesRaw]
    ).catch(() => ({ rows: [] }));

    const txtRow = txtRows[0];
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
      por_posto,
      faixas_posto,
      ciclos_por_op: ciclosOp.slice(0, 100),
      detalhe_postos,
      detalhe_ri,
      evolucao_semanal,
      evolucao_mensal,
      producao_diaria,
      producao_liberacoes,
      textos,
    });
  } catch (err) {
    console.error('[PRODUCAO] erro relatorio-gerencial:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Erro ao gerar relatório produção.' });
  }
});

// PUT /producao/relatorio-gerencial/textos
router.put('/producao/relatorio-gerencial/textos', async (req, res) => {
  try {
    await ensureProducaoRelatorioSchema();
    const mes = String(req.body?.mes || '').trim();
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ ok: false, error: 'Mês inválido (use YYYY-MM).' });
    }
    const planoRaw = req.body?.plano_acao;
    const plano_acao = Array.isArray(planoRaw) ? planoRaw : [];
    const editado_por = String(req.user?.username || req.session?.user?.username || req.body?.editado_por || '').trim() || null;

    const { rows } = await pool.query(
      `INSERT INTO producao.relatorio_gerencial (
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
    console.error('[PRODUCAO] erro salvar textos relatorio-gerencial:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Erro ao salvar textos.' });
  }
});

module.exports = router;
