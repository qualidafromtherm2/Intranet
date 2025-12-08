const express = require('express');
const router = express.Router();
const { dbQuery } = require('../src/db');

// Consulta todos os registros de modificações de produto
router.get('/', async (req, res) => {
    try {
        const { tipo, codigo, usuario, data_inicio, data_fim, limit } = req.query || {};
        const where = [];
        const params = [];

        if (tipo && String(tipo).trim() !== '') {
            params.push(String(tipo).trim());
            where.push(`tipo_acao = $${params.length}`);
        }
        if (codigo && String(codigo).trim() !== '') {
            const cod = String(codigo).trim();
            // permite filtrar por qualquer um dos identificadores
            params.push(cod);
            where.push(`(codigo_omie = $${params.length} OR codigo_texto = $${params.length} OR codigo_produto::text = $${params.length})`);
        }
        if (usuario && String(usuario).trim() !== '') {
            params.push(String(usuario).trim());
            where.push(`usuario = $${params.length}`);
        }
        if (data_inicio && String(data_inicio).trim() !== '') {
            params.push(String(data_inicio).trim());
            where.push(`data_hora >= $${params.length}::timestamptz`);
        }
        if (data_fim && String(data_fim).trim() !== '') {
            params.push(String(data_fim).trim());
            where.push(`data_hora <= $${params.length}::timestamptz`);
        }

        const lim = Math.max(1, Math.min(1000, Number(limit) || 200));

        const sql = `
            SELECT *
              FROM auditoria_produto.historico_modificacoes
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             ORDER BY data_hora DESC
             LIMIT ${lim}
        `;
        const result = await dbQuery(sql, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Registrar uma modificação de produto
router.post('/', async (req, res) => {
    const { codigo_omie, codigo_texto, codigo_produto, tipo_acao, usuario, detalhes, origem } = req.body;
    if (!(codigo_omie || codigo_texto || codigo_produto) || !tipo_acao || !usuario) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    }
    try {
        await dbQuery(`
            INSERT INTO auditoria_produto.historico_modificacoes (codigo_omie, codigo_texto, codigo_produto, tipo_acao, usuario, detalhes, origem)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [codigo_omie || codigo_texto || String(codigo_produto || ''), codigo_texto || null, codigo_produto || null, tipo_acao, usuario, detalhes || '', origem || '']);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
