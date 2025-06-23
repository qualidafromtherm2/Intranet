// routes/kanban.js
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const fetch   = require('node-fetch');        // se Node < 18
const router  = express.Router();

const DATA    = path.join(__dirname, '..', 'data', 'kanban.json');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.server.js');
// === BASE URL DA OMIE ===
const OMIE_API = 'https://api.omie.com.br/api/v1';


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
    /* 1) baixa pedidos (mesmo filtro que usa no front) */
    const resp = await fetchRetry(`${OMIE_API}/geral/pedidovenda/`, {


        
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
  const text = await resp.text();                 // Omie devolveu HTML
  console.error('Omie respondeu:', text.slice(0, 200));
  throw new Error('Resposta não-JSON da Omie');
}
// ─── fim do guard ───────────────────────────────────

    const apiJson  = await resp.json();
    const pedidos  = apiJson.pedido_venda_produto || [];

    /* 2) carrega cache atual em memória */
    const cache = readJSON();

    /* 3) índice p/ achar rápido (pedido+codigo) */
    const idx = {};
    cache.forEach(rec => idx[`${rec.pedido}-${rec.codigo}`] = rec);

    /* 4) percorre todos os itens de todos os pedidos */
    for (const p of pedidos) {
      for (const item of p.det) {
        const key  = `${p.cabecalho.numero_pedido}-${item.produto.codigo}`;
        const qtd  = item.produto.quantidade || 1;
        const hojeBR = new Date().toLocaleDateString('pt-BR'); // 29/05/2025
        const rec  = idx[key] || {
          pedido     : p.cabecalho.numero_pedido,
          codigo     : item.produto.codigo,
          quantidade : qtd,
          local_Estoque: [],
          Obs        : [],
          Estoque    : 0
        };
        /* ajusta quantidade se aumentou na Omie */
        if (qtd > rec.quantidade) rec.quantidade = qtd;

        /* se é novo, joga no cache & índice */
        if (!idx[key]) {
          cache.push(rec);
          idx[key] = rec;
        }

        /* 5) (opcional) traz estoque físico — somente se ainda = 0 */
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

 // ----------- valida se veio JSON -----------
 if (!estResp.ok || !estResp.headers.get('content-type')?.includes('json')) {
   const txt = await estResp.text();
   console.error('Estoque respondeu:', txt.slice(0, 200));
   throw new Error('Resposta não-JSON (estoque)');
 }

 const estJson = await estResp.json();
 const fisico  = estJson.listaEstoque?.[0]?.fisico ?? 0;
 rec.Estoque   = fisico;
        }
      }
    }

    /* 6) persiste */
    writeJSON(cache);
    res.json(cache);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
  console.error('KANBAN SYNC ERROR', err.message);
}
    res.status(500).json({ error:'sync_failed' });
  }
});

module.exports = router;
