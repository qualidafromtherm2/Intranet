// routes/users.js — SQL-only + perfil + permissões
const express = require('express');
const { Pool } = require('pg');

const router = express.Router();
router.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* -------- helpers de auth -------- */
function adminOnly(req, res, next) {
  const roles = req.session.user?.roles || [];
  if (!roles.includes('admin')) return res.status(403).json({ error: 'Sem permissão' });
  next();
}
function selfOrAdmin(req, res, next) {
  const me = req.session.user;
  if (!me) return res.status(401).json({ error: 'Não autenticado' });
  const isAdmin = (me.roles || []).includes('admin');
  const target = String(req.params.id);
  const isSelf  = String(me.id) === target || String(me.username) === target;
  if (isAdmin || isSelf) return next();
  return res.status(403).json({ error: 'Sem permissão' });
}
async function resolveTarget(client, idOrName) {
  const q = `
    SELECT id, username, roles
      FROM public.auth_user
     WHERE id::text = $1 OR username = $1
     LIMIT 1`;
  const r = await client.query(q, [String(idOrName)]);
  return r.rows[0] || null;
}

/* -------- lookups -------- */
router.get('/lookups', async (_req, res) => {
  const cli = await pool.connect();
  try {
    const s = await cli.query('SELECT name FROM public.auth_sector WHERE active=true ORDER BY name');
    const f = await cli.query('SELECT name FROM public.auth_funcao WHERE active=true ORDER BY name');
    res.json({ setores: s.rows, funcoes: f.rows });
  } finally { cli.release(); }
});

// --- LOOKUPS: criar setor (admin only) ---
router.post('/lookups/sector', adminOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'nome obrigatório' });
  try {
    await pool.query('INSERT INTO public.auth_sector(name,active) VALUES ($1,true) ON CONFLICT (name) DO UPDATE SET active=true', [name]);
    const { rows } = await pool.query('SELECT name FROM public.auth_sector WHERE active=true ORDER BY name');
    res.status(201).json({ ok: true, setores: rows });
  } catch (e) {
    console.error('[sector:create]', e);
    res.status(500).json({ error: 'falha ao criar setor' });
  }
});

// --- LOOKUPS: criar função (admin only) ---
router.post('/lookups/funcao', adminOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'nome obrigatório' });
  try {
    await pool.query('INSERT INTO public.auth_funcao(name,active) VALUES ($1,true) ON CONFLICT (name) DO UPDATE SET active=true', [name]);
    const { rows } = await pool.query('SELECT name FROM public.auth_funcao WHERE active=true ORDER BY name');
    res.status(201).json({ ok: true, funcoes: rows });
  } catch (e) {
    console.error('[funcao:create]', e);
    res.status(500).json({ error: 'falha ao criar função' });
  }
});

// --- PERMISSÕES: árvore para um usuário ---
router.get('/:id/permissions/tree', selfOrAdmin, async (req, res) => {
  const cli = await pool.connect();
  try {
    const t = await cli.query(`
      SELECT * FROM public.auth_user_permissions_tree(
        (SELECT id FROM public.auth_user WHERE id::text=$1 OR username=$1 LIMIT 1)
      )`, [req.params.id]);
    res.json({ nodes: t.rows });
  } finally { cli.release(); }
});

// --- PERMISSÕES: salvar overrides (admin altera de qualquer um; usuário só o próprio) ---
router.put('/:id/permissions/overrides', selfOrAdmin, async (req, res) => {
  const { overrides } = req.body || {};
  if (!overrides || typeof overrides !== 'object') {
    return res.status(400).json({ error: 'overrides inválido' });
  }
  const cli = await pool.connect();
  try {
    const who = await cli.query(`SELECT id FROM public.auth_user WHERE id::text=$1 OR username=$1 LIMIT 1`, [req.params.id]);
    if (who.rowCount === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    const targetId = who.rows[0].id;

    // mapeia key -> id
    const keys = Object.keys(overrides);
    if (keys.length === 0) return res.json({ ok: true });
    const map = await cli.query(
      `SELECT id, key FROM public.nav_node WHERE key = ANY($1::text[])`,
      [keys]
    );
    const idByKey = new Map(map.rows.map(r => [r.key, r.id]));

    await cli.query('BEGIN');
    for (const [k, v] of Object.entries(overrides)) {
      const nodeId = idByKey.get(k);
      if (!nodeId) continue;
      if (v === null) {
        // remove override
        await cli.query(`DELETE FROM public.auth_user_permission WHERE user_id=$1 AND node_id=$2`, [targetId, nodeId]);
      } else if (typeof v === 'boolean') {
        // upsert override (true/false)
        await cli.query(`
          INSERT INTO public.auth_user_permission(user_id,node_id,allow)
          VALUES ($1,$2,$3)
          ON CONFLICT (user_id,node_id) DO UPDATE SET allow=EXCLUDED.allow
        `, [targetId, nodeId, v]);
      }
    }
    await cli.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await pool.query('ROLLBACK').catch(()=>{});
    console.error('[perm:overrides]', e);
    res.status(500).json({ error: 'falha ao salvar overrides' });
  } finally { cli.release(); }
});

/* -------- CRUD usuários básico -------- */
router.get('/', adminOnly, async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, username, roles FROM public.auth_users_public ORDER BY username'
  );
  res.json(rows);
});
router.post('/', adminOnly, async (req, res) => {
  const { username, password, roles } = req.body || {};
  if (!username || !password || !Array.isArray(roles)) {
    return res.status(400).json({ error: 'username, password e roles são obrigatórios' });
  }
  try {
    const r = await pool.query(
      'SELECT * FROM public.auth_create_user($1,$2,$3)',
      [username, password, roles]
    );
    res.json({ ok: true, user: r.rows[0] || null });
  } catch (err) {
    if (String(err.message).includes('auth_user_username_key')) {
      return res.status(409).json({ error: 'Usuário já existe' });
    }
    console.error('[users:create]', err);
    res.status(500).json({ error: 'Falha ao criar usuário' });
  }
});
router.put('/:id', selfOrAdmin, async (req, res) => {
  const { password, roles } = req.body || {};
  const client = await pool.connect();
  try {
    const target = await resolveTarget(client, req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

    if (password) {
      await client.query('SELECT public.auth_set_password($1,$2)', [target.username, password]);
    }
    const isAdmin = (req.session.user?.roles || []).includes('admin');
    if (isAdmin && Array.isArray(roles)) {
      await client.query('UPDATE public.auth_user SET roles = $1 WHERE id = $2', [roles, target.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[users:update]', err);
    res.status(500).json({ error: 'Falha ao atualizar usuário' });
  } finally { client.release(); }
});
router.delete('/:id', adminOnly, async (req, res) => {
  const p = String(req.params.id);
  const q = /^\d+$/.test(p)
    ? ['DELETE FROM public.auth_user WHERE id = $1', [Number(p)]]
    : ['DELETE FROM public.auth_user WHERE username = $1', [p]];
  const r = await pool.query(q[0], q[1]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json({ ok: true });
});

/* -------- mensagens -------- */
router.get('/me/messages', async (req, res) => {
  const me = req.session.user;
  if (!me) return res.status(401).json({ error: 'Não autenticado' });
  const { rows } = await pool.query(
    'SELECT id, body, created_at FROM public.auth_messages_for($1)',
    [me.id]
  );
  res.json({ count: rows.length, messages: rows });
});
router.post('/me/messages/delete', async (req, res) => {
  const me = req.session.user;
  if (!me) return res.status(401).json({ error: 'Não autenticado' });
  const msgId = Number(req.body?.id);
  if (!Number.isInteger(msgId) || msgId <= 0) return res.status(400).json({ error: 'id inválido' });
  const { rows } = await pool.query('SELECT public.auth_message_delete($1,$2) AS ok', [me.id, msgId]);
  if (!rows[0]?.ok) return res.status(400).json({ error: 'Falha ao excluir' });
  res.json({ ok: true });
});
router.post('/request-reset', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username obrigatório' });
  await pool.query('SELECT public.auth_request_reset($1,$2)', [
    username,
    req.session.user?.id || null
  ]);
  res.json({ ok: true });
});

/* -------- perfil (setor/função) -------- */
router.get('/:id/profile', selfOrAdmin, async (req, res) => {
  const p = String(req.params.id);
  const q = `
    SELECT v.user_id, v.username, v.setor, v.funcao
      FROM public.auth_user_profile_v v
     WHERE v.user_id::text = $1 OR v.username = $1
     LIMIT 1`;
  const r = await pool.query(q, [p]);
  res.json(r.rows[0] || { user_id: null, username: p, setor: null, funcao: null });
});

router.put('/:id/profile', selfOrAdmin, async (req, res) => {
  const { setor, funcao } = req.body || {};
  if (!setor && !funcao) return res.status(400).json({ error: 'Nada para atualizar' });

  const c = await pool.connect();
  try {
    const target = await resolveTarget(c, req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

    await c.query('SELECT public.auth_profile_set($1,$2,$3)', [
      target.id,
      setor || NULL,
      funcao || NULL
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[profile:set]', e);
    res.status(500).json({ error: 'Falha ao salvar perfil' });
  } finally { c.release(); }
});

/* -------- permissões -------- */
router.get('/:id/permissions/tree', selfOrAdmin, async (req, res) => {
  const c = await pool.connect();
  try {
    // aceita id ou username
    const t = await resolveTarget(c, req.params.id);
    if (!t) return res.status(404).json({ error: 'Usuário não encontrado' });
    const r = await c.query('SELECT * FROM public.auth_user_permissions_tree($1)', [t.id]);
    res.json({ user: { id: t.id, username: t.username }, nodes: r.rows });
  } finally { c.release(); }
});

/* Define overrides explícitos por usuário.
   body: { overrides: { "<key>": true|false|null, ... } }
   true/false => UPSERT; null => REMOVE override
*/
router.put('/:id/permissions/overrides', selfOrAdmin, async (req, res) => {
  const map = req.body?.overrides || {};
  const c = await pool.connect();
  try {
    const t = await resolveTarget(c, req.params.id);
    if (!t) return res.status(404).json({ error: 'Usuário não encontrado' });

    // resolve keys -> ids
    const keys = Object.keys(map);
    if (keys.length === 0) return res.json({ ok: true });

    const qids = await c.query(
      'SELECT id, key FROM public.nav_node WHERE key = ANY($1::text[])',
      [keys]
    );
    const idByKey = Object.fromEntries(qids.rows.map(r => [r.key, r.id]));

    // aplica mudanças
    for (const k of keys) {
      const v = map[k];
      const nodeId = idByKey[k];
      if (!nodeId) continue;
      if (v === null) {
        await c.query('DELETE FROM public.auth_user_permission WHERE user_id=$1 AND node_id=$2', [t.id, nodeId]);
      } else {
        await c.query(`
          INSERT INTO public.auth_user_permission(user_id, node_id, allow)
          VALUES ($1,$2,$3)
          ON CONFLICT (user_id,node_id) DO UPDATE SET allow=EXCLUDED.allow
        `, [t.id, nodeId, !!v]);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[perm:overrides]', e);
    res.status(500).json({ error: 'Falha ao salvar permissões' });
  } finally { c.release(); }
});

module.exports = router;
