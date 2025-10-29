// routes/qualidade.js
// Endpoints para "Consulta Abertura de OS" (qualidade)
// - Implementa busca em múltiplas tabelas históricas

const express = require('express');
const router = express.Router();
const { dbQuery, isDbEnabled } = require('../src/db');

// GET /api/qualidade/abertura-os/search?term=...&sources=tabela1,tabela2,...
// Retorna grupos de resultados de todas as tabelas históricas
router.get('/abertura-os/search', async (req, res) => {
  try {
    const term = String(req.query.term || '').trim();
    if (!term) {
      return res.json({ ok: true, order: [], results: {} });
    }

    if (!isDbEnabled) {
      return res.status(503).json({ ok: false, error: 'Banco de dados não configurado.' });
    }

    // Pega as tabelas solicitadas ou todas por padrão
    const requestedSources = req.query.sources 
      ? String(req.query.sources).split(',').map(s => s.trim()).filter(Boolean)
      : null; // null = buscar em todas

    const like = `%${term}%`;
    const results = {};
    const order = [];

    // Função helper para adicionar resultados
    const addResults = (key, rows, label, subtitle = '') => {
      if (rows && rows.length > 0) {
        order.push(key);
        results[key] = {
          label,
          subtitle,
          rows: rows.map(r => ({ raw: r, match: term }))
        };
      }
    };

    // Verifica se deve buscar em uma fonte específica
    const shouldSearch = (source) => !requestedSources || requestedSources.includes(source);

    // 1. controle_assistencia_tecnica - Busca por: protc, cliente, n_s, cpf_cnpj
    if (shouldSearch('controle_assistencia_tecnica')) {
      const sql1 = `
        SELECT * FROM public.controle_assistencia_tecnica
        WHERE protc ILIKE $1 OR cliente ILIKE $1 OR n_s ILIKE $1 OR cpf_cnpj ILIKE $1
        ORDER BY protc DESC NULLS LAST
        LIMIT 200
      `;
      const rows1 = await dbQuery(sql1, [like]).then(r => r.rows).catch(() => []);
      addResults('controle_assistencia_tecnica', rows1, "Histórico de OS's");
    }

    // 2. historico_op_glide - Busca por: ordem_de_producao, pedido, modelo
    if (shouldSearch('historico_op_glide')) {
      const sql2 = `
        SELECT * FROM public.historico_op_glide
        WHERE ordem_de_producao ILIKE $1 OR pedido ILIKE $1 OR modelo ILIKE $1
        ORDER BY ordem_de_producao DESC NULLS LAST
        LIMIT 200
      `;
      const rows2 = await dbQuery(sql2, [like]).then(r => r.rows).catch(() => []);
      addResults('historico_op_glide', rows2, 'Histórico OP e NS', 'GLIDE');
    }

    // 3. historico_op_glide_f_escopo - Busca por: ordem_de_producao, pedido, modelo
    if (shouldSearch('historico_op_glide_f_escopo')) {
      const sql3 = `
        SELECT * FROM public.historico_op_glide_f_escopo
        WHERE ordem_de_producao ILIKE $1 OR pedido ILIKE $1 OR modelo ILIKE $1
        ORDER BY ordem_de_producao DESC NULLS LAST
        LIMIT 200
      `;
      const rows3 = await dbQuery(sql3, [like]).then(r => r.rows).catch(() => []);
      addResults('historico_op_glide_f_escopo', rows3, 'Histórico OP e NS', 'GLIDE (F Escopo)');
    }

    // 4. historico_op_iapp - Busca por: lote_antecipado, ficha_tecnica_identificacao
    if (shouldSearch('historico_op_iapp')) {
      const sql4 = `
        SELECT * FROM public.historico_op_iapp
        WHERE lote_antecipado ILIKE $1 OR ficha_tecnica_identificacao ILIKE $1
        ORDER BY lote_antecipado DESC NULLS LAST
        LIMIT 200
      `;
      const rows4 = await dbQuery(sql4, [like]).then(r => r.rows).catch(() => []);
      addResults('historico_op_iapp', rows4, 'Histórico OP');
    }

    // 5. historico_pedido_originalis - Busca por: nota_fiscal, ordem_de_producao, pedido
    if (shouldSearch('historico_pedido_originalis')) {
      const sql5 = `
        SELECT * FROM public.historico_pedido_originalis
        WHERE nota_fiscal ILIKE $1 OR ordem_de_producao ILIKE $1 OR pedido ILIKE $1
        ORDER BY nota_fiscal DESC NULLS LAST
        LIMIT 200
      `;
      const rows5 = await dbQuery(sql5, [like]).then(r => r.rows).catch(() => []);
      addResults('historico_pedido_originalis', rows5, 'Histórico NF/OP/Pedidos');
    }

    // 6. pedidos_por_cliente - Busca em clientes_omie e pedidos_venda
    if (shouldSearch('pedidos_por_cliente')) {
      const sql6 = `
        SELECT 
          c.codigo_cliente_omie,
          c.razao_social,
          c.nome_fantasia,
          c.cnpj_cpf,
          COUNT(p.codigo_pedido) as total_pedidos
        FROM public.clientes_omie c
        LEFT JOIN public.pedidos_venda p ON p.codigo_cliente = c.codigo_cliente_omie
        WHERE 
          c.razao_social ILIKE $1 OR 
          c.nome_fantasia ILIKE $1 OR 
          c.cnpj_cpf ILIKE $1 OR
          CAST(c.codigo_cliente_omie AS TEXT) ILIKE $1
        GROUP BY c.codigo_cliente_omie, c.razao_social, c.nome_fantasia, c.cnpj_cpf
        ORDER BY c.razao_social
        LIMIT 200
      `;
      const rows6 = await dbQuery(sql6, [like]).then(r => r.rows).catch(() => []);
      addResults('pedidos_por_cliente', rows6, 'Pedidos por Cliente', 'Clientes e pedidos');
    }

    // 7. historico_pre2024 - NOVA TABELA - Busca por: pedido, razao_social_faturamento, nome_fantasia_revende
    if (shouldSearch('historico_pre2024')) {
      const sql7 = `
        SELECT
          pedido,
          razao_social_faturamento,
          nome_fantasia_revende,
          data_aprovacao_pedido,
          modelo,
          quantidade
        FROM public.historico_pre2024
        WHERE
          pedido ILIKE $1 OR
          razao_social_faturamento ILIKE $1 OR
          nome_fantasia_revende ILIKE $1
        ORDER BY data_aprovacao_pedido DESC NULLS LAST
        LIMIT 200
      `;
      const rows7 = await dbQuery(sql7, [like]).then(r => r.rows).catch(() => []);
      addResults('historico_pre2024', rows7, 'Histórico pré-2024', 'Pedidos anteriores a 2024');
    }

    return res.json({ ok: true, order, results });
  } catch (err) {
    console.error('[qualidade] search erro:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao pesquisar.' });
  }
});

module.exports = router;
