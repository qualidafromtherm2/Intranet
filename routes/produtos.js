// intranet/routes/produtos.js
const express = require('express');
const { dbQuery } = require('../src/db');

const router = express.Router();

// --- SSE (Server-Sent Events) ---
const sseClients = new Set();

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


// POST /api/produtos/webhook  → recebe eventos da Omie
router.post('/webhook', async (req, res) => {
    console.log('[webhook] expected=', process.env.OMIE_WEBHOOK_TOKEN, ' header=', req.get('X-Omie-Token'), ' query=', req.query.token);

  try {
    const tokenHeader = req.get('X-Omie-Token');
    const tokenQuery  = req.query.token;
    const expected    = process.env.OMIE_WEBHOOK_TOKEN || '';

    if (!expected || (tokenHeader !== expected && tokenQuery !== expected)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const body = req.body || {};
    let processed = 0;

    // aceita um item único ou um array na chave produto_servico_cadastro
    const items = Array.isArray(body.produto_servico_cadastro)
      ? body.produto_servico_cadastro
      : (body.produto_servico_cadastro ? [body.produto_servico_cadastro] : []);

    for (const item of items) {
      await dbQuery('SELECT omie_upsert_produto($1::jsonb)', [item]);
      processed++;
    }

    // Notifica os clientes conectados para recarregar a lista
if (processed > 0) {
  sseBroadcast({ type: 'refresh_all' });
}

    return res.json({ ok: true, processed });
  } catch (err) {
    console.error('[webhook/omie] erro →', err);
    return res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
