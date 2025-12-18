// routes/engenharia.js
const express = require('express');
const router = express.Router();

module.exports = (pool) => {
  
  // GET /api/engenharia/atividades/:familiaCodigo - Lista atividades de uma família
  router.get('/atividades/:familiaCodigo', async (req, res) => {
    const client = await pool.connect();
    try {
      const { familiaCodigo } = req.params;
      
      const result = await client.query(`
        SELECT 
          id,
          familia_codigo,
          nome_atividade,
          descricao_atividade,
          ordem,
          ativo,
          created_at
        FROM engenharia.atividades_familia
        WHERE familia_codigo = $1 AND ativo = true
        ORDER BY ordem ASC, created_at ASC
      `, [familiaCodigo]);
      
      res.json(result.rows);
      
    } catch (e) {
      console.error('[GET /api/engenharia/atividades] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });
  
  // POST /api/engenharia/atividades - Cria nova atividade
  router.post('/atividades', async (req, res) => {
    const client = await pool.connect();
    try {
      const { familiaCodigo, nomeAtividade, descricaoAtividade, ordem } = req.body;
      
      if (!familiaCodigo || !nomeAtividade) {
        return res.status(400).json({ error: 'familiaCodigo e nomeAtividade são obrigatórios' });
      }
      
      const result = await client.query(`
        INSERT INTO engenharia.atividades_familia 
          (familia_codigo, nome_atividade, descricao_atividade, ordem)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [familiaCodigo, nomeAtividade, descricaoAtividade || '', ordem || 0]);
      
      res.json({ ok: true, atividade: result.rows[0] });
      
    } catch (e) {
      console.error('[POST /api/engenharia/atividades] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });
  
  // DELETE /api/engenharia/atividades/:id - Remove (soft delete) uma atividade
  router.delete('/atividades/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      
      await client.query(`
        UPDATE engenharia.atividades_familia
        SET ativo = false
        WHERE id = $1
      `, [id]);
      
      res.json({ ok: true });
      
    } catch (e) {
      console.error('[DELETE /api/engenharia/atividades] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // GET /api/engenharia/produto-atividades?codigo=...&familia=...
  // Retorna a lista de atividades da família com o status (concluído/NA/obs/data) do produto
  router.get('/produto-atividades', async (req, res) => {
    const client = await pool.connect();
    try {
      const { codigo, familia } = req.query;
      if (!codigo || !familia) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios: codigo, familia' });
      }
      const sql = `
        SELECT 
          af.id,
          af.nome_atividade,
          af.descricao_atividade,
          s.concluido,
          s.nao_aplicavel,
          s.observacao,
          s.data_conclusao,
          s.responsavel_username AS responsavel,
          s.autor_username AS autor,
          s.prazo
        FROM engenharia.atividades_familia af
        LEFT JOIN engenharia.atividades_produto_status s
          ON s.atividade_id = af.id AND s.produto_codigo = $1
        WHERE af.familia_codigo = $2 AND af.ativo = true
        ORDER BY af.ordem ASC, af.created_at ASC;
      `;
      const { rows } = await client.query(sql, [codigo, familia]);
      res.json(rows);
    } catch (e) {
      console.error('[GET /api/engenharia/produto-atividades] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // POST /api/engenharia/produto-status/bulk
  // Salva (upsert) o status das atividades de um produto
  router.post('/produto-status/bulk', async (req, res) => {
    const client = await pool.connect();
    try {
      const { produto_codigo, produto_id_omie, itens } = req.body || {};
      if (!produto_codigo || !Array.isArray(itens)) {
        return res.status(400).json({ error: 'produto_codigo e itens são obrigatórios' });
      }
      await client.query('BEGIN');
      for (const it of itens) {
        const { atividade_id, concluido, nao_aplicavel, observacao, responsavel, autor, prazo } = it;
        const data_conclusao = concluido ? new Date() : null;
        const prazoDate = prazo ? new Date(prazo) : null;
        await client.query(`
          INSERT INTO engenharia.atividades_produto_status
            (produto_codigo, produto_id_omie, atividade_id, concluido, nao_aplicavel, observacao, data_conclusao, responsavel_username, autor_username, prazo)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (produto_codigo, atividade_id)
          DO UPDATE SET
            concluido = EXCLUDED.concluido,
            nao_aplicavel = EXCLUDED.nao_aplicavel,
            observacao = EXCLUDED.observacao,
            data_conclusao = EXCLUDED.data_conclusao,
            responsavel_username = EXCLUDED.responsavel_username,
            autor_username = EXCLUDED.autor_username,
            prazo = EXCLUDED.prazo,
            updated_at = NOW();
        `, [
          produto_codigo,
          produto_id_omie || null,
          atividade_id,
          !!concluido,
          !!nao_aplicavel,
          observacao || '',
          data_conclusao,
          responsavel || null,
          autor || null,
          prazoDate
        ]);
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await (async () => { try { await client.query('ROLLBACK'); } catch(_){} })();
      console.error('[POST /api/engenharia/produto-status/bulk] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });
  
  return router;
};
