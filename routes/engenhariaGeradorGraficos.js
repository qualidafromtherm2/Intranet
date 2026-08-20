// routes/engenhariaGeradorGraficos.js — snapshots do gerador + busca de testes.leituras
'use strict';

const express = require('express');

function loginDaSessao(req) {
  const u = req.session?.user || req.session?.usuario || {};
  const login = u.username || u.login || u.nome || req.session?.usuario;
  return typeof login === 'string' ? login : '';
}

function slugTitulo(texto) {
  const s = String(texto || 'grafico')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return s || 'grafico';
}

function stampNome(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}${p(d.getMonth() + 1)}${p(d.getHours())}${p(d.getMinutes())}`;
}

module.exports = function engenhariaGeradorGraficosRouter(pool) {
  const router = express.Router();
  let schemaOk = false;

  async function ensureSchema() {
    if (schemaOk) return;
    await pool.query(`CREATE SCHEMA IF NOT EXISTS engenharia`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS engenharia.gerador_graficos_salvos (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        usuario TEXT NOT NULL,
        titulo TEXT,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS gerador_graficos_salvos_criado_idx
        ON engenharia.gerador_graficos_salvos (criado_em DESC)
    `);
    schemaOk = true;
  }

  function requireAuth(req, res, next) {
    const login = loginDaSessao(req);
    if (!login) return res.status(401).json({ error: 'Não autenticado.' });
    req.loginUsuario = login;
    next();
  }

  router.use(requireAuth);

  router.get('/salvos', async (_req, res) => {
    try {
      await ensureSchema();
      const { rows } = await pool.query(`
        SELECT id, nome, usuario, titulo, criado_em
          FROM engenharia.gerador_graficos_salvos
         ORDER BY criado_em DESC
         LIMIT 200
      `);
      res.json({ ok: true, itens: rows || [] });
    } catch (err) {
      console.error('[gerador-graficos/salvos GET]', err);
      res.status(500).json({ error: err.message || 'Falha ao listar gráficos salvos.' });
    }
  });

  router.get('/salvos/:id', async (req, res) => {
    try {
      await ensureSchema();
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const { rows } = await pool.query(
        `SELECT id, nome, usuario, titulo, config, criado_em
           FROM engenharia.gerador_graficos_salvos WHERE id = $1`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Gráfico não encontrado.' });
      res.json({ ok: true, item: rows[0] });
    } catch (err) {
      console.error('[gerador-graficos/salvos/:id]', err);
      res.status(500).json({ error: err.message || 'Falha ao abrir gráfico salvo.' });
    }
  });

  router.post('/salvos', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      await ensureSchema();
      const nomeLivre = String(req.body?.nome || '').trim();
      const titulo = nomeLivre || String(req.body?.titulo || '').trim() || 'grafico';
      const config = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};
      const agora = new Date();
      const baseSlug = slugTitulo(nomeLivre || titulo);
      const nome = `${req.loginUsuario}_${baseSlug}_${stampNome(agora)}`;
      const { rows } = await pool.query(
        `INSERT INTO engenharia.gerador_graficos_salvos (nome, usuario, titulo, config)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, nome, usuario, titulo, criado_em`,
        [nome, req.loginUsuario, titulo, JSON.stringify(config)]
      );
      res.json({ ok: true, item: rows[0] });
    } catch (err) {
      console.error('[gerador-graficos/salvos POST]', err);
      res.status(500).json({ error: err.message || 'Falha ao gravar gráfico.' });
    }
  });

  router.get('/testes/colunas', async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT column_name, ordinal_position, data_type
          FROM information_schema.columns
         WHERE table_schema = 'testes' AND table_name = 'leituras'
         ORDER BY ordinal_position
      `);
      const todas = rows || [];
      const ini = todas.findIndex((c) => c.column_name === 'temp_ambiente');
      const recorte = (ini >= 0 ? todas.slice(ini) : todas).filter((c) => {
        const t = String(c.data_type || '');
        return /numeric|double|real|integer|decimal/i.test(t);
      });
      res.json({
        ok: true,
        colunas: recorte.map((c) => c.column_name),
      });
    } catch (err) {
      console.error('[gerador-graficos/testes/colunas]', err);
      res.status(500).json({ error: err.message || 'Falha ao listar colunas.' });
    }
  });

  router.get('/testes/modelos', async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT modelo, COUNT(*)::int AS qtd
          FROM testes.relatorios
         WHERE modelo IS NOT NULL AND BTRIM(modelo) <> ''
         GROUP BY modelo
         ORDER BY modelo
      `);
      res.json({ ok: true, modelos: rows || [] });
    } catch (err) {
      console.error('[gerador-graficos/testes/modelos]', err);
      res.status(500).json({ error: err.message || 'Falha ao listar modelos.' });
    }
  });

  router.get('/testes/buscar', async (req, res) => {
    try {
      const tipo = String(req.query.tipo || 'op').trim();
      const q = String(req.query.q || '').trim();
      if (!q) return res.json({ ok: true, relatorios: [] });
      const params = [`%${q}%`];
      const where = tipo === 'modelo'
        ? 'r.modelo ILIKE $1'
        : '(r.num_op ILIKE $1 OR r.operador ILIKE $1)';
      const { rows } = await pool.query(
        `SELECT r.id, r.criado_em, r.linha, r.modelo, r.num_op, r.operador, r.total_registros
           FROM testes.relatorios r
          WHERE ${where}
          ORDER BY r.criado_em DESC NULLS LAST, r.id DESC
          LIMIT 80`,
        params
      );
      res.json({ ok: true, relatorios: rows || [] });
    } catch (err) {
      console.error('[gerador-graficos/testes/buscar]', err);
      res.status(500).json({ error: err.message || 'Falha ao buscar testes.' });
    }
  });

  router.get('/testes/:id/leituras', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const rel = await pool.query(
        `SELECT id, criado_em, linha, modelo, num_op, operador, total_registros
           FROM testes.relatorios WHERE id = $1`,
        [id]
      );
      if (!rel.rows.length) return res.status(404).json({ error: 'Teste não encontrado.' });
      const { rows } = await pool.query(
        `SELECT * FROM testes.leituras
          WHERE relatorio_id = $1
          ORDER BY data_hora ASC NULLS LAST, id ASC`,
        [id]
      );
      res.json({ ok: true, relatorio: rel.rows[0], leituras: rows || [] });
    } catch (err) {
      console.error('[gerador-graficos/testes/:id/leituras]', err);
      res.status(500).json({ error: err.message || 'Falha ao carregar leituras.' });
    }
  });

  return router;
};
