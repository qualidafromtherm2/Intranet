#!/usr/bin/env node
/**
 * Chamado #19 — destravar pedidos 3053, 3060, 3069, 3083 em Compra realizada.
 *
 * Uso (produção):
 *   set -a && source .env.render-backup-YYYYMMDD && set +a
 *   node scripts/fixar_chamado_19_pedidos_recebidos.js
 */
'use strict';

const { Client } = require('pg');
const {
  atualizarFlagsRecebimentoPedido,
  sincronizarSolicitacaoPorPedido,
  fecharAposRecebimentoNfeLocal,
  substituirItensPedido
} = require('../utils/syncPedidosCompraOmie');

const NUMEROS = ['3053', '3060', '3069', '3083'];

function assertProdUrl(url) {
  const u = String(url || '');
  if (!u) throw new Error('Defina DATABASE_URL (produção).');
  if (/127\.0\.0\.1|localhost|intranet_local/i.test(u)) {
    throw new Error('Recusado: DATABASE_URL aponta para localhost.');
  }
}

async function consultarPedCompra(nCodPed) {
  const key = process.env.OMIE_APP_KEY;
  const secret = process.env.OMIE_APP_SECRET;
  if (!key || !secret) return null;

  const resp = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarPedCompra',
      app_key: key,
      app_secret: secret,
      param: [{ nCodPed: Number(nCodPed) }]
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data?.faultstring) {
    throw new Error(data?.faultstring || `HTTP ${resp.status}`);
  }
  return data;
}

async function main() {
  assertProdUrl(process.env.DATABASE_URL);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  try {
    const { rows: pedidos } = await client.query(
      `
      SELECT n_cod_ped, c_numero, "Etapa_NF", "Pedido recebido", pendente_omie, n_valor,
             "NFe vinculada"
        FROM compras.pedidos_omie
       WHERE BTRIM(c_numero) = ANY($1::text[])
       ORDER BY c_numero
      `,
      [NUMEROS]
    );

    if (!pedidos.length) {
      console.log('Nenhum pedido encontrado.');
      return;
    }

    for (const ped of pedidos) {
      const nCodPed = Number(ped.n_cod_ped);
      console.log(`\n=== Pedido ${ped.c_numero} (${nCodPed}) ===`);

      const { rows: resumo } = await client.query(
        `WITH pedido AS (
           SELECT COALESCE(
                    NULLIF(p.n_valor, 0),
                    (
                      SELECT COALESCE(SUM(COALESCE(pp.n_val_tot, 0)), 0)
                        FROM compras.pedidos_omie_produtos pp
                       WHERE pp.n_cod_ped = p.n_cod_ped
                    ),
                    0
                  )::numeric AS valor_total
             FROM compras.pedidos_omie p
            WHERE p.n_cod_ped = $1
         ),
         recebido AS (
           SELECT COALESCE(SUM(COALESCE(i.v_total_item, 0)), 0)::numeric AS valor_recebido
             FROM logistica.recebimentos_nfe_itens i
             JOIN logistica.recebimentos_nfe_omie r ON r.n_id_receb = i.n_id_receb
            WHERE i.n_id_pedido = $1
              AND COALESCE(r.c_cancelada, 'N') <> 'S'
         )
         SELECT p.valor_total, r.valor_recebido FROM pedido p CROSS JOIN recebido r`,
        [nCodPed]
      );

      const vt = Number(resumo[0]?.valor_total || 0);
      const vr = Number(resumo[0]?.valor_recebido || 0);
      const etapaNf = vt > 0 && vr + 0.01 >= vt ? '60' : '50';
      console.log(`  valores: recebido=${vr} total=${vt} → Etapa_NF=${etapaNf}`);

      try {
        const det = await consultarPedCompra(nCodPed);
        if (det) {
          const pedOmie = det?.pedido_compra_produto || det || {};
          const produtos = pedOmie.produtos_consulta || pedOmie.produtos || [];
          if (Array.isArray(produtos) && produtos.length) {
            await substituirItensPedido(client, nCodPed, produtos);
            const flags = await atualizarFlagsRecebimentoPedido(client, nCodPed);
            console.log(`  Omie itens: total=${flags.total} recebidos=${flags.recebidos} full=${flags.fullyReceived}`);
          }
        }
      } catch (e) {
        console.warn(`  Omie ConsultarPedCompra: ${e.message}`);
      }

      await client.query(
        `
        UPDATE compras.pedidos_omie
           SET "Etapa_NF" = $2,
               updated_at = NOW()
         WHERE n_cod_ped = $1
        `,
        [nCodPed, etapaNf]
      );

      const fechou = await fecharAposRecebimentoNfeLocal(client, nCodPed, {
        etapaNf,
        origem: 'chamado-19-fix',
        log: console.log
      });

      // Garantia extra: se valor já bateu 100%, força flags mesmo se Omie não trouxe n_qtde_rec
      if (etapaNf === '60') {
        await client.query(
          `
          UPDATE compras.pedidos_omie
             SET pendente_omie = FALSE,
                 "Pedido recebido" = TRUE,
                 "Pedido recebido em" = COALESCE("Pedido recebido em", NOW()),
                 "Pedido recebido webhook" = COALESCE(
                   NULLIF(BTRIM("Pedido recebido webhook"), ''),
                   'chamado-19-fix'
                 ),
                 updated_at = NOW()
           WHERE n_cod_ped = $1
          `,
          [nCodPed]
        );
        await sincronizarSolicitacaoPorPedido(client, nCodPed, {
          statusFinalForcado: 'recebido',
          log: console.log
        });
      }

      const { rows: after } = await client.query(
        `
        SELECT "Etapa_NF", "Pedido recebido", pendente_omie, "Pedido recebido webhook"
          FROM compras.pedidos_omie WHERE n_cod_ped = $1
        `,
        [nCodPed]
      );
      const { rows: sols } = await client.query(
        `
        SELECT id, status, produto_codigo
          FROM compras.solicitacao_compras
         WHERE ncodped::text = $1 OR BTRIM(cnumero::text) = BTRIM($2)
         ORDER BY id
        `,
        [String(nCodPed), String(ped.c_numero)]
      );

      console.log('  pedido:', after[0]);
      console.log('  solicitacoes:', sols);
      console.log('  fecharApos:', fechou);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
