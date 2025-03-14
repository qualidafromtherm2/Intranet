// routes/excluirCaracteristica.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.js');


router.post('/', async (req, res) => {
  const { cCodIntProd, cCodIntCaract } = req.body;
  const payload = {
    call: "ExcluirCaractProduto",
    param: [{
      cCodIntProd,
      cCodIntCaract
    }],
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET
  };
  
  console.log("Payload para exclusão:", JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(
      'https://app.omie.com.br/api/v1/geral/prodcaract/',
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    console.log("Resposta da Omie:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error("Erro ao excluir característica:", error.message);
    if (error.response && error.response.data) {
      console.error("Detalhes do erro:", error.response.data);
      res.status(500).json({ error: error.response.data });
    } else {
      res.status(500).json({ error: 'Erro ao excluir característica na Omie' });
    }
  }
});

module.exports = router;
