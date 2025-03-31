// abertura_op_csv.js

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Função para garantir que o campo seja seguro para CSV
function csvSafeField(value) {
  value = String(value);
  const safeVal = value.replace(/"/g, '""');
  return `"${safeVal}"`;
}

router.post('/', (req, res) => {
  console.log("[DEBUG] /api/plano-op => req.body:", req.body);
  const { dados } = req.body; // Espera um array com { pedido, produto, local, status, data, user, observacao }
  console.log("Dados recebidos:", dados);

  if (!dados || !Array.isArray(dados)) {
    return res.status(400).json({ error: 'Dados inválidos.' });
  }

  // Define o caminho para o CSV (pasta csv/plano_op.csv)
  const filePath = path.join(__dirname, '../csv/plano_op.csv');
  let csvContent = "";
  // NOVO CABEÇALHO: 8 colunas
  const header = "OP,Pedido,produto,local,status,data,user,observação\n";

  // Se o arquivo não existir, adiciona o cabeçalho
  if (!fs.existsSync(filePath)) {
    console.log("[DEBUG] Arquivo não existe, adicionando cabeçalho.");
    csvContent += header;
  } else {
    // Se o arquivo existir, garante que termine com quebra de linha
    const existingContent = fs.readFileSync(filePath, 'utf8');
    if (!existingContent.endsWith('\n')) {
      csvContent += "\n";
    }
  }

  // Gera o prefixo OP com base no mês e ano atual
  const currentDate = new Date();
  const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
  const yy = String(currentDate.getFullYear()).slice(-2);
  const prefix = "OP" + mm + yy + "-";
  console.log("[DEBUG] Prefix gerado:", prefix);

  // Conta quantos itens já possuem esse prefixo no CSV para definir a numeração sequencial
  let countForPrefix = 0;
  if (fs.existsSync(filePath)) {
    const existingContent = fs.readFileSync(filePath, 'utf8');
    const lines = existingContent.split('\n');
    lines.forEach(line => {
      if (line.startsWith(prefix)) {
        countForPrefix++;
      }
    });
  }
  console.log("[DEBUG] Contagem inicial para prefixo:", countForPrefix);

  // Para cada objeto recebido, gera a linha do CSV com o código OP gerado
  dados.forEach(row => {
    // Gera o código OP: prefix + sequencial
    const opCode = prefix + (countForPrefix + 1);
    countForPrefix++;

    // Pega cada campo novo (local, status, data, user, observacao)
    const localVal = row.local || "";
    const statusVal = row.status || "";
    const dataVal = row.data || "";
    const userVal = row.user || "";
    const observacao = row.observacao || "";

    // Monta a linha com as 8 colunas
    // Indíces: 0=OP, 1=Pedido, 2=produto, 3=local, 4=status, 5=data, 6=user, 7=observação
    csvContent += `${opCode},${row.pedido},${row.produto},${localVal},${statusVal},${dataVal},${userVal},${csvSafeField(observacao)}\n`;
  });

  fs.appendFile(filePath, csvContent, (err) => {
    if (err) {
      console.error("Erro ao salvar CSV:", err);
      return res.status(500).json({ error: 'Erro ao salvar CSV.' });
    }
    console.log("CSV atualizado com sucesso.");
    return res.json({ success: true });
  });
});

// Endpoint GET para ler o CSV
router.get('/ler-csv', (req, res) => {
  const filePath = path.join(__dirname, '../csv/plano_op.csv');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error("Erro ao ler CSV:", err);
      return res.status(500).json({ error: 'Erro ao ler CSV.' });
    }
    res.send(data);
  });
});

// Endpoint para atualizar local + status de um registro no CSV
router.post('/atualizar-status', (req, res) => {
  const { pedido, produto, local, status } = req.body;
  if (!pedido || !produto || !local || !status) {
    return res.status(400).json({ error: 'Dados insuficientes para atualizar o status/local.' });
  }

  const filePath = path.join(__dirname, '../csv/plano_op.csv');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error("Erro ao ler CSV para atualização:", err);
      return res.status(500).json({ error: 'Erro ao ler CSV.' });
    }

    // Divide o conteúdo em linhas
    let lines = data.split('\n');
    let updated = false;
    // Cabeçalho fica em lines[0]
    // Indíces: 0=OP, 1=Pedido, 2=produto, 3=local, 4=status, 5=data, 6=user, 7=observação
    for (let i = 1; i < lines.length; i++) {
      let line = lines[i];
      if (!line.trim()) continue;
      const cols = line.split(',');

      // Verifica se o Pedido e o produto correspondem
      if (cols[1] === String(pedido) && cols[2] === String(produto)) {
        // Atualiza a coluna local (3) e status (4)
        cols[3] = local;
        cols[4] = status;
        lines[i] = cols.join(',');
        updated = true;
      }
    }

    if (!updated) {
      return res.status(404).json({ error: 'Registro não encontrado no CSV.' });
    }

    const newContent = lines.join('\n');
    fs.writeFile(filePath, newContent, (errWrite) => {
      if (errWrite) {
        console.error("Erro ao atualizar CSV:", errWrite);
        return res.status(500).json({ error: 'Erro ao atualizar CSV.' });
      }
      return res.json({ success: true });
    });
  });
});

// Endpoint para atualizar a observação de um registro no CSV
router.post('/atualizar-observacao', (req, res) => {
  const { pedido, produto, observacao } = req.body;
  if (!pedido || !produto || observacao === undefined) {
    return res.status(400).json({ error: 'Dados insuficientes para atualizar a observação.' });
  }

  const filePath = path.join(__dirname, '../csv/plano_op.csv');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error("Erro ao ler CSV para atualização da observação:", err);
      return res.status(500).json({ error: 'Erro ao ler CSV.' });
    }

    let lines = data.split('\n');
    let updated = false;
    // Indíces: 0=OP, 1=Pedido, 2=produto, 3=local, 4=status, 5=data, 6=user, 7=observação
    for (let i = 1; i < lines.length; i++) {
      let line = lines[i];
      if (!line.trim()) continue;
      const cols = line.split(',');
      if (cols[1] === String(pedido) && cols[2] === String(produto)) {
        // Atualiza a observação (coluna índice 7)
        cols[7] = csvSafeField(observacao);
        lines[i] = cols.join(',');
        updated = true;
      }
    }

    if (!updated) {
      return res.status(404).json({ error: 'Registro não encontrado no CSV.' });
    }

    const newContent = lines.join('\n');
    fs.writeFile(filePath, newContent, (errWrite) => {
      if (errWrite) {
        console.error("Erro ao atualizar CSV:", errWrite);
        return res.status(500).json({ error: 'Erro ao atualizar CSV.' });
      }
      return res.json({ success: true });
    });
  });
});

// Endpoint para excluir um registro do CSV
router.post('/excluir', (req, res) => {
  const { pedido, produto } = req.body;
  if (!pedido || !produto) {
    return res.status(400).json({ error: 'Dados insuficientes para exclusão.' });
  }

  const filePath = path.join(__dirname, '../csv/plano_op.csv');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error("Erro ao ler CSV para exclusão:", err);
      return res.status(500).json({ error: 'Erro ao ler CSV.' });
    }
    const lines = data.split('\n');
    const header = lines[0];
    const newLines = [header];
    let found = false;
    // Indíces: 0=OP, 1=Pedido, 2=produto, 3=local, 4=status, 5=data, 6=user, 7=observação
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const cols = line.split(',');
      if (cols[1] === String(pedido) && cols[2] === String(produto)) {
        found = true;
        continue; // não adiciona esta linha
      }
      newLines.push(line);
    }
    if (!found) {
      return res.status(404).json({ error: 'Registro não encontrado para exclusão.' });
    }
    fs.writeFile(filePath, newLines.join('\n'), (errWrite) => {
      if (errWrite) {
        console.error("Erro ao salvar CSV após exclusão:", errWrite);
        return res.status(500).json({ error: 'Erro ao atualizar CSV.' });
      }
      return res.json({ success: true });
    });
  });
});

module.exports = router;
