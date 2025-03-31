// routes/familias.js
const express = require('express');
const router = express.Router();
const familiasController = require('../controllers/familiasController');

router.post('/', familiasController.pesquisarFamilias);

module.exports = router;
