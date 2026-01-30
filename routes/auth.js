// routes/auth.js (SQL only, com parser e id numérico na sessão)
const express = require('express');
const { Pool } = require('pg');

const router = express.Router();
router.use(express.json()); // garante req.body em /login

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function carregarExtrasDoUsuario(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT s.name AS setor_nome, u.foto_perfil_url
         FROM public.auth_user u
         LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
         LEFT JOIN public.auth_sector s ON s.id = up.sector_id
        WHERE u.id = $1
        LIMIT 1`,
      [userId]
    );
    return { 
      setor: rows[0]?.setor_nome || null,
      foto_perfil_url: rows[0]?.foto_perfil_url || null
    };
  } catch (e) {
    console.warn('[auth] não foi possível carregar dados extras do usuário', e.message);
    return { setor: null, foto_perfil_url: null };
  }
}

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
    const extras = await carregarExtrasDoUsuario(u.id);
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Falha na sessão' });
      req.session.user = {
        id: String(u.id),                 // << id numérico correto
        username: u.username,
        roles: u.roles,
        setor: extras.setor
      };
      req.session.save(() => res.json({ ok: true, user: req.session.user }));
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Falha no login' });
  }
});

// POST /first-password
// Troca a senha inicial ("123") por uma nova e inicia a sessão.
router.post('/first-password', async (req, res) => {
  try {
    const { username, newPassword } = req.body || {};
    if (!username || !newPassword) {
      return res.status(400).json({ ok: false, error: 'Parâmetros inválidos' });
    }

    // 1) Busca o usuário na auth_user (o teu backend usa esse schema)
    const sel = await pool.query(
      `SELECT id, username, password_hash
         FROM public.auth_user
        WHERE username = $1 OR id::text = $1
        LIMIT 1`,
      [username]
    );
    if (sel.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Usuário não encontrado' });
    }
    const u = sel.rows[0];

    // 2) Permite trocar somente se a senha atual ainda for "123"
    //    (compara o hash atual com "123")
    const chk = await pool.query(
      `SELECT (password_hash = crypt('123', password_hash)) AS is123
         FROM public.auth_user
        WHERE id = $1`,
      [u.id]
    );
    const is123 = !!chk.rows[0]?.is123;
    if (!is123) {
      return res.status(401).json({ ok: false, error: 'Não autenticado' });
    }

    // 3) Atualiza para a nova senha (hash via pgcrypto/bcrypt no Postgres)
    await pool.query(
      `UPDATE public.auth_user
          SET password_hash = crypt($1, gen_salt('bf')), updated_at = now()
        WHERE id = $2`,
      [newPassword, u.id]
    );

    // 4) Cria a sessão (mesmo modelo do /login)
    const usernameOut = u.username || String(u.id);
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ ok: false, error: 'Falha na sessão' });
      req.session.user = {
        id: String(u.id),
        username: usernameOut,
        roles: [] // ajuste se você usa perfis
      };
      req.session.save(() => res.json({ ok: true, user: req.session.user }));
    });
  } catch (e) {
    console.error('[auth/first-password]', e);
    return res.status(500).json({ ok: false, error: 'Erro interno' });
  }
});


router.get('/status', (req, res) => {
  const finish = (user) => res.json({ loggedIn: !!user, user: user || null });

  if (!req.session.user) return finish(null);

  carregarExtrasDoUsuario(req.session.user.id)
    .then(extras => {
      const merged = { ...req.session.user, ...extras };
      req.session.user = merged;
      finish(merged);
    })
    .catch(() => finish(req.session.user));
});

// GET /auth/permissoes - retorna permissões de produto do usuário logado
router.get('/permissoes', async (req, res) => {
  try {
    if (!req.session.user?.id) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    const userId = req.session.user.id;
    const { rows } = await pool.query(
      `SELECT array_agg(permissao_codigo) AS codigos
       FROM public.auth_user_produto_permissao
       WHERE user_id = $1`,
      [userId]
    );
    const permissoes = rows[0]?.codigos || [];
    res.json({ permissoes });
  } catch (err) {
    console.error('[auth/permissoes]', err);
    res.status(500).json({ error: 'Erro ao buscar permissões' });
  }
});

router.post('/logout', (req, res) => {
  try { req.session.destroy(() => res.json({ ok: true })); }
  catch { res.json({ ok: true }); }
});

module.exports = router;
