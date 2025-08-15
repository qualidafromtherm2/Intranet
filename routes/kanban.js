// routes/kanban.js
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const fetch   = require('node-fetch');        // se Node < 18
const router  = express.Router();

const DATA    = path.join(__dirname, '..', 'data', 'kanban.json');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.server.js');
// === BASE URL DA OMIE ===
const OMIE_API = 'https://app.omie.com.br/api/v1';



// --- utilitário: tenta até N vezes com back-off simples -----------------
async function fetchRetry(url, opts = {}, tentativas = 3, ms = 1500) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, opts);
      // se não for timeout ou 5xx, retorna logo
      if (r.status < 500 || r.status >= 600) return r;
      // 502, 503, 504 continuam para o catch abaixo
      throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      if (i === tentativas - 1) throw err;      // acabou a cota
      await new Promise(res => setTimeout(res, ms)); // espera e tenta de novo
    }
  }
}

/* utilidades */
function readJSON()  { try { return JSON.parse(fs.readFileSync(DATA)); } catch { return []; } }
function writeJSON(d){ fs.writeFileSync(DATA, JSON.stringify(d, null, 2)); }

// devolve o cache cru
router.get('/', (_req, res) => {
  res.json(readJSON());
});

// sobrescreve o cache com o que vier do cliente
router.post('/', express.json(), (req, res) => {
  writeJSON(req.body);
  res.json({ ok: true });
});


/* ——— GET /api/kanban/data ———  devolve o cache cru */
router.get('/data', (_req, res) => res.json(readJSON()));

/* ——— GET /api/kanban/sync ———  (re)sincroniza e devolve o novo JSON */
router.get('/sync', async (_req, res) => {
  try {
        if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
      return res.status(500).json({
        error: 'OMIE_APP_KEY/OMIE_APP_SECRET ausentes no servidor.'
      });
    }

    /* 1) baixa pedidos (mesmo filtro que usa no front) */
    const resp = await fetchRetry(`${OMIE_API}/produtos/pedido/`, {



        
      method : 'POST',
      headers: { 'Content-Type':'application/json' },
      body   : JSON.stringify({
        call : 'ListarPedidos',
        param: [{ pagina:1, registros_por_pagina:100, etapa:'80', apenas_importado_api:'N' }],
        app_key   : OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET
      })
    });

    // ─── valida se veio JSON ─────────────────────────────
if (!resp.ok || !resp.headers.get('content-type')?.includes('json')) {
  const ct   = resp.headers.get('content-type');
  const body = await resp.text();
  console.error('[KANBAN /sync] Omie NÃO-JSON',
                'status=', resp.status, 'ct=', ct,
                'trecho=', body.slice(0, 200));
  return res.status(502).json({ error: 'omie_non_json', status: resp.status, ct });
}
// ─── fim do guard ───────────────────────────────────

const apiJson = await resp.json();

const todos = Array.isArray(apiJson.pedido_venda_produto)
  ? apiJson.pedido_venda_produto
  : [];

// 🔒 garante só etapa 80 (Aprovado)
const pedidos = todos.filter(p => String(p?.cabecalho?.etapa) === '80');


/* 2) RECONSTRÓI do zero (sem cache antigo) */
const idx     = {};
const result  = [];

/* 3) percorre todos os itens de todos os pedidos */
for (const p of pedidos) {
  for (const item of (Array.isArray(p.det) ? p.det : [])) {
    const key    = `${p.cabecalho.numero_pedido}-${item.produto.codigo}`;
    const qtd    = item.produto.quantidade || 1;
    const hojeBR = new Date().toLocaleDateString('pt-BR'); // 29/05/2025

    const rec = idx[key] || {
      pedido       : p.cabecalho.numero_pedido,
      codigo       : item.produto.codigo,
      quantidade   : qtd,
      local_Estoque: [],
      Obs          : [],
      Estoque      : 0
    };
    if (qtd > rec.quantidade) rec.quantidade = qtd;

    if (!idx[key]) {
      result.push(rec);
      idx[key] = rec;
    }

    // (opcional) estoque físico — mantém sua lógica existente
    if (rec.Estoque === 0) {
      const estResp = await fetchRetry(`${OMIE_API}/estoque/consulta/`, {
        method : 'POST',
        headers: { 'Content-Type':'application/json' },
        body   : JSON.stringify({
          call : 'ObterEstoqueProduto',
          param: [{ nIdProduto: item.produto.codigo_produto, dDia: hojeBR }],
          app_key   : OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET
        })
      });
      if (estResp.ok && estResp.headers.get('content-type')?.includes('json')) {
        const estJson = await estResp.json();
        rec.Estoque   = estJson.listaEstoque?.[0]?.fisico ?? 0;
      }
    }
  }
}

/* 4) devolve apenas o snapshot atual (sem gravar cache) */
return res.json(result);

  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
  console.error('KANBAN SYNC ERROR', err.message);
}
    res.status(500).json({ error:'sync_failed' });
  }
});

module.exports = router;
