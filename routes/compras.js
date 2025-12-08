// routes/compras.js
const express = require('express');
const router = express.Router();

module.exports = (pool) => {
  // Lista atividades de compras por família
  router.get('/atividades/:familiaCodigo', async (req, res) => {
    const client = await pool.connect();
    try {
      const { familiaCodigo } = req.params;
      const { rows } = await client.query(`
        SELECT id, familia_codigo, nome_atividade, descricao_atividade, ordem, ativo, created_at
        FROM compras.atividades_familia
        WHERE familia_codigo = $1 AND ativo = true
        ORDER BY ordem ASC, created_at ASC
      `, [familiaCodigo]);
      res.json(rows);
    } catch (e) {
      console.error('[GET /api/compras/atividades] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Cria nova atividade de compras
  router.post('/atividades', async (req, res) => {
    const client = await pool.connect();
    try {
      const { familiaCodigo, nomeAtividade, descricaoAtividade, ordem } = req.body || {};
      if (!familiaCodigo || !nomeAtividade) {
        return res.status(400).json({ error: 'familiaCodigo e nomeAtividade são obrigatórios' });
      }
      const { rows } = await client.query(`
        INSERT INTO compras.atividades_familia (familia_codigo, nome_atividade, descricao_atividade, ordem)
        VALUES ($1,$2,$3,$4) RETURNING *
      `,[familiaCodigo, nomeAtividade, descricaoAtividade || '', ordem || 0]);
      res.json({ ok: true, atividade: rows[0] });
    } catch (e) {
      console.error('[POST /api/compras/atividades] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Soft delete
  router.delete('/atividades/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      await client.query(`UPDATE compras.atividades_familia SET ativo=false WHERE id=$1`, [id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/compras/atividades/:id] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Lista atividades do produto com status
  router.get('/produto-atividades', async (req, res) => {
    const client = await pool.connect();
    try {
      const { codigo, familia } = req.query || {};
      if (!codigo || !familia) return res.status(400).json({ error: 'codigo e familia são obrigatórios' });
      const { rows } = await client.query(`
        SELECT af.id, af.nome_atividade, af.descricao_atividade,
               s.concluido, s.nao_aplicavel, s.observacao, s.data_conclusao
        FROM compras.atividades_familia af
        LEFT JOIN compras.atividades_produto_status s
          ON s.atividade_id = af.id AND s.produto_codigo = $1
        WHERE af.familia_codigo = $2 AND af.ativo = true
        ORDER BY af.ordem ASC, af.created_at ASC
      `, [codigo, familia]);
      res.json(rows);
    } catch (e) {
      console.error('[GET /api/compras/produto-atividades] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Salvar status em bulk
  router.post('/produto-status/bulk', async (req, res) => {
    const client = await pool.connect();
    try {
      const { produto_codigo, produto_id_omie, itens } = req.body || {};
      if (!produto_codigo || !Array.isArray(itens)) return res.status(400).json({ error: 'produto_codigo e itens são obrigatórios' });
      await client.query('BEGIN');
      for (const it of itens) {
        const { atividade_id, concluido, nao_aplicavel, observacao } = it;
        const data_conclusao = concluido ? new Date() : null;
        await client.query(`
          INSERT INTO compras.atividades_produto_status
            (produto_codigo, produto_id_omie, atividade_id, concluido, nao_aplicavel, observacao, data_conclusao)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (produto_codigo, atividade_id)
          DO UPDATE SET concluido=EXCLUDED.concluido, nao_aplicavel=EXCLUDED.nao_aplicavel,
                        observacao=EXCLUDED.observacao, data_conclusao=EXCLUDED.data_conclusao, updated_at=NOW();
        `, [produto_codigo, produto_id_omie || null, atividade_id, !!concluido, !!nao_aplicavel, observacao || '', data_conclusao]);
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await (async ()=>{ try{ await client.query('ROLLBACK'); }catch(_){} })();
      console.error('[POST /api/compras/produto-status/bulk] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  return router;
};
