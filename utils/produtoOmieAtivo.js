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
       FROM public.produtos_omie p
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
       FROM public.produtos_omie p
      WHERE (TRIM(p.codigo) = $1 OR TRIM(p.codigo_produto_integracao) = $1)
        AND ${produtoAtivoSql('p')}
      ORDER BY p.updated_at DESC NULLS LAST, p.codigo_produto DESC
      LIMIT 1`,
    [raw]
  );

  return rows.length ? Number(rows[0].codigo_produto) : null;
}

async function resolverProdutoOmieAtivo({ dbQuery, candidatos = [], codigo }) {
  if (typeof dbQuery !== 'function') throw new TypeError('dbQuery é obrigatória.');

  for (const candidato of candidatos) {
    const raw = candidato !== undefined && candidato !== null ? String(candidato).trim() : '';
    if (!/^\d+$/.test(raw)) continue;
    const ativo = await buscarProdutoAtivoPorId(dbQuery, raw);
    if (ativo) return ativo;
  }

  const porCodigo = await buscarProdutoAtivoPorCodigo(dbQuery, codigo);
  if (porCodigo) return porCodigo;

  const err = new Error(`Produto ativo e desbloqueado "${String(codigo || '').trim()}" não encontrado.`);
  err.status = 404;
  throw err;
}

module.exports = {
  buscarProdutoAtivoPorId,
  buscarProdutoAtivoPorCodigo,
  resolverProdutoOmieAtivo
};
