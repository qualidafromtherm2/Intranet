// routes/auth.js (SQL only, com parser e id numérico na sessão)
const express = require('express');
const { Pool } = require('pg');

const router = express.Router();
router.use(express.json()); // garante req.body em /login

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// routes/auth.js (SQL only) — login completo
router.post('/login', async (req, res) => {
  try {
    const { user, senha } = req.body || {};
    if (!user || !senha) {
      return res.status(400).json({ error: 'user e senha são obrigatórios' });
    }

    const ip = req.ip || null;
    const ua = req.headers['user-agent'] || null;

    const { rows } = await pool.query(
      'SELECT * FROM public.auth_login($1,$2,$3::inet,$4::text)',
      [user, senha, ip, ua]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    const u = rows[0]; // tem id, username, roles
    // evita fixation: gera um novo id de sessão
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Falha na sessão' });
      req.session.user = {
        id: String(u.id),                 // << id numérico correto
        username: u.username,
        roles: u.roles
      };
      req.session.save(() => res.json({ ok: true, user: req.session.user }));
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Falha no login' });
  }
});

router.get('/status', (req, res) => {
  if (req.session.user) return res.json({ loggedIn: true, user: req.session.user });
  res.json({ loggedIn: false });
});


router.post('/logout', (req, res) => {
  try { req.session.destroy(() => res.json({ ok: true })); }
  catch { res.json({ ok: true }); }
});

router.get('/status', (req, res) => {
  if (req.session.user) return res.json({ loggedIn: true, user: req.session.user });
  res.json({ loggedIn: false });
});

module.exports = router;
