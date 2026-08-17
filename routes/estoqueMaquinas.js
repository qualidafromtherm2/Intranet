const express = require('express');
const { pool } = require('../src/db');

const router = express.Router();

const COD_ESTOQUE_MAQUINAS = '10408747829';
const ETAPAS_EXCLUIDAS = ['00', '70'];
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

function etapaDescricaoSql() {
  return `
    CASE COALESCE(NULLIF(TRIM(p.etapa::text), ''), '')
      WHEN '00' THEN 'Aberto'
      WHEN '10' THEN 'Em análise'
      WHEN '20' THEN 'Aprovado'
      WHEN '50' THEN 'Em processamento'
      WHEN '60' THEN 'Em separação'
      WHEN '70' THEN 'Faturado/Entregue'
      WHEN '80' THEN 'Concluído'
      ELSE 'Etapa ' || COALESCE(NULLIF(TRIM(p.etapa::text), ''), '?')
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
    SELECT
      TRIM(i.codigo) AS codigo,
      COALESCE(po.descricao, i.descricao, i.codigo, '-') AS descricao,
      SUM(COALESCE(i.quantidade, 0))::numeric AS quantidade,
      COUNT(DISTINCT p.codigo_pedido)::int AS pedidos,
      json_agg(json_build_object(
        'codigo_pedido', p.codigo_pedido,
        'numero_pedido', p.numero_pedido,
        'cliente_nome', COALESCE(NULLIF(TRIM(f.nome_fantasia), ''), NULLIF(TRIM(f.razao_social), ''), 'N/D'),
        'etapa', COALESCE(NULLIF(TRIM(p.etapa::text), ''), ''),
        'etapa_descricao', ${etapaDescricaoSql()},
        'quantidade', COALESCE(i.quantidade, 0),
        'data_previsao', p.data_previsao
      ) ORDER BY p.numero_pedido DESC NULLS LAST) AS pedidos_itens
    FROM vendas.pedidos_venda p
    JOIN vendas.pedidos_venda_itens i
      ON i.codigo_pedido = p.codigo_pedido
    LEFT JOIN omie.fornecedores f
      ON TRIM(COALESCE(f.codigo_cliente_omie::text, '')) = TRIM(COALESCE(p.codigo_cliente::text, ''))
    LEFT JOIN produto.produtos_omie po
      ON TRIM(po.codigo) = TRIM(i.codigo)
    WHERE COALESCE(NULLIF(TRIM(p.etapa::text), ''), '') NOT IN (${ETAPAS_EXCLUIDAS.map((_, idx) => `$${idx + 1}`).join(', ')})
      AND NULLIF(TRIM(i.codigo), '') IS NOT NULL
    GROUP BY TRIM(i.codigo), COALESCE(po.descricao, i.descricao, i.codigo, '-')
    ORDER BY quantidade DESC, codigo
  `, ETAPAS_EXCLUIDAS);

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
