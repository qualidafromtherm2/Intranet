// requisicoes_omie/produtos.js

import express from 'express';
import fetch from 'node-fetch';             // ou axios, se preferir
import config from '../config.server.js';   // com OMIE_APP_KEY e OMIE_APP_SECRET
const router = express.Router();

router.post('/omie/resumido', async (req, res) => {
  const { descricao } = req.body;
  const payload = {
    call: 'ListarProdutosResumido',
    param: [{
      pagina: 1,
      registros_por_pagina: 50,
      filtrar_apenas_descricao: `%${descricao}%`,
      apenas_importado_api: 'N',
      filtrar_apenas_omiepdv: 'N'
    }],
    app_key: config.OMIE_APP_KEY,
    app_secret: config.OMIE_APP_SECRET
  };

  try {
    const omieRes = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await omieRes.json();
    return res.json(data);
  } catch (error) {
    console.error('[produtos/omie/resumido]', error);
    return res.status(500).json({ error: 'Erro ao buscar produtos OMIE' });
  }
});



export default router;
