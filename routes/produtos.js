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

router.post('/webhook', async (req, res) => {
  const expected = process.env.OMIE_WEBHOOK_TOKEN;
  const headerTok = req.get('X-Omie-Token');
  const queryTok  = req.query.token;
  if (expected && headerTok !== expected && queryTok !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = req.body || {};

  // Normaliza os diferentes formatos de payload de webhook (inclui Connect 2.0: { topic, event })
  let raw =
    body.produto_servico_cadastro ??
    body.produto_cadastro ??
    body.itens ??
    body.item ??
    (body.topic && body.event ? body.event : []);

  // Garante array para o loop
  const itens = Array.isArray(raw) ? raw : [raw];

  // Se o payload veio vazio, responde ok e sai
  if (!itens.length || (itens.length === 1 && Object.keys(itens[0] || {}).length === 0)) {
    return res.json({ ok: true, processed: 0, fetched_from_omie: 0 });
  }

  let processed = 0;
  let fetched_from_omie = 0;
  const failures = [];

  for (const it of itens) {
    try {
      // Aceita tanto id (codigo_produto) quanto código "humano"
      const id     = it.codigo_produto ?? it.codigoProduto ?? null;
      const codigo = it.codigo ?? it.codigo_produto_integracao ?? it.codigoProdutoIntegracao ?? null;

      let full = it;

      // Se ainda não temos campos mínimos (ex.: só veio id), fazemos fallback para ConsultarProduto
      const hasMin = !!(full.descricao && (id || codigo));
      if (!hasMin) {
        if (!id && !codigo) {
          failures.push({ step: 'skip', msg: 'sem id/codigo no item', itResumo: { id, codigo } });
          continue;
        }
        const payload = id ? { codigo_produto: id } : { codigo };
        try {
          full = await callOmie('ConsultarProduto', payload);
          fetched_from_omie++;
        } catch (e) {
          failures.push({ step: 'omie_consulta', id, codigo, error: String(e) });
          continue;
        }
      }

      // Upsert no Postgres (função já criada no seu banco)
      await pool.query('SELECT omie_upsert_produto($1)', [full]);
      processed++;
    } catch (e) {
      failures.push({ step: 'db_upsert', error: String(e) });
    }
  }

  // Notifica clientes via SSE (se configurado no app)
  try {
    const notify =
      (req.app && req.app.locals && req.app.locals.broadcastSSE) ||
      (req.app && typeof req.app.get === 'function' && req.app.get('broadcastSSE'));
    if (typeof notify === 'function') {
      notify('produtos:update', { count: processed, at: new Date().toISOString() });
    }
  } catch {}

  const resp = { ok: true, processed, fetched_from_omie };
  if (req.query.debug) {
    resp.debug = {
      items_len: itens.length,
      hasEnv: { key: !!process.env.OMIE_APP_KEY, secret: !!process.env.OMIE_APP_SECRET },
      failures
    };
  }
  return res.json(resp);
});




module.exports = router;
