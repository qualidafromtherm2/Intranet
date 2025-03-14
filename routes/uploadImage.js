// routes/uploadImage.js
const express = require('express');
const router = express.Router();
const axios = require('axios');

// Atenção: armazene seu token de acesso de forma segura (por exemplo, em variáveis de ambiente)
const REPO_OWNER = 'qualidafromtherm2';
const REPO_NAME = 'Intranet_Fromtherm';
const FILE_PATH = 'img/Produto/';

router.post('/', async (req, res) => {
  const { fileName, content } = req.body;
  if (!fileName || !content) {
    return res.status(400).json({ success: false, error: "Parâmetros ausentes." });
  }
  const fullPath = FILE_PATH + fileName;
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${fullPath}`;
  
  let sha = null;
  // Verifica se o arquivo já existe (para atualizar)
  try {
    const getRes = await axios.get(url, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    sha = getRes.data.sha;
  } catch (err) {
    // Se não encontrar, prossegue para criar o arquivo
  }
  
  const payload = {
    message: sha ? "Atualizando imagem do produto" : "Adicionando imagem do produto",
    content: content,
    branch: "master" // Alterado para master
  };
  if (sha) {
    payload.sha = sha;
  }
  
  try {
    await axios.put(url, payload, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    // Gera a URL raw para a imagem
    const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master/${fullPath}`;

    res.json({ success: true, url: rawUrl });
  } catch (error) {
    console.error("Erro ao fazer upload no GitHub:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: "Erro ao fazer upload no GitHub" });
  }
});

module.exports = router;
