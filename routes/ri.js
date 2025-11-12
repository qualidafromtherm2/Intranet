// routes/ri.js
const express = require('express');
const router = express.Router();
const { dbQuery } = require('../src/db');

// Listar operações disponíveis
router.get('/operacoes', async (req, res) => {
  try {
    const result = await dbQuery(
      'SELECT DISTINCT operacao FROM public.omie_operacao ORDER BY operacao'
    );
    
    res.json(result.rows.map(row => row.operacao));
  } catch (error) {
    console.error('Erro ao buscar operações:', error);
    res.status(500).json({ error: 'Erro ao buscar operações' });
  }
});

// Listar todos os itens RI de um produto
router.get('/:id_omie', async (req, res) => {
  try {
    const { id_omie } = req.params;
    
    const result = await dbQuery(
      `SELECT id, id_omie, codigo, item_verificado, o_que_verificar, 
              local_verificacao, prioridade, foto_url, criado_em, atualizado_em
       FROM qualidade.ri
       WHERE id_omie = $1
       ORDER BY criado_em DESC`,
      [id_omie]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar itens RI:', error);
    res.status(500).json({ error: 'Erro ao buscar itens RI' });
  }
});

// Buscar um item específico
router.get('/item/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await dbQuery(
      `SELECT id, id_omie, codigo, item_verificado, o_que_verificar, 
              local_verificacao, prioridade, foto_url, criado_em, atualizado_em
       FROM qualidade.ri
       WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar item RI:', error);
    res.status(500).json({ error: 'Erro ao buscar item RI' });
  }
});

// Criar novo item RI
router.post('/', async (req, res) => {
  try {
    const { id_omie, codigo, item_verificado, o_que_verificar, local_verificacao, prioridade, foto_url } = req.body;
    
    if (!id_omie || !codigo || !item_verificado || !o_que_verificar || !local_verificacao || !prioridade) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    
    const result = await dbQuery(
      `INSERT INTO qualidade.ri 
       (id_omie, codigo, item_verificado, o_que_verificar, local_verificacao, prioridade, foto_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id_omie, codigo, item_verificado, o_que_verificar, local_verificacao, prioridade, foto_url || null]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar item RI:', error);
    res.status(500).json({ error: 'Erro ao criar item RI' });
  }
});

// Atualizar item RI
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { item_verificado, o_que_verificar, local_verificacao, prioridade, foto_url } = req.body;
    
    if (!item_verificado || !o_que_verificar || !local_verificacao || !prioridade) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    
    const result = await dbQuery(
      `UPDATE qualidade.ri
       SET item_verificado = $1,
           o_que_verificar = $2,
           local_verificacao = $3,
           prioridade = $4,
           foto_url = $5,
           atualizado_em = NOW()
       WHERE id = $6
       RETURNING *`,
      [item_verificado, o_que_verificar, local_verificacao, prioridade, foto_url || null, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar item RI:', error);
    res.status(500).json({ error: 'Erro ao atualizar item RI' });
  }
});

// Excluir item RI
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await dbQuery(
      'DELETE FROM qualidade.ri WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }
    
    res.json({ message: 'Item excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir item RI:', error);
    res.status(500).json({ error: 'Erro ao excluir item RI' });
  }
});

module.exports = router;
