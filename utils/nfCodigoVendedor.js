'use strict';

/**
 * Extrai código do vendedor do payload da NF de venda (Omie).
 * Fonte principal: titulos[].nCodVendedor (sempre vem na ConsultarNF).
 * Fallback: campos avulsos no root / pedido.
 */
function extractCodigoVendedorFromNfPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const root =
    Array.isArray(payload.det) || Array.isArray(payload.titulos)
      ? payload
      : (payload.event && typeof payload.event === 'object' ? payload.event : payload);

  const titulos = Array.isArray(root?.titulos) ? root.titulos : [];
  for (const t of titulos) {
    const digits = String(t?.nCodVendedor ?? t?.codVend ?? t?.nCodVend ?? '')
      .replace(/\D/g, '')
      .trim();
    if (digits && digits !== '0') return digits;
  }

  const avulsos = [
    root?.nCodVendedor,
    root?.codVend,
    root?.pedido?.nCodVendedor,
    root?.pedido?.codVend,
    root?.compl?.nCodVendedor,
  ];
  for (const raw of avulsos) {
    const digits = String(raw ?? '').replace(/\D/g, '').trim();
    if (digits && digits !== '0') return digits;
  }
  return null;
}

/**
 * SQL: código do vendedor na CTE base do relatório.
 * Ordem: pedido (codVend) → coluna gravada na NF → títulos da NF.
 * Aliases esperados: p (pedidos_venda), nf (nf_emitidas / notas).
 */
const CODIGO_VENDEDOR_SQL = `COALESCE(
  NULLIF(TRIM(p.informacoes_adicionais->>'codVend'), ''),
  NULLIF(TRIM(nf.codigo_vendedor::text), ''),
  (
    SELECT NULLIF(REGEXP_REPLACE(TRIM(COALESCE(t->>'nCodVendedor', '')), '\\D', '', 'g'), '')
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(nf.payload_ultimo->'titulos') = 'array'
            THEN nf.payload_ultimo->'titulos'
          ELSE '[]'::jsonb
        END
      ) AS t
     WHERE NULLIF(REGEXP_REPLACE(TRIM(COALESCE(t->>'nCodVendedor', '')), '\\D', '', 'g'), '') IS NOT NULL
       AND REGEXP_REPLACE(TRIM(COALESCE(t->>'nCodVendedor', '')), '\\D', '', 'g') <> '0'
     LIMIT 1
  ),
  ''
)`;

/** UPDATE que preenche codigo_vendedor a partir do payload (backfill). */
const BACKFILL_CODIGO_VENDEDOR_SQL = `
  UPDATE vendas.notas_fiscais_omie nf
     SET codigo_vendedor = sub.cod,
         updated_at = NOW()
    FROM (
      SELECT
        n.id,
        (
          SELECT NULLIF(REGEXP_REPLACE(TRIM(COALESCE(t->>'nCodVendedor', '')), '\\D', '', 'g'), '')
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(n.payload_ultimo->'titulos') = 'array'
                  THEN n.payload_ultimo->'titulos'
                ELSE '[]'::jsonb
              END
            ) AS t
           WHERE NULLIF(REGEXP_REPLACE(TRIM(COALESCE(t->>'nCodVendedor', '')), '\\D', '', 'g'), '') IS NOT NULL
             AND REGEXP_REPLACE(TRIM(COALESCE(t->>'nCodVendedor', '')), '\\D', '', 'g') <> '0'
           LIMIT 1
        ) AS cod
      FROM vendas.notas_fiscais_omie n
      WHERE COALESCE(TRIM(n.codigo_vendedor), '') = ''
        AND n.payload_ultimo IS NOT NULL
    ) sub
   WHERE nf.id = sub.id
     AND sub.cod IS NOT NULL
`;

module.exports = {
  extractCodigoVendedorFromNfPayload,
  CODIGO_VENDEDOR_SQL,
  BACKFILL_CODIGO_VENDEDOR_SQL,
};
