// routes/testesProducao.js
// Relatórios de teste de bombas de calor — schema testes.relatorios + testes.leituras
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { dbQuery } = require('../src/db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.user?.username) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  next();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avg(arr) {
  const vals = arr.filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function minMax(arr) {
  const vals = arr.filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return { min: null, max: null };
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

function stdDev(arr) {
  const vals = arr.filter((v) => v != null && Number.isFinite(v));
  if (vals.length < 2) return null;
  const m = avg(vals);
  const variance = vals.reduce((s, v) => s + (v - m) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(variance);
}

/** Leitura em regime: máquina aquecendo de verdade (não partida/parada). */
function isEmRegime(l) {
  const cop = num(l.cop);
  const cons = num(l.kw_consumo);
  const pA = num(l.pressao_alta);
  const pB = num(l.pressao_baixa);
  if (cop == null || cop < 1.5) return false;
  if (cons == null || cons < 0.4) return false;
  if (pA != null && pB != null && Math.abs(pA - pB) < 25) return false;
  return true;
}

let _specsCache = null;

function parseBrNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Intervalos tipo "7,0 _7E 13,8" ou "2,34 ~ 10,26"
  if (/_7E|~|–|—/.test(s)) {
    const parts = s.split(/_7E|~|–|—/).map((p) => p.trim());
    const nums = parts.map(parseBrNumber).filter((n) => n != null);
    if (!nums.length) return null;
    return { min: Math.min(...nums), max: Math.max(...nums), mid: avg(nums) };
  }
  s = s.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function loadMachineSpecs() {
  if (_specsCache) return _specsCache;
  const map = {};
  const files = [
    path.join(__dirname, '..', 'produtos', 'dadosEtiquetasMaquinas - dadosFTI.csv'),
    path.join(__dirname, '..', 'produtos', 'dadosEtiquetasMaquinas - dadosFT.csv'),
  ];
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) continue;
      const headers = lines[0].split(',').map((h) => h.trim());
      for (let i = 1; i < lines.length; i++) {
        // CSV simples com aspas — split respeitando aspas
        const cols = [];
        let cur = '';
        let inQ = false;
        for (const ch of lines[i]) {
          if (ch === '"') { inQ = !inQ; continue; }
          if (ch === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
          cur += ch;
        }
        cols.push(cur);
        const row = {};
        headers.forEach((h, idx) => { row[h] = cols[idx]; });
        const modelo = String(row.modelo || '').trim().toUpperCase();
        if (!modelo) continue;
        map[modelo] = {
          modelo,
          modeloLabel: row['modelo-'] || modelo,
          capacidadekW: parseBrNumber(row.capacidadekW),
          potenciaKw: parseBrNumber(row.potenciakW),
          cop: parseBrNumber(row.cop),
          tensaoNominal: row.tensaoNominal || null,
          correnteMaxima: parseBrNumber(row.correnteMaxima || row.correnteNominal),
          pressaoDescarga: row.pressaoDescarga || null,
          pressaoSuccao: row.pressaoSuccao || null,
          vazaoAguaIdeal: parseBrNumber(row.vazaoAguaIdeal),
          vazaoAguaMin: parseBrNumber(row.vazaoAguaMin),
          vazaoAguaMax: parseBrNumber(row.vazaoAguaMax),
          fluido: row.fluidoRefrigerante || null,
        };
      }
    } catch (err) {
      console.warn('[testes] Falha ao ler specs:', err.message);
    }
  }
  _specsCache = map;
  return map;
}

function findSpec(modelo) {
  const specs = loadMachineSpecs();
  const key = String(modelo || '').trim().toUpperCase();
  if (!key) return null;
  if (specs[key]) return specs[key];
  // match parcial (ex.: FTI165LPTBR vs FTI145LPTBR família)
  const candidates = Object.keys(specs).filter((k) => key.startsWith(k.slice(0, 5)) || k.startsWith(key.slice(0, 5)));
  if (candidates.length === 1) return specs[candidates[0]];
  return null;
}

function calcularStats(leituras) {
  const todas = leituras || [];
  const regime = todas.filter(isEmRegime);
  const base = regime.length >= 3 ? regime : todas.filter((l) => num(l.cop) > 0);

  const pick = (field) => base.map((l) => num(l[field]));
  const copVals = pick('cop');
  const deltaVals = pick('temp_dif');
  const kwAq = pick('kw_aquecimento');
  const kwCons = pick('kw_consumo');
  const kcal = pick('kcal_h');
  const vazao = pick('vazao');
  const pAlta = pick('pressao_alta');
  const pBaixa = pick('pressao_baixa');
  const tensao = pick('tensao');
  const corrente = pick('corrente');
  const tAmb = pick('temp_ambiente');
  const tEnt = pick('temp_entrada');
  const tSai = pick('temp_saida');

  const copAvg = avg(copVals);
  const deltaAvg = avg(deltaVals);
  const kwAqAvg = avg(kwAq);
  const kwConsAvg = avg(kwCons);

  return {
    total_leituras: todas.length,
    leituras_regime: regime.length,
    cop: { media: copAvg, ...minMax(copVals), desvio: stdDev(copVals) },
    delta_t: { media: deltaAvg, ...minMax(deltaVals), desvio: stdDev(deltaVals) },
    kw_aquecimento: { media: kwAqAvg, ...minMax(kwAq) },
    kw_consumo: { media: kwConsAvg, ...minMax(kwCons) },
    kcal_h: { media: avg(kcal), ...minMax(kcal) },
    vazao: { media: avg(vazao), ...minMax(vazao), desvio: stdDev(vazao) },
    pressao_alta: { media: avg(pAlta), ...minMax(pAlta) },
    pressao_baixa: { media: avg(pBaixa), ...minMax(pBaixa) },
    tensao: { media: avg(tensao), ...minMax(tensao) },
    corrente: { media: avg(corrente), ...minMax(corrente) },
    temp_ambiente: { media: avg(tAmb), ...minMax(tAmb) },
    temp_entrada: { media: avg(tEnt), ...minMax(tEnt) },
    temp_saida: { media: avg(tSai), ...minMax(tSai) },
    eficiencia_pct: (kwAqAvg != null && kwConsAvg > 0) ? (kwAqAvg / kwConsAvg) * 100 : null,
  };
}

function gerarDiagnostico(relatorio, stats, leituras, spec) {
  const alertas = [];
  const ok = [];
  const infos = [];
  const isInverter = /FTI|INVERTER/i.test(`${relatorio.modelo || ''} ${relatorio.linha || ''}`);

  const copMedia = stats.cop?.media;
  if (copMedia != null) {
    if (copMedia >= 5) {
      ok.push(`COP médio ${copMedia.toFixed(2)} — excelente para bomba de calor de piscina${isInverter ? ' inverter' : ''}.`);
    } else if (copMedia >= 3.5) {
      ok.push(`COP médio ${copMedia.toFixed(2)} — dentro do esperado para aquecimento de piscina.`);
    } else if (copMedia >= 2.5) {
      alertas.push({ nivel: 'atencao', texto: `COP médio ${copMedia.toFixed(2)} — abaixo do ideal. Verificar carga de gás, fluxo de ar e vazão de água.` });
    } else {
      alertas.push({ nivel: 'critico', texto: `COP médio ${copMedia.toFixed(2)} — muito baixo. Possível falha no circuito frigorífico, sensor ou máquina fora de regime.` });
    }
  }

  if (spec?.cop) {
    const nom = typeof spec.cop === 'object' ? spec.cop.min : spec.cop;
    if (nom != null && copMedia != null && copMedia < nom * 0.7) {
      alertas.push({
        nivel: 'atencao',
        texto: `COP abaixo de ~70% do nominal de catálogo (${typeof spec.cop === 'object' ? `${spec.cop.min}–${spec.cop.max}` : nom}).`,
      });
    } else if (nom != null && copMedia != null) {
      infos.push(`COP de catálogo: ${typeof spec.cop === 'object' ? `${spec.cop.min}–${spec.cop.max}` : nom}.`);
    }
  }

  const delta = stats.delta_t?.media;
  if (delta != null) {
    if (delta < 0.5) {
      alertas.push({ nivel: 'critico', texto: `ΔT médio ${delta.toFixed(2)} °C — quase sem aquecimento (entrada ≈ saída). Checar vazão, troca térmica ou compressor.` });
    } else if (delta < 1.2) {
      alertas.push({ nivel: 'atencao', texto: `ΔT médio ${delta.toFixed(2)} °C — baixo para piscina. Pode indicar vazão alta demais ou capacidade reduzida.` });
    } else if (delta <= 4.5) {
      ok.push(`ΔT médio ${delta.toFixed(2)} °C — faixa típica de bomba de calor para piscina.`);
    } else {
      alertas.push({ nivel: 'atencao', texto: `ΔT médio ${delta.toFixed(2)} °C — elevado. Pode indicar vazão baixa (troca térmica insuficiente / risco de alta pressão).` });
    }
  }

  const pA = stats.pressao_alta?.media;
  const pB = stats.pressao_baixa?.media;
  if (pA != null && pB != null) {
    const ratio = pB > 0 ? pA / pB : null;
    infos.push(`Pressões médias em regime: alta ${pA.toFixed(1)} / baixa ${pB.toFixed(1)} (razão ${ratio != null ? ratio.toFixed(2) : '—'}).`);
    if (pA > 450) {
      alertas.push({ nivel: 'critico', texto: `Pressão de descarga alta (${pA.toFixed(1)}) — risco de proteção/corte. Verificar condensação, vazão e limpeza.` });
    } else if (pA > 380) {
      alertas.push({ nivel: 'atencao', texto: `Pressão de descarga elevada (${pA.toFixed(1)}). Monitorar durante o teste.` });
    } else {
      ok.push('Pressão de descarga dentro de faixa operacional usual.');
    }
    if (pB < 40 && pB > 0) {
      alertas.push({ nivel: 'atencao', texto: `Pressão de sucção baixa (${pB.toFixed(1)}) — possível falta de fluido ou restrição.` });
    }
  }

  const vazaoMedia = stats.vazao?.media;
  if (vazaoMedia != null) {
    // Leituras históricas usam L/h (~8000–11000). Specs de catálogo em m³/h (~3–13).
    const vazaoMh = vazaoMedia > 100 ? vazaoMedia / 1000 : vazaoMedia;
    infos.push(`Vazão média: ${vazaoMedia > 100 ? `${Math.round(vazaoMedia)} L/h (~${vazaoMh.toFixed(1)} m³/h)` : `${vazaoMedia.toFixed(1)} m³/h`}.`);
    if (spec?.vazaoAguaIdeal != null) {
      const ideal = typeof spec.vazaoAguaIdeal === 'object' ? spec.vazaoAguaIdeal.mid : spec.vazaoAguaIdeal;
      if (ideal != null && Math.abs(vazaoMh - ideal) / ideal > 0.35) {
        alertas.push({ nivel: 'atencao', texto: `Vazão distante da ideal de catálogo (~${ideal} m³/h).` });
      } else if (ideal != null) {
        ok.push(`Vazão alinhada com a ideal de catálogo (~${ideal} m³/h).`);
      }
    }
  }

  const tensao = stats.tensao?.media;
  if (tensao != null) {
    if (tensao < 190) {
      alertas.push({ nivel: 'critico', texto: `Tensão média ${tensao.toFixed(0)} V — abaixo do mínimo usual (208–220 V).` });
    } else if (tensao > 250 && tensao < 300) {
      infos.push(`Tensão média ${tensao.toFixed(0)} V — possível leitura trifásica/fase-fase ou instrumentação.`);
    } else if (tensao >= 300 && tensao <= 420) {
      ok.push(`Tensão média ${tensao.toFixed(0)} V — compatível com alimentação trifásica 380 V.`);
    } else if (tensao >= 200 && tensao <= 240) {
      ok.push(`Tensão média ${tensao.toFixed(0)} V — compatível com monofásico 220 V.`);
    }
  }

  const regimePct = stats.total_leituras > 0
    ? (stats.leituras_regime / stats.total_leituras) * 100
    : 0;
  if (stats.leituras_regime < 3) {
    alertas.push({ nivel: 'atencao', texto: 'Poucas leituras em regime estável. Teste pode ter sido curto ou máquina não estabilizou.' });
  } else {
    infos.push(`${stats.leituras_regime} de ${stats.total_leituras} leituras em regime (${regimePct.toFixed(0)}%).`);
  }

  // Parada final: pressões equalizadas + COP ~0
  const ultima = (leituras || [])[leituras.length - 1];
  if (ultima) {
    const dP = Math.abs((num(ultima.pressao_alta) || 0) - (num(ultima.pressao_baixa) || 0));
    if ((num(ultima.cop) || 0) < 0.5 && dP < 20) {
      ok.push('Última leitura indica equalização de pressões (máquina desligada / fim de teste).');
    }
  }

  let veredicto = 'aprovado';
  if (alertas.some((a) => a.nivel === 'critico')) veredicto = 'reprovado';
  else if (alertas.some((a) => a.nivel === 'atencao')) veredicto = 'atencao';

  return { veredicto, ok, alertas, infos, is_inverter: isInverter };
}

// GET /api/testes/resumo
router.get('/resumo', requireAuth, async (req, res) => {
  try {
    const [totais, maquinas, recentes] = await Promise.all([
      dbQuery(`
        SELECT
          (SELECT COUNT(*)::int FROM testes.relatorios) AS total_relatorios,
          (SELECT COUNT(*)::int FROM testes.leituras) AS total_leituras,
          (SELECT COUNT(DISTINCT modelo)::int FROM testes.relatorios WHERE modelo IS NOT NULL AND modelo <> '') AS total_modelos,
          (SELECT COUNT(DISTINCT num_op)::int FROM testes.relatorios WHERE num_op IS NOT NULL AND num_op <> '') AS total_ops,
          (SELECT MAX(criado_em) FROM testes.relatorios) AS ultimo_teste
      `),
      dbQuery(`
        SELECT
          r.modelo,
          r.linha,
          COUNT(*)::int AS qtd_relatorios,
          COALESCE(SUM(r.total_registros), 0)::int AS qtd_leituras,
          MAX(r.criado_em) AS ultimo_teste,
          ROUND((AVG(l.cop) FILTER (WHERE l.cop > 1.5))::numeric, 2) AS cop_medio,
          ROUND((AVG(l.temp_dif) FILTER (WHERE l.temp_dif > 0.5))::numeric, 2) AS delta_t_medio,
          ROUND((AVG(l.kw_aquecimento) FILTER (WHERE l.kw_aquecimento > 1))::numeric, 2) AS kw_aq_medio
        FROM testes.relatorios r
        LEFT JOIN testes.leituras l ON l.relatorio_id = r.id
        WHERE r.modelo IS NOT NULL AND TRIM(r.modelo) <> ''
        GROUP BY r.modelo, r.linha
        ORDER BY MAX(r.criado_em) DESC NULLS LAST, r.modelo
      `),
      dbQuery(`
        SELECT id, criado_em, linha, modelo, num_op, operador, total_registros, arquivo_xlsx
        FROM testes.relatorios
        ORDER BY criado_em DESC NULLS LAST, id DESC
        LIMIT 12
      `),
    ]);

    const maquinasEnriquecidas = (maquinas.rows || []).map((m) => ({
      ...m,
      spec: findSpec(m.modelo),
    }));

    res.json({
      ok: true,
      totais: totais.rows[0] || {},
      maquinas: maquinasEnriquecidas,
      recentes: recentes.rows || [],
    });
  } catch (err) {
    console.error('[testes/resumo]', err);
    res.status(500).json({ error: err.message || 'Erro ao carregar resumo de testes.' });
  }
});

// GET /api/testes/relatorios?q=&modelo=&linha=
router.get('/relatorios', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const modelo = String(req.query.modelo || '').trim();
    const linha = String(req.query.linha || '').trim();
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 80));

    const where = [];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      where.push(`(
        r.num_op ILIKE $${i}
        OR r.modelo ILIKE $${i}
        OR r.linha ILIKE $${i}
        OR r.operador ILIKE $${i}
        OR r.arquivo_xlsx ILIKE $${i}
      )`);
    }
    if (modelo) {
      params.push(modelo);
      where.push(`r.modelo = $${params.length}`);
    }
    if (linha) {
      params.push(linha);
      where.push(`r.linha = $${params.length}`);
    }

    params.push(limit);
    const sql = `
      SELECT
        r.id, r.criado_em, r.linha, r.modelo, r.num_op, r.operador,
        r.total_registros, r.arquivo_xlsx,
        ROUND((AVG(l.cop) FILTER (WHERE l.cop > 1.5))::numeric, 2) AS cop_medio,
        ROUND((AVG(l.temp_dif) FILTER (WHERE l.temp_dif > 0.5))::numeric, 2) AS delta_t_medio,
        ROUND((AVG(l.kw_aquecimento) FILTER (WHERE l.kw_aquecimento > 1))::numeric, 2) AS kw_aq_medio,
        ROUND(MAX(l.cop)::numeric, 2) AS cop_max,
        COUNT(l.id)::int AS leituras_count
      FROM testes.relatorios r
      LEFT JOIN testes.leituras l ON l.relatorio_id = r.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY r.id
      ORDER BY r.criado_em DESC NULLS LAST, r.id DESC
      LIMIT $${params.length}
    `;

    const { rows } = await dbQuery(sql, params);
    res.json({ ok: true, relatorios: rows || [] });
  } catch (err) {
    console.error('[testes/relatorios]', err);
    res.status(500).json({ error: err.message || 'Erro ao listar relatórios.' });
  }
});

// GET /api/testes/relatorios/:id
router.get('/relatorios/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const rel = await dbQuery(
      `SELECT id, criado_em, linha, modelo, num_op, operador, total_registros, arquivo_xlsx
       FROM testes.relatorios WHERE id = $1`,
      [id]
    );
    if (!rel.rows?.length) {
      return res.status(404).json({ error: 'Relatório não encontrado.' });
    }

    const relatorio = rel.rows[0];
    const leit = await dbQuery(
      `SELECT id, data_hora, temp_ambiente, temp_entrada, temp_saida, temp_dif,
              tensao, corrente, vazao, kcal_h, kw_aquecimento, kw_consumo, cop,
              pressao_alta, pressao_baixa
       FROM testes.leituras
       WHERE relatorio_id = $1
       ORDER BY id ASC`,
      [id]
    );

    const leituras = (leit.rows || []).map((l) => ({
      ...l,
      em_regime: isEmRegime(l),
    }));

    const stats = calcularStats(leituras);
    const spec = findSpec(relatorio.modelo);
    const diagnostico = gerarDiagnostico(relatorio, stats, leituras, spec);

    // Outros testes do mesmo modelo (comparativo)
    const peers = await dbQuery(
      `SELECT r.id, r.criado_em, r.num_op, r.operador, r.total_registros,
              ROUND((AVG(l.cop) FILTER (WHERE l.cop > 1.5))::numeric, 2) AS cop_medio,
              ROUND((AVG(l.temp_dif) FILTER (WHERE l.temp_dif > 0.5))::numeric, 2) AS delta_t_medio
       FROM testes.relatorios r
       LEFT JOIN testes.leituras l ON l.relatorio_id = r.id
       WHERE r.modelo = $1 AND r.id <> $2
       GROUP BY r.id
       ORDER BY r.criado_em DESC NULLS LAST
       LIMIT 8`,
      [relatorio.modelo, id]
    );

    res.json({
      ok: true,
      relatorio,
      leituras,
      stats,
      diagnostico,
      spec,
      comparativo_modelo: peers.rows || [],
    });
  } catch (err) {
    console.error('[testes/relatorios/:id]', err);
    res.status(500).json({ error: err.message || 'Erro ao carregar relatório.' });
  }
});

// GET /api/testes/maquinas/:modelo — histórico do modelo
router.get('/maquinas/:modelo', requireAuth, async (req, res) => {
  try {
    const modelo = String(req.params.modelo || '').trim();
    if (!modelo) return res.status(400).json({ error: 'Modelo obrigatório.' });

    const { rows } = await dbQuery(
      `SELECT
         r.id, r.criado_em, r.linha, r.modelo, r.num_op, r.operador,
         r.total_registros, r.arquivo_xlsx,
         ROUND((AVG(l.cop) FILTER (WHERE l.cop > 1.5))::numeric, 2) AS cop_medio,
         ROUND((AVG(l.temp_dif) FILTER (WHERE l.temp_dif > 0.5))::numeric, 2) AS delta_t_medio,
         ROUND((AVG(l.kw_aquecimento) FILTER (WHERE l.kw_aquecimento > 1))::numeric, 2) AS kw_aq_medio,
         ROUND((AVG(l.kw_consumo) FILTER (WHERE l.kw_consumo > 0.4))::numeric, 2) AS kw_cons_medio
       FROM testes.relatorios r
       LEFT JOIN testes.leituras l ON l.relatorio_id = r.id
       WHERE r.modelo = $1
       GROUP BY r.id
       ORDER BY r.criado_em DESC NULLS LAST, r.id DESC`,
      [modelo]
    );

    res.json({
      ok: true,
      modelo,
      spec: findSpec(modelo),
      relatorios: rows || [],
    });
  } catch (err) {
    console.error('[testes/maquinas/:modelo]', err);
    res.status(500).json({ error: err.message || 'Erro ao carregar máquina.' });
  }
});

module.exports = router;
