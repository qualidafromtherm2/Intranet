// intranet/routes/produtos.js
const express  = require('express');
const router   = express.Router();
const { dbQuery } = require('../src/db');

// === Config Omie (para fallback ConsultarProduto) ============================
const OMIE_WEBHOOK_TOKEN = process.env.OMIE_WEBHOOK_TOKEN || '';
const OMIE_APP_KEY       = process.env.OMIE_APP_KEY || '';
const OMIE_APP_SECRET    = process.env.OMIE_APP_SECRET || '';
const OMIE_PROD_URL      = 'https://app.omie.com.br/api/v1/geral/produtos/';
// Ctrl+F: require('express')  (cole logo abaixo dos requires)
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || 'changeme';
const INTERNAL_BASE = `http://localhost:${process.env.PORT || 5001}`;

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

// GET /api/produtos/detalhe?codigo=FTI55DPTBR
// Retorna os campos para preencher a guia "Dados do produto" direto do Postgres.
// Fontes: public.produtos_omie + public.produtos_omie_imagens
router.get('/detalhe', async (req, res) => {
  try {
    const codigo = String(req.query?.codigo || '').trim();
    if (!codigo) {
      return res.status(400).json({ error: 'Parâmetro ?codigo é obrigatório.' });
    }

    // 1) Busca o produto na tabela principal
    const sql = `
      SELECT
        p.codigo_produto,
        p.codigo,
        p.descricao,
        p.descricao_familia,
        p.unidade,
        p.tipoitem,
        p.ncm,
        p.cfop,
        p.origem_mercadoria,
        p.cest,
        p.aliquota_ibpt,
        p.marca,
        p.modelo,
        p.descr_detalhada,
        p.obs_internas,
        p.visivel_principal,
        p.tipo_compra,
        p.inativo,
        p.bloqueado,
        p.bloquear_exclusao,
        p.quantidade_estoque,
        p.valor_unitario,
        p.preco_definido,
        p.dalt, p.halt, p.dinc, p.hinc, p.ualt, p.uinc,
        p.codigo_familia,
        p.codint_familia
      FROM public.produtos_omie p
      WHERE p.codigo = $1
      LIMIT 1;
    `;
    const { rows } = await dbQuery(sql, [codigo]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado no Postgres.' });
    }
    const r = rows[0];

    // 2) Busca imagens (se houverem)
    const imgSql = `
      SELECT url_imagem, pos
      FROM public.produtos_omie_imagens
      WHERE codigo_produto = $1
      ORDER BY pos ASC
    `;
    const { rows: imgs } = await dbQuery(imgSql, [r.codigo_produto]);
    const imagens = (imgs || []).map(i => ({
      url_imagem: i.url_imagem,
      pos: i.pos
    }));

    // 3) Normaliza o payload para o front (mantendo chaves esperadas)
    const payload = {
      codigo_produto: r.codigo_produto,
      codigo:         r.codigo,
      descricao:      r.descricao,

      // — Detalhes do produto —
      descricao_familia: r.descricao_familia,
      unidade:           r.unidade,
      tipoItem:          r.tipoitem,                // (mantemos camelCase que o front já usa)
      marca:             r.marca,
      modelo:            r.modelo,
      descr_detalhada:   r.descr_detalhada,
      obs_internas:      r.obs_internas,
      visivel_principal: r.visivel_principal,
      tipo_compra:       r.tipo_compra,

      // — Cadastro —
      bloqueado:          r.bloqueado,
      bloquear_exclusao:  r.bloquear_exclusao,
      inativo:            r.inativo,
      codigo_familia:     r.codigo_familia,
      codInt_familia:     r.codint_familia,

      // — Financeiro —
      ncm:             r.ncm,
      cfop:            r.cfop,
      origem_imposto:  r.origem_mercadoria,        // mapeado p/ chave já usada no front
      cest:            r.cest,
      aliquota_ibpt:   r.aliquota_ibpt,

      // — Outras infos úteis ao banner e editors —
      quantidade_estoque: r.quantidade_estoque,
      valor_unitario:     r.valor_unitario,
      preco_definido:     r.preco_definido,
      info: {
        uAlt: r.ualt, dAlt: r.dalt, hAlt: r.halt,
        uInc: r.uinc, dInc: r.dinc, hInc: r.hinc
      },
      imagens
    };

    // evita cache
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache'); res.set('Expires', '0'); res.set('Surrogate-Control', 'no-store');

    return res.json(payload);
  } catch (err) {
    console.error('[produtos/detalhe] erro →', err);
    return res.status(500).json({ error: 'Falha ao consultar detalhes do produto (SQL).' });
  }
});

// ============================================================================
// POST /api/produtos/locais
// Atualiza campos que existem só no Postgres (não enviados à Omie).
// Espera body: { codigo, visivel_principal, tipo_compra }
// ============================================================================
router.post('/locais', async (req, res) => {
  try {
    const codigo = String(req.body?.codigo || '').trim();
    if (!codigo) return res.status(400).json({ error: 'codigo é obrigatório' });

      const setClauses = [];
      const values = [codigo];

      // Normaliza visivel_principal para boolean ou null (só aplica se veio no body)
      if (req.body.hasOwnProperty('visivel_principal')) {
        const vpRaw = req.body?.visivel_principal;
        const vpNorm =
          vpRaw === true || String(vpRaw).trim().toUpperCase() === 'S' || String(vpRaw).trim().toUpperCase() === 'SIM'
            ? true
            : (vpRaw === false || String(vpRaw).trim().toUpperCase() === 'N' || String(vpRaw).trim().toUpperCase() === 'NAO' || String(vpRaw).trim().toUpperCase() === 'NÃO'
                ? false
                : null);
        setClauses.push(`visivel_principal = $${values.length + 1}`);
        values.push(vpNorm);
      }

      // Normaliza tipo_compra para valores conhecidos ou null (só aplica se veio no body)
      if (req.body.hasOwnProperty('tipo_compra')) {
        const tipoRaw = String(req.body?.tipo_compra || '').trim().toUpperCase();
        const tipoAllowed = new Set(['AUTOMATICA', 'SEMIAUTOMATICA', 'MANUAL']);
        const tipoNorm = tipoAllowed.has(tipoRaw) ? tipoRaw : null;
        setClauses.push(`tipo_compra = $${values.length + 1}`);
        values.push(tipoNorm);
      }

      // Normaliza preco_definido (moeda) para numeric ou null (só aplica se veio no body)
      if (req.body.hasOwnProperty('preco_definido')) {
        const precoRaw = req.body?.preco_definido;
        const num = Number(String(precoRaw).replace(',', '.'));
        const precoNorm = Number.isFinite(num) ? num : null;
        setClauses.push(`preco_definido = $${values.length + 1}`);
        values.push(precoNorm);
      }

      if (!setClauses.length) {
        return res.status(400).json({ error: 'Nenhum campo enviado para atualização.' });
      }

      setClauses.push("ualt = COALESCE(ualt, 'portal')");
      setClauses.push('dalt = COALESCE(dalt, NOW()::date)');
      setClauses.push('halt = COALESCE(halt, NOW()::time)');

      const { rows } = await dbQuery(
        `UPDATE public.produtos_omie
           SET ${setClauses.join(', ')}
         WHERE codigo = $1
         RETURNING codigo_produto, visivel_principal, tipo_compra;`,
        values
      );

    if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado no Postgres.' });

    res.json({
      ok: true,
      codigo_produto: rows[0].codigo_produto,
      visivel_principal: rows[0].visivel_principal,
      tipo_compra: rows[0].tipo_compra
    });
  } catch (err) {
    console.error('[produtos/locais] erro →', err);
    res.status(500).json({ error: 'Falha ao atualizar campos locais.' });
  }
});

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

  // dispara re-sync da ESTRUTURA (fire-and-forget)
async function fireAndForgetResyncById(idProduto) {
  if (!idProduto) return;
  const url = `${INTERNAL_BASE}/internal/pcp/estrutura/resync?token=${encodeURIComponent(INTERNAL_TOKEN)}`;
  const body = JSON.stringify({ id_produto: Number(idProduto) });
  try {
    httpFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    }).catch(() => {});
  } catch (_) {}
}


  async function upsertNoBanco(item, label = 'raw') {
    try {
      const obj = ensureIntegrationKey({ ...item });
      await dbQuery('SELECT omie_upsert_produto($1::jsonb)', [obj]);

const cod = Number(obj.codigo_produto || obj.codigo);
if (!Number.isNaN(cod)) {
  touchedIds.add(cod);

  // não mexe na estrutura quando o evento for Produto.Excluido
  if ((req.body?.topic || '') !== 'Produto.Excluido') {
    fireAndForgetResyncById(cod);
  }
}


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
      fireAndForgetResyncById(produto?.codigo_produto || produto?.codigo);

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

// ============================================================================
// GET /api/produtos/familias - Lista famílias da tabela configuracoes.familia
// ============================================================================
router.get('/familias', async (req, res) => {
  try {
    const result = await dbQuery('SELECT id, codigo, nome_familia FROM configuracoes.familia ORDER BY nome_familia');
    res.json(result.rows || []);
  } catch (e) {
    console.error('[GET /api/produtos/familias]', e);
    res.status(500).json({ error: 'Erro ao buscar famílias' });
  }
});

module.exports = router;
