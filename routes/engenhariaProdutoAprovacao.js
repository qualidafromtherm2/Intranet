'use strict';

const express = require('express');
const { dbQuery } = require('../src/db');

const STATUS_OK = new Set(['aprovado', 'reprovado', 'projeto']);
const STATUS_LABEL = {
  aprovado: 'Aprovado para uso',
  reprovado: 'Reprovado',
  projeto: 'Projeto',
};

async function ensureProdutoAprovacaoTable() {
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS engenharia`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS engenharia.produto_aprovacao (
      id SERIAL PRIMARY KEY,
      codigo_produto TEXT NOT NULL,
      codigo TEXT,
      status TEXT NOT NULL,
      definido_por TEXT NOT NULL,
      definido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      etq_recebimento_id INT
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_produto_aprovacao_codigo_produto_em
      ON engenharia.produto_aprovacao (codigo_produto, definido_em DESC)
  `);
}

function usuarioSessao(req) {
  const u = req.session?.user || {};
  return String(u.fullName || u.username || u.email || u.id || 'sistema').trim() || 'sistema';
}

module.exports = function engenhariaProdutoAprovacaoRouter() {
  const router = express.Router();

  router.get('/produto-aprovacao/:codigo', async (req, res) => {
    try {
      await ensureProdutoAprovacaoTable();
      const codigo = String(req.params.codigo || '').trim();
      if (!codigo) return res.status(400).json({ error: 'Código obrigatório.' });

      const result = await dbQuery(
        `SELECT id, codigo_produto, codigo, status, definido_por, definido_em, etq_recebimento_id
           FROM engenharia.produto_aprovacao
          WHERE TRIM(codigo_produto) = TRIM($1)
             OR TRIM(COALESCE(codigo, '')) = TRIM($1)
          ORDER BY definido_em DESC, id DESC
          LIMIT 1`,
        [codigo]
      );
      if (!result.rows.length) {
        return res.json({ ok: true, aprovacao: null });
      }
      const row = result.rows[0];
      return res.json({
        ok: true,
        aprovacao: {
          ...row,
          status_label: STATUS_LABEL[row.status] || row.status,
        },
      });
    } catch (err) {
      console.error('[engenharia/produto-aprovacao GET]', err);
      return res.status(500).json({ error: err.message || 'Falha ao buscar aprovação.' });
    }
  });

  router.post('/produto-aprovacao', express.json(), async (req, res) => {
    try {
      await ensureProdutoAprovacaoTable();
      const status = String(req.body?.status || '').trim().toLowerCase();
      if (!STATUS_OK.has(status)) {
        return res.status(400).json({ error: 'Status inválido. Use aprovado, reprovado ou projeto.' });
      }
      const codigoProduto = String(req.body?.codigo_produto || '').trim();
      const codigo = String(req.body?.codigo || '').trim();
      if (!codigoProduto && !codigo) {
        return res.status(400).json({ error: 'Informe codigo_produto.' });
      }
      const etqId = Number(req.body?.etq_recebimento_id || 0) || null;
      const definidoPor = usuarioSessao(req);

      const result = await dbQuery(
        `INSERT INTO engenharia.produto_aprovacao
           (codigo_produto, codigo, status, definido_por, etq_recebimento_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, codigo_produto, codigo, status, definido_por, definido_em, etq_recebimento_id`,
        [codigoProduto || codigo, codigo || null, status, definidoPor, etqId]
      );
      const row = result.rows[0];
      return res.json({
        ok: true,
        aprovacao: {
          ...row,
          status_label: STATUS_LABEL[row.status] || row.status,
        },
      });
    } catch (err) {
      console.error('[engenharia/produto-aprovacao POST]', err);
      return res.status(500).json({ error: err.message || 'Falha ao gravar aprovação.' });
    }
  });

  return router;
};
