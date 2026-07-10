/**
 * Identidade de produto em public.produtos_omie
 *
 * codigo_produto = ID Omie fixo (ex.: 10409717177) — preferir sempre para localizar.
 * codigo         = SKU legível (pode mudar na Omie).
 *
 * Uso seguro: aceita os dois no input, mas prioriza match em codigo_produto.
 */

'use strict';

/** ID Omie típico: só dígitos, 8+ caracteres (ex. 10409717177). */
function isCodigoProdutoOmie(raw) {
  return /^\d{8,}$/.test(String(raw || '').trim());
}

function normalizarIdentidadeProduto(raw) {
  return String(raw || '').trim();
}

/**
 * Fragmento SQL WHERE para localizar produto.
 * @param {string} [alias=''] - alias da tabela (ex. 'p') ou ''
 * @param {string} [param='$1'] - placeholder
 */
function sqlWhereProdutosOmieIdentidade(alias = '', param = '$1') {
  const p = (col) => (alias ? `${alias}.${col}` : col);
  // Prioridade: codigo_produto (ID Omie) → codigo (SKU) → integracao
  return `(
    TRIM(${p('codigo_produto')}::text) = TRIM(${param})
    OR TRIM(${p('codigo')}) = TRIM(${param})
    OR TRIM(COALESCE(${p('codigo_produto_integracao')}, '')) = TRIM(${param})
  )`;
}

/** ORDER BY para preferir a linha que casou em codigo_produto. */
function sqlOrderPreferCodigoProduto(alias = '', param = '$1') {
  const p = (col) => (alias ? `${alias}.${col}` : col);
  return `CASE
    WHEN TRIM(${p('codigo_produto')}::text) = TRIM(${param}) THEN 0
    WHEN TRIM(${p('codigo')}) = TRIM(${param}) THEN 1
    ELSE 2
  END`;
}

/**
 * Busca 1 produto por identidade (prioriza codigo_produto).
 * @param {Function} queryFn - (sql, params) => Promise<{ rows }>
 * @param {string} identidade
 * @param {string} [selectCols]
 */
async function buscarProdutoOmiePorIdentidade(queryFn, identidade, selectCols = 'codigo, codigo_produto, descricao') {
  const raw = normalizarIdentidadeProduto(identidade);
  if (!raw) return null;
  if (typeof queryFn !== 'function') throw new Error('queryFn obrigatória');

  const sql = `
    SELECT ${selectCols}
      FROM public.produtos_omie
     WHERE ${sqlWhereProdutosOmieIdentidade('', '$1')}
     ORDER BY ${sqlOrderPreferCodigoProduto('', '$1')}
     LIMIT 1`;
  const { rows } = await queryFn(sql, [raw]);
  return rows[0] || null;
}

/**
 * Resolve o codigo_produto (ID Omie) a partir de qualquer identidade.
 * @returns {Promise<string|null>}
 */
async function resolverCodigoProdutoOmie(queryFn, identidade) {
  const raw = normalizarIdentidadeProduto(identidade);
  if (!raw) return null;
  if (isCodigoProdutoOmie(raw)) return raw;
  const row = await buscarProdutoOmiePorIdentidade(queryFn, raw, 'codigo_produto::text AS codigo_produto');
  return row?.codigo_produto ? String(row.codigo_produto).trim() : null;
}

module.exports = {
  isCodigoProdutoOmie,
  normalizarIdentidadeProduto,
  sqlWhereProdutosOmieIdentidade,
  sqlOrderPreferCodigoProduto,
  buscarProdutoOmiePorIdentidade,
  resolverCodigoProdutoOmie,
};
