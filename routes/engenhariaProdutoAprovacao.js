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
  const {
    LOCAL_AREA_VERMELHA,
    LOCAL_ENG_AMOSTRAS
  } = require('../utils/locaisSeparacaoBloqueados');

  router.get('/produto-aprovacao', async (req, res) => {
    try {
      await ensureProdutoAprovacaoTable();
      const status = String(req.query.status || '').trim().toLowerCase();
      if (!STATUS_OK.has(status) || status === 'aprovado') {
        return res.status(400).json({ error: 'Use status=reprovado ou status=projeto.' });
      }
      const localAlvo = status === 'reprovado' ? LOCAL_AREA_VERMELHA : LOCAL_ENG_AMOSTRAS;
      const q = String(req.query.q || '').trim();
      const like = q ? `%${q}%` : null;
      const result = await dbQuery(
        `WITH ult AS (
           SELECT DISTINCT ON (TRIM(a.codigo_produto))
                  a.id, a.codigo_produto, a.codigo, a.status, a.definido_por, a.definido_em, a.etq_recebimento_id
             FROM engenharia.produto_aprovacao a
            WHERE a.status = $1
            ORDER BY TRIM(a.codigo_produto), a.definido_em DESC, a.id DESC
         )
         SELECT u.id, u.codigo_produto, u.codigo, u.status, u.definido_por, u.definido_em, u.etq_recebimento_id,
                COALESCE(p.descricao, r.descricao_produto, '') AS descricao,
                r.numero_nfe, r.lote, r.qtd AS qtd_recebimento,
                (
                  SELECT string_agg(i.id::text, ', ' ORDER BY i.id)
                    FROM etiqueta."ETQ_rec_impresso" i
                    LEFT JOIN produto.produtos_omie p2
                      ON TRIM(i.codigo_produto) IN (p2.codigo_produto::text, TRIM(p2.codigo))
                   WHERE COALESCE(i.qtd, 0) > 0
                     AND TRIM(COALESCE(i.local_estoque_codigo, '')) = $2
                     AND (
                       TRIM(COALESCE(p2.codigo, '')) = TRIM(u.codigo_produto)
                       OR TRIM(COALESCE(p2.codigo_produto::text, '')) = TRIM(u.codigo_produto)
                       OR (u.etq_recebimento_id IS NOT NULL AND i.origem_id = u.etq_recebimento_id)
                     )
                ) AS ids_armazem
           FROM ult u
           LEFT JOIN LATERAL (
             SELECT descricao
               FROM produto.produtos_omie
              WHERE TRIM(codigo) = TRIM(u.codigo_produto)
                 OR TRIM(codigo_produto::text) = TRIM(u.codigo_produto)
              ORDER BY codigo_produto DESC
              LIMIT 1
           ) p ON TRUE
           LEFT JOIN etiqueta."ETQ_recebimento" r ON r.id = u.etq_recebimento_id
          WHERE ($3::text IS NULL
             OR u.codigo_produto ILIKE $3
             OR COALESCE(u.codigo, '') ILIKE $3
             OR COALESCE(p.descricao, r.descricao_produto, '') ILIKE $3
             OR COALESCE(r.numero_nfe, '') ILIKE $3
             OR COALESCE(r.lote, '') ILIKE $3)
          ORDER BY u.definido_em DESC
          LIMIT 400`,
        [status, localAlvo, like]
      );
      return res.json({
        ok: true,
        status,
        status_label: STATUS_LABEL[status] || status,
        itens: (result.rows || []).map((row) => ({
          ...row,
          status_label: STATUS_LABEL[row.status] || row.status
        }))
      });
    } catch (err) {
      console.error('[engenharia/produto-aprovacao LIST]', err);
      return res.status(500).json({ error: err.message || 'Falha ao listar.' });
    }
  });

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
      if (result.rows.length) {
        const row = result.rows[0];
        return res.json({
          ok: true,
          aprovacao: {
            ...row,
            status_label: STATUS_LABEL[row.status] || row.status,
          },
        });
      }
      return res.json({ ok: true, aprovacao: null });
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
