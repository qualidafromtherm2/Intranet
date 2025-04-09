// routes/produtos.js
const express = require('express');
const router = express.Router();
const produtosController = require('../controllers/produtosController');

router.get('/generate-csv', produtosController.generateCsv);
router.get('/detalhes/:codigo', produtosController.detalhes);
router.post('/alterar', produtosController.alterar);
router.post('/estoque', produtosController.estoque);

// NOVA ROTA para alterar o CSV local
router.post('/alterarNoCSV', produtosController.alterarNoCSV);

module.exports = router;
