const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());

// Suas rotas e outras configurações do servidor

app.listen(5001, () => {
  console.log('Servidor rodando na porta 5001');
});