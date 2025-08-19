// intranet/routes/produtos.js
const express = require('express');
const { dbQuery } = require('../src/db');

const router = express.Router();

// --- SSE (Server-Sent Events) ---
const sseClients = new Set();


// ===== Helpers para o webhook =====
const OMIE_WEBHOOK_TOKEN = process.env.OMIE_WEBHOOK_TOKEN;
const OMIE_APP_KEY       = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET    = process.env.OMIE_APP_SECRET;
const OMIE_URL           = 'https://app.omie.com.br/api/v1/geral/produtos/';


const mask = s => (s ? s.slice(0,4) + '…' : s);

function sseBroadcast(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (_) {}
  }
}


/**
 * GET /api/produtos/lista
 * Query:
 *   q?        → busca (descricao|codigo|codigo_produto_integracao)
 *   tipoitem? → ex.: '04'
 *   inativo?  → 'S' | 'N'
 *   page?     → página (default 1)
 *   limit?    → itens por página (default 50, máx 200)
 */
router.get('/lista', async (req, res) => {
  try {
    const q        = (req.query.q || '').trim() || null;
    const tipoitem = (req.query.tipoitem || '').trim() || null;
    const inativo  = (req.query.inativo  || '').trim() || null;
    const limit    = Math.min(parseInt(req.query.limit || '50', 10), 500);
    const page     = Math.max(parseInt(req.query.page  || '1', 10), 1);
    const offset   = (page - 1) * limit;

    const sql = `
      WITH base AS (
        SELECT *
        FROM vw_lista_produtos
        WHERE
          ($1::text IS NULL
            OR descricao ILIKE '%' || $1 || '%'
            OR codigo    ILIKE '%' || $1 || '%'
            OR codigo_produto_integracao ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR tipoitem = $2)
          AND ($3::text IS NULL OR inativo  = $3)
      )
      SELECT
        (SELECT COUNT(*) FROM base) AS total,
        json_agg(row_to_json(t.*))  AS itens
      FROM (
        SELECT
          codigo_produto,
          codigo_produto_integracao,
          codigo,
          descricao,
          unidade,
          tipoitem,
          ncm,
          valor_unitario,
          quantidade_estoque,
          inativo,
          bloqueado,
          marca,
          modelo,
          dalt, halt, dinc, hinc,
          primeira_imagem
        FROM base
        ORDER BY descricao ASC
        LIMIT $4 OFFSET $5
      ) AS t;
    `;

    const { rows } = await dbQuery(sql, [q, tipoitem, inativo, limit, offset]);
    const total = Number(rows?.[0]?.total || 0);
    const itens = rows?.[0]?.itens || [];
    // dentro do handler GET /lista, antes de responder:
res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
res.set('Pragma', 'no-cache');
res.set('Expires', '0');
res.set('Surrogate-Control', 'no-store');

    res.json({ total, page, limit, itens });
  } catch (err) {
    console.error('[produtos/lista] erro →', err);
    res.status(500).json({ error: 'Falha ao consultar produtos.' });
  }
});

// GET /api/produtos/stream → canal SSE
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  // reconexão automática do EventSource
  res.write('retry: 5000\n');

  // ping inicial
  res.write('data: {"type":"hello"}\n\n');

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// define se o payload está “magro” (precisa buscar na Omie)
function precisaFetch(it) {
  if (!it) return false;
  // se não veio descrição (ou outros campos básicos), vamos buscar
  if (!it.descricao) return true;
  // alguns tópicos mandam só "tipoItem" e mais nada — cubra esses casos também
  if (!it.unidade || !it.tipoItem || !it.ncm) return true;
  return false;
}

async function consultarProdutoOmie({ codigo_produto, codigo }) {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) return null;

  const param = codigo_produto ? { codigo_produto } :
                codigo         ? { codigo } :
                                 null;
  if (!param) return null;

  const payload = {
    call: 'ConsultarProduto',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [param]
  };

  const resp = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let json = null;
  try {
    json = await resp.json();
  } catch {
    return null;
  }

  // formatos possíveis:
  // A) { produto_servico_cadastro: {...} }
  // B) { ...camposDoProduto... }
  // C) { faultstring: "...", ... }
  if (json && json.produto_servico_cadastro) return json.produto_servico_cadastro;

  if (json && (json.codigo_produto || json.codigo || json.descricao)) {
    return json;
  }

  // se vier erro, retorne null (o caller loga)
  return null;
}


// (opcional) se você já tem uma lista global de clientes SSE, use-a
function broadcastSSE(msg) {
  try {
    const clients = global.__produtosSSEClients || [];
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of clients) res.write(data);
  } catch {}
}

function hasEssentials(obj) {
  return !!(obj && obj.codigo_produto && (obj.codigo || obj.codigo_produto_integracao));
}

// ===== WEBHOOK OMIE =====
// ===== WEBHOOK OMIE =====
router.post('/webhook', async (req, res) => {
  const debugMode = String(req.query.debug || '') === '1';

  // aceita token no header OU na querystring
  const token = req.get('X-Omie-Token') || req.query.token;
  if (!token || token !== OMIE_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const hasEnv = { key: !!OMIE_APP_KEY, secret: !!OMIE_APP_SECRET };
  const body = req.body || {};

  // tenta várias chaves possíveis vindas da Omie
  const raw =
    body.produto_servico_cadastro ??
    body.produto_cadastro ??
    body.itens ??
    body.item ??
    [];

  const items = Array.isArray(raw) ? raw : [raw];

  let processed = 0;
  let fetched   = 0;
  const failures = [];

  for (const it of items) {
    let data = (it && typeof it === 'object') ? { ...it } : null;

    // precisa ter pelo menos codigo_produto OU codigo para poder consultar
    if (!data || (!data.codigo_produto && !data.codigo)) {
      failures.push({
        step: 'skip',
        id: data?.codigo_produto || data?.codigo || null,
        reason: 'sem codigo_produto/codigo'
      });
      continue;
    }

    // payload "magro"? então buscamos o produto completo na Omie
    const needFetch =
      !data.descricao ||
      !data.unidade ||
      !data.tipoItem ||
      !data.ncm ||
      !data.codigo ||
      !data.codigo_produto_integracao;

    if (needFetch && hasEnv.key && hasEnv.secret) {
      try {
        const full = await consultarProdutoOmie({
          codigo_produto: data.codigo_produto,
          codigo: data.codigo
        });
        if (full) {
          data = full;
          fetched++;
        } else {
          failures.push({
            step: 'consultarProdutoOmie',
            id: data.codigo_produto || data.codigo,
            error: 'resposta vazia/inesperada'
          });
        }
      } catch (e) {
        failures.push({
          step: 'consultarProdutoOmie',
          id: data.codigo_produto || data.codigo,
          error: e?.message || String(e)
        });
      }
    }

    // validações essenciais para o upsert
    if (!data || !data.codigo_produto || !(data.codigo || data.codigo_produto_integracao)) {
      failures.push({
        step: 'skip_upsert',
        id: data?.codigo_produto || data?.codigo,
        reason: 'payload sem campos essenciais (codigo/codigo_produto_integracao)'
      });
      continue;
    }

    try {
      await dbQuery('SELECT omie_upsert_produto($1::jsonb);', [data]);
      processed++;
    } catch (e) {
      failures.push({
        step: 'db_upsert',
        id: data.codigo_produto || data.codigo,
        error: e?.message || String(e),
        code: e?.code || null,
        detail: e?.detail || null
      });
    }
  }

  // avisa o front por SSE (se estiver aberto)
  try { sseBroadcast({ type: 'refresh_all', at: Date.now() }); } catch (_) {}
  try { broadcastSSE({ type: 'refresh_all', at: Date.now() }); } catch (_) {}

  const payload = { ok: true, processed, fetched_from_omie: fetched };
  if (debugMode) payload.debug = { items_len: items.length, hasEnv, failures };

  return res.json(payload);
});



module.exports = router;
