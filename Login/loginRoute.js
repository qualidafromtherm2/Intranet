// routes/loginRoute.js

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

/**
 * POST /api/login/login
 * Espera { email, password } no body.
 * Lê o CSV de login. Se encontrar a linha com Email=... e Senha=..., cria sessão e retorna success:true.
 * Se não encontrar, retorna erro 401.
 */
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  // Validação mínima
  if (!email || !password) {
    return res.status(400).json({
      success: false, 
      message: 'Faltam credenciais.'
    });
  }

  // Caminho do CSV
  const csvPath = path.join(__dirname, '..', 'csv', 'Login.csv');

  fs.readFile(csvPath, 'utf-8', (err, data) => {
    if (err) {
      console.error('Erro ao ler CSV:', err);
      return res.status(500).json({
        success: false, 
        message: 'Erro ao ler arquivo de login.'
      });
    }

    const linhas = data.split('\n').filter(l => l.trim() !== '');
    if (linhas.length <= 1) {
      // Só tem o cabeçalho, sem dados
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas.'
      });
    }

    // Cabeçalho: User,Email,Senha,Senha temporaria
    // Linhas de dados (ignorando a 1ª)
    const dados = linhas.slice(1);

    let usuarioEncontrado = null;

    for (const linha of dados) {
      const partes = linha.split(',');
      let [UserCsv, EmailCsv, SenhaCsv] = partes;
      // Tira espaços
      UserCsv = UserCsv.trim();
      EmailCsv = EmailCsv.trim();
      SenhaCsv = SenhaCsv.trim();

      if (EmailCsv === email && SenhaCsv === password) {
        // Achou login válido
        usuarioEncontrado = { user: UserCsv, email: EmailCsv };
        break;
      }
    }

    if (!usuarioEncontrado) {
      return res.status(401).json({
        success: false,
        message: 'Email ou senha inválidos.'
      });
    }


      // Transformar a string permissoes em array
  const permissoesArr = usuarioEncontrado.permissoes 
  ? usuarioEncontrado.permissoes.split(';') 
  : [];

// Guardamos tudo na sessão
req.session.user = {
  user: usuarioEncontrado.user,
  email: usuarioEncontrado.email,
  permissoes: permissoesArr
};


    // Se achou, guardamos info na sessão
    req.session.user = usuarioEncontrado; 
    // Retorna status OK
    return res.json({
      success: true,
      message: 'Login bem-sucedido.',
      user: usuarioEncontrado
    });
  });
});

/**
 * GET /api/login/profile
 * Exemplo de rota que retorna dados do usuário logado.
 */
// loginRoute.js (trecho)
router.get('/profile', (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ success: false, message: 'Não autenticado.' });
    }
    return res.json({ success: true, user: req.session.user });
  });
  

/**
 * POST /api/login/logout
 * Destrói a sessão.
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Erro ao destruir sessão:', err);
    }
    // Apaga também o cookie de sessão no cliente (caso queira)
    res.clearCookie('connect.sid'); 
    return res.json({ success: true, message: 'Logout efetuado.' });
  });
});

module.exports = router;


// Em loginRoute.js ou outro arquivo de rotas:
router.post('/atualizar-permissoes', (req, res) => {
    const { user, permissoes } = req.body;
    
    if (!user || !Array.isArray(permissoes)) {
      return res.status(400).json({ success: false, message: 'Dados inválidos.' });
    }
    
    // Aqui, você deve implementar a lógica para:
    // 1. Ler o CSV (ou acessar seu banco de dados)
    // 2. Encontrar o usuário pelo nome ou e-mail
    // 3. Atualizar a coluna de permissões com a string separada por ; (por exemplo, permissoes.join(';'))
    // 4. Salvar o CSV atualizado
    
    // Exemplo simplificado:
    const csvPath = path.join(__dirname, '..', 'csv', 'Login.csv');
    
    fs.readFile(csvPath, 'utf-8', (err, data) => {
      if (err) {
        console.error('Erro ao ler CSV:', err);
        return res.status(500).json({ success: false, message: 'Erro ao ler arquivo.' });
      }
      
      let linhas = data.split('\n').filter(l => l.trim() !== '');
      const header = linhas[0];
      const linhasAtualizadas = [header];
      let encontrou = false;
      
      for (let i = 1; i < linhas.length; i++) {
        let partes = linhas[i].split(',');
        // Suponha que a estrutura seja: User,Email,Senha,SenhaTemporaria,Permissoes
        if (partes[0].trim() === user) {
          // Atualiza a coluna de permissões (por exemplo, a 5ª coluna)
          partes[4] = permissoes.join(';');
          encontrou = true;
        }
        linhasAtualizadas.push(partes.join(','));
      }
      
      if (!encontrou) {
        return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
      }
      
      fs.writeFile(csvPath, linhasAtualizadas.join('\n') + '\n', (errWrite) => {
        if (errWrite) {
          console.error('Erro ao salvar CSV:', errWrite);
          return res.status(500).json({ success: false, message: 'Erro ao atualizar arquivo.' });
        }
        return res.json({ success: true, message: 'Permissões atualizadas com sucesso!' });
      });
    });
  });
  