// routes/engenharia.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE
  );
}
const ENGENHARIA_BUCKET = 'Engenharia';
const PASTAS = ['Documento', 'Fotos', 'Videos'];

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
  
  // -------------------------------------------------------------------------
  // CÓDIGOS DE ERRO  (3 tabelas: codigos_erro → codigo_analise → codigo_solucao)
  // -------------------------------------------------------------------------

  // GET /api/engenharia/codigos-erro?codigo=XXX
  // Retorna lista de códigos únicos, cada um com suas análises e soluções.
  router.get('/codigos-erro', async (req, res) => {
    const client = await pool.connect();
    try {
      const codigo = String(req.query.codigo || '').trim();
      if (!codigo) {
        return res.status(400).json({ error: 'Parâmetro "codigo" é obrigatório.' });
      }

      const result = await client.query(
        `SELECT
           ce.id              AS codigo_erro_id,
           ce.codigo,
           ce.criado_por      AS codigo_criado_por,
           ca.id              AS analise_id,
           ca.analise,
           cs.id              AS solucao_id,
           cs.solucao_problema
         FROM engenharia.codigos_erro ce
         LEFT JOIN engenharia.codigo_analise ca ON ca.codigo_erro_id = ce.id
         LEFT JOIN engenharia.codigo_solucao cs ON cs.codigo_analise_id = ca.id
         WHERE ce.codigo ILIKE $1
         ORDER BY ce.id ASC, ca.id ASC, cs.id ASC`,
        [`%${codigo}%`]
      );

      // Agregar resultado flat → estrutura aninhada
      const codesMap = new Map();
      for (const row of result.rows) {
        if (!codesMap.has(row.codigo_erro_id)) {
          codesMap.set(row.codigo_erro_id, {
            id: row.codigo_erro_id,
            codigo: row.codigo,
            criado_por: row.codigo_criado_por,
            analises: []
          });
        }
        const entry = codesMap.get(row.codigo_erro_id);

        if (row.analise_id) {
          let analise = entry.analises.find(a => a.id === row.analise_id);
          if (!analise) {
            analise = { id: row.analise_id, analise: row.analise, solucoes: [] };
            entry.analises.push(analise);
          }
          if (row.solucao_id && !analise.solucoes.find(s => s.id === row.solucao_id)) {
            analise.solucoes.push({ id: row.solucao_id, solucao_problema: row.solucao_problema });
          }
        }
      }

      res.json({ ok: true, registros: Array.from(codesMap.values()) });
    } catch (e) {
      console.error('[GET /api/engenharia/codigos-erro] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // POST /api/engenharia/codigos-erro — cadastra código + análise + solução
  // Body: { codigo, analise, solucao_problema }
  router.post('/codigos-erro', async (req, res) => {
    const client = await pool.connect();
    try {
      const { codigo, analise, solucao_problema } = req.body;
      if (!codigo) {
        return res.status(400).json({ error: 'Campo "codigo" é obrigatório.' });
      }
      const criadoPor = req.session?.usuario?.username || req.session?.usuario?.nome || 'sistema';

      await client.query('BEGIN');

      // Upsert código
      let codigoErroId;
      const existing = await client.query(
        `SELECT id FROM engenharia.codigos_erro WHERE codigo = $1 LIMIT 1`,
        [codigo.trim()]
      );
      if (existing.rows.length) {
        codigoErroId = existing.rows[0].id;
      } else {
        const ins = await client.query(
          `INSERT INTO engenharia.codigos_erro (codigo, criado_por) VALUES ($1, $2) RETURNING id`,
          [codigo.trim(), criadoPor]
        );
        codigoErroId = ins.rows[0].id;
      }

      // Inserir análise
      const analiseRes = await client.query(
        `INSERT INTO engenharia.codigo_analise (codigo_erro_id, analise, criado_por)
         VALUES ($1, $2, $3) RETURNING id`,
        [codigoErroId, analise || null, criadoPor]
      );
      const analiseId = analiseRes.rows[0].id;

      // Inserir solução (se fornecida)
      if (solucao_problema && String(solucao_problema).trim()) {
        await client.query(
          `INSERT INTO engenharia.codigo_solucao (codigo_analise_id, solucao_problema, criado_por)
           VALUES ($1, $2, $3)`,
          [analiseId, solucao_problema, criadoPor]
        );
      }

      await client.query('COMMIT');
      res.json({ ok: true, codigo_erro_id: codigoErroId, analise_id: analiseId });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[POST /api/engenharia/codigos-erro] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // -------------------------------------------------------------------------
  // ARQUIVOS SUPABASE — codigos-erro/{id}/{pasta}/
  // -------------------------------------------------------------------------

  // GET /api/engenharia/codigos-erro/:id/arquivos  — lista arquivos das 3 pastas
  router.get('/codigos-erro/:id/arquivos', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const supabase = getSupabase();
      const resultado = {};
      for (const pasta of PASTAS) {
        const prefixo = `codigos-erro/${id}/${pasta}`;
        const { data, error } = await supabase.storage.from(ENGENHARIA_BUCKET).list(prefixo);
        if (error) { resultado[pasta] = []; continue; }
        resultado[pasta] = (data || [])
          .filter(f => f.name && f.name !== '.emptyFolderPlaceholder')
          .map(f => {
            const filePath = `${prefixo}/${f.name}`;
            const { data: pub } = supabase.storage.from(ENGENHARIA_BUCKET).getPublicUrl(filePath);
            return { nome: f.name, url: pub.publicUrl, path: filePath, tamanho: f.metadata?.size || 0 };
          });
      }
      res.json({ ok: true, arquivos: resultado });
    } catch (e) {
      console.error('[GET /api/engenharia/codigos-erro/:id/arquivos] erro:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/engenharia/codigos-erro/arquivo  — remove arquivo do Supabase
  // Body: { path: 'codigos-erro/1/Fotos/imagem.jpg' }
  router.delete('/codigos-erro/arquivo', async (req, res) => {
    try {
      const { path: filePath } = req.body;
      if (!filePath) return res.status(400).json({ error: 'Campo "path" obrigatório.' });
      // Segurança: só permite caminhos dentro de codigos-erro/
      if (!String(filePath).startsWith('codigos-erro/')) {
        return res.status(403).json({ error: 'Caminho não permitido.' });
      }
      const supabase = getSupabase();
      const { error } = await supabase.storage.from(ENGENHARIA_BUCKET).remove([filePath]);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/engenharia/codigos-erro/arquivo] erro:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/engenharia/codigos-erro/:id  — edita o texto do código
  router.put('/codigos-erro/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      const id = parseInt(req.params.id, 10);
      const { codigo } = req.body;
      if (!id || !codigo) return res.status(400).json({ error: 'id e codigo obrigatórios.' });
      await client.query('UPDATE engenharia.codigos_erro SET codigo = $1 WHERE id = $2', [codigo.trim(), id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[PUT /api/engenharia/codigos-erro/:id] erro:', e);
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // POST /api/engenharia/codigo-analise  — adiciona análise a um código
  router.post('/codigo-analise', async (req, res) => {
    const client = await pool.connect();
    try {
      const { codigo_erro_id, analise, solucao_problema } = req.body;
      if (!codigo_erro_id) return res.status(400).json({ error: 'codigo_erro_id obrigatório.' });
      const criadoPor = req.session?.usuario?.username || req.session?.usuario?.nome || 'sistema';
      await client.query('BEGIN');
      const analiseRes = await client.query(
        `INSERT INTO engenharia.codigo_analise (codigo_erro_id, analise, criado_por) VALUES ($1, $2, $3) RETURNING id`,
        [codigo_erro_id, analise || null, criadoPor]
      );
      const analiseId = analiseRes.rows[0].id;
      if (solucao_problema && String(solucao_problema).trim()) {
        await client.query(
          `INSERT INTO engenharia.codigo_solucao (codigo_analise_id, solucao_problema, criado_por) VALUES ($1, $2, $3)`,
          [analiseId, solucao_problema.trim(), criadoPor]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true, analise_id: analiseId });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[POST /api/engenharia/codigo-analise] erro:', e);
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // PUT /api/engenharia/codigo-analise/:id  — edita análise
  router.put('/codigo-analise/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      const id = parseInt(req.params.id, 10);
      const { analise } = req.body;
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      await client.query('UPDATE engenharia.codigo_analise SET analise = $1 WHERE id = $2', [analise || null, id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[PUT /api/engenharia/codigo-analise/:id] erro:', e);
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // DELETE /api/engenharia/codigo-analise/:id  — remove análise (e suas soluções via cascade)
  router.delete('/codigo-analise/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      await client.query('DELETE FROM engenharia.codigo_analise WHERE id = $1', [id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/engenharia/codigo-analise/:id] erro:', e);
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // PUT /api/engenharia/codigo-solucao/:id  — edita solução
  router.put('/codigo-solucao/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      const id = parseInt(req.params.id, 10);
      const { solucao_problema } = req.body;
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      await client.query('UPDATE engenharia.codigo_solucao SET solucao_problema = $1 WHERE id = $2', [solucao_problema || null, id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[PUT /api/engenharia/codigo-solucao/:id] erro:', e);
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // POST /api/engenharia/codigo-solucao  — adiciona solução a uma análise
  router.post('/codigo-solucao', async (req, res) => {
    const client = await pool.connect();
    try {
      const { codigo_analise_id, solucao_problema } = req.body;
      if (!codigo_analise_id || !solucao_problema) return res.status(400).json({ error: 'codigo_analise_id e solucao_problema obrigatórios.' });
      const criadoPor = req.session?.usuario?.username || req.session?.usuario?.nome || 'sistema';
      const r = await client.query(
        `INSERT INTO engenharia.codigo_solucao (codigo_analise_id, solucao_problema, criado_por) VALUES ($1, $2, $3) RETURNING id`,
        [codigo_analise_id, solucao_problema.trim(), criadoPor]
      );
      res.json({ ok: true, id: r.rows[0].id });
    } catch (e) {
      console.error('[POST /api/engenharia/codigo-solucao] erro:', e);
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // DELETE /api/engenharia/codigo-solucao/:id
  router.delete('/codigo-solucao/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      await client.query('DELETE FROM engenharia.codigo_solucao WHERE id = $1', [id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/engenharia/codigo-solucao/:id] erro:', e);
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // -------------------------------------------------------------------------
  // VERIFICAÇÕES (codigo_verificacoes) — questionamentos ligados a um código
  // -------------------------------------------------------------------------

  // GET /api/engenharia/codigos-erro/:id/verificacoes
  router.get('/codigos-erro/:id/verificacoes', async (req, res) => {
    const client = await pool.connect();
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const { rows } = await client.query(`
        SELECT v.id, v.codigo_erro_id, v.codigo_analise_id,
               v.verificacao, v.criado_por, v.criado_em,
               ca.analise AS analise_texto
        FROM engenharia.codigo_verificacoes v
        LEFT JOIN engenharia.codigo_analise ca ON ca.id = v.codigo_analise_id
        WHERE v.codigo_erro_id = $1
        ORDER BY v.criado_em ASC
      `, [id]);
      res.json({ ok: true, verificacoes: rows });
    } catch (e) {
      console.error('[GET /codigos-erro/:id/verificacoes] erro:', e);
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // POST /api/engenharia/codigo-verificacoes
  // Body: { codigo_erro_id, codigo_analise_id?, verificacao }
  router.post('/codigo-verificacoes', async (req, res) => {
    const client = await pool.connect();
    try {
      const { codigo_erro_id, codigo_analise_id, verificacao } = req.body;
      if (!codigo_erro_id) return res.status(400).json({ error: 'codigo_erro_id obrigatório.' });
      const criadoPor = req.session?.usuario?.username || req.session?.usuario?.nome || 'sistema';
      const { rows } = await client.query(`
        INSERT INTO engenharia.codigo_verificacoes
          (codigo_erro_id, codigo_analise_id, verificacao, criado_por)
        VALUES ($1, $2, $3, $4) RETURNING id
      `, [codigo_erro_id, codigo_analise_id || null, verificacao || null, criadoPor]);
      res.json({ ok: true, id: rows[0].id });
    } catch (e) {
      console.error('[POST /api/engenharia/codigo-verificacoes] erro:', e);
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // DELETE /api/engenharia/codigo-verificacoes/:id
  router.delete('/codigo-verificacoes/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      await client.query('DELETE FROM engenharia.codigo_verificacoes WHERE id = $1', [id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/engenharia/codigo-verificacoes/:id] erro:', e);
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // PUT /api/engenharia/codigo-verificacoes/:id — edita texto da verificação
  router.put('/codigo-verificacoes/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      const id = parseInt(req.params.id, 10);
      const { verificacao } = req.body;
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      await client.query('UPDATE engenharia.codigo_verificacoes SET verificacao = $1 WHERE id = $2', [verificacao || null, id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[PUT /codigo-verificacoes/:id] erro:', e);
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // -------------------------------------------------------------------------
  // ARQUIVOS POR ENTIDADE (analise / solucao / verificacao)
  // Paths: codigos-erro/{tipo}/{id}/{pasta}/{arquivo}
  // -------------------------------------------------------------------------

  async function listarArquivosEntidade(tipo, id) {
    const supabase = getSupabase();
    const resultado = {};
    for (const pasta of PASTAS) {
      const prefixo = `codigos-erro/${tipo}/${id}/${pasta}`;
      const { data } = await supabase.storage.from(ENGENHARIA_BUCKET).list(prefixo);
      resultado[pasta] = (data || [])
        .filter(f => f.name && f.name !== '.emptyFolderPlaceholder')
        .map(f => {
          const filePath = `${prefixo}/${f.name}`;
          const { data: pub } = supabase.storage.from(ENGENHARIA_BUCKET).getPublicUrl(filePath);
          return { nome: f.name, url: pub.publicUrl, path: filePath, tamanho: f.metadata?.size || 0 };
        });
    }
    return resultado;
  }

  // GET /api/engenharia/codigo-analise/:id/arquivos
  router.get('/codigo-analise/:id/arquivos', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      res.json({ ok: true, arquivos: await listarArquivosEntidade('analise', id) });
    } catch (e) {
      console.error('[GET /codigo-analise/:id/arquivos]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/engenharia/codigo-solucao/:id/arquivos
  router.get('/codigo-solucao/:id/arquivos', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      res.json({ ok: true, arquivos: await listarArquivosEntidade('solucao', id) });
    } catch (e) {
      console.error('[GET /codigo-solucao/:id/arquivos]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/engenharia/codigo-verificacoes/:id/arquivos
  router.get('/codigo-verificacoes/:id/arquivos', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      res.json({ ok: true, arquivos: await listarArquivosEntidade('verificacao', id) });
    } catch (e) {
      console.error('[GET /codigo-verificacoes/:id/arquivos]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/engenharia/entidade-arquivo — remove arquivo de qualquer entidade
  // Body: { path: 'codigos-erro/analise/1/Fotos/img.jpg' }
  router.delete('/entidade-arquivo', async (req, res) => {
    try {
      const { path: filePath } = req.body;
      if (!filePath) return res.status(400).json({ error: 'Campo "path" obrigatório.' });
      if (!String(filePath).startsWith('codigos-erro/')) {
        return res.status(403).json({ error: 'Caminho não permitido.' });
      }
      const supabase = getSupabase();
      const { error } = await supabase.storage.from(ENGENHARIA_BUCKET).remove([filePath]);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /entidade-arquivo]', e);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
