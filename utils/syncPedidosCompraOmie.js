/**
 * Sincroniza pedidos de compra Omie ↔ intranet.
 *
 * Responsabilidades:
 * - Marcar pedido local como recebido/fechado quando a Omie já baixou
 * - Atualizar itens (n_qtde_rec) a partir do ConsultarPedCompra
 * - Fechar solicitações órfãs que ainda dizem "Compra realizada"/"aguardando compra"
 *
 * Usado pelo webhook, pela varredura do server.js e pelo cron.
 */

'use strict';

const STATUS_FINAIS = new Set([
  'recebido',
  'concluído',
  'concluido',
  'cancelado',
  'reprovado',
  'excluido',
  'excluído'
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Atualiza pendente_omie / "Pedido recebido" com base nas quantidades dos itens.
 * Retorna { total, recebidos, fullyReceived }.
 */
async function atualizarFlagsRecebimentoPedido(clientOrPool, nCodPed) {
  const { rows } = await clientOrPool.query(
    `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE COALESCE(n_qtde_rec, 0) + 0.0001 >= COALESCE(n_qtde, 0)
          AND COALESCE(n_qtde, 0) > 0
      )::int AS recebidos,
      COUNT(*) FILTER (
        WHERE COALESCE(n_qtde, 0) > 0
          AND COALESCE(n_qtde_rec, 0) + 0.0001 < COALESCE(n_qtde, 0)
      )::int AS pendentes
    FROM compras.pedidos_omie_produtos
    WHERE n_cod_ped = $1
    `,
    [nCodPed]
  );

  const total = Number(rows[0]?.total || 0);
  const recebidos = Number(rows[0]?.recebidos || 0);
  const pendentes = Number(rows[0]?.pendentes || 0);
  const fullyReceived = total > 0 && pendentes === 0;

  if (fullyReceived) {
    await clientOrPool.query(
      `
      UPDATE compras.pedidos_omie
         SET pendente_omie = FALSE,
             "Pedido recebido" = TRUE,
             updated_at = NOW()
       WHERE n_cod_ped = $1
      `,
      [nCodPed]
    );
  } else if (pendentes > 0) {
    await clientOrPool.query(
      `
      UPDATE compras.pedidos_omie
         SET pendente_omie = TRUE,
             "Pedido recebido" = FALSE,
             updated_at = NOW()
       WHERE n_cod_ped = $1
         AND COALESCE(inativo, FALSE) = FALSE
      `,
      [nCodPed]
    );
  }

  return { total, recebidos, pendentes, fullyReceived };
}

/**
 * Fecha solicitações locais ligadas a pedidos já fechados/recebidos/inativos na Omie.
 * Também cobre o caso em que o produto saiu do pedido (item removido) e o pedido fechou.
 */
async function fecharSolicitacoesDePedidosFechados(pool, log = console.log) {
  const { rowCount: fechadasPed } = await pool.query(`
    UPDATE compras.solicitacao_compras sc
       SET status = CASE
             WHEN COALESCE(po.inativo, FALSE) = TRUE THEN 'excluido'
             ELSE 'recebido'
           END,
           updated_at = NOW()
      FROM compras.pedidos_omie po
     WHERE (
             (NULLIF(TRIM(sc.ncodped::text), '') IS NOT NULL AND po.n_cod_ped::text = TRIM(sc.ncodped::text))
          OR (NULLIF(TRIM(sc.cnumero::text), '') IS NOT NULL AND TRIM(po.c_numero) = TRIM(sc.cnumero::text))
          OR (
               NULLIF(TRIM(sc.numero_pedido), '') IS NOT NULL
               AND TRIM(po.c_cod_int_ped) = TRIM(sc.numero_pedido)
             )
           )
       AND LOWER(TRIM(COALESCE(sc.status, ''))) NOT IN (
             'recebido', 'concluído', 'concluido', 'cancelado',
             'reprovado', 'excluido', 'excluído', 'carrinho'
           )
       AND (
             COALESCE(po.inativo, FALSE) = TRUE
          OR COALESCE(po."Pedido recebido", FALSE) = TRUE
          OR po.pendente_omie IS FALSE
           )
  `);

  // Produto ainda "em compra" mas o item sumiu do pedido Omie aberto/fechado
  // (ex.: 05.MP.N.61107 removido do pedido 3000 após recebimento parcial/reorganização).
  const { rowCount: fechadasItemSumiu } = await pool.query(`
    UPDATE compras.solicitacao_compras sc
       SET status = 'recebido',
           updated_at = NOW()
      FROM compras.pedidos_omie po
     WHERE (
             (NULLIF(TRIM(sc.ncodped::text), '') IS NOT NULL AND po.n_cod_ped::text = TRIM(sc.ncodped::text))
          OR (NULLIF(TRIM(sc.cnumero::text), '') IS NOT NULL AND TRIM(po.c_numero) = TRIM(sc.cnumero::text))
           )
       AND LOWER(TRIM(COALESCE(sc.status, ''))) IN (
             'compra realizada', 'aguardando compra', 'pedido de compra',
             'faturada pelo fornecedor'
           )
       AND COALESCE(po.inativo, FALSE) = FALSE
       AND TRIM(COALESCE(sc.produto_codigo, '')) <> ''
       AND NOT EXISTS (
             SELECT 1
               FROM compras.pedidos_omie_produtos pi
              WHERE pi.n_cod_ped = po.n_cod_ped
                AND UPPER(TRIM(pi.c_produto)) = UPPER(TRIM(sc.produto_codigo))
                AND COALESCE(pi.n_qtde, 0) > COALESCE(pi.n_qtde_rec, 0)
           )
       AND (
             po.pendente_omie IS FALSE
          OR COALESCE(po."Pedido recebido", FALSE) = TRUE
          OR NOT EXISTS (
               SELECT 1
                 FROM compras.pedidos_omie_produtos pi2
                WHERE pi2.n_cod_ped = po.n_cod_ped
                  AND UPPER(TRIM(pi2.c_produto)) = UPPER(TRIM(sc.produto_codigo))
             )
           )
  `);

  const total = (fechadasPed || 0) + (fechadasItemSumiu || 0);
  if (total > 0) {
    log(`[syncPedidosCompra] Solicitações fechadas: pedido=${fechadasPed || 0} itemSumiu=${fechadasItemSumiu || 0}`);
  }
  return { fechadas_pedido: fechadasPed || 0, fechadas_item_sumiu: fechadasItemSumiu || 0 };
}

/**
 * Atualiza status da solicitação a partir do estado atual do pedido local.
 * statusFinalForcado: 'recebido' | 'excluido' | 'cancelado' (opcional)
 */
async function sincronizarSolicitacaoPorPedido(pool, nCodPed, opts = {}) {
  const log = opts.log || console.log;
  const statusFinalForcado = opts.statusFinalForcado || null;

  const pedidoResult = await pool.query(
    `
    SELECT c_etapa, n_cod_for, c_numero, c_cod_int_ped,
           pendente_omie, inativo,
           COALESCE("Pedido recebido", FALSE) AS pedido_recebido
      FROM compras.pedidos_omie
     WHERE n_cod_ped = $1
    `,
    [nCodPed]
  );

  if (pedidoResult.rows.length === 0) {
    log(`[sincronizarPedido] Pedido ${nCodPed} não encontrado`);
    return { updated: 0 };
  }

  const ped = pedidoResult.rows[0];
  const fechado =
    !!statusFinalForcado ||
    ped.inativo === true ||
    ped.pedido_recebido === true ||
    ped.pendente_omie === false;

  if (fechado) {
    let status = statusFinalForcado || 'recebido';
    if (!statusFinalForcado) {
      if (ped.inativo) status = 'excluido';
      else status = 'recebido';
    }

    const result = await pool.query(
      `
      UPDATE compras.solicitacao_compras
         SET status = $1,
             cnumero = COALESCE(NULLIF(TRIM(cnumero::text), ''), $2),
             updated_at = NOW()
       WHERE (
               ncodped::text = TRIM($3::text)
            OR (NULLIF(TRIM($2), '') IS NOT NULL AND TRIM(cnumero::text) = TRIM($2))
            OR (
                 NULLIF(TRIM($4), '') IS NOT NULL
                 AND TRIM(numero_pedido) = TRIM($4)
               )
             )
         AND LOWER(TRIM(COALESCE(status, ''))) NOT IN (
               'recebido', 'concluído', 'concluido', 'cancelado',
               'reprovado', 'excluido', 'excluído', 'carrinho'
             )
      `,
      [
        status,
        ped.c_numero ? String(ped.c_numero) : null,
        String(nCodPed),
        ped.c_cod_int_ped ? String(ped.c_cod_int_ped) : null
      ]
    );
    log(`[sincronizarPedido] ✓ ncodped=${nCodPed} → status="${status}" (${result.rowCount} sol.)`);
    return { updated: result.rowCount, status };
  }

  const etapa = String(ped.c_etapa || '').trim();
  if (!etapa) {
    return { updated: 0 };
  }

  const etapaResult = await pool.query(
    'SELECT descricao_padrao FROM compras.etapas_pedido_compra WHERE codigo = $1',
    [etapa]
  );
  const descricaoEtapa =
    etapaResult.rows.length > 0 ? etapaResult.rows[0].descricao_padrao : `Etapa ${etapa}`;

  // Não reabre solicitação já finalizada
  const result = await pool.query(
    `
    UPDATE compras.solicitacao_compras
       SET status = $1,
           cnumero = COALESCE($2, cnumero),
           updated_at = NOW()
     WHERE ncodped::text = TRIM($3::text)
       AND LOWER(TRIM(COALESCE(status, ''))) NOT IN (
             'recebido', 'concluído', 'concluido', 'cancelado',
             'reprovado', 'excluido', 'excluído', 'carrinho'
           )
    `,
    [descricaoEtapa, ped.c_numero || null, String(nCodPed)]
  );
  if (result.rowCount > 0) {
    log(`[sincronizarPedido] ✓ ncodped=${nCodPed} etapa ${etapa} → "${descricaoEtapa}"`);
  }
  return { updated: result.rowCount, status: descricaoEtapa };
}

/**
 * Substitui itens locais pelos da Omie (quando a lista vier preenchida).
 */
async function substituirItensPedido(clientOrPool, nCodPed, produtos) {
  if (!Array.isArray(produtos) || produtos.length === 0) return 0;

  await clientOrPool.query(
    'DELETE FROM compras.pedidos_omie_produtos WHERE n_cod_ped = $1',
    [nCodPed]
  );

  for (const prod of produtos) {
    await clientOrPool.query(
      `
      INSERT INTO compras.pedidos_omie_produtos (
        n_cod_ped, n_cod_item, c_produto, c_descricao, c_unidade,
        n_qtde, n_qtde_rec, n_val_unit, n_val_tot
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        nCodPed,
        prod.nCodItem || prod.n_cod_item || null,
        prod.cProduto || prod.c_produto || null,
        prod.cDescricao || prod.c_descricao || null,
        prod.cUnidade || prod.c_unidade || null,
        prod.nQtde || prod.n_qtde || null,
        prod.nQtdeRec || prod.n_qtde_rec || null,
        prod.nValUnit || prod.n_val_unit || null,
        prod.nValTot || prod.n_val_tot || null
      ]
    );
  }
  return produtos.length;
}

/**
 * Após marcar pedido como fechado (não está mais na lista aberta da Omie),
 * consulta a Omie e atualiza itens + flags + solicitação.
 */
async function refrescarPedidoFechadoDaOmie({
  pool,
  nCodPed,
  cNumero,
  omieConsultarPedCompra,
  delayMs = 350,
  log = console.log
}) {
  try {
    if (delayMs > 0) await sleep(delayMs);
    const det = await omieConsultarPedCompra(Number(nCodPed));
    if (det?.faultstring) throw new Error(det.faultstring);

    const ped = det?.pedido_compra_produto || det || {};
    const cab = ped.cabecalho_consulta || ped.cabecalho || {};
    const produtos = ped.produtos_consulta || ped.produtos || [];
    const etapa = String(cab.cEtapa || cab.c_etapa || '').trim();

    if (etapa) {
      await pool.query(
        `UPDATE compras.pedidos_omie SET c_etapa = $2, updated_at = NOW() WHERE n_cod_ped = $1`,
        [nCodPed, etapa]
      );
    }

    if (Array.isArray(produtos) && produtos.length > 0) {
      await substituirItensPedido(pool, nCodPed, produtos);
      await atualizarFlagsRecebimentoPedido(pool, nCodPed);
    } else {
      // Sem itens no retorno: ainda assim fecha (saiu da lista aberta Omie)
      await pool.query(
        `
        UPDATE compras.pedidos_omie
           SET pendente_omie = FALSE,
               "Pedido recebido" = TRUE,
               updated_at = NOW()
         WHERE n_cod_ped = $1
        `,
        [nCodPed]
      );
    }

    await sincronizarSolicitacaoPorPedido(pool, nCodPed, { log });
    log(`[syncPedidosCompra] Pedido ${cNumero || nCodPed} refrescou da Omie (fechado)`);
    return true;
  } catch (e) {
    // Mesmo com falha no Consultar, mantém fechado localmente
    await pool.query(
      `
      UPDATE compras.pedidos_omie
         SET pendente_omie = FALSE,
             "Pedido recebido" = TRUE,
             updated_at = NOW()
       WHERE n_cod_ped = $1
      `,
      [nCodPed]
    );
    await sincronizarSolicitacaoPorPedido(pool, nCodPed, { log });
    log(`[syncPedidosCompra] Pedido ${cNumero || nCodPed} fechado sem refresh completo: ${e.message}`);
    return false;
  }
}

module.exports = {
  STATUS_FINAIS,
  atualizarFlagsRecebimentoPedido,
  fecharSolicitacoesDePedidosFechados,
  sincronizarSolicitacaoPorPedido,
  substituirItensPedido,
  refrescarPedidoFechadoDaOmie
};
