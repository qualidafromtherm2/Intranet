/**
 * Quando a Omie recria um produto (mesmo SKU, ID novo), o saldo em
 * etiqueta.ETQ_rec_impresso pode ficar no ID fantasma. A separação debita
 * só o ID ativo → "não possui saldo".
 *
 * Esta util migra codigo_produto das etiquetas do ID antigo → ID ativo.
 */

/**
 * @param {object} client - pg Client/Pool com .query
 * @param {{ deIds: Array<string|number>, paraId: string|number, descricao?: string|null }} opts
 * @returns {Promise<{ migrados: number, ids: number[], detalhes: object[] }>}
 */
async function migrarEtqCodigoProduto(client, opts = {}) {
  const paraId = String(opts.paraId ?? '').trim();
  const deIds = [...new Set(
    (opts.deIds || [])
      .map((id) => String(id ?? '').trim())
      .filter((id) => /^\d+$/.test(id) && id !== paraId)
  )];
  if (!/^\d+$/.test(paraId) || !deIds.length) {
    return { migrados: 0, ids: [], detalhes: [] };
  }

  const desc = String(opts.descricao || '').trim();
  const { rows } = await client.query(
    `UPDATE etiqueta."ETQ_rec_impresso" e
        SET codigo_produto = $1,
            descricao_produto = CASE
              WHEN $3 <> '' THEN $3
              ELSE e.descricao_produto
            END
      WHERE TRIM(COALESCE(e.codigo_produto, '')) = ANY($2::text[])
      RETURNING e.id, TRIM(e.endereco) AS endereco, COALESCE(e.qtd, 0) AS qtd,
                TRIM(COALESCE(e.codigo_produto, '')) AS codigo_produto`,
    [paraId, deIds, desc]
  );

  return {
    migrados: rows.length,
    ids: rows.map((r) => Number(r.id)).filter(Number.isFinite),
    detalhes: rows
  };
}

/**
 * Para cada SKU com cadastro ativo + irmão(s) inativo(s) que ainda têm
 * etiqueta com aquele ID, migra o codigo_produto para o ativo.
 *
 * @param {object} client
 * @returns {Promise<{ migrados: number, pares: number, detalhes: object[] }>}
 */
async function migrarEtqSaldosSkuFantasma(client) {
  const { rows: pares } = await client.query(
    `SELECT TRIM(p.codigo) AS sku,
            pa.codigo_produto::text AS id_ativo,
            LEFT(COALESCE(pa.descricao, ''), 120) AS descricao,
            array_agg(DISTINCT p.codigo_produto::text) AS ids_fantasma
       FROM produto.produtos_omie p
       JOIN produto.produtos_omie pa
         ON TRIM(pa.codigo) = TRIM(p.codigo)
        AND TRIM(COALESCE(pa.codigo, '')) <> ''
        AND COALESCE(NULLIF(UPPER(TRIM(pa.inativo)), ''), 'N') NOT IN ('S', 'SIM')
        AND pa.codigo_produto <> p.codigo_produto
      WHERE COALESCE(NULLIF(UPPER(TRIM(p.inativo)), ''), 'N') IN ('S', 'SIM')
        AND TRIM(COALESCE(p.codigo, '')) <> ''
        AND EXISTS (
          SELECT 1
            FROM etiqueta."ETQ_rec_impresso" e
           WHERE TRIM(COALESCE(e.codigo_produto, '')) = p.codigo_produto::text
        )
      GROUP BY TRIM(p.codigo), pa.codigo_produto, LEFT(COALESCE(pa.descricao, ''), 120)`
  );

  let migrados = 0;
  const detalhes = [];
  for (const par of pares) {
    const r = await migrarEtqCodigoProduto(client, {
      deIds: par.ids_fantasma || [],
      paraId: par.id_ativo,
      descricao: par.descricao
    });
    migrados += r.migrados;
    if (r.migrados > 0) {
      detalhes.push({
        sku: par.sku,
        id_ativo: par.id_ativo,
        ids_fantasma: par.ids_fantasma,
        migrados: r.migrados,
        etiquetas: r.ids
      });
    }
  }

  return { migrados, pares: pares.length, detalhes };
}

/**
 * Após inativar IDs irmãos de um SKU, migra etiquetas desses IDs para o mantido.
 *
 * @param {object} client
 * @param {{ manterId: string|number, idsInativados: Array<string|number>, descricao?: string }} opts
 */
async function migrarEtqAoInativarDuplicatas(client, opts = {}) {
  return migrarEtqCodigoProduto(client, {
    deIds: opts.idsInativados || [],
    paraId: opts.manterId,
    descricao: opts.descricao
  });
}

module.exports = {
  migrarEtqCodigoProduto,
  migrarEtqSaldosSkuFantasma,
  migrarEtqAoInativarDuplicatas
};
