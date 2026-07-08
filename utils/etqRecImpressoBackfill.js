/**
 * utils/etqRecImpressoBackfill.js
 * Preenche codigo/descricao em ETQ_rec_impresso usando apenas dados do banco.
 */
async function backfillEtqRecImpresso(conn) {
  let total = 0;

  const rec = await conn.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = COALESCE(NULLIF(TRIM(i.codigo_produto), ''), p.codigo_produto::text),
           descricao_produto = COALESCE(
             NULLIF(TRIM(i.descricao_produto), ''),
             NULLIF(TRIM(p.descricao), ''),
             NULLIF(TRIM(r.descricao_produto), '')
           )
      FROM etiqueta."ETQ_recebimento" r
      JOIN public.produtos_omie p ON TRIM(p.codigo) = TRIM(r.codigo_produto)
     WHERE r.id = i.origem_id
       AND (
         NULLIF(TRIM(i.codigo_produto), '') IS NULL
         OR NULLIF(TRIM(i.descricao_produto), '') IS NULL
       )
  `);
  total += rec.rowCount || 0;

  const zpl = await conn.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = p.codigo_produto::text,
           descricao_produto = COALESCE(
             NULLIF(TRIM(i.descricao_produto), ''),
             NULLIF(TRIM(p.descricao), '')
           )
      FROM public.produtos_omie p
     WHERE (i.codigo_produto IS NULL OR TRIM(i.codigo_produto) = '')
       AND i.conteudo_zpl IS NOT NULL
       AND TRIM(i.conteudo_zpl) <> ''
       AND TRIM(SUBSTRING(i.conteudo_zpl FROM 'Cod\\. Produto: ([^\\^\\n\\r]+)')) <> ''
       AND TRIM(p.codigo) = TRIM(SUBSTRING(i.conteudo_zpl FROM 'Cod\\. Produto: ([^\\^\\n\\r]+)'))
       AND p.codigo_produto IS NOT NULL
  `);
  total += zpl.rowCount || 0;

  // Mesmo endereço: copia codigo/descricao de outro registro ETQ_rec_impresso preenchido.
  const irmao = await conn.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = COALESCE(NULLIF(TRIM(i.codigo_produto), ''), ref.codigo_produto),
           descricao_produto = COALESCE(
             NULLIF(TRIM(i.descricao_produto), ''),
             NULLIF(TRIM(ref.descricao_produto), '')
           ),
           complemento = COALESCE(
             NULLIF(TRIM(i.complemento), ''),
             NULLIF(TRIM(ref.complemento), '')
           )
      FROM (
        SELECT DISTINCT ON (TRIM(endereco))
               TRIM(endereco) AS endereco,
               codigo_produto,
               descricao_produto,
               complemento
          FROM etiqueta."ETQ_rec_impresso"
         WHERE endereco IS NOT NULL AND TRIM(endereco) <> ''
           AND NULLIF(TRIM(codigo_produto), '') IS NOT NULL
         ORDER BY TRIM(endereco), id DESC
      ) ref
     WHERE TRIM(COALESCE(i.endereco, '')) = ref.endereco
       AND (
         NULLIF(TRIM(i.codigo_produto), '') IS NULL
         OR NULLIF(TRIM(i.descricao_produto), '') IS NULL
       )
  `);
  total += irmao.rowCount || 0;

  const fix = await conn.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = p.codigo_produto::text,
           descricao_produto = COALESCE(NULLIF(TRIM(i.descricao_produto), ''), NULLIF(TRIM(p.descricao), ''))
      FROM public.produtos_omie p
     WHERE TRIM(i.codigo_produto) = TRIM(p.codigo)
       AND p.codigo_produto IS NOT NULL
       AND TRIM(i.codigo_produto) <> TRIM(p.codigo_produto::text)
  `);
  total += fix.rowCount || 0;

  return total;
}

module.exports = { backfillEtqRecImpresso };
