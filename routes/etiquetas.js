// routes/etiquetas.js  (CommonJS)
const express = require('express');
const fs      = require('fs');
const path    = require('path');

const router = express.Router();
const etiquetasDir = path.join(__dirname, '..', 'etiquetas', 'printed');

// GET /api/etiquetas  →  devolve array de .zpl
router.get('/', (req, res) => {
  fs.readdir(etiquetasDir, (err, files) => {
    if (err) {
      console.error('[etiquetas] erro ao ler pasta:', err);
      return res.status(500).json({ error: 'Falha ao listar etiquetas' });
    }
    const lista = files.filter(f => f.endsWith('.zpl'));
    res.json(lista);
  });
});

module.exports = router;
