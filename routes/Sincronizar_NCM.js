const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config');

// Define o diretório e o caminho do arquivo CSV na pasta "csv"
const csvDir = path.join(__dirname, '../csv');
if (!fs.existsSync(csvDir)) {
  fs.mkdirSync(csvDir, { recursive: true });
}
const filePath = path.join(csvDir, 'ListarNCM.csv');

// Endpoint para sincronizar NCM
router.post('/', async (req, res) => {
  // Cria ou limpa o arquivo CSV
  try {
    fs.writeFileSync(filePath, '');
  } catch (err) {
    console.error('Erro ao limpar arquivo CSV:', err);
    return res.status(500).json({ success: false, error: 'Erro ao limpar arquivo CSV.' });
  }

  const totalPages = 280;
  const regPorPagina = 50;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  try {
    for (let page = 1; page <= totalPages; page++) {
      // Aguarda aproximadamente 333ms entre requisições (para ~3 por segundo)
      if (page > 1) await delay(333);

      const bodyData = {
        call: "ListarNCM",
        param: [{ nPagina: page, nRegPorPagina: regPorPagina }],
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET
      };

      const response = await fetch('https://app.omie.com.br/api/v1/produtos/ncm/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });
      const data = await response.json();

      if (data.listaNCM && Array.isArray(data.listaNCM)) {
        data.listaNCM.forEach(item => {
          // Extrai as colunas cCodigo e cDescricao
          const line = `${item.cCodigo},${item.cDescricao}\n`;
          fs.appendFileSync(filePath, line);
        });
      } else {
        console.error(`Resposta inválida na página ${page}:`, data);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Erro na sincronização NCM:', err);
    res.status(500).json({ success: false, error: 'Erro na sincronização NCM.' });
  }
});

module.exports = router;
