/**
 * Fantasmas Omie: produtos que existem no Postgres local
 * mas foram excluídos no Omie (ConsultarProduto → Client-105).
 *
 * Estratégia: marcar inativo = 'S' (não DELETE), para:
 * - sumir da Lista de produtos (filtro padrão oculta inativos)
 * - preservar imagens/anexos e histórico local
 */

async function comSourceOmie(client, source, fn) {
  await client.query('BEGIN');
  try {
    await client.query(
      "SELECT set_config('app.produtos_omie_write_source', $1, true)",
      [source]
    );
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  }
}

/**
 * @param {object} client - pg Client com .query
 * @param {Array<string|number>} ids - codigo_produto
 * @param {string} [source='omie_sync']
 * @returns {Promise<{ marcados: number, ids: string[] }>}
 */
async function marcarProdutosOmieInativos(client, ids, source = 'omie_sync') {
  const limpos = [...new Set(
    (ids || [])
      .map((id) => String(id ?? '').trim())
      .filter((id) => /^\d+$/.test(id))
  )];

  if (!limpos.length) {
    return { marcados: 0, ids: [] };
  }

  return comSourceOmie(client, source, async () => {
    const { rowCount } = await client.query(
      `UPDATE public.produtos_omie
          SET inativo = 'S',
              updated_at = NOW()
        WHERE codigo_produto = ANY($1::bigint[])
          AND COALESCE(UPPER(TRIM(inativo)), 'N') <> 'S'`,
      [limpos]
    );
    return { marcados: rowCount || 0, ids: limpos };
  });
}

/**
 * Após uma sync completa (lista de IDs vistos na Omie),
 * marca como inativos os locais ativos que não apareceram.
 *
 * @param {object} client
 * @param {Iterable<string|number>} idsVistosNaOmie
 * @param {string} [source='omie_sync']
 * @returns {Promise<{ marcados: number, ids: string[], detalhes: object[] }>}
 */
async function reconciliarProdutosOmieAusentes(client, idsVistosNaOmie, source = 'omie_sync') {
  const vistos = [...new Set(
    [...(idsVistosNaOmie || [])]
      .map((id) => String(id ?? '').trim())
      .filter((id) => /^\d+$/.test(id))
  )];

  if (!vistos.length) {
    // Segurança: nunca marcar tudo como fantasma se a lista Omie veio vazia
    return { marcados: 0, ids: [], detalhes: [] };
  }

  return comSourceOmie(client, source, async () => {
    const { rows } = await client.query(
      `UPDATE public.produtos_omie
          SET inativo = 'S',
              updated_at = NOW()
        WHERE COALESCE(UPPER(TRIM(inativo)), 'N') <> 'S'
          AND codigo_produto IS NOT NULL
          AND NOT (codigo_produto = ANY($1::bigint[]))
        RETURNING codigo_produto::text AS codigo_produto, codigo, LEFT(descricao, 80) AS descricao`,
      [vistos]
    );

    return {
      marcados: rows.length,
      ids: rows.map((r) => r.codigo_produto),
      detalhes: rows,
    };
  });
}

module.exports = {
  marcarProdutosOmieInativos,
  reconciliarProdutosOmieAusentes,
};
