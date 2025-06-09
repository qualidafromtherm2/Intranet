// routes/estoque.js




const express = require('express');
const { axiosPostWithRetry } = require('../utils/axiosRetry');
const {
  OMIE_APP_KEY,
  OMIE_APP_SECRET
} = require('../config.server');
const fetch   = require('node-fetch');
const router = express.Router();
const OMIE_URL = 'https://app.omie.com.br/api/v1/estoque/consulta/';

/* ------------------------------------------------------------------ */
/*  /api/omie/estoque/pagina                                          */
/* ------------------------------------------------------------------ */
router.post('/pagina', async (req, res) => {
  try {
    const { call, param } = req.body;         // pega só o necessário

    const payload = {
      call,
      param,
      app_key   : OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };

    const { data } = await axiosPostWithRetry(
      OMIE_URL,
      payload,
      {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    return res.json(data);
  } catch (err) {
    /* log detalhado */
    const fault = err.response?.data || err.message;
    console.error('[Estoque/pagina] erro →', fault);
    return res.status(500).json({ error: 'Falha ao consultar posição de estoque (página)' });
  }
});

/* ------------------------------------------------------------------ */
/*  /api/omie/estoque/posicao                                         */
/* ------------------------------------------------------------------ */
router.post('/posicao', async (req, res) => {
  try {
    const {
      dDataPosicao         = '30/04/2025',
      nRegPorPagina        = 50,
      cExibeTodos          = 'S',
      codigo_local_estoque = 0
    } = req.body.param?.[0] || {};

    /* página 1 */
    const firstPayload = {
      call: 'ListarPosEstoque',
      param: [{
        nPagina: 1,
        nRegPorPagina,
        dDataPosicao,
        cExibeTodos,
        codigo_local_estoque
      }],
      app_key:    OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };

    const { data: first } = await axiosPostWithRetry(
      OMIE_URL,
      firstPayload,
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );

    const produtos = [...first.produtos];
    const totalPag = first.nTotPaginas;

    /* páginas 2..N */
    for (let pg = 2; pg <= totalPag; pg++) {
      const payload = {
        ...firstPayload,
        param: [{
          nPagina: pg,
          nRegPorPagina,
          dDataPosicao,
          cExibeTodos,
          codigo_local_estoque
        }]
      };

      const { data } = await axiosPostWithRetry(
        OMIE_URL,
        payload,
        { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
      );

      produtos.push(...data.produtos);
    }

    return res.json({
      dDataPosicao,
      nTotRegistros: produtos.length,
      produtos
    });
  } catch (err) {
    console.error('[Estoque/posicao] erro →', err.response?.data || err.message);
    return res.status(500).json({ error: 'Falha ao consultar posição de estoque' });
  }
});

// Rota de Ajuste de Estoque Mínimo
router.post('/ajuste', async (req, res) => {
  try {
    const payload = {
      call:      'AlterarEstoqueMinimo',
      app_key:   OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param:     req.body.param   // espera [{ cod_int, quan_min }]
    };

    const resp = await fetch(
      'https://app.omie.com.br/api/v1/estoque/ajuste/',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
      }
    );

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json(data);
    }
    res.json(data);

  } catch (err) {
    console.error('Erro na rota /api/omie/estoque/ajuste', err);
    res
      .status(500)
      .json({ error: 'Falha interna ao ajustar estoque mínimo' });
  }
});

module.exports = router;
