// routes/login_omie.js

const express = require('express');
const { axiosPostWithRetry } = require('../utils/axiosRetry');
const {
  OMIE_APP_KEY,
  OMIE_APP_SECRET
} = require('../config.server');

const router = express.Router();
const OMIE_CRM_URL = 'https://app.omie.com.br/api/v1/crm/contatos/';

 /**
  * POST /api/omie/login/contatos
  * Body esperado opcionalmente: 
  *   { pagina: <número>, registros_por_pagina: <número> }
  */
// routes/login_omie.js :contentReference[oaicite:0]{index=0}:contentReference[oaicite:1]{index=1}

router.post('/contatos', async (req, res) => {
  try {
    // parâmetros padrão — acrescente exibir_obs aqui:
    const {
      pagina              = 1,
      registros_por_pagina = 50,
      // você pode permitir que o cliente envie esse valor, ou fixar sempre 'S'
      exibir_obs           = 'S'
    } = req.body;

    const payload = {
      call: 'ListarContatos',
      param: [{
        pagina,
        registros_por_pagina,
        exibir_obs            // <-- aqui!
      }],
      app_key:    OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };

    const { data } = await axiosPostWithRetry(
      OMIE_CRM_URL,
      payload,
      {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    return res.json(data);
  } catch (err) {
    console.error('[login_omie/contatos] erro →', err.response?.data || err.message);
    return res.status(500).json({ error: 'Falha ao listar contatos via OMIE' });
  }
});


module.exports = router;
