// routes/prodcaract.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.js');


router.post('/', async (req, res) => {
  const payload = {
    call: req.body.call || "IncluirCaractProduto",
    param: req.body.param,
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET
  };



  
  console.log("========================================");
  console.log("Iniciando chamada:", payload.call);
  console.log("Payload enviado para Omie:", JSON.stringify(payload, null, 2));
  console.log("========================================");

  try {
    const response = await axios.post(
      'https://app.omie.com.br/api/v1/geral/prodcaract/',
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    console.log("========================================");
    console.log(`Resposta da Omie para ${payload.call}:`, JSON.stringify(response.data, null, 2));
    console.log("========================================");
    return res.json(response.data);
  } catch (error) {
    console.log("========================================");
    console.log("Erro na chamada para", payload.call);
    console.log("Mensagem do erro:", error.message);
    if (error.response && error.response.data) {
      console.log("Detalhes do erro:", JSON.stringify(error.response.data, null, 2));
      console.log("========================================");
      return res.status(500).json({ error: error.response.data });
    } else {
      console.log("Erro:", error);
      console.log("========================================");
      return res.status(500).json({ error: error.message });
    }
  }
});

module.exports = router;
