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

// === WEBHOOK OMIE ============================================================
router.post('/webhook', async (req, res) => {
  const expected = process.env.OMIE_WEBHOOK_TOKEN || '';
  const token    = req.query.token || req.get('X-Omie-Token') || '';

  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // fetch seguro (usa global, senão carrega node-fetch)
  async function httpFetch(url, opts) {
    const f = globalThis.fetch || (await import('node-fetch')).default;
    return f(url, opts);
  }

  // Fallback: ConsultarProduto direto na Omie
  async function consultarProdutoOmie({ codigo, codigo_produto }) {
    const app_key    = process.env.OMIE_APP_KEY;
    const app_secret = process.env.OMIE_APP_SECRET;
    if (!app_key || !app_secret) throw new Error('OMIE_APP_KEY/SECRET ausentes');

    const payload = {
      call: 'ConsultarProduto',
      param: [{ codigo, codigo_produto }],
      app_key,
      app_secret,
    };

    const r = await httpFetch('https://app.omie.com.br/api/v1/geral/produtos/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`Omie HTTP ${r.status}`);
    return r.json();
  }

  // Upsert no Postgres usando a sua função PL/pgSQL
  async function upsertNoBanco(item) {
    if (!item) return;
    if (!item.codigo_produto_integracao) {
      item.codigo_produto_integracao = item.codigo || String(item.codigo_produto || '');
    }
    await pool.query('SELECT omie_upsert_produto($1::jsonb)', [item]);
  }

  const body = req.body || {};
  let processed = 0;
  let fetched   = 0;
  const failures = [];

  try {
    // 1) Formato clássico (lista completa)
    if (Array.isArray(body.produto_servico_cadastro) && body.produto_servico_cadastro.length) {
      for (const raw of body.produto_servico_cadastro) {
        try {
          await upsertNoBanco(raw);
          processed++;
        } catch (e) {
          failures.push({ step: 'db_upsert', id: raw?.codigo_produto || raw?.codigo, error: String(e) });
        }
      }
    }

    // 2) Formato Omie Connect: { topic:"Produto.Alterado", event:{...} }
    if (body.topic === 'Produto.Alterado' && body.event) {
      const ev = body.event;
      const codigo_produto = ev.codigo_produto || null;
      const codigo         = ev.codigo || null;

      try {
        // buscamos SEMPRE a versão completa na Omie
        const produto = await consultarProdutoOmie({ codigo, codigo_produto });
        if (!produto.codigo_produto_integracao) {
          produto.codigo_produto_integracao = produto.codigo || String(produto.codigo_produto || '');
        }
        await upsertNoBanco(produto);
        processed++;
        fetched++;
      } catch (e) {
        failures.push({ step: 'omie_consulta', id: codigo_produto || codigo, error: String(e) });
      }
    }

    // (opcional) notificar SSE/clientes
    try { req.app?.get('notifyProducts')?.(); } catch {}

    const resp = { ok: true, processed, fetched_from_omie: fetched };
    if (String(req.query.debug) === '1') {
      resp.debug = {
        items_len: Array.isArray(body.produto_servico_cadastro) ? body.produto_servico_cadastro.length : 0,
        hasEnv: { key: !!process.env.OMIE_APP_KEY, secret: !!process.env.OMIE_APP_SECRET },
        failures,
      };
    }
    return res.json(resp);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err), processed, fetched_from_omie: fetched, failures });
  }
});




module.exports = router;
