/**
 * Fantasmas Omie: produtos que existem no Postgres local
 * mas foram excluídos no Omie (ConsultarProduto → Client-105).
 *
 * Estratégia: marcar inativo = 'S' (não DELETE), para:
 * - sumir da Lista de produtos (filtro padrão oculta inativos)
 * - preservar imagens/anexos e histórico local
 *
 * Também trata o caso "mesmo SKU, ID novo": quando a Omie recria o produto
 * com outro codigo_produto, o ID antigo precisa ficar inativo para a
 * separação/transferência não mandarem o ID fantasma.
 *
 * Ao inativar o ID antigo, migra saldo de etiqueta.ETQ_rec_impresso
 * para o ID ativo (senão a SEP acha "não possui saldo").
 */

const {
  migrarEtqAoInativarDuplicatas,
  migrarEtqSaldosSkuFantasma
} = require('./etqMigrarCodigoFantasma');

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
      `UPDATE produto.produtos_omie
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
 * Após upsert de um produto ATIVO, inativa outros registros com o mesmo
 * codigo / codigo_produto_integracao (IDs antigos do mesmo SKU).
 *
 * @param {object} client
 * @param {{ codigoProduto: string|number, codigo?: string, integracao?: string }} opts
 * @param {string} [source='omie_sync']
 * @param {{ alreadyInTx?: boolean }} [flags] — se true, não abre BEGIN (já está em tx com source)
 */
async function desativarDuplicatasMesmoCodigo(client, opts, source = 'omie_sync', flags = {}) {
  const codigoProduto = String(opts?.codigoProduto ?? '').trim();
  if (!/^\d+$/.test(codigoProduto)) {
    return { marcados: 0, ids: [], detalhes: [] };
  }

  const codigo = String(opts?.codigo || '').trim();
  const integracao = String(opts?.integracao || '').trim();

  const run = async () => {
    // Garante códigos do próprio registro se o caller não passou.
    let cod = codigo;
    let integ = integracao;
    if (!cod || !integ) {
      const { rows } = await client.query(
        `SELECT TRIM(codigo) AS codigo,
                TRIM(COALESCE(codigo_produto_integracao, '')) AS integracao,
                COALESCE(NULLIF(UPPER(TRIM(inativo)), ''), 'N') AS inativo
           FROM produto.produtos_omie
          WHERE codigo_produto = $1
          LIMIT 1`,
        [codigoProduto]
      );
      if (!rows[0]) return { marcados: 0, ids: [], detalhes: [] };
      if (rows[0].inativo === 'S' || rows[0].inativo === 'SIM') {
        return { marcados: 0, ids: [], detalhes: [] };
      }
      cod = cod || rows[0].codigo || '';
      integ = integ || rows[0].integracao || '';
    }

    if (!cod && !integ) return { marcados: 0, ids: [], detalhes: [] };

    const { rows } = await client.query(
      `UPDATE produto.produtos_omie
          SET inativo = 'S',
              updated_at = NOW()
        WHERE codigo_produto <> $1::bigint
          AND COALESCE(UPPER(TRIM(inativo)), 'N') <> 'S'
          AND (
            ($2 <> '' AND TRIM(codigo) = $2)
            OR ($3 <> '' AND TRIM(COALESCE(codigo_produto_integracao, '')) = $3)
          )
        RETURNING codigo_produto::text AS codigo_produto, codigo, LEFT(descricao, 80) AS descricao`,
      [codigoProduto, cod, integ]
    );

    let etq = { migrados: 0, ids: [], detalhes: [] };
    if (rows.length) {
      const { rows: descRows } = await client.query(
        `SELECT LEFT(COALESCE(descricao, ''), 120) AS descricao
           FROM produto.produtos_omie WHERE codigo_produto = $1::bigint LIMIT 1`,
        [codigoProduto]
      );
      etq = await migrarEtqAoInativarDuplicatas(client, {
        manterId: codigoProduto,
        idsInativados: rows.map((r) => r.codigo_produto),
        descricao: descRows[0]?.descricao || ''
      });
    }

    return {
      marcados: rows.length,
      ids: rows.map((r) => r.codigo_produto),
      detalhes: rows,
      etq_migrados: etq.migrados,
      etq
    };
  };

  if (flags.alreadyInTx) return run();
  return comSourceOmie(client, source, run);
}

/**
 * Limpa SKUs com mais de um cadastro ainda "ativo" localmente.
 * Mantém o de maior codigo_produto (em geral o mais novo na Omie).
 */
async function limparDuplicatasAtivasLocais(client, source = 'omie_sync') {
  return comSourceOmie(client, source, async () => {
    const { rows: grupos } = await client.query(
      `SELECT TRIM(codigo) AS codigo,
              array_agg(codigo_produto ORDER BY codigo_produto DESC) AS ids
         FROM produto.produtos_omie
        WHERE TRIM(COALESCE(codigo, '')) <> ''
          AND COALESCE(UPPER(TRIM(inativo)), 'N') NOT IN ('S', 'SIM')
        GROUP BY TRIM(codigo)
       HAVING COUNT(*) > 1`
    );

    let marcados = 0;
    let etqMigrados = 0;
    const detalhes = [];
    for (const g of grupos) {
      const ids = (g.ids || []).map(String);
      const manter = ids[0];
      const inativar = ids.slice(1);
      if (!inativar.length) continue;
      const { rows } = await client.query(
        `UPDATE produto.produtos_omie
            SET inativo = 'S',
                updated_at = NOW()
          WHERE codigo_produto = ANY($1::bigint[])
            AND COALESCE(UPPER(TRIM(inativo)), 'N') <> 'S'
          RETURNING codigo_produto::text AS codigo_produto, codigo, LEFT(descricao, 80) AS descricao`,
        [inativar]
      );
      marcados += rows.length;
      for (const r of rows) {
        detalhes.push({ ...r, mantido: manter, motivo: 'duplicata_ativa_local' });
      }
      if (rows.length) {
        const { rows: descRows } = await client.query(
          `SELECT LEFT(COALESCE(descricao, ''), 120) AS descricao
             FROM produto.produtos_omie WHERE codigo_produto = $1::bigint LIMIT 1`,
          [manter]
        );
        const etq = await migrarEtqAoInativarDuplicatas(client, {
          manterId: manter,
          idsInativados: rows.map((r) => r.codigo_produto),
          descricao: descRows[0]?.descricao || ''
        });
        etqMigrados += etq.migrados || 0;
      }
    }

    // Também cobre fantasmas já inativos com saldo ETQ preso (ex.: 01.MP.N.30100).
    const etqExtra = await migrarEtqSaldosSkuFantasma(client);
    etqMigrados += etqExtra.migrados || 0;

    return {
      marcados,
      detalhes,
      grupos: grupos.length,
      etq_migrados: etqMigrados,
      etq: etqExtra
    };
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
      `UPDATE produto.produtos_omie
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
  desativarDuplicatasMesmoCodigo,
  limparDuplicatasAtivasLocais,
  reconciliarProdutosOmieAusentes,
  migrarEtqSaldosSkuFantasma
};
