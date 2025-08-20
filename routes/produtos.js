// intranet/routes/produtos.js
const express  = require('express');
const router   = express.Router();
const { dbQuery } = require('../src/db');

// === Config Omie (para fallback ConsultarProduto) ============================
const OMIE_WEBHOOK_TOKEN = process.env.OMIE_WEBHOOK_TOKEN || '';
const OMIE_APP_KEY       = process.env.OMIE_APP_KEY || '';
const OMIE_APP_SECRET    = process.env.OMIE_APP_SECRET || '';
const OMIE_PROD_URL      = 'https://app.omie.com.br/api/v1/geral/produtos/';

// Utilzinho pra ocultar chaves em logs
const mask = s => (s ? String(s).slice(0, 4) + '…' : '');

// === Helpers =================================================================
function ensureIntegrationKey(item) {
  if (!item) return item;
  if (!item.codigo_produto_integracao) {
    item.codigo_produto_integracao = item.codigo || String(item.codigo_produto || '');
  }
  return item;
}

// Node 18+ tem fetch; se não tiver, carrega node-fetch
async function httpFetch(url, opts) {
  const f = globalThis.fetch || (await import('node-fetch')).default;
  return f(url, opts);
}

async function consultarProdutoOmie({ codigo_produto, codigo }) {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET ausentes no ambiente.');
  }
  const param =
    codigo_produto ? { codigo_produto } :
    codigo         ? { codigo } :
    null;
  if (!param) throw new Error('Parâmetro de consulta vazio (sem código).');

  const payload = {
    call: 'ConsultarProduto',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [param]
  };

  const r = await httpFetch(OMIE_PROD_URL, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Omie HTTP ${r.status}`);
  const j = await r.json();

  // pode vir como { produto_servico_cadastro: {...} } ou já flat
  return j?.produto_servico_cadastro || j;
}

// ============================================================================
// GET /api/produtos/lista
// Query:
//   q?        → busca (descricao|codigo|codigo_produto_integracao)
//   tipoitem? → ex.: '04'
//   inativo?  → 'S' | 'N'
//   page?     → página (default 1)
//   limit?    → itens por página (default 50, máx 500)
// ============================================================================
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

    // cache busting no lado do cliente + aqui anulamos caches intermediários
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

// ============================================================================
// POST /api/produtos/webhook
// Aceita:
//  A) { produto_servico_cadastro: [ {...}, ... ] }  (webhook "clássico")
//  B) { topic:"Produto.Alterado", event:{...} }     (Omie Connect 2.0)
// Valida por ?token=... ou header X-Omie-Token.
// Após gravar, dispara SSE via app.get('sseBroadcast') se existir.
// ============================================================================
router.post('/webhook', async (req, res) => {
  const expected = OMIE_WEBHOOK_TOKEN;
  const token    = req.query.token || req.get('X-Omie-Token') || '';

  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = req.body || {};
  const touchedIds = new Set();
  let processed = 0;   // incrementa só no upsertNoBanco
  let fetched   = 0;   // incrementa quando buscar na Omie
  const failures = [];

  async function upsertNoBanco(item, label = 'raw') {
    try {
      const obj = ensureIntegrationKey({ ...item });
      await dbQuery('SELECT omie_upsert_produto($1::jsonb)', [obj]);

      const cod = Number(obj.codigo_produto || obj.codigo);
      if (!Number.isNaN(cod)) touchedIds.add(cod);

      processed++; // ← conta aqui, não nos loops
    } catch (e) {
      failures.push({
        step: 'db_upsert',
        label,
        id: item?.codigo_produto || item?.codigo,
        error: String(e)
      });
    }
  }

  // A) webhook “clássico”
  if (Array.isArray(body.produto_servico_cadastro) && body.produto_servico_cadastro.length) {
    for (const raw of body.produto_servico_cadastro) {
      await upsertNoBanco(raw, 'classico');
    }
  }

  // B) Omie Connect 2.0
  if (body.topic === 'Produto.Alterado' && body.event) {
    const ev = body.event;
    try {
      const produto = await consultarProdutoOmie({
        codigo_produto: ev.codigo_produto,
        codigo: ev.codigo,
      });
      if (!produto) throw new Error('payload vazio da Omie');
      await upsertNoBanco(produto, 'omie_connect');
      fetched++; // apenas aqui
    } catch (e) {
      failures.push({ step: 'omie_consulta', id: ev?.codigo_produto || ev?.codigo, error: String(e) });
    }
  }

  // Dispara SSE para o front (uma única vez)
  try {
    const sse = req.app.get('sseBroadcast');
    if (typeof sse === 'function' && touchedIds.size) {
      sse({ type: 'produtos_updated', ids: Array.from(touchedIds), at: Date.now() });
    }
  } catch (e) {
    console.warn('[webhook] SSE broadcast falhou:', e);
  }

  const resp = { ok: true, processed, fetched_from_omie: fetched };
  if (String(req.query.debug) === '1') {
    resp.debug = {
      items_len: Array.isArray(body.produto_servico_cadastro)
        ? body.produto_servico_cadastro.length
        : (body.topic ? 1 : 0),
      hasEnv: { key: !!OMIE_APP_KEY, secret: !!OMIE_APP_SECRET },
      failures,
    };
  }

  return res.json(resp);
});

// ============================================================================
// POST /api/produtos/debug/broadcast
// Permite testar o SSE sem passar pela Omie
// Body: { ids: [104..., ...] }
// ============================================================================
router.post('/debug/broadcast', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const sse = req.app.get('sseBroadcast');
    if (typeof sse === 'function') {
      sse({ type: 'produtos_updated', ids, at: Date.now() });
    }
    res.json({ ok: true, sent: ids });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

module.exports = router;
