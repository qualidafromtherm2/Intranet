// routes/pir.js
const express = require('express');
const router = express.Router();
const { dbQuery } = require('../src/db');

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
