/**
 * routes/usuario.js — Preferências de usuário (impressora padrão, etc.)
 *
 * Tabela: usuario.usuario_preferencias (login, chave, valor, atualizado_em)
 *
 * Chaves usadas: impressora_envio, impressora_etiquetas, menu_grupos_recolhidos
 *
 * GET  /api/usuario/preferencias/:chave  → { valor } ou { valor: null }
 * POST /api/usuario/preferencias         → { chave, valor } upsert → { ok: true }
 * GET  /api/usuario/notificacao-preferencias → catálogo + preferências do usuário
 * PUT  /api/usuario/notificacao-preferencias → salva preferências de notificação
 */

const express = require('express');
const router  = express.Router();
const { dbQuery } = require('../src/db.js');
const {
  ensureSchema: ensureNotificacaoPreferenciasSchema,
  getPreferencias,
  setPreferencias,
} = require('../utils/notificacaoPreferencias');

// Garante que a tabela existe na primeira execução
(async () => {
  try {
    await dbQuery(`CREATE SCHEMA IF NOT EXISTS usuario`);
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS usuario.usuario_preferencias (
        login        TEXT        NOT NULL,
        chave        TEXT        NOT NULL,
        valor        TEXT,
        atualizado_em TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (login, chave)
      )
    `);
    console.log('[usuario] Tabela usuario_preferencias pronta.');
  } catch (e) {
    console.warn('[usuario] Falha ao criar tabela usuario_preferencias:', e.message);
  }
  try {
    await ensureNotificacaoPreferenciasSchema();
    console.log('[usuario] Tabela notificacao_preferencias pronta.');
  } catch (e) {
    console.warn('[usuario] Falha ao criar tabela notificacao_preferencias:', e.message);
  }
})();

// Middleware: exige sessão autenticada
function requireAuth(req, res, next) {
  const login = req.session?.user?.username || req.session?.user?.login || req.session?.usuario;
  if (!login) return res.status(401).json({ ok: false, error: 'Não autenticado' });
  req.loginUsuario = login;
  next();
}

function userIdDaSessao(req) {
  const raw = req.session?.user?.id ?? req.session?.userId ?? null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// GET /api/usuario/preferencias/:chave
router.get('/preferencias/:chave', requireAuth, async (req, res) => {
  const { chave } = req.params;
  if (!chave) return res.status(400).json({ ok: false, error: 'chave obrigatória' });
  try {
    const { rows } = await dbQuery(
      `SELECT valor FROM usuario.usuario_preferencias WHERE login = $1 AND chave = $2 LIMIT 1`,
      [req.loginUsuario, chave]
    );
    return res.json({ valor: rows.length ? rows[0].valor : null });
  } catch (e) {
    console.error('[usuario] Erro ao buscar preferência:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/usuario/preferencias  — body: { chave, valor }
router.post('/preferencias', requireAuth, async (req, res) => {
  const { chave, valor } = req.body || {};
  if (!chave) return res.status(400).json({ ok: false, error: 'chave obrigatória' });
  try {
    await dbQuery(
      `INSERT INTO usuario.usuario_preferencias (login, chave, valor, atualizado_em)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (login, chave) DO UPDATE
         SET valor = EXCLUDED.valor, atualizado_em = NOW()`,
      [req.loginUsuario, chave, valor ?? null]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[usuario] Erro ao salvar preferência:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/usuario/notificacao-preferencias
router.get('/notificacao-preferencias', requireAuth, async (req, res) => {
  try {
    const userId = userIdDaSessao(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Sessão sem user_id' });
    }
    const data = await getPreferencias(userId);
    return res.json({ ok: true, ...data });
  } catch (e) {
    console.error('[usuario] Erro ao buscar notificacao-preferencias:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/usuario/notificacao-preferencias  — body: { preferencias: [{ tipo, canal, habilitado }] }
router.put('/notificacao-preferencias', requireAuth, async (req, res) => {
  try {
    const userId = userIdDaSessao(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Sessão sem user_id' });
    }
    const lista = req.body?.preferencias ?? req.body?.itens ?? req.body;
    const data = await setPreferencias(userId, lista);
    return res.json({ ok: true, ...data });
  } catch (e) {
    console.error('[usuario] Erro ao salvar notificacao-preferencias:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
