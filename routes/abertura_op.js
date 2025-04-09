// routes/abertura_op.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config');

router.post('/listar-pedidos', async (req, res) => {
  // Leia a etapa enviada pelo front-end (ex.: '10' ou '20')
  const etapa = req.body.etapa || '20';

  const payload = {
    call: 'ListarPedidos',
    param: [{
      pagina: 1,
      registros_por_pagina: 100,
      etapa: etapa,
      apenas_importado_api: 'N'
    }],
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET
  };

  try {
    const response = await axios.post(
      'https://app.omie.com.br/api/v1/produtos/pedido/',
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    res.json(response.data);
  } catch (error) {
    console.error("Erro na requisição à Omie:", error.message);
    res.status(500).json({ error: 'Erro na requisição à Omie' });
  }
});


module.exports = router;




