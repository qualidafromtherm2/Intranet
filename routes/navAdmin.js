'use strict';

const express = require('express');
const { pool } = require('../src/db');
const { sessionEhAdmin } = require('../utils/navPermissions');

const router = express.Router();
router.use(express.json());

let schemaOk = false;

async function ensureSchema() {
  if (schemaOk) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.nav_botao_historico (
      id              BIGSERIAL PRIMARY KEY,
      nav_key         TEXT NOT NULL,
      nav_label       TEXT,
      tipo            TEXT NOT NULL,
      descricao       TEXT,
      referencia_id   BIGINT,
      usuario         TEXT,
      usuario_nome    TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_nav_botao_hist_key
      ON public.nav_botao_historico (nav_key, created_at DESC)
  `);
  schemaOk = true;
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ ok: false, error: 'Não autenticado.' });
  if (!sessionEhAdmin(req)) return res.status(403).json({ ok: false, error: 'Somente administrador.' });
  next();
}

function getUsuario(req) {
  const u = req.session.user || {};
  return {
    login: String(u.username || u.id || '').trim(),
    nome: String(u.nome || u.name || u.username || u.id || '').trim(),
  };
}

async function registrarHistorico({ navKey, navLabel, tipo, descricao, referenciaId, req }) {
  await ensureSchema();
  const { login, nome } = getUsuario(req);
  await pool.query(
    `INSERT INTO public.nav_botao_historico
       (nav_key, nav_label, tipo, descricao, referencia_id, usuario, usuario_nome)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      navKey,
      navLabel || null,
      tipo,
      descricao || null,
      referenciaId || null,
      login || null,
      nome || null,
    ]
  );
}

async function parentKeyFromId(parentId) {
  if (!parentId) return null;
  const { rows } = await pool.query(
    `SELECT key FROM public.nav_node WHERE id = $1 LIMIT 1`,
    [parentId]
  );
  return rows[0]?.key || null;
}

router.use(requireAdmin);

// GET /api/nav/admin/botoes — lista botões do menu lateral
router.get('/botoes', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        n.id,
        n.key,
        n.label,
        n.selector,
        n.sort,
        n.position,
        p.key AS parent_key
      FROM public.nav_node n
      LEFT JOIN public.nav_node p ON p.id = n.parent_id
      WHERE n.active = TRUE
        AND n.position = 'side'
        AND COALESCE(n.selector, '') <> ''
      ORDER BY p.sort NULLS FIRST, p.id NULLS FIRST, n.sort, n.id
    `);
    res.json({ ok: true, botoes: rows });
  } catch (err) {
    console.error('[nav/admin/botoes]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/nav/admin/ordem — mapa de ordenação salva
router.get('/ordem', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        n.key,
        n.sort,
        n.parent_id,
        p.key AS parent_key
      FROM public.nav_node n
      LEFT JOIN public.nav_node p ON p.id = n.parent_id
      WHERE n.active = TRUE AND n.position = 'side'
    `);
    res.json({ ok: true, ordem: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/nav/admin/renomear
router.patch('/renomear', async (req, res) => {
  try {
    const navKey = String(req.body?.nav_key || '').trim();
    const label = String(req.body?.label || '').trim();
    if (!navKey || !label) {
      return res.status(400).json({ ok: false, error: 'nav_key e label são obrigatórios.' });
    }

    const { rows } = await pool.query(
      `UPDATE public.nav_node
          SET label = $2
        WHERE key = $1 AND active = TRUE
        RETURNING id, key, label`,
      [navKey, label]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Botão não encontrado.' });

    await registrarHistorico({
      navKey,
      navLabel: label,
      tipo: 'renomear',
      descricao: `Botão renomeado para "${label}"`,
      req,
    });

    res.json({ ok: true, botao: rows[0] });
  } catch (err) {
    console.error('[nav/admin/renomear]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/nav/admin/reordenar
// Body: { nav_key, parent_key, items: [{ key, sort }] }
router.post('/reordenar', async (req, res) => {
  try {
    const navKey = String(req.body?.nav_key || '').trim();
    const parentKey = String(req.body?.parent_key || '').trim() || null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!navKey || !items.length) {
      return res.status(400).json({ ok: false, error: 'Informe nav_key e a lista items.' });
    }

    let parentId = null;
    if (parentKey) {
      const { rows: pRows } = await pool.query(
        `SELECT id FROM public.nav_node WHERE key = $1 LIMIT 1`,
        [parentKey]
      );
      parentId = pRows[0]?.id || null;
    }

    for (const it of items) {
      const key = String(it?.key || '').trim();
      const sort = Number(it?.sort);
      if (!key || !Number.isFinite(sort)) continue;
      await pool.query(
        `UPDATE public.nav_node
            SET sort = $2,
                parent_id = COALESCE($3, parent_id)
          WHERE key = $1`,
        [key, sort, parentId]
      );
    }

    const labelAtual = items.find((i) => i.key === navKey)?.label
      || (await pool.query(`SELECT label FROM public.nav_node WHERE key = $1`, [navKey])).rows[0]?.label;

    await registrarHistorico({
      navKey,
      navLabel: labelAtual,
      tipo: 'reordenar',
      descricao: parentKey ? `Posição alterada (grupo ${parentKey})` : 'Posição alterada no menu',
      req,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[nav/admin/reordenar]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/nav/admin/historico/:navKey
router.get('/historico/:navKey', async (req, res) => {
  try {
    await ensureSchema();
    const navKey = String(req.params.navKey || '').trim();
    if (!navKey) return res.status(400).json({ ok: false, error: 'nav_key inválido.' });

    const [histRes, chamRes] = await Promise.all([
      pool.query(
        `SELECT id, nav_key, nav_label, tipo, descricao, referencia_id,
                usuario, usuario_nome, created_at
           FROM public.nav_botao_historico
          WHERE nav_key = $1
          ORDER BY created_at DESC
          LIMIT 200`,
        [navKey]
      ),
      pool.query(
        `SELECT id, descricao, criticidade, status, criado_por, criado_por_nome, criado_em
           FROM suporte."Chamado"
          WHERE nav_key = $1
          ORDER BY criado_em DESC
          LIMIT 100`,
        [navKey]
      ).catch(() => ({ rows: [] })),
    ]);

    res.json({
      ok: true,
      historico: histRes.rows,
      chamados: chamRes.rows,
    });
  } catch (err) {
    console.error('[nav/admin/historico]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/nav/admin/historico/:navKey/atividade
router.post('/historico/:navKey/atividade', async (req, res) => {
  try {
    const navKey = String(req.params.navKey || '').trim();
    const descricao = String(req.body?.descricao || '').trim();
    const navLabel = String(req.body?.nav_label || '').trim() || null;
    const referenciaId = Number(req.body?.referencia_id) || null;
    const tipo = String(req.body?.tipo || 'atividade').trim() || 'atividade';
    if (!navKey || !descricao) {
      return res.status(400).json({ ok: false, error: 'Descrição obrigatória.' });
    }

    await registrarHistorico({ navKey, navLabel, tipo, descricao, referenciaId, req });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/nav/admin/usuarios — combobox visão cliente
router.get('/usuarios', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id::text AS id, u.username::text AS username,
             COALESCE(NULLIF(TRIM(u.nome_completo), ''), u.username::text) AS nome
        FROM public.auth_user u
       ORDER BY u.username
    `);
    res.json({ ok: true, usuarios: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/nav/admin/visao-cliente/:userId
router.get('/visao-cliente/:userId', async (req, res) => {
  try {
    const uid = String(req.params.userId || '').trim();
    const { rows: uRows } = await pool.query(
      `SELECT id FROM public.auth_user WHERE id::text = $1 OR username = $1 LIMIT 1`,
      [uid]
    );
    if (!uRows.length) return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });

    const userId = uRows[0].id;
    const { rows } = await pool.query(
      `SELECT t.id, t.parent_id, t.key, t.label, t.pos, t.sort, t.allowed, t.user_override,
              (SELECT selector FROM public.nav_node n WHERE n.id = t.id) AS selector
         FROM public.auth_user_permissions_tree($1) t
        ORDER BY t.pos, t.parent_id NULLS FIRST, t.sort, t.id`,
      [userId]
    );
    res.json({ ok: true, userId: String(userId), nodes: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
module.exports.registrarHistoricoNav = registrarHistorico;
