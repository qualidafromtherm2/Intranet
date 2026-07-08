/**
 * routes/usuario.js — Preferências de usuário (impressora padrão, etc.)
 *
 * Tabela: public.usuario_preferencias (login, chave, valor, atualizado_em)
 *
 * GET  /api/usuario/preferencias/:chave  → { valor } ou { valor: null }
 * POST /api/usuario/preferencias         → { chave, valor } upsert → { ok: true }
 */

const express = require('express');
const router  = express.Router();
const { dbQuery } = require('../src/db.js');

// Garante que a tabela existe na primeira execução
(async () => {
  try {
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS public.usuario_preferencias (
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
})();

// Middleware: exige sessão autenticada
function requireAuth(req, res, next) {
  const login = req.session?.user?.username || req.session?.user?.login || req.session?.usuario;
  if (!login) return res.status(401).json({ ok: false, error: 'Não autenticado' });
  req.loginUsuario = login;
  next();
}

function isDevSessionFallbackEnabled() {
  const sessionMode = String(process.env.SESSION_STORE_MODE || '').trim().toLowerCase();
  const inMemorySession = sessionMode === 'memory' || sessionMode === 'mem' || sessionMode === 'local';
  const devSessionFlag = String(process.env.DEV_SESSION_IN_MEMORY || '').trim() === '1';
  return process.env.NODE_ENV !== 'production' && (inMemorySession || devSessionFlag);
}

// GET /api/usuario/preferencias/:chave
router.get('/preferencias/:chave', requireAuth, async (req, res) => {
  const { chave } = req.params;
  if (!chave) return res.status(400).json({ ok: false, error: 'chave obrigatória' });
  try {
    const { rows } = await dbQuery(
      `SELECT valor FROM public.usuario_preferencias WHERE login = $1 AND chave = $2 LIMIT 1`,
      [req.loginUsuario, chave]
    );
    return res.json({ valor: rows.length ? rows[0].valor : null });
  } catch (e) {
    console.error('[usuario] Erro ao buscar preferência:', e.message);
    if (isDevSessionFallbackEnabled()) {
      return res.json({ valor: null, dev: true });
    }
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/usuario/preferencias  — body: { chave, valor }
router.post('/preferencias', requireAuth, async (req, res) => {
  const { chave, valor } = req.body || {};
  if (!chave) return res.status(400).json({ ok: false, error: 'chave obrigatória' });
  try {
    await dbQuery(
      `INSERT INTO public.usuario_preferencias (login, chave, valor, atualizado_em)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (login, chave) DO UPDATE
         SET valor = EXCLUDED.valor, atualizado_em = NOW()`,
      [req.loginUsuario, chave, valor ?? null]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[usuario] Erro ao salvar preferência:', e.message);
    if (isDevSessionFallbackEnabled()) {
      return res.json({ ok: true, dev: true, skipped: true });
    }
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
