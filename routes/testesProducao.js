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
  if (v == null || v === '') return null;
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
  const kwAq = num(l.kw_aquecimento);
  const pA = num(l.pressao_alta);
  const pB = num(l.pressao_baixa);
  if (cop == null || cop < 1.2) return false;
  if (cons == null || cons < 0.25) return false;
  // Pressões equalizadas = não está comprimindo
  if (pA != null && pB != null && Math.abs(pA - pB) < 20) return false;
  // Aceita COP bom mesmo com instrumentação de pressão incompleta
  if (cop >= 2.5 && (kwAq == null || kwAq > 0.5)) return true;
  if (cop >= 1.5 && cons >= 0.4) return true;
  return false;
}

function isParada(l) {
  const cop = num(l.cop) || 0;
  const cons = num(l.kw_consumo) || 0;
  const pA = num(l.pressao_alta);
  const pB = num(l.pressao_baixa);
  const dP = (pA != null && pB != null) ? Math.abs(pA - pB) : 999;
  return cop < 0.5 && cons < 0.5 && dP < 25;
}

function resumoLeitura(l, idx) {
  if (!l) return null;
  return {
    indice: idx + 1,
    id: l.id,
    data_hora: l.data_hora,
    fase: l.fase,
    temp_ambiente: num(l.temp_ambiente),
    temp_entrada: num(l.temp_entrada),
    temp_saida: num(l.temp_saida),
    temp_dif: num(l.temp_dif),
    cop: num(l.cop),
    kw_aquecimento: num(l.kw_aquecimento),
    kw_consumo: num(l.kw_consumo),
    kcal_h: num(l.kcal_h),
    vazao: num(l.vazao),
    pressao_alta: num(l.pressao_alta),
    pressao_baixa: num(l.pressao_baixa),
    tensao: num(l.tensao),
    corrente: num(l.corrente),
  };
}

function deltaCampo(a, b, campo) {
  const va = num(a?.[campo]);
  const vb = num(b?.[campo]);
  if (va == null || vb == null) return null;
  return Number((vb - va).toFixed(3));
}

/**
 * Classifica fases e compara leituras entre si (início × pico × fim).
 * É o núcleo lógico do relatório — não apenas médias de um registro.
 */
function analisarComparativoLeituras(leiturasRaw) {
  const leituras = (leiturasRaw || []).map((l, i) => {
    let fase = 'transicao';
    if (isParada(l)) fase = 'parada';
    else if (isEmRegime(l)) fase = 'regime';
    else if ((num(l.cop) || 0) > 0.5 || (num(l.kw_consumo) || 0) > 0.3) fase = 'partida';
    return { ...l, em_regime: isEmRegime(l), fase, _i: i };
  });

  // Refinar: primeiras leituras em regime ainda com ΔT baixo = aquecimento
  const regimeIdxs = leituras.map((l, i) => (l.fase === 'regime' ? i : -1)).filter((i) => i >= 0);
  if (regimeIdxs.length >= 4) {
    const firstThird = Math.max(1, Math.floor(regimeIdxs.length / 3));
    for (let k = 0; k < firstThird; k++) {
      const i = regimeIdxs[k];
      const dt = num(leituras[i].temp_dif) || 0;
      const peakDt = Math.max(...regimeIdxs.map((j) => num(leituras[j].temp_dif) || 0));
      if (dt < peakDt * 0.75) leituras[i].fase = 'aquecimento';
    }
    // Queda de COP/potência no final do regime = desaceleração
    const lastFew = regimeIdxs.slice(-Math.max(1, Math.floor(regimeIdxs.length / 5)));
    const maxKw = Math.max(...regimeIdxs.map((j) => num(leituras[j].kw_aquecimento) || 0));
    lastFew.forEach((i) => {
      const kw = num(leituras[i].kw_aquecimento) || 0;
      const cop = num(leituras[i].cop) || 0;
      const maxCop = Math.max(...regimeIdxs.map((j) => num(leituras[j].cop) || 0));
      if (maxKw > 0 && kw < maxKw * 0.8 && cop < maxCop * 0.85) {
        leituras[i].fase = 'desaceleracao';
      }
    });
  }

  const ativas = leituras.filter((l) => l.fase !== 'parada');
  const regime = leituras.filter((l) => l.fase === 'regime' || l.fase === 'aquecimento');
  const baseCmp = regime.length ? regime : ativas;

  const pickBest = (arr, campo) => {
    if (!arr.length) return null;
    return arr.reduce((best, cur) => (
      (num(cur[campo]) || -Infinity) > (num(best[campo]) || -Infinity) ? cur : best
    ));
  };

  const inicio = ativas[0] || leituras[0] || null;
  const picoCop = pickBest(baseCmp, 'cop');
  const picoPotencia = pickBest(baseCmp, 'kw_aquecimento');
  const picoDelta = pickBest(baseCmp, 'temp_dif');
  const fimRegime = [...baseCmp].reverse().find((l) => l.fase === 'regime' || l.fase === 'desaceleracao')
    || baseCmp[baseCmp.length - 1]
    || null;
  const parada = [...leituras].reverse().find((l) => l.fase === 'parada') || leituras[leituras.length - 1] || null;

  const pontos = {
    inicio: resumoLeitura(inicio, inicio?._i ?? 0),
    pico_cop: resumoLeitura(picoCop, picoCop?._i ?? 0),
    pico_potencia: resumoLeitura(picoPotencia, picoPotencia?._i ?? 0),
    pico_delta_t: resumoLeitura(picoDelta, picoDelta?._i ?? 0),
    fim_regime: resumoLeitura(fimRegime, fimRegime?._i ?? 0),
    parada: resumoLeitura(parada, parada?._i ?? 0),
  };

  // Comparação início → pico → fim (campos-chave)
  const campos = ['cop', 'temp_dif', 'kw_aquecimento', 'kw_consumo', 'temp_saida', 'pressao_alta', 'corrente'];
  const comparacao = {
    inicio_para_pico: {},
    pico_para_fim: {},
    inicio_para_fim: {},
  };
  campos.forEach((c) => {
    comparacao.inicio_para_pico[c] = deltaCampo(pontos.inicio, pontos.pico_cop, c);
    comparacao.pico_para_fim[c] = deltaCampo(pontos.pico_cop, pontos.fim_regime, c);
    comparacao.inicio_para_fim[c] = deltaCampo(pontos.inicio, pontos.fim_regime, c);
  });

  // Séries para gráfico de barras comparativo (3 momentos)
  const momentos = [
    { key: 'inicio', label: 'Início', ponto: pontos.inicio },
    { key: 'pico', label: 'Pico COP', ponto: pontos.pico_cop },
    { key: 'fim', label: 'Fim regime', ponto: pontos.fim_regime },
  ].filter((m) => m.ponto);

  const barrasComparativas = {
    labels: momentos.map((m) => `${m.label} (#${m.ponto.indice})`),
    cop: momentos.map((m) => m.ponto.cop),
    delta_t: momentos.map((m) => m.ponto.temp_dif),
    kw_aquecimento: momentos.map((m) => m.ponto.kw_aquecimento),
    kw_consumo: momentos.map((m) => m.ponto.kw_consumo),
    temp_saida: momentos.map((m) => m.ponto.temp_saida),
    corrente: momentos.map((m) => m.ponto.corrente),
  };

  // Variação leitura a leitura (só ativas)
  const evolucao = [];
  for (let i = 1; i < ativas.length; i++) {
    const prev = ativas[i - 1];
    const cur = ativas[i];
    evolucao.push({
      de: prev._i + 1,
      para: cur._i + 1,
      data_hora: cur.data_hora,
      d_cop: deltaCampo(prev, cur, 'cop'),
      d_temp_dif: deltaCampo(prev, cur, 'temp_dif'),
      d_kw_aq: deltaCampo(prev, cur, 'kw_aquecimento'),
      d_temp_saida: deltaCampo(prev, cur, 'temp_saida'),
    });
  }

  const contagemFases = leituras.reduce((acc, l) => {
    acc[l.fase] = (acc[l.fase] || 0) + 1;
    return acc;
  }, {});

  // Narrativa curta do teste
  const narrativa = [];
  if (pontos.inicio && pontos.pico_cop) {
    const dCop = comparacao.inicio_para_pico.cop;
    const dDt = comparacao.inicio_para_pico.temp_dif;
    narrativa.push(
      `Das ${ativas.length} leituras ativas, o COP saiu de ${fmtOrDash(pontos.inicio.cop)} (#${pontos.inicio.indice}) ` +
      `para o pico ${fmtOrDash(pontos.pico_cop.cop)} na leitura #${pontos.pico_cop.indice}` +
      (dCop != null ? ` (Δ ${dCop >= 0 ? '+' : ''}${dCop.toFixed(2)})` : '') + '.'
    );
    if (dDt != null) {
      narrativa.push(
        `No mesmo trecho o ΔT ${dDt >= 0 ? 'subiu' : 'caiu'} ${Math.abs(dDt).toFixed(2)} °C ` +
        `(${fmtOrDash(pontos.inicio.temp_dif)} → ${fmtOrDash(pontos.pico_cop.temp_dif)}).`
      );
    }
  }
  if (pontos.pico_potencia && pontos.pico_cop && pontos.pico_potencia.id !== pontos.pico_cop.id) {
    narrativa.push(
      `Maior potência de aquecimento: ${fmtOrDash(pontos.pico_potencia.kw_aquecimento)} kW na leitura #${pontos.pico_potencia.indice} ` +
      `(COP ${fmtOrDash(pontos.pico_potencia.cop)}), diferente do pico de COP.`
    );
  }
  if (pontos.fim_regime && pontos.pico_cop && comparacao.pico_para_fim.cop != null) {
    const d = comparacao.pico_para_fim.cop;
    if (Math.abs(d) >= 0.3) {
      narrativa.push(
        `Do pico ao fim do regime o COP ${d < 0 ? 'caiu' : 'subiu'} ${Math.abs(d).toFixed(2)} ` +
        `(leitura #${pontos.fim_regime.indice}).`
      );
    } else {
      narrativa.push('Do pico ao fim do regime o COP permaneceu estável.');
    }
  }
  if (pontos.parada && pontos.parada.fase === 'parada') {
    const nearEnd = pontos.parada.indice >= Math.max(2, Math.floor(leituras.length * 0.7));
    if (nearEnd) {
      narrativa.push(`Encerramento detectado na leitura #${pontos.parada.indice} (pressões equalizadas / COP ~0).`);
    }
  }

  return {
    leituras_classificadas: leituras.map(({ _i, ...rest }) => rest),
    fases: contagemFases,
    pontos_chave: pontos,
    comparacao,
    barras_comparativas: barrasComparativas,
    evolucao_leitura_a_leitura: evolucao,
    narrativa,
  };
}

function fmtOrDash(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(2);
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

    const comparativo = analisarComparativoLeituras(leit.rows || []);
    const leituras = comparativo.leituras_classificadas;
    const stats = calcularStats(leituras);
    const spec = findSpec(relatorio.modelo);
    const diagnostico = gerarDiagnostico(relatorio, stats, leituras, spec);

    // Outros testes do mesmo modelo (comparativo)
    const peers = await dbQuery(
      `SELECT r.id, r.criado_em, r.num_op, r.operador, r.total_registros,
              ROUND((AVG(l.cop) FILTER (WHERE l.cop > 1.5))::numeric, 2) AS cop_medio,
              ROUND((AVG(l.temp_dif) FILTER (WHERE l.temp_dif > 0.5))::numeric, 2) AS delta_t_medio,
              ROUND(MAX(l.cop)::numeric, 2) AS cop_max,
              ROUND(MAX(l.kw_aquecimento)::numeric, 2) AS kw_aq_max
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
      comparativo: {
        fases: comparativo.fases,
        pontos_chave: comparativo.pontos_chave,
        comparacao: comparativo.comparacao,
        barras_comparativas: comparativo.barras_comparativas,
        evolucao_leitura_a_leitura: comparativo.evolucao_leitura_a_leitura,
        narrativa: comparativo.narrativa,
      },
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
