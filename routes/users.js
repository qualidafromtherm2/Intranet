// routes/users.js
const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const bcrypt    = require('bcrypt');
const router    = express.Router();
const msn = require('../mensagens/msn');   // NOVO
const DATA_PATH = path.join(__dirname, '../data/users.json');


function selfOrAdmin(req, res, next) {
    const isAdmin = (req.session.user?.roles || []).includes('admin');
    const p       = req.params.id;              // pode ser id numérico ou username
    const isSelf  = String(req.session.user?.id) === p ||
                    req.session.user?.username   === p;
    if (isAdmin || isSelf) return next();
    return res.status(403).json({ error: 'Sem permissão' });
  }
// 2. rota PUT: procura primeiro por id; se não achar, tenta por username
router.put('/:id', selfOrAdmin, async (req, res) => {
  const { roles, password } = req.body;
  const users = loadUsers();

 const p = req.params.id;
 const u = users.find(u =>
   String(u.id) === p ||
   u.username.toLowerCase() === p.toLowerCase()
 );
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (Array.isArray(roles)) u.roles = roles;
  if (password) u.passwordHash = await bcrypt.hash(password, 10);
  saveUsers(users);
  res.json({ ok: true });
});

function loadUsers() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}
function saveUsers(users) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(users, null, 2), 'utf8');
}

// middleware para permitir só admins
function adminOnly(req, res, next) {
  const roles = req.session.user?.roles || [];
  if (!roles.includes('admin')) return res.status(403).json({ error: 'Sem permissão' });
  next();
}

// Listar todos (sem expor a senha)
router.get('/', adminOnly, (req, res) => {
  const users = loadUsers()
    .map(u => ({ id: u.id, username: u.username, roles: u.roles }));
  res.json(users);
});

// Criar novo usuário
router.post('/', adminOnly, async (req, res) => {
  const { username, password, roles } = req.body;
  if (!username || !password || !Array.isArray(roles)) {
    return res.status(400).json({ error: 'username, password e roles são obrigatórios' });
  }
  const users = loadUsers();
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ error: 'Usuário já existe' });
  }
  const hash = await bcrypt.hash(password, 10);
  const id   = users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;
  users.push({ id, username, passwordHash: hash, roles });
  saveUsers(users);
  res.json({ ok: true });
});


// Deletar usuário
router.delete('/:id', adminOnly, (req, res) => {
  let users = loadUsers();
  const before = users.length;
  users = users.filter(u => u.id !== +req.params.id);
  if (users.length === before) return res.status(404).json({ error: 'Usuário não encontrado' });
  saveUsers(users);
  res.json({ ok: true });
});



  
  // Solicitação de RESET de senha  (versão final)
  router.post('/request-reset', async (req, res) => {
     const { username } = req.body;
     if (!username) return res.status(400).json({ error: 'username obrigatório' });
     try {
       msn.addResetRequest(username);
       return res.json({ ok: true });
     } catch (_e) {
       return res.status(500).json({ error: 'Falha ao registrar o pedido.' });
     }
   });
  

 /* rota que devolve as mensagens do usuário logado ---------------- */
 router.get('/me/messages', (req, res) => {
   if (!req.session?.user) {
     return res.status(401).json({ error: 'Não autenticado' });
   }

  const { count, messages } = msn.getMessagesForUser(req.session.user.id); // <<<
   res.json({ count, messages });
 });

// Resetar senha do usuário para "123" (somente admins)
router.post('/reset-password', adminOnly, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username obrigatório' });

  const users = loadUsers();
  const u = users.find(x => x.username.toLowerCase() === username.toLowerCase());
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });

  u.passwordHash = await bcrypt.hash('123', 10);
  saveUsers(users);
  res.json({ ok: true });
});

// excluir notificação do usuário logado  –– body: { index : 0 }
// excluir notificação do usuário logado — body: { index : 0 }
router.post('/me/messages/delete', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const index = Number(req.body.index);
  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: 'Índice inválido' });
  }

  try {
    // usa o ID numérico, que sempre existe na sessão
    msn.removeMessageForUser(req.session.user.id, index);
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Índice inválido' });
  }
});




module.exports = router;
