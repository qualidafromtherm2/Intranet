// routes/nav.js
const express = require('express');
const { Pool } = require('pg');

const router = express.Router();
router.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// checa se o usuário logado pode "gerenciar colaboradores" (mesma regra que lista usuários)
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

function requireLogin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Não autenticado' });
  next();
}

/**
 * POST /api/nav/sync
 * Body: { nodes: [{ key, label, position: 'side'|'top', parentKey?, sort?, selector? }, ...] }
 * - Faz upsert em public.nav_node
 * - parentKey é chave do pai (se vier, resolvemos para parent_id)
 */
router.post('/sync', requireLogin, async (req, res) => {
  const me = req.session.user;
  if (!(await hasManagePermission(me.id))) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const nodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
  if (!nodes.length) return res.status(400).json({ error: 'Lista vazia' });

  // index de pais para resolver parent_id por key
  const parentKeys = [...new Set(nodes.map(n => n.parentKey).filter(Boolean))];
  const parentMap = new Map();

  if (parentKeys.length) {
    const { rows } = await pool.query(
      `SELECT key, id FROM public.nav_node WHERE key = ANY($1::text[])`,
      [parentKeys]
    );
    rows.forEach(r => parentMap.set(r.key, r.id));
  }

  // upsert um por um (lista tipicamente pequena)
  for (const n of nodes) {
    const { key, label, position, selector } = n;
    if (!key || !label || !position) continue;

    const sort = Number.isFinite(n.sort) ? n.sort : 0;
    const parent_id = n.parentKey ? (parentMap.get(n.parentKey) || null) : null;

    // se parentKey veio mas o pai ainda não existe, tentamos criar o pai “rótulo” (sem selector)
    if (n.parentKey && parent_id == null) {
      const up = await pool.query(
        `INSERT INTO public.nav_node(key, label, position, parent_id, sort, selector, active)
         VALUES ($1,$2,$3,NULL,0,NULL,TRUE)
         ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, position=EXCLUDED.position, active=TRUE
         RETURNING id`,
        [n.parentKey, n.parentKey.split(':').pop(), position]
      );
      parentMap.set(n.parentKey, up.rows[0].id);
    }

    await pool.query(
      `INSERT INTO public.nav_node(key,label,position,parent_id,sort,selector,active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)
       ON CONFLICT (key) DO UPDATE
         SET label    = EXCLUDED.label,
             position = EXCLUDED.position,
             parent_id= COALESCE(EXCLUDED.parent_id, public.nav_node.parent_id),
             sort     = EXCLUDED.sort,
             selector = COALESCE(EXCLUDED.selector, public.nav_node.selector),
             active   = TRUE`,
      [key, label, position, parentMap.get(n.parentKey) || null, sort, selector || null]
    );
  }

  res.json({ ok: true, upserted: nodes.length });
});

// debug opcional
router.get('/known', requireLogin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, key, label, position, parent_id, sort, selector
       FROM public.nav_node
      WHERE active = TRUE
      ORDER BY position, parent_id NULLS FIRST, sort, id`
  );
  res.json(rows);
});

module.exports = router;
