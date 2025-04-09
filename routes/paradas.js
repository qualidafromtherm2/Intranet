// Exemplo em routes/paradas.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

function csvSafeField(value) {
  value = String(value);
  const safeVal = value.replace(/"/g, '""');
  return `"${safeVal}"`;
}

// Endpoint para inserir um registro no Paradas.csv
router.post('/inserir', (req, res) => {
  const { Data, Local, status, OP, parada, motivo, h_inicio, h_fim, observação } = req.body;
  if (!Data || !Local || !status || !OP || !parada || !motivo || !h_inicio) {
    return res.status(400).json({ error: 'Dados insuficientes para inserir o registro.' });
  }
  const filePath = path.join(__dirname, '../csv/Paradas.csv');
  let csvContent = "";
  const header = "Data,Local,status,OP,parada,motivo,h_inicio,h_fim,observação\n";
  if (!fs.existsSync(filePath)) {
    csvContent += header;
  } else {
    const existingContent = fs.readFileSync(filePath, 'utf8');
    if (!existingContent.endsWith('\n')) {
      csvContent += "\n";
    }
  }
  
  csvContent += `${csvSafeField(Data)},${csvSafeField(Local)},${csvSafeField(status)},${csvSafeField(OP)},${csvSafeField(parada)},${csvSafeField(motivo)},${csvSafeField(h_inicio)},${csvSafeField(h_fim || "")},${csvSafeField(observação || "")}\n`;
  
  fs.appendFile(filePath, csvContent, (err) => {
    if (err) {
      console.error("Erro ao salvar Paradas.csv:", err);
      return res.status(500).json({ error: 'Erro ao salvar o registro no CSV.' });
    }
    return res.json({ success: true });
  });
});

// Endpoint para atualizar o campo h_fim em Paradas.csv
router.post('/atualizar-hfim', (req, res) => {
  const { OP, h_fim } = req.body;
  if (!OP || !h_fim) {
    return res.status(400).json({ error: 'Dados insuficientes para atualizar h_fim.' });
  }

  const filePath = path.join(__dirname, '../csv/Paradas.csv');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error("Erro ao ler Paradas.csv:", err);
      return res.status(500).json({ error: 'Erro ao ler o CSV.' });
    }
    let lines = data.split('\n');
    let updated = false;
    // Percorre as linhas (pulando o cabeçalho, na linha 0)
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = lines[i].split(',');
      // O cabeçalho esperado: Data,Local,status,OP,parada,motivo,h_inicio,h_fim,observação
      // Comparação: a coluna OP está no índice 3 e h_fim no índice 7.
      const opCSV = cols[3].replace(/"/g, '').trim();
      const hfCSV = cols[7].replace(/"/g, '').trim();
      // Atualiza o primeiro registro em que o OP coincide e h_fim está vazio
      if (opCSV === OP.trim() && hfCSV === "") {
        cols[7] = csvSafeField(h_fim);
        lines[i] = cols.join(',');
        updated = true;
        // Se desejar atualizar somente o primeiro registro encontrado, inclua:
        break;
      }
    }
    if (!updated) {
      return res.status(404).json({ error: 'Registro não encontrado para atualização de h_fim.' });
    }
    const newContent = lines.join('\n');
    fs.writeFile(filePath, newContent, (errWrite) => {
      if (errWrite) {
        console.error("Erro ao atualizar Paradas.csv:", errWrite);
        return res.status(500).json({ error: 'Erro ao atualizar o CSV.' });
      }
      return res.json({ success: true });
    });
  });
});




module.exports = router;
