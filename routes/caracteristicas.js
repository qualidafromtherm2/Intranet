// routes/caracteristicas.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config');


// Esse endpoint atua como proxy para a API de Listar Características da Omie
router.post('/', async (req, res) => {
  const payload = {
    call: "ListarCaracteristicas",
    param: [{ nPagina: 1, nRegPorPagina: 50 }],
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
    console.error("Erro na requisição de características:", error.message);
    res.status(500).json({ error: 'Erro na requisição de características' });
  }
});

module.exports = router;
