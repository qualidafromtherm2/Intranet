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
           s.concluido, s.nao_aplicavel, s.observacao, s.data_conclusao,
           s.responsavel_username AS responsavel,
           s.autor_username AS autor,
           s.prazo
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
        const { atividade_id, concluido, nao_aplicavel, observacao, responsavel, autor, prazo } = it;
        const data_conclusao = concluido ? new Date() : null;
        const prazoDate = prazo ? new Date(prazo) : null;
        await client.query(`
          INSERT INTO compras.atividades_produto_status
            (produto_codigo, produto_id_omie, atividade_id, concluido, nao_aplicavel, observacao, data_conclusao, responsavel_username, autor_username, prazo)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (produto_codigo, atividade_id)
          DO UPDATE SET concluido=EXCLUDED.concluido, nao_aplicavel=EXCLUDED.nao_aplicavel,
                        observacao=EXCLUDED.observacao, data_conclusao=EXCLUDED.data_conclusao,
                        responsavel_username = EXCLUDED.responsavel_username,
                        autor_username = EXCLUDED.autor_username,
                        prazo = EXCLUDED.prazo,
                        updated_at=NOW();
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
      await (async ()=>{ try{ await client.query('ROLLBACK'); }catch(_){} })();
      console.error('[POST /api/compras/produto-status/bulk] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Criar atividade específica de um produto
  router.post('/atividade-produto', async (req, res) => {
    const client = await pool.connect();
    try {
      const { produto_codigo, descricao, observacoes } = req.body;
      
      if (!produto_codigo || !descricao) {
        return res.status(400).json({ error: 'produto_codigo e descricao são obrigatórios' });
      }
      
      const { rows } = await client.query(`
        INSERT INTO compras.atividades_produto 
          (produto_codigo, descricao, observacoes, ativo, criado_em)
        VALUES ($1, $2, $3, true, NOW())
        RETURNING id, produto_codigo, descricao, observacoes, ativo, criado_em
      `, [produto_codigo, descricao, observacoes || null]);
      
      console.log(`[Compras] Nova atividade criada para produto ${produto_codigo}: ${descricao}`);
      res.json({ success: true, atividade: rows[0] });
    } catch (e) {
      console.error('[POST /api/compras/atividade-produto] erro:', e);
      res.status(500).json({ error: 'Falha ao criar atividade do produto' });
    } finally {
      client.release();
    }
  });

  // Listar atividades específicas de um produto
  router.get('/atividades-produto/:codigo', async (req, res) => {
    const client = await pool.connect();
    try {
      const { codigo } = req.params;
      
      const { rows } = await client.query(`
        SELECT 
          ap.id,
          ap.produto_codigo,
          ap.descricao AS nome,
          ap.observacoes,
          ap.ativo,
          ap.criado_em,
          COALESCE(aps.concluido, false) AS concluido,
          COALESCE(aps.nao_aplicavel, false) AS nao_aplicavel,
          COALESCE(aps.observacao_status, '') AS observacao_status,
          aps.responsavel_username AS responsavel,
          aps.autor_username AS autor,
          aps.prazo,
          aps.atualizado_em
        FROM compras.atividades_produto ap
        LEFT JOIN compras.atividades_produto_status_especificas aps
          ON aps.atividade_produto_id = ap.id AND aps.produto_codigo = ap.produto_codigo
        WHERE ap.produto_codigo = $1 AND ap.ativo = true
        ORDER BY ap.criado_em DESC
      `, [codigo]);
      
      res.json({ atividades: rows });
    } catch (e) {
      console.error('[GET /api/compras/atividades-produto] erro:', e);
      res.status(500).json({ error: 'Falha ao buscar atividades do produto' });
    } finally {
      client.release();
    }
  });

  // Salvar status das atividades específicas do produto em bulk
  router.post('/atividade-produto-status/bulk', async (req, res) => {
    const client = await pool.connect();
    try {
      const { produto_codigo, itens } = req.body || {};
      if (!produto_codigo || !Array.isArray(itens)) {
        return res.status(400).json({ error: 'produto_codigo e itens são obrigatórios' });
      }
      
      await client.query('BEGIN');
      
      for (const it of itens) {
        const { atividade_produto_id, concluido, nao_aplicavel, observacao, responsavel, autor, prazo } = it;
        const data_conclusao = concluido ? new Date() : null;
        const prazoDate = prazo ? new Date(prazo) : null;
        
        await client.query(`
          INSERT INTO compras.atividades_produto_status_especificas
            (produto_codigo, atividade_produto_id, concluido, nao_aplicavel, observacao_status, data_conclusao, responsavel_username, autor_username, prazo)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (produto_codigo, atividade_produto_id)
          DO UPDATE SET
            concluido = EXCLUDED.concluido,
            nao_aplicavel = EXCLUDED.nao_aplicavel,
            observacao_status = EXCLUDED.observacao_status,
            data_conclusao = EXCLUDED.data_conclusao,
            responsavel_username = EXCLUDED.responsavel_username,
            autor_username = EXCLUDED.autor_username,
            prazo = EXCLUDED.prazo,
            atualizado_em = NOW()
        `, [
          produto_codigo,
          atividade_produto_id,
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
      console.error('[POST /api/compras/atividade-produto-status/bulk] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Busca solicitações de compras para recebimento
  router.get('/solicitacoes-recebimento', async (req, res) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`
        SELECT 
          cnumero,
          id,
          produto_codigo,
          produto_descricao,
          quantidade,
          solicitante,
          previsao_chegada,
          resp_inspecao_recebimento,
          observacao,
          created_at
        FROM compras.solicitacao_compras
        WHERE status = 'compra realizada'
        AND cnumero IS NOT NULL
        ORDER BY cnumero DESC, id ASC
      `);
      res.json(rows);
    } catch (e) {
      console.error('[GET /api/compras/solicitacoes-recebimento] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  return router;
};
