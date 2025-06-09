// routes/malhaConsultar.js
const express = require('express');
const router  = express.Router();
const estrutura = require('./helpers/malhaEstrutura');

/* Espera body = { intProduto: 'FT20B35T' }                      */
/* Responde 200 { ident, itens, … }  ou  { notFound:true }       */
router.post('/', async (req, res) => {
  try {
    const codigo = req.body.intProduto;
    if (!codigo) return res.status(400).json({ error:'intProduto vazio' });

    const json = await estrutura(codigo);
    if (json === null) return res.json({ notFound:true });
    res.json(json);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
