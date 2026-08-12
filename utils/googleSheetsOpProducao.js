/**
 * Registra OPs geradas na planilha Google Sheets (aba PRODUÇÃO 2 - F/ ESCOPO)
 * via webhook do Google Apps Script.
 *
 * Mapeamento na planilha:
 *   E = MODELO
 *   G = CONTROLADOR ← numero_op do sistema
 *   F = ORDEM DE PRODUÇÃO (não preencher)
 *   D = PEDIDO (deixar em branco — fórmula antiga gerava #NAME?)
 *
 * Env: GOOGLE_SHEETS_OP_WEBHOOK_URL
 *
 * Após alterar scripts/google_apps_script/registrar_op_producao_escopo.gs,
 * é obrigatório republicar a implantação do Apps Script (nova versão).
 */

const { parse: csvParse } = require('csv-parse/sync');

const ACAO = 'registrar_ops_producao_escopo';
const ACAO_BUSCAR = 'buscar_ordem_producao_escopo';
const ABA_ESCOPO = 'PRODUÇÃO 2 - F/ ESCOPO';
const SPREADSHEET_ID = '1Kzg7LngaUig6t2CLabS1fhZ-iD5idrmv1ZesIUVOy1M';
const AT_SERIE_SHEETS_PUB_KEY = '2PACX-1vTBZcTPkowyN_dViQlzWd4noEgssByJR3f6YPtnR234sYIT5gTFI5PZXw3ZdPUOWAlxp_RDMo_I8JFm';
const AT_SERIE_PUBHTML_URL = `https://docs.google.com/spreadsheets/d/e/${AT_SERIE_SHEETS_PUB_KEY}/pubhtml`;
const AT_SERIE_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${AT_SERIE_SHEETS_PUB_KEY}/pub`;

let mapaControladorCache = null;
let mapaControladorCacheAt = 0;
const MAPA_CACHE_MS = 2 * 60 * 1000;

function normOpKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^0+/, '') || '0';
}

/**
 * @param {{ modelo: string, numeroOp: string|number }} params
 */
function montarLinhaPlanilhaOp({ modelo, numeroOp }) {
  const modeloTxt = String(modelo || '').trim();
  const numeroOpTxt = String(numeroOp || '').trim();
  if (!modeloTxt || !numeroOpTxt) {
    throw new Error('modelo e numeroOp são obrigatórios para a planilha');
  }
  return {
    modelo: modeloTxt,
    numero_op: numeroOpTxt,
    etapa: 5,
    // PEDIDO fica em branco no Apps Script (sem formula_pedido)
  };
}

async function postWebhookOpProducao(payload) {
  const webhookUrl = process.env.GOOGLE_SHEETS_OP_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('GOOGLE_SHEETS_OP_WEBHOOK_URL não configurada');
  }

  const fetchFn = global.safeFetch || globalThis.fetch;
  if (!fetchFn) {
    throw new Error('Fetch indisponível no servidor');
  }

  const body = JSON.stringify(payload);
  const resposta = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'manual',
  });

  if ([301, 302, 303, 307, 308].includes(Number(resposta.status || 0))) {
    return { ok: true, redirect: true };
  }

  const contentType = String(resposta.headers.get('content-type') || '').toLowerCase();
  const texto = await resposta.text();

  if (!resposta.ok) {
    throw new Error(`Webhook OP planilha HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }

  if (contentType.includes('text/html')) {
    throw new Error(`Webhook OP planilha retornou HTML: ${texto.slice(0, 300)}`);
  }

  if (!texto) return { ok: true };

  let json = null;
  try {
    json = JSON.parse(texto);
  } catch (_) {
    return { ok: true, raw: texto };
  }

  if (json && json.ok === false) {
    throw new Error(json.error || JSON.stringify(json));
  }

  return json || { ok: true };
}

/**
 * Envia as OPs recém-geradas para a planilha (uma linha por OP).
 * Falha na planilha não deve impedir a criação das OPs no sistema.
 *
 * @param {{ modelo: string, ops: Array<{ n_op: string|number }> }} params
 */
async function registrarOpsGeradasNaPlanilha({ modelo, ops }) {
  const lista = Array.isArray(ops) ? ops : [];
  if (!lista.length) return { ok: true, skipped: true, reason: 'sem_ops' };

  const modeloTxt = String(modelo || '').trim();
  if (!modeloTxt) {
    throw new Error('modelo do produto é obrigatório para registrar na planilha');
  }

  const linhas = lista.map((op) => montarLinhaPlanilhaOp({
    modelo: modeloTxt,
    numeroOp: op?.n_op ?? op?.numero_op ?? op,
  }));

  const retorno = await postWebhookOpProducao({
    acao: ACAO,
    aba: 'PRODUÇÃO 2 - F/ ESCOPO',
    linhas,
  });

  return {
    ok: true,
    linhas: linhas.length,
    retorno,
  };
}

async function fetchComTimeout(url, options = {}, timeoutMs = 25000) {
  const fetchFn = global.safeFetch || globalThis.fetch;
  if (!fetchFn) throw new Error('Fetch indisponível no servidor');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizarCabecalho(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function montarMapaDeLinhas(linhas) {
  const mapa = new Map();
  if (!Array.isArray(linhas) || !linhas.length) return mapa;

  const primeira = linhas[0];
  const ehObjeto = primeira && typeof primeira === 'object' && !Array.isArray(primeira);
  let idxF = 5;
  let idxG = 6;
  let start = 0;

  if (ehObjeto) {
    const headers = Object.keys(primeira);
    const colF = headers.find((h) => {
      const n = normalizarCabecalho(h);
      return n.includes('ORDEM') && n.includes('PROD');
    });
    const colG = headers.find((h) => normalizarCabecalho(h).includes('CONTROLADOR'));
    for (const row of linhas) {
      const controlador = String(row[colG] || '').trim();
      const ordem = String(row[colF] || '').trim();
      const key = normOpKey(controlador);
      if (key && ordem) mapa.set(key, ordem);
    }
    return mapa;
  }

  for (let i = 0; i < Math.min(linhas.length, 12); i++) {
    const row = linhas[i] || [];
    const norms = row.map((c) => normalizarCabecalho(c));
    const f = norms.findIndex((n) => n.includes('ORDEM') && n.includes('PROD'));
    const g = norms.findIndex((n) => n.includes('CONTROLADOR'));
    if (f >= 0 && g >= 0) {
      idxF = f;
      idxG = g;
      start = i + 1;
      break;
    }
  }

  for (let i = start; i < linhas.length; i++) {
    const row = linhas[i] || [];
    const controlador = String(row[idxG] || '').trim();
    const ordem = String(row[idxF] || '').trim();
    const key = normOpKey(controlador);
    if (key && ordem) mapa.set(key, ordem);
  }
  return mapa;
}

async function buscarViaWebhook(numerosOp) {
  const webhookUrl = process.env.GOOGLE_SHEETS_OP_WEBHOOK_URL;
  if (!webhookUrl) return null;
  const lista = [...new Set((numerosOp || []).map((n) => String(n || '').trim()).filter(Boolean))];
  if (!lista.length) return new Map();

  const retorno = await postWebhookOpProducao({
    acao: ACAO_BUSCAR,
    aba: ABA_ESCOPO,
    numeros_op: lista,
  });
  if (!retorno || retorno.ok === false) return null;

  const mapa = new Map();
  const itens = Array.isArray(retorno.itens) ? retorno.itens : [];
  for (const item of itens) {
    const key = normOpKey(item?.numero_op);
    const ordem = String(item?.ordem_producao || '').trim();
    if (key && ordem) mapa.set(key, ordem);
  }
  if (retorno.ordem_producao && retorno.numero_op) {
    const key = normOpKey(retorno.numero_op);
    const ordem = String(retorno.ordem_producao || '').trim();
    if (key && ordem) mapa.set(key, ordem);
  }
  return mapa;
}

async function descobrirGidAbaEscopo() {
  const resp = await fetchComTimeout(AT_SERIE_PUBHTML_URL, { headers: { Accept: 'text/html' } }, 15000);
  if (!resp.ok) throw new Error(`pubhtml HTTP ${resp.status}`);
  const html = await resp.text();
  const alvo = normalizarCabecalho(ABA_ESCOPO);
  const scriptRegex = /items\.push\(\{name:\s*"([^"]+)",[\s\S]*?gid:\s*"(-?\d+)"/g;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const title = String(match[1] || '')
      .replace(/\\\//g, '/')
      .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .trim();
    if (normalizarCabecalho(title) === alvo) return String(match[2] || '').trim();
  }
  return '';
}

async function buscarViaCsvPublicado() {
  const gid = await descobrirGidAbaEscopo();
  if (!gid) throw new Error('gid da aba PRODUÇÃO 2 não encontrado');
  const csvUrl = `${AT_SERIE_CSV_URL}?gid=${encodeURIComponent(gid)}&single=true&output=csv`;
  const resp = await fetchComTimeout(csvUrl, { headers: { Accept: 'text/csv' } }, 30000);
  if (!resp.ok) throw new Error(`CSV publicado HTTP ${resp.status}`);
  const csvText = await resp.text();
  const linhas = csvParse(csvText, {
    columns: false,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
  return montarMapaDeLinhas(linhas);
}

async function buscarViaGviz() {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(ABA_ESCOPO)}`;
  const resp = await fetchComTimeout(csvUrl, { headers: { Accept: 'text/csv' } }, 30000);
  if (!resp.ok) throw new Error(`gviz HTTP ${resp.status}`);
  const csvText = await resp.text();
  if (/<html/i.test(csvText.slice(0, 80))) {
    throw new Error('gviz retornou HTML');
  }
  const linhas = csvParse(csvText, {
    columns: false,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
  return montarMapaDeLinhas(linhas);
}

async function carregarMapaControladorOrdem(numerosOp) {
  const agora = Date.now();
  if (mapaControladorCache && (agora - mapaControladorCacheAt) < MAPA_CACHE_MS) {
    return mapaControladorCache;
  }

  let mapa = null;
  try {
    mapa = await buscarViaWebhook(numerosOp);
  } catch (err) {
    console.warn('[Sheets OP] busca webhook:', err.message || err);
  }

  if (!mapa || !mapa.size) {
    try {
      mapa = await buscarViaCsvPublicado();
    } catch (err) {
      console.warn('[Sheets OP] busca CSV publicado:', err.message || err);
    }
  }

  if (!mapa || !mapa.size) {
    mapa = await buscarViaGviz();
  }

  if (mapa && mapa.size) {
    mapaControladorCache = mapa;
    mapaControladorCacheAt = Date.now();
  }
  return mapa || new Map();
}

/**
 * Localiza ORDEM DE PRODUÇÃO (coluna F) pelo CONTROLADOR (coluna G = n_op do sistema).
 * @param {Array<string|number>} numerosOp
 * @returns {Promise<Record<string, string>>} chave = n_op original, valor = coluna F
 */
async function buscarOrdensProducaoPorControladores(numerosOp) {
  const lista = [...new Set((numerosOp || []).map((n) => String(n || '').trim()).filter(Boolean))];
  if (!lista.length) return {};

  const mapa = await carregarMapaControladorOrdem(lista);
  const out = {};
  for (const numero of lista) {
    const valor = mapa.get(normOpKey(numero));
    if (valor) out[numero] = valor;
  }
  return out;
}

module.exports = {
  ACAO,
  ACAO_BUSCAR,
  montarLinhaPlanilhaOp,
  registrarOpsGeradasNaPlanilha,
  buscarOrdensProducaoPorControladores,
  normOpKey,
};
