const axios = require('axios');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config');

exports.pesquisarFamilias = async (req, res) => {
    const payload = {
      call: "PesquisarFamilias",
      param: [{ pagina: 1, registros_por_pagina: 50 }],
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };
  
    try {
      const response = await axios.post(
        'https://app.omie.com.br/api/v1/geral/familias/',
        payload,
        { headers: { 'Content-Type': 'application/json' } }
      );
      console.log("Resposta da API Omie para famílias:", response.data);
      res.json(response.data);
    } catch (error) {
      console.error("Erro ao pesquisar famílias:", error.message);
      res.status(500).json({ error: "Erro ao pesquisar famílias" });
    }
};