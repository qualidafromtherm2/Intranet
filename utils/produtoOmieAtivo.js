function produtoAtivoSql(alias = 'p') {
  return `
    COALESCE(NULLIF(UPPER(TRIM(${alias}.inativo)), ''), 'N') NOT IN ('S', 'SIM')
    AND COALESCE(NULLIF(UPPER(TRIM(${alias}.bloqueado)), ''), 'N') NOT IN ('S', 'SIM')
  `;
}

async function buscarProdutoAtivoPorId(dbQuery, codigoProduto) {
  const id = Number(codigoProduto);
  if (!Number.isFinite(id) || id <= 0) return null;

  const { rows } = await dbQuery(
    `SELECT p.codigo_produto
       FROM produto.produtos_omie p
      WHERE p.codigo_produto = $1
        AND ${produtoAtivoSql('p')}
      LIMIT 1`,
    [id]
  );

  return rows.length ? Number(rows[0].codigo_produto) : null;
}

async function buscarProdutoAtivoPorCodigo(dbQuery, codigo) {
  const raw = String(codigo || '').trim();
  if (!raw) return null;

  const { rows } = await dbQuery(
    `SELECT p.codigo_produto
       FROM produto.produtos_omie p
      WHERE (TRIM(p.codigo) = $1 OR TRIM(p.codigo_produto_integracao) = $1)
        AND ${produtoAtivoSql('p')}
      ORDER BY p.updated_at DESC NULLS LAST, p.codigo_produto DESC
      LIMIT 1`,
    [raw]
  );

  return rows.length ? Number(rows[0].codigo_produto) : null;
}

/**
 * Resolve o id Omie (codigo_produto) preferindo cadastro ativo/desbloqueado.
 * Cobre o caso de código duplicado (ex.: 01.MP.N.30100) em que o ID antigo
 * ficou inativo/excluído na Omie e ainda existe localmente.
 *
 * @param {Function} dbQuery
 * @param {string|number} codigoOuId
 * @param {{ strictAtivo?: boolean }} [opts]
 * @returns {Promise<string|null>}
 */
async function resolverCodigoProdutoPreferindoAtivo(dbQuery, codigoOuId, opts = {}) {
  const strictAtivo = !!opts.strictAtivo;
  const raw = String(codigoOuId || '').trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const ativoId = await buscarProdutoAtivoPorId(dbQuery, raw);
    if (ativoId) return String(ativoId);
  }

  const ativoCod = await buscarProdutoAtivoPorCodigo(dbQuery, raw);
  if (ativoCod) return String(ativoCod);

  // ID fantasma/inativo: usa o código do registro e busca o ativo equivalente.
  if (/^\d+$/.test(raw)) {
    const { rows } = await dbQuery(
      `SELECT TRIM(codigo) AS codigo,
              TRIM(COALESCE(codigo_produto_integracao, '')) AS integracao
         FROM produto.produtos_omie
        WHERE codigo_produto = $1
        LIMIT 1`,
      [Number(raw)]
    );
    const candidatos = [rows[0]?.codigo, rows[0]?.integracao].filter(Boolean);
    for (const c of candidatos) {
      const alt = await buscarProdutoAtivoPorCodigo(dbQuery, c);
      if (alt) return String(alt);
    }
  }

  if (strictAtivo) return null;

  // Fallback legado (etiquetas / histórico): qualquer match, ativos primeiro.
  const { rows } = await dbQuery(
    `SELECT codigo_produto::text AS id_omie
       FROM produto.produtos_omie
      WHERE TRIM(codigo_produto::text) = TRIM($1)
         OR TRIM(codigo) = TRIM($1)
         OR TRIM(COALESCE(codigo_produto_integracao, '')) = TRIM($1)
      ORDER BY
        CASE
          WHEN COALESCE(NULLIF(UPPER(TRIM(inativo)), ''), 'N') IN ('S', 'SIM') THEN 1
          ELSE 0
        END,
        CASE
          WHEN COALESCE(NULLIF(UPPER(TRIM(bloqueado)), ''), 'N') IN ('S', 'SIM') THEN 1
          ELSE 0
        END,
        CASE
          WHEN TRIM(codigo_produto::text) = TRIM($1) THEN 0
          WHEN TRIM(codigo) = TRIM($1) THEN 1
          ELSE 2
        END,
        updated_at DESC NULLS LAST,
        codigo_produto DESC
      LIMIT 1`,
    [raw]
  );
  return rows[0]?.id_omie || null;
}

/**
 * Resolve o código textual (SKU) preferindo cadastro ativo/desbloqueado.
 */
async function resolverCodigoTextoPreferindoAtivo(dbQuery, codigoOuId) {
  const raw = String(codigoOuId || '').trim();
  if (!raw) return null;

  const { rows } = await dbQuery(
    `SELECT codigo
       FROM produto.produtos_omie
      WHERE TRIM(codigo_produto::text) = TRIM($1)
         OR TRIM(codigo) = TRIM($1)
         OR TRIM(COALESCE(codigo_produto_integracao, '')) = TRIM($1)
      ORDER BY
        CASE
          WHEN COALESCE(NULLIF(UPPER(TRIM(inativo)), ''), 'N') IN ('S', 'SIM') THEN 1
          ELSE 0
        END,
        CASE
          WHEN COALESCE(NULLIF(UPPER(TRIM(bloqueado)), ''), 'N') IN ('S', 'SIM') THEN 1
          ELSE 0
        END,
        CASE
          WHEN TRIM(codigo_produto::text) = TRIM($1) THEN 0
          WHEN TRIM(codigo) = TRIM($1) THEN 1
          ELSE 2
        END,
        updated_at DESC NULLS LAST,
        codigo_produto DESC
      LIMIT 1`,
    [raw]
  );
  return rows[0]?.codigo || raw;
}

async function resolverProdutoOmieAtivo({ dbQuery, candidatos = [], codigo }) {
  if (typeof dbQuery !== 'function') throw new TypeError('dbQuery é obrigatória.');

  for (const candidato of candidatos) {
    const raw = candidato !== undefined && candidato !== null ? String(candidato).trim() : '';
    if (!/^\d+$/.test(raw)) continue;
    const ativo = await buscarProdutoAtivoPorId(dbQuery, raw);
    if (ativo) return ativo;

    // Candidato numérico inativo/excluído: tenta o ativo pelo SKU do registro.
    const viaPreferido = await resolverCodigoProdutoPreferindoAtivo(dbQuery, raw, { strictAtivo: true });
    if (viaPreferido) return Number(viaPreferido);
  }

  const porCodigo = await buscarProdutoAtivoPorCodigo(dbQuery, codigo);
  if (porCodigo) return porCodigo;

  const err = new Error(`Produto ativo e desbloqueado "${String(codigo || '').trim()}" não encontrado.`);
  err.status = 404;
  throw err;
}

function mensagemErroOmieProduto(errOrText) {
  const raw = typeof errOrText === 'string'
    ? errOrText
    : String(errOrText?.message || errOrText || '');
  let fault = raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.faultstring) fault = String(parsed.faultstring);
  } catch (_) { /* texto simples */ }
  return fault;
}

function omieErroProdutoNaoLocalizado(errOrText) {
  const fault = mensagemErroOmieProduto(errOrText);
  return /nenhum produto foi localizado|produto n[aã]o cadastrado|produto.+n[aã]o encontrado|c[oó]digo de integra[cç][aã]o/i.test(fault);
}

module.exports = {
  produtoAtivoSql,
  buscarProdutoAtivoPorId,
  buscarProdutoAtivoPorCodigo,
  resolverCodigoProdutoPreferindoAtivo,
  resolverCodigoTextoPreferindoAtivo,
  resolverProdutoOmieAtivo,
  mensagemErroOmieProduto,
  omieErroProdutoNaoLocalizado
};
