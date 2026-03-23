// routes/pir.js
const express = require('express');
const router = express.Router();
const { dbQuery } = require('../src/db');

let ensureProdutosOmiePirColumnPromise = null;

async function ensureProdutosOmiePirColumn() {
  if (!ensureProdutosOmiePirColumnPromise) {
    ensureProdutosOmiePirColumnPromise = dbQuery(`
      ALTER TABLE public.produtos_omie
      ADD COLUMN IF NOT EXISTS pir BOOLEAN NOT NULL DEFAULT FALSE
    `).catch((err) => {
      ensureProdutosOmiePirColumnPromise = null;
      throw err;
    });
  }
  await ensureProdutosOmiePirColumnPromise;
}

// Buscar status do check Verificação PIR por código do produto
router.get('/produto/:codigo/verificacao', async (req, res) => {
  try {
    await ensureProdutosOmiePirColumn();
    const codigo = String(req.params.codigo || '').trim();
    if (!codigo) {
      return res.status(400).json({ error: 'Código do produto é obrigatório' });
    }

    const result = await dbQuery(
      `SELECT codigo, COALESCE(pir, FALSE) AS pir
       FROM public.produtos_omie
       WHERE codigo = $1
       LIMIT 1`,
      [codigo]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    return res.json({
      codigo: result.rows[0].codigo,
      pir: result.rows[0].pir === true
    });
  } catch (error) {
    console.error('Erro ao buscar verificação PIR do produto:', error);
    return res.status(500).json({ error: 'Erro ao buscar verificação PIR do produto' });
  }
});

// Atualizar status do check Verificação PIR por código do produto
router.put('/produto/:codigo/verificacao', async (req, res) => {
  try {
    await ensureProdutosOmiePirColumn();
    const codigo = String(req.params.codigo || '').trim();
    if (!codigo) {
      return res.status(400).json({ error: 'Código do produto é obrigatório' });
    }

    const pirRaw = req.body?.pir;
    const pir = pirRaw === true || pirRaw === 1 || pirRaw === '1' || pirRaw === 'true';

    const result = await dbQuery(
      `UPDATE public.produtos_omie
       SET pir = $2
       WHERE codigo = $1
       RETURNING codigo, pir`,
      [codigo, pir]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    return res.json({
      codigo: result.rows[0].codigo,
      pir: result.rows[0].pir === true
    });
  } catch (error) {
    console.error('Erro ao atualizar verificação PIR do produto:', error);
    return res.status(500).json({ error: 'Erro ao atualizar verificação PIR do produto' });
  }
});

// Listar códigos únicos cadastrados em qualidade.pir + status Verificação PIR
router.get('/resumo/codigos', async (_req, res) => {
  try {
    await ensureProdutosOmiePirColumn();

    const result = await dbQuery(
      `WITH pir_unico AS (
         SELECT DISTINCT ON (TRIM(p.codigo))
                TRIM(p.codigo) AS codigo,
                TRIM(COALESCE(p.id_omie::text, '')) AS id_omie
         FROM qualidade.pir p
         WHERE p.codigo IS NOT NULL
           AND TRIM(p.codigo) <> ''
         ORDER BY TRIM(p.codigo), p.criado_em DESC, p.id DESC
       )
       SELECT pu.codigo,
              COALESCE(po.descricao, '') AS descricao,
              COALESCE(po.pir, FALSE) AS pir
       FROM pir_unico pu
       LEFT JOIN public.produtos_omie po
         ON TRIM(COALESCE(po.codigo_produto::text, '')) = pu.id_omie
       ORDER BY pu.codigo ASC`
    );

    return res.json({
      total: result.rows.length,
      itens: result.rows.map((r) => ({
        codigo: r.codigo,
        descricao: r.descricao,
        pir: r.pir === true
      }))
    });
  } catch (error) {
    console.error('Erro ao listar resumo de códigos PIR:', error);
    return res.status(500).json({ error: 'Erro ao listar resumo de códigos PIR' });
  }
});

// Listar produtos da public.produtos_omie por filtros de negócio para verificação PIR
router.get('/resumo/produtos-omie', async (_req, res) => {
  try {
    await ensureProdutosOmiePirColumn();

    const familiasPermitidas = [
      '10763340559',
      '10510982183',
      '10510981897',
      '10510981991',
      '10510982183',
      '10763340622'
    ];

    const result = await dbQuery(
      `SELECT po.codigo,
              COALESCE(po.descricao, '') AS descricao,
              COALESCE(po.pir, FALSE) AS pir
       FROM public.produtos_omie po
       WHERE COALESCE(po.inativo, 'N') = 'N'
         AND COALESCE(po.bloqueado, 'N') = 'N'
         AND po.codigo_familia::text = ANY($1::text[])
       ORDER BY po.codigo ASC`,
      [familiasPermitidas]
    );

    return res.json({
      total: result.rows.length,
      itens: result.rows.map((r) => ({
        codigo: r.codigo,
        descricao: r.descricao,
        pir: r.pir === true
      }))
    });
  } catch (error) {
    console.error('Erro ao listar produtos_omie filtrados para verificação PIR:', error);
    return res.status(500).json({ error: 'Erro ao listar produtos_omie filtrados para verificação PIR' });
  }
});

// Listar todos os itens PIR de um produto
router.get('/:id_omie', async (req, res) => {
  try {
    const { id_omie } = req.params;
    
    const result = await dbQuery(
      `SELECT id, id_omie, codigo, frequencia, o_que_verificar, 
              foto_url, criado_em, atualizado_em
       FROM qualidade.pir
       WHERE id_omie = $1
       ORDER BY criado_em DESC`,
      [id_omie]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar itens PIR:', error);
    res.status(500).json({ error: 'Erro ao buscar itens PIR' });
  }
});

// Buscar um item específico
router.get('/item/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await dbQuery(
      `SELECT id, id_omie, codigo, frequencia, o_que_verificar, 
              foto_url, criado_em, atualizado_em
       FROM qualidade.pir
       WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar item PIR:', error);
    res.status(500).json({ error: 'Erro ao buscar item PIR' });
  }
});

// Criar novo item PIR
router.post('/', async (req, res) => {
  try {
    const { id_omie, codigo, frequencia, o_que_verificar, foto_url } = req.body;
    const frequenciaNum = Number(frequencia);
    
    if (!id_omie || !codigo || !frequenciaNum || !o_que_verificar) {
      return res.status(400).json({ error: 'Campos obrigatórios: id_omie, codigo, frequencia, o_que_verificar' });
    }
    if (![10, 50, 100].includes(frequenciaNum)) {
      return res.status(400).json({ error: 'Frequência inválida. Use 10, 50 ou 100.' });
    }
    
    const result = await dbQuery(
      `INSERT INTO qualidade.pir 
       (id_omie, codigo, frequencia, o_que_verificar, foto_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id_omie, codigo, frequenciaNum, o_que_verificar, foto_url || null]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar item PIR:', error);
    res.status(500).json({ error: 'Erro ao criar item PIR' });
  }
});

// Atualizar item PIR
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { frequencia, o_que_verificar, foto_url } = req.body;
    const frequenciaNum = Number(frequencia);
    
    if (!frequenciaNum || !o_que_verificar) {
      return res.status(400).json({ error: 'Campos obrigatórios: frequencia, o_que_verificar' });
    }
    if (![10, 50, 100].includes(frequenciaNum)) {
      return res.status(400).json({ error: 'Frequência inválida. Use 10, 50 ou 100.' });
    }
    
    const result = await dbQuery(
        `UPDATE qualidade.pir
         SET frequencia = $1,
           o_que_verificar = $2,
           foto_url = $3,
           atualizado_em = NOW()
         WHERE id = $4
         RETURNING *`,
        [frequenciaNum, o_que_verificar, foto_url || null, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar item PIR:', error);
    res.status(500).json({ error: 'Erro ao atualizar item PIR' });
  }
});

// Excluir item PIR
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await dbQuery(
      'DELETE FROM qualidade.pir WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }
    
    res.json({ message: 'Item excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir item PIR:', error);
    res.status(500).json({ error: 'Erro ao excluir item PIR' });
  }
});

module.exports = router;
