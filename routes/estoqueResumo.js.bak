// routes/estoqueResumo.js
const express = require('express');
const fetch   = require('node-fetch');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.server');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { call, param } = req.body;
    const omieRes = await fetch(
      'https://app.omie.com.br/api/v1/estoque/resumo/',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          call,
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param
        })
      }
    );

    const text = await omieRes.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error('Resposta do OMIE não é JSON:', text);
      return res.status(502).json({ error: 'Resposta inválida do OMIE' });
    }

    return res.status(omieRes.ok ? 200 : 502).json(json);
  } catch (err) {
    console.error('Erro no proxy estoqueResumo:', err);
    return res.status(500).json({ error: 'Falha no proxy estoqueResumo' });
  }
});

module.exports = router;
