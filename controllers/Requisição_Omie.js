// controllers/Requisição_Omie.js
const fetch = require('node-fetch');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config');
module.exports.fetchTotalProdutos = fetchTotalProdutos;


module.exports.incluirProduto = async (req, res) => {
  const payload = req.body;  
  // Adiciona as credenciais obtidas do config
  payload.app_key = OMIE_APP_KEY;
  payload.app_secret = OMIE_APP_SECRET;

  console.log("Payload recebido no endpoint:", JSON.stringify(payload, null, 2));

  try {
    const response = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Erro na requisição para a Omie:", error);
    res.status(500).json({ error: "Erro interno ao incluir produto" });
  }
};


async function fetchTotalProdutos() {
    const payload = {
      call: "ListarProdutosResumido",
      param: [{
        pagina: 1,
        registros_por_pagina: 50,
        apenas_importado_api: "N",
        filtrar_apenas_omiepdv: "N"
      }]
    };
  
    // Injeta as credenciais conforme seu projeto
    payload.app_key = OMIE_APP_KEY;
    payload.app_secret = OMIE_APP_SECRET;
  
    try {
      const response = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      return data.total_de_registros;
    } catch (error) {
      console.error("Erro ao buscar total de produtos:", error);
      return null;
    }
  }
  