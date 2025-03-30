const express = require('express');
const fs = require('fs');
const papa = require('papaparse');
const path = require('path');

const app = express();
app.use(express.json());

// Endpoint para atualizar a coluna Permissoes no CSV
app.post('/api/login/atualizar-permissoes', (req, res) => {
  const { user, permissoes } = req.body;
  if (!user) {
    return res.status(400).json({ success: false, message: 'Usuário é obrigatório.' });
  }
  
  // Caminho para o CSV (ajuste conforme necessário)
  const csvPath = path.join(__dirname, '..', 'csv', 'Login.csv');
  
  // Lê o CSV
  fs.readFile(csvPath, 'utf8', (err, csvData) => {
    if (err) {
      console.error("Erro ao ler o CSV:", err);
      return res.status(500).json({ success: false, message: 'Erro ao ler o CSV.' });
    }
    
    // Faz o parse do CSV considerando a primeira linha como cabeçalho
    const parsed = papa.parse(csvData, { header: true, skipEmptyLines: true });
    let rows = parsed.data;
    let userFound = false;
    
    // Atualiza a coluna Permissoes para o usuário selecionado
    rows = rows.map(row => {
      if (row.User === user) {
        row.Permissoes = Array.isArray(permissoes) ? permissoes.join(';') : "";
        userFound = true;
      }
      return row;
    });
    
    if (!userFound) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }
    
    // Converte os dados atualizados de volta para CSV
    const updatedCSV = papa.unparse(rows);
    
    // Escreve o CSV atualizado no mesmo arquivo
    fs.writeFile(csvPath, updatedCSV, 'utf8', (err) => {
      if (err) {
        console.error("Erro ao salvar o CSV:", err);
        return res.status(500).json({ success: false, message: 'Erro ao salvar o CSV.' });
      }
      return res.json({ success: true });
    });
  });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
