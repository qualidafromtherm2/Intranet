// routes/loginRoute.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

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

    // Separa linhas (removendo vazias)
    const linhas = data.split('\n').filter(l => l.trim() !== '');
    if (linhas.length <= 1) {
      // Só cabeçalho ou arquivo vazio
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas.'
      });
    }

    // Cabeçalho: User,Email,Senha,SenhaTemporaria,Permissoes
    // Vamos ignorar a 1ª linha (cabeçalho)
    const dados = linhas.slice(1);

    let usuarioEncontrado = null;

    for (const linha of dados) {
      // Divide por vírgula
      const partes = linha.split(',');

      // Extrai colunas (ajuste se a ordem for diferente)
      let [UserCsv, EmailCsv, SenhaCsv, SenhaTempCsv, PermissoesCsv] = partes;

      // Remove espaços extras
      UserCsv = UserCsv.trim();
      EmailCsv = EmailCsv.trim();
      SenhaCsv = SenhaCsv.trim();
      SenhaTempCsv = SenhaTempCsv ? SenhaTempCsv.trim() : '';
      PermissoesCsv = PermissoesCsv ? PermissoesCsv.trim() : '';

      // Verifica login
      if (EmailCsv === email && SenhaCsv === password) {
        // Faz o split das permissões e remove espaços em branco (trim)
        const permissoesArr = PermissoesCsv
          ? PermissoesCsv.split(';').map(item => item.trim())
          : [];
      
        usuarioEncontrado = {
          user: UserCsv,
          email: EmailCsv,
          permissoes: permissoesArr
        };
        break;
      }
      
    }

    // Se não achou, retorna erro
    if (!usuarioEncontrado) {
      return res.status(401).json({
        success: false,
        message: 'Email ou senha inválidos.'
      });
    }

    // Guarda na sessão
    req.session.user = usuarioEncontrado;

    // Retorna sucesso
    return res.json({
      success: true,
      message: 'Login bem-sucedido.',
      user: usuarioEncontrado
    });
  });
});

// Exemplo de rota de perfil para checar se o usuário está logado e retornar dados:
router.get('/profile', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Não autenticado.' });
  }
  // Se estiver logado, retorna dados do usuário (incluindo permissões)
  return res.json({ success: true, user: req.session.user });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Erro ao destruir sessão:', err);
    res.clearCookie('connect.sid'); 
    return res.json({ success: true, message: 'Logout efetuado.' });
  });
});

// Atualizar permissões (exemplo):
router.post('/atualizar-permissoes', (req, res) => {
  const { user, permissoes } = req.body;
  
  if (!user || !Array.isArray(permissoes)) {
    return res.status(400).json({ success: false, message: 'Dados inválidos.' });
  }

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

    // Cabeçalho: User,Email,Senha,SenhaTemporaria,Permissoes
    for (let i = 1; i < linhas.length; i++) {
      let partes = linhas[i].split(',');

      // Ajuste para a posição correta do "User"
      if (partes[0].trim() === user) {
        // Atualiza a coluna de permissões (5ª coluna)
        partes[4] = permissoes.join(';');
        encontrou = true;
      }
      linhasAtualizadas.push(partes.join(','));
    }

    if (!encontrou) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }

    // Salva de volta no CSV
    fs.writeFile(csvPath, linhasAtualizadas.join('\n') + '\n', (errWrite) => {
      if (errWrite) {
        console.error('Erro ao salvar CSV:', errWrite);
        return res.status(500).json({ success: false, message: 'Erro ao atualizar arquivo.' });
      }
      return res.json({ success: true, message: 'Permissões atualizadas com sucesso!' });
    });
  });
});

module.exports = router;


