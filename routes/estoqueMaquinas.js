const express = require('express');
const { pool } = require('../src/db');

const router = express.Router();

const COD_ESTOQUE_MAQUINAS = '10408747829';
const NAV_KEY = 'side:log:estoque-maquinas';
const NAV_SIBLING_KEY = 'side:log:estoque-minimo';

let _ensureNavPromise = null;

async function ensureNavEstoqueMaquinas() {
  if (_ensureNavPromise) return _ensureNavPromise;
  _ensureNavPromise = (async () => {
    await pool.query(`
      INSERT INTO public.nav_node (key, label, position, parent_id, sort, active, selector)
      SELECT
        $1, 'estoque de maquinas', 'side', p.id, 85, TRUE, '#menu-estoque-maquinas'
      FROM public.nav_node p
      WHERE p.key = 'side:log'
      ON CONFLICT (key) DO UPDATE SET
        label = EXCLUDED.label,
        position = EXCLUDED.position,
        parent_id = COALESCE(EXCLUDED.parent_id, public.nav_node.parent_id),
        active = TRUE,
        selector = EXCLUDED.selector
    `, [NAV_KEY]);

    await pool.query(`
      INSERT INTO public.auth_role_permission (role, node_id, allow)
      SELECT arp.role, n.id, arp.allow
        FROM public.nav_node n
        JOIN public.nav_node s ON s.key = $2
        JOIN public.auth_role_permission arp ON arp.node_id = s.id
       WHERE n.key = $1
      ON CONFLICT (role, node_id) DO NOTHING
    `, [NAV_KEY, NAV_SIBLING_KEY]);

    await pool.query(`
      INSERT INTO public.auth_user_permission (user_id, node_id, allow)
      SELECT aup.user_id, n.id, aup.allow
        FROM public.nav_node n
        JOIN public.nav_node s ON s.key = $2
        JOIN public.auth_user_permission aup ON aup.node_id = s.id
       WHERE n.key = $1
      ON CONFLICT (user_id, node_id) DO NOTHING
    `, [NAV_KEY, NAV_SIBLING_KEY]);

    await pool.query(`
      INSERT INTO public.auth_role_permission (role, node_id, allow)
      SELECT 'admin', n.id, TRUE
        FROM public.nav_node n
       WHERE n.key = $1
      ON CONFLICT (role, node_id) DO UPDATE SET allow = TRUE
    `, [NAV_KEY]);
  })().catch((err) => {
    _ensureNavPromise = null;
    console.error('[logistica/estoque-maquinas] falha ao garantir nav:', err.message);
    throw err;
  });
  return _ensureNavPromise;
}

ensureNavEstoqueMaquinas().catch(() => {});

function etapaDescricaoSql(expr = 'p.etapa') {
  return `
    CASE COALESCE(NULLIF(TRIM(${expr}::text), ''), '')
      WHEN '00' THEN 'Aberto'
      WHEN '10' THEN 'Em análise'
      WHEN '20' THEN 'Aprovado'
      WHEN '50' THEN 'Em processamento'
      WHEN '60' THEN 'Em separação'
      WHEN '70' THEN 'Faturado/Entregue'
      WHEN '80' THEN 'Concluído'
      ELSE 'Etapa ' || COALESCE(NULLIF(TRIM(${expr}::text), ''), '?')
    END
  `;
}

async function listarEstoqueMaquinas() {
  const { rows } = await pool.query(`
    SELECT
      e.codigo,
      COALESCE(NULLIF(TRIM(e.descricao), ''), po.descricao, e.codigo) AS descricao,
      COALESCE(e.saldo, 0)::numeric AS saldo,
      COALESCE(e.fisico, 0)::numeric AS fisico,
      COALESCE(e.reservado, 0)::numeric AS reservado,
      e.local_codigo,
      e.local_nome
    FROM logistica.estoque_atual e
    LEFT JOIN produto.produtos_omie po ON TRIM(po.codigo) = TRIM(e.codigo)
    WHERE e.local_codigo = $1
      AND COALESCE(e.saldo, 0) > 0
    ORDER BY COALESCE(e.descricao, e.codigo)
  `, [COD_ESTOQUE_MAQUINAS]);

  return rows.map((r) => ({
    codigo: r.codigo || '',
    descricao: r.descricao || '',
    saldo: Number(r.saldo) || 0,
    fisico: Number(r.fisico) || 0,
    reservado: Number(r.reservado) || 0,
    local_codigo: r.local_codigo || COD_ESTOQUE_MAQUINAS,
    local_nome: r.local_nome || '4. ESTOQUE MAQUINAS',
  }));
}

async function listarSolicitacaoEnvio() {
  const { rows } = await pool.query(`
    WITH estoque_maquinas AS (
      SELECT
        UPPER(TRIM(COALESCE(e.codigo, ''))) AS codigo_norm,
        SUM(GREATEST(COALESCE(e.saldo, 0), 0)) AS quantidade
      FROM logistica.estoque_atual e
      WHERE TRIM(COALESCE(e.local_codigo, '')) = $1
      GROUP BY UPPER(TRIM(COALESCE(e.codigo, '')))
    ),
    ops_ativas_linha AS (
      SELECT
        UPPER(TRIM(COALESCE(op.codigo, ''))) AS codigo_norm,
        COUNT(*)::numeric AS quantidade
      FROM producao."OP_producao" op
      WHERE NOT EXISTS (
        SELECT 1
        FROM producao."Kanban_programacao" kp
        WHERE kp.op_producao_id = op.id
          AND LOWER(TRIM(COALESCE(kp.status, ''))) = 'finalizado'
      )
      GROUP BY UPPER(TRIM(COALESCE(op.codigo, '')))
    ),
    cobertura AS (
      SELECT codigo_norm, SUM(quantidade) AS quantidade
      FROM (
        SELECT codigo_norm, quantidade FROM estoque_maquinas
        UNION ALL
        SELECT codigo_norm, quantidade FROM ops_ativas_linha
      ) fontes
      GROUP BY codigo_norm
    ),
    itens_base AS (
      SELECT
        p.codigo_pedido,
        p.numero_pedido,
        p.etapa,
        p.data_previsao,
        i.seq,
        i.codigo,
        COALESCE(po.descricao, i.descricao, i.codigo, '-') AS descricao,
        COALESCE(NULLIF(TRIM(f.nome_fantasia), ''), NULLIF(TRIM(f.razao_social), ''), 'N/D') AS cliente_nome,
        UPPER(TRIM(COALESCE(i.codigo, ''))) AS codigo_norm,
        GREATEST(COALESCE(i.quantidade, 0), 0) AS quantidade
      FROM vendas.pedidos_venda p
      JOIN vendas.pedidos_venda_itens i
        ON i.codigo_pedido = p.codigo_pedido
      JOIN produto.produtos_omie po
        ON UPPER(TRIM(COALESCE(po.codigo, ''))) = UPPER(TRIM(COALESCE(i.codigo, '')))
      LEFT JOIN omie.fornecedores f
        ON TRIM(COALESCE(f.codigo_cliente_omie::text, '')) = TRIM(COALESCE(p.codigo_cliente::text, ''))
      WHERE TRIM(COALESCE(p.etapa::text, '')) = '80'
        AND TRIM(COALESCE(p.bloqueado, '')) = 'N'
        AND TRIM(COALESCE(p.encerrado, '')) IN ('', 'N')
        AND TRIM(COALESCE(po.tipoitem, '')) IN ('04', '4')
        AND NULLIF(TRIM(i.codigo), '') IS NOT NULL
    ),
    itens_ordenados AS (
      SELECT
        ib.*,
        COALESCE(
          SUM(ib.quantidade) OVER (
            PARTITION BY ib.codigo_norm
            ORDER BY ib.numero_pedido ASC NULLS LAST, ib.codigo_pedido ASC, ib.seq ASC NULLS LAST
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),
          0
        ) AS demanda_anterior
      FROM itens_base ib
    ),
    itens_disponiveis AS (
      SELECT
        io.*,
        LEAST(
          io.quantidade,
          GREATEST(COALESCE(c.quantidade, 0) - io.demanda_anterior, 0)
        ) AS quantidade_envio
      FROM itens_ordenados io
      LEFT JOIN cobertura c ON c.codigo_norm = io.codigo_norm
    )
    SELECT
      TRIM(id.codigo) AS codigo,
      id.descricao,
      SUM(id.quantidade_envio)::numeric AS quantidade,
      COUNT(DISTINCT id.codigo_pedido)::int AS pedidos,
      json_agg(json_build_object(
        'codigo_pedido', id.codigo_pedido,
        'numero_pedido', id.numero_pedido,
        'cliente_nome', id.cliente_nome,
        'etapa', COALESCE(NULLIF(TRIM(id.etapa::text), ''), ''),
        'etapa_descricao', ${etapaDescricaoSql('id.etapa')},
        'quantidade', id.quantidade_envio,
        'data_previsao', id.data_previsao
      ) ORDER BY id.numero_pedido ASC NULLS LAST) AS pedidos_itens
    FROM itens_disponiveis id
    WHERE id.quantidade_envio > 0
    GROUP BY TRIM(id.codigo), id.descricao
    ORDER BY quantidade DESC, codigo
  `, [COD_ESTOQUE_MAQUINAS]);

  return rows.map((r) => ({
    codigo: r.codigo || '',
    descricao: r.descricao || '',
    quantidade: Number(r.quantidade) || 0,
    pedidos: Number(r.pedidos) || 0,
    pedidos_itens: Array.isArray(r.pedidos_itens) ? r.pedidos_itens : [],
  }));
}

router.get('/estoque-maquinas', async (_req, res) => {
  try {
    await ensureNavEstoqueMaquinas().catch(() => {});
    const settled = await Promise.allSettled([
      listarEstoqueMaquinas(),
      listarSolicitacaoEnvio(),
    ]);
    const [estoqueS, pedidosS] = settled;
    const erros = [];
    if (estoqueS.status === 'rejected') erros.push('estoque: ' + (estoqueS.reason?.message || estoqueS.reason));
    if (pedidosS.status === 'rejected') erros.push('pedidos: ' + (pedidosS.reason?.message || pedidosS.reason));
    if (erros.length) console.error('[logistica/estoque-maquinas] parciais:', erros.join(' | '));

    return res.json({
      ok: true,
      local_estoque: {
        codigo: COD_ESTOQUE_MAQUINAS,
        nome: '##MAQ 10408747829 — 4. ESTOQUE MAQUINAS',
      },
      estoque: estoqueS.status === 'fulfilled' ? estoqueS.value : [],
      pedidos: pedidosS.status === 'fulfilled' ? pedidosS.value : [],
      avisos: erros,
    });
  } catch (err) {
    console.error('[logistica/estoque-maquinas]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Erro ao carregar estoque de máquinas.' });
  }
});

module.exports = router;
