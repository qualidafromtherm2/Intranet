/**
 * CTE e join entre NF de vendas (webhook Omie) e pedidos_venda.
 * Desde mai/2026 o Omie passou a enviar id_pedido no webhook sem numero_pedido;
 * o codigo_pedido na intranet corresponde ao id_pedido_omie (não ao numero_pedido visível).
 */
const VENDAS_NF_POR_PEDIDO_CTE = `
  nf_por_pedido AS (
    SELECT
      COALESCE(NULLIF(TRIM(numero_pedido), ''), TRIM(id_pedido_omie::text), '') AS pedido_key,
      MAX(
        CASE
          WHEN TRIM(COALESCE(data_emissao, '')) ~ '^\\d{4}-\\d{2}-\\d{2}'
            THEN LEFT(TRIM(data_emissao), 10)::date
          WHEN TRIM(COALESCE(data_emissao, '')) ~ '^\\d{1,2}/\\d{1,2}/\\d{4}'
            THEN to_date(regexp_replace(SUBSTRING(TRIM(data_emissao) FROM 1 FOR 10), ' .*', ''), 'DD/MM/YYYY')
          ELSE NULL
        END
      ) AS data_emissao_dt
    FROM "Vendas".notas_fiscais_omie
    WHERE COALESCE(NULLIF(TRIM(numero_pedido), ''), TRIM(id_pedido_omie::text), '') <> ''
    GROUP BY 1
  )
`;

function vendasNfJoinPedidoSql(aliasNf = 'nf', aliasPedido = 'p') {
  return `TRIM(COALESCE(${aliasPedido}.codigo_pedido::text, '')) = ${aliasNf}.pedido_key`;
}

function resolveNumeroPedidoFromWebhook(numeroPedido, idPedidoOmie) {
  const n = String(numeroPedido || '').trim();
  if (n) return n;
  if (idPedidoOmie !== null && idPedidoOmie !== undefined && String(idPedidoOmie).trim()) {
    return String(idPedidoOmie).trim();
  }
  return null;
}

module.exports = {
  VENDAS_NF_POR_PEDIDO_CTE,
  vendasNfJoinPedidoSql,
  resolveNumeroPedidoFromWebhook,
};
