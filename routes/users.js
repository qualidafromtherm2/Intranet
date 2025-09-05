// routes/users.js — SQL only (com self-or-manage e salvamento de permissões)
const express = require('express');
const { Pool } = require('pg');

const router = express.Router();
router.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ----------------- helpers ----------------- */
function requireLogin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Não autenticado' });
  next();
}

async function hasManagePermission(userId) {
  const { rows } = await pool.query(
    `SELECT EXISTS(
       SELECT 1 FROM public.auth_user_permissions_tree($1) t
       WHERE t.key='side:rh:cad-colab' AND t.allowed
     ) AS ok`,
    [userId]
  );
  return !!rows[0]?.ok;
}

async function manageOnly(req, res, next) {
  const me = req.session?.user;
  if (!me) return res.status(401).json({ error: 'Não autenticado' });
  if (await hasManagePermission(me.id)) return next();
  return res.status(403).json({ error: 'Sem permissão' });
}

async function selfOrManage(req, res, next) {
  const me = req.session?.user;
  if (!me) return res.status(401).json({ error: 'Não autenticado' });

  const p = String(req.params.id || '');
  if (String(me.id) === p || String(me.username) === p) return next(); // próprio usuário

  if (await hasManagePermission(me.id)) return next();                 // pode gerenciar
  return res.status(403).json({ error: 'Sem permissão' });
}

async function idFromParam(p) {
  const { rows } = await pool.query(
    `SELECT id FROM public.auth_user WHERE id::text=$1 OR username=$1 LIMIT 1`,
    [p]
  );
  return rows[0]?.id || null;
}

/* ----------------- 1) Listar usuários (precisa poder gerenciar) ----------------- */
router.get('/', requireLogin, manageOnly, async (_req, res) => {
  const q = `
    SELECT u.id::text AS id, u.username::text AS username, u.roles,
           s.name AS setor, f.name AS funcao
      FROM public.auth_user u
      LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
      LEFT JOIN public.auth_sector s ON s.id = up.sector_id
      LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
     ORDER BY u.username`;
  const { rows } = await pool.query(q);
  res.json(rows.map(r => ({
    id: r.id, username: r.username, roles: r.roles || [],
    setor: r.setor || null, funcao: r.funcao || null
  })));
});

/* ----------------- 2) Obter 1 usuário + perfil (self OU quem pode gerenciar) ----------------- */
router.get('/:id', requireLogin, selfOrManage, async (req, res) => {
  const uid = await idFromParam(req.params.id);
  if (!uid) return res.status(404).json({ error: 'Usuário não encontrado' });

  const q = `
    SELECT u.id::text AS id, u.username::text AS username, u.roles,
           s.name AS setor, f.name AS funcao
      FROM public.auth_user u
      LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
      LEFT JOIN public.auth_sector s ON s.id = up.sector_id
      LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
     WHERE u.id = $1
     LIMIT 1`;
  const { rows } = await pool.query(q, [uid]);
  const r = rows[0];
  res.json({
    user:    { id: r.id, username: r.username, roles: r.roles || [] },
    profile: { setor: r.setor || null, funcao: r.funcao || null }
  });
});

/* ----------------- 3) Árvore de permissões (SELF OU quem pode gerenciar) ----------------- */
// rota "me" (facilita no front). IMPORTANTE: declarar ANTES de "/:id/..."
router.get('/me/permissions/tree', requireLogin, async (req, res) => {
  const uid = req.session.user.id;
  const { rows } = await pool.query(
    `SELECT t.id, t.parent_id, t.key, t.label, t.pos, t.sort, t.allowed, t.user_override,
            (SELECT selector FROM public.nav_node n WHERE n.id=t.id) AS selector
       FROM public.auth_user_permissions_tree($1) t
     ORDER BY t.pos, t.parent_id NULLS FIRST, t.sort, t.id`,
    [uid]
  );
  res.json({ userId: String(uid), nodes: rows });
});

router.get('/:id/permissions/tree', requireLogin, selfOrManage, async (req, res) => {
  const uid = await idFromParam(req.params.id);
  if (!uid) return res.status(404).json({ error: 'Usuário não encontrado' });

  const { rows } = await pool.query(
    `SELECT t.id, t.parent_id, t.key, t.label, t.pos, t.sort, t.allowed, t.user_override,
            (SELECT selector FROM public.nav_node n WHERE n.id=t.id) AS selector
       FROM public.auth_user_permissions_tree($1) t
     ORDER BY t.pos, t.parent_id NULLS FIRST, t.sort, t.id`,
    [uid]
  );
  res.json({ userId: String(uid), nodes: rows });
});

/* ----------------- 4) Salvar permissões (precisa poder gerenciar) ----------------- */
router.post('/:id/permissions/save', requireLogin, manageOnly, async (req, res) => {
  const uid = await idFromParam(req.params.id);
  if (!uid) return res.status(404).json({ error: 'Usuário não encontrado' });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'Nada para salvar' });

  const rowsToInsert = items
    .map(it => ({ node_id: Number(it.node_id ?? it.id), allow: !!it.allowed }))
    .filter(it => Number.isInteger(it.node_id));

  if (!rowsToInsert.length) return res.status(400).json({ error: 'Itens inválidos' });

  const values = [];
  const params = [];
  let i = 1;
  for (const it of rowsToInsert) {
    params.push(uid, it.node_id, it.allow);
    values.push(`($${i++}, $${i++}, $${i++})`);
  }
  const sql = `
    INSERT INTO public.auth_user_permission(user_id, node_id, allow)
    VALUES ${values.join(',')}
    ON CONFLICT (user_id, node_id) DO UPDATE SET allow = EXCLUDED.allow`;
  await pool.query(sql, params);

  res.json({ ok: true, updated: rowsToInsert.length });
});

/* ----------------- 5) Atualizar senha/roles (mantive a regra de “pode gerenciar”) ----------------- */
router.put('/:id', requireLogin, manageOnly, async (req, res) => {
  const uid = await idFromParam(req.params.id);
  if (!uid) return res.status(404).json({ error: 'Usuário não encontrado' });

  const { password, roles } = req.body || {};
  if (password) {
    const { rows } = await pool.query('SELECT username FROM public.auth_user WHERE id=$1', [uid]);
    await pool.query('SELECT public.auth_set_password($1,$2)', [rows[0].username, password]);
  }
  if (Array.isArray(roles)) {
    await pool.query('UPDATE public.auth_user SET roles=$1 WHERE id=$2', [roles, uid]);
  }
  res.json({ ok: true });
});

module.exports = router;
