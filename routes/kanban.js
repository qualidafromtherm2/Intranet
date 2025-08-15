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


module.exports = router;
