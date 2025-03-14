// routes/incluirCaracteristica.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config');


router.post('/', async (req, res) => {
  const payload = {
    call: "IncluirCaracteristica",
    param: req.body.param, // Espera um array com o objeto de característica
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET
  };

  
  try {
    const response = await axios.post(
      'https://app.omie.com.br/api/v1/geral/caracteristicas/',
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    res.json(response.data);
  } catch (error) {
    console.error("Erro ao incluir característica:", error.message);
    res.status(500).json({ error: 'Erro ao incluir característica na Omie' });
  }
});

module.exports = router;
