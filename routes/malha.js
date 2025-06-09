// routes/malha.js   (versão CommonJS)
const express  = require('express');
const omieCall = require('../utils/omieCall');   // se precisar

const router = express.Router();

/* exemplo de rota: consultar estrutura -------------------------------- */
router.post('/consultar', async (req, res) => {
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/geral/malha/',
      {
        call      : 'ConsultarEstrutura',
        app_key   : process.env.OMIE_APP_KEY,
        app_secret: process.env.OMIE_APP_SECRET,
        param     : [ { intProduto: req.body.intProduto } ]
      }
    );
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/* idem para /alterar, se existir */

module.exports = router;
