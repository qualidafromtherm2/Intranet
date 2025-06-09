// routes/auth.js

const fs      = require('fs');
const path    = require('path');
const bcrypt  = require('bcrypt');

const USERS_PATH = path.join(__dirname, '../data/users.json');
function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
}



const express = require('express');
const router  = express.Router();
const axiosPostWithRetry = require('../utils/axiosRetry');

router.post('/login', async (req, res) => {
  console.log('☞ LOGIN REQ.BODY:', req.body);
  const { user, senha } = req.body;
  const users = loadUsers();
  // 1) tenta usuário local
  const u = users.find(u => 
    u.username.toLowerCase() === String(user).toLowerCase()
  );
  if (u) {
    const ok = await bcrypt.compare(senha, u.passwordHash);
    if (ok) {
      // sucesso local: grava na sessão e retorna
      req.session.user = { id: u.username, roles: u.roles };
      return res.json({ ok: true, user: req.session.user });
    }
  }
  // 2) (opcional) continua com a autenticação Omie se quiser
  //    … seu código antigo de chamar o proxy Omie …
  // 3) se nada bateu:
  return res.status(401).json({ error: 'Usuário ou senha inválidos' });
});


router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/status', (req, res) => {
  if (req.session.user) {
    return res.json({ loggedIn: true, user: req.session.user });
  }
  res.json({ loggedIn: false });
});

module.exports = router;
