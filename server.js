// server.js

// 1) Importações principais
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); // Manipula arquivo CSV

// 2) Importações das rotas existentes
const produtosRouter = require('./routes/produtos');
const caracteristicasRouter = require('./routes/caracteristicas');
const prodcaractRouter = require('./routes/prodcaract');
const excluirCaracteristicaRouter = require('./routes/excluirCaracteristica');
const uploadImageRouter = require('./routes/uploadImage');
const incluirCaracteristicaRouter = require('./routes/incluirCaracteristica');

// 3) Inicializa a aplicação Express e configura porta
const app = express();
const PORT = process.env.PORT || 5001;

// 4) Middlewares principais
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// 5) Registra as rotas
app.use('/api/produtos', produtosRouter);
app.use('/api/caracteristicas', caracteristicasRouter);
app.use('/api/prodcaract', prodcaractRouter);
app.use('/api/excluir-caracteristica', excluirCaracteristicaRouter);
app.use('/api/uploadImage', uploadImageRouter);
app.use('/api/incluir-caracteristica', incluirCaracteristicaRouter);

/**
 * A nova formatação do CSV:
 *   codigo, DD/MM/YYYY, HH:MM:SS
 * Exemplo de linha: "03.MP.I.60701,12/03/2025,07:00:00"
 */

/**
 * Rota /api/log-codigo:
 *   - Lê se já existe no CSV => atualiza data/hora
 *   - Se não existir => cria nova linha com data/hora
 */
app.post('/api/log-codigo', (req, res) => {
  const { codigo } = req.body;
  if (!codigo) {
    return res.status(400).json({ success: false, error: 'Código não fornecido.' });
  }

  // Data em formato DD/MM/YYYY
  const agora = new Date();
  const dia = String(agora.getDate()).padStart(2, '0');
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const ano = agora.getFullYear();
  const dataStr = `${dia}/${mes}/${ano}`;

  // Hora no formato HH:MM:SS (24h)
  const horaStr = agora.toLocaleTimeString('pt-BR', { hour12: false });

  // Exemplo de linha CSV: "03.MP.I.60701,12/03/2025,07:00:00"
  const novaLinha = `${codigo},${dataStr},${horaStr}`;

  fs.readFile('logsDeCodigo.csv', 'utf-8', (err, data) => {
    // Se o arquivo não existir, cria diretamente
    if (err && err.code === 'ENOENT') {
      return fs.writeFile('logsDeCodigo.csv', novaLinha + '\n', (errWrite) => {
        if (errWrite) {
          console.error('Erro ao criar CSV:', errWrite);
          return res.status(500).json({ success: false, error: 'Erro ao criar CSV.' });
        }
        return res.json({ success: true });
      });
    } else if (err) {
      console.error('Erro ao ler CSV:', err);
      return res.status(500).json({ success: false, error: 'Erro ao ler CSV.' });
    }

    // data existe => split em linhas
    const linhas = data.split('\n').filter(l => l.trim() !== '');

    // Se já existir esse codigo, substituímos a linha
    let encontrou = false;
    for (let i = 0; i < linhas.length; i++) {
      const [codExistente] = linhas[i].split(',');
      if (codExistente === codigo) {
        linhas[i] = novaLinha;
        encontrou = true;
        break;
      }
    }
    if (!encontrou) {
      linhas.push(novaLinha);
    }

    fs.writeFile('logsDeCodigo.csv', linhas.join('\n') + '\n', (errWrite) => {
      if (errWrite) {
        console.error('Erro ao salvar CSV:', errWrite);
        return res.status(500).json({ success: false, error: 'Erro ao salvar CSV.' });
      }
      return res.json({ success: true });
    });
  });
});

/**
 * Função para verificar se a data/hora CSV é mais antiga que 1 minuto
 * Recebe dataCSV="DD/MM/YYYY" e horaCSV="HH:MM:SS"
 */
function jaPassou1Minuto(dataCSV, horaCSV) {
  const agora = new Date();

  // dataCSV: "DD/MM/YYYY"
  const [diaStr, mesStr, anoStr] = dataCSV.split('/');
  const dia = parseInt(diaStr, 10);
  const mes = parseInt(mesStr, 10) - 1; // Em JS, 0=Janeiro
  const ano = parseInt(anoStr, 10);

  // horaCSV: "HH:MM:SS"
  const [hStr, mStr, sStr] = horaCSV.split(':');
  const h = parseInt(hStr, 10);
  const min = parseInt(mStr, 10);
  const seg = parseInt(sStr, 10);

  if (Number.isNaN(dia) || Number.isNaN(mes) || Number.isNaN(ano) ||
      Number.isNaN(h)   || Number.isNaN(min) || Number.isNaN(seg)) {
    // Se tiver algum dado inválido, preferimos não remover
    return false;
  }

  // Monta data/hora
  const dataRegistro = new Date(ano, mes, dia, h, min, seg);

  // Diferença em milissegundos
  const diffMs = agora - dataRegistro;
  const diffSegundos = diffMs / 1000;
  return diffSegundos > 60; // se passou de 60s => remove
}

/**
 * POST /api/log-codigo/cleanup:
 *   - Lê o CSV "logsDeCodigo.csv"
 *   - Remove linhas mais velhas que 1 minuto
 */
app.post('/api/log-codigo/cleanup', (req, res) => {
  fs.readFile('logsDeCodigo.csv', 'utf-8', (err, data) => {
    if (err) {
      // Se o arquivo não existe, nada a limpar
      if (err.code === 'ENOENT') {
        return res.json({ success: true, message: 'logsDeCodigo.csv não existe, nada a limpar.' });
      }
      console.error("Erro ao ler CSV pra cleanup:", err);
      return res.status(500).json({ success: false, error: 'Erro ao ler CSV.' });
    }

    let linhas = data.split('\n').filter(l => l.trim() !== '');
    let alterou = false;

    // Cada linha: "codigo,DD/MM/YYYY,HH:MM:SS"
    const novasLinhas = linhas.filter(l => {
      const partes = l.split(',');
      if (partes.length < 3) {
        // Se tiver menos de 3 colunas => mal formada
        alterou = true;
        return false;
      }
      const [cod, dataCSV, horaCSV] = partes;
      if (!cod || !dataCSV || !horaCSV) {
        alterou = true;
        return false;
      }
      // Checa se já passou 1 minuto
      if (jaPassou1Minuto(dataCSV.trim(), horaCSV.trim())) {
        alterou = true;
        return false; // remove
      }
      return true; // mantém
    });

    if (!alterou) {
      return res.json({ success: true, message: 'Nenhuma linha removida.' });
    }

    // Se removeu algo, reescreve
    fs.writeFile('logsDeCodigo.csv', novasLinhas.join('\n') + '\n', (errWrite) => {
      if (errWrite) {
        console.error("Erro ao salvar CSV após cleanup:", errWrite);
        return res.status(500).json({ success: false, error: 'Erro ao salvar CSV.' });
      }
      return res.json({ success: true, message: 'Linhas antigas removidas com sucesso!' });
    });
  });
});

// Sobe o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
