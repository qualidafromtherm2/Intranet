#!/usr/bin/env node
/**
 * Reconciliação imediata: alinha pedidos_omie + solicitacao_compras com a Omie.
 * Uso: node scripts/reconciliar_pedidos_compra_omie.js
 */
require('dotenv/config');
const { pool } = require('../src/db');
const {
  fecharSolicitacoesDePedidosFechados,
  sincronizarSolicitacaoPorPedido,
  refrescarPedidoFechadoDaOmie,
  substituirItensPedido,
  atualizarFlagsRecebimentoPedido
} = require('../utils/syncPedidosCompraOmie');

const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;
const DELAY_MS = 350;

function log(...a) { console.log(...a); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function omiePost(path, call, param) {
  const res = await fetch(`https://app.omie.com.br/api/v1/${path}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] })
  });
  await sleep(DELAY_MS);
  return res.json();
}

async function pesquisar(filtros) {
  const mapa = new Map();
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    let data;
    try {
      data = await omiePost('produtos/pedidocompra', 'PesquisarPedCompra', {
        nPagina: pagina,
        nRegsPorPagina: 50,
        dDataInicial: '01/01/2026',
        ...filtros
      });
    } catch (e) {
      if (/n[aã]o existem registros/i.test(String(e.message || ''))) break;
      throw e;
    }
    if (data?.faultstring) {
      if (/n[aã]o existem registros/i.test(data.faultstring)) break;
      throw new Error(data.faultstring);
    }
    totalPaginas = data.nTotalPaginas || 1;
    for (const item of (data.pedidos_pesquisa || [])) {
      const cab = item?.cabecalho_consulta || {};
      if (cab.nCodPed) mapa.set(String(cab.nCodPed), String(cab.cEtapa || '').trim());
    }
    pagina++;
  }
  return mapa;
}

(async () => {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) throw new Error('OMIE_APP_KEY/SECRET ausentes');

  log('── Reconciliando pedidos com a Omie...');
  const etapasOmie = await pesquisar({
    lExibirPedidosPendentes: true,
    lExibirPedidosFaturados: true,
    lExibirPedidosRecebidos: true,
    lExibirPedidosCancelados: true,
    lExibirPedidosEncerrados: true,
    lExibirPedidosRecParciais: true,
    lExibirPedidosFatParciais: true
  });
  const pendentesOmie = await pesquisar({
    lExibirPedidosPendentes: true,
    lExibirPedidosFaturados: true,
    lExibirPedidosFatParciais: true,
    lExibirPedidosRecParciais: true
  });
  log(`  Omie: ${etapasOmie.size} pedidos mapeados, ${pendentesOmie.size} abertos`);

  await pool.query(`ALTER TABLE compras.pedidos_omie ADD COLUMN IF NOT EXISTS pendente_omie BOOLEAN`);

  const { rows: abertos } = await pool.query(`
    SELECT DISTINCT po.n_cod_ped, po.c_numero, po.c_etapa, po.pendente_omie
    FROM compras.pedidos_omie po
    WHERE COALESCE(po.inativo, FALSE) = FALSE
      AND po.d_inc_data >= '2026-01-01'
  `);

  let inativados = 0, etapaAjustada = 0, fechados = 0, reabertos = 0, importados = 0;

  for (const ped of abertos) {
    const idPed = String(ped.n_cod_ped);
    const etapaOmie = etapasOmie.get(idPed);

    if (etapaOmie === undefined) {
      await pool.query(
        `UPDATE compras.pedidos_omie
            SET inativo = TRUE, pendente_omie = FALSE, "Pedido recebido" = TRUE, updated_at = NOW()
          WHERE n_cod_ped = $1`,
        [ped.n_cod_ped]
      );
      await sincronizarSolicitacaoPorPedido(pool, ped.n_cod_ped, { statusFinalForcado: 'excluido', log });
      inativados++;
      log(`  ✓ inativado ${ped.c_numero}`);
      continue;
    }

    if (etapaOmie && etapaOmie !== String(ped.c_etapa || '').trim()) {
      await pool.query(
        `UPDATE compras.pedidos_omie SET c_etapa = $2, updated_at = NOW() WHERE n_cod_ped = $1`,
        [ped.n_cod_ped, etapaOmie]
      );
      etapaAjustada++;
    }

    const pendenteAgora = pendentesOmie.has(idPed);
    if (ped.pendente_omie !== pendenteAgora) {
      await pool.query(
        `UPDATE compras.pedidos_omie SET pendente_omie = $2, updated_at = NOW() WHERE n_cod_ped = $1`,
        [ped.n_cod_ped, pendenteAgora]
      );
      if (!pendenteAgora) {
        fechados++;
        log(`  ✓ fechando ${ped.c_numero}...`);
        await refrescarPedidoFechadoDaOmie({
          pool,
          nCodPed: ped.n_cod_ped,
          cNumero: ped.c_numero,
          delayMs: DELAY_MS,
          log,
          omieConsultarPedCompra: (nCod) =>
            omiePost('produtos/pedidocompra', 'ConsultarPedCompra', { nCodPed: Number(nCod) })
        });
      } else {
        reabertos++;
        await sincronizarSolicitacaoPorPedido(pool, ped.n_cod_ped, { log });
      }
    }
  }

  const { rows: idsLocais } = await pool.query(`SELECT n_cod_ped FROM compras.pedidos_omie`);
  const setIds = new Set(idsLocais.map(r => String(r.n_cod_ped)));
  for (const idPed of pendentesOmie.keys()) {
    if (setIds.has(idPed)) continue;
    try {
      const det = await omiePost('produtos/pedidocompra', 'ConsultarPedCompra', { nCodPed: Number(idPed) });
      if (det?.faultstring) throw new Error(det.faultstring);
      const ped = det?.pedido_compra_produto || det || {};
      const cab = ped.cabecalho_consulta || ped.cabecalho || {};
      const produtos = ped.produtos_consulta || ped.produtos || [];
      if (!cab.nCodPed) throw new Error('sem cabeçalho');
      const dataInc = String(cab.dIncData || '').split('/').reverse().join('-') || null;
      const dataPrev = String(cab.dDtPrevisao || '').split('/').reverse().join('-') || null;
      await pool.query(`
        INSERT INTO compras.pedidos_omie (
          n_cod_ped, c_cod_int_ped, c_numero, d_inc_data, c_inc_hora, d_dt_previsao,
          c_etapa, n_cod_for, c_cod_parc, n_qtde_parc, c_obs, c_obs_int,
          pendente_omie, inativo, evento_webhook, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,FALSE,'manual-reconcile',NOW())
        ON CONFLICT (n_cod_ped) DO UPDATE SET
          c_etapa = EXCLUDED.c_etapa, pendente_omie = TRUE, updated_at = NOW()
      `, [
        cab.nCodPed, cab.cCodIntPed || null, cab.cNumero || null,
        dataInc, cab.cIncHora || null, dataPrev,
        String(cab.cEtapa || '').trim() || null, cab.nCodFor || null,
        cab.cCodParc || null, cab.nQtdeParc || null,
        cab.cObs || null, cab.cObsInt || null
      ]);
      await substituirItensPedido(pool, cab.nCodPed, produtos);
      await atualizarFlagsRecebimentoPedido(pool, cab.nCodPed);
      await sincronizarSolicitacaoPorPedido(pool, cab.nCodPed, { log });
      importados++;
      log(`  ✓ importado ${cab.cNumero || idPed}`);
    } catch (e) {
      log(`  ✗ import ${idPed}: ${e.message}`);
    }
  }

  const sol = await fecharSolicitacoesDePedidosFechados(pool, log);

  const { rows: cards } = await pool.query(`
    SELECT COUNT(DISTINCT c_numero)::int AS n
    FROM compras.pedidos_omie
    WHERE COALESCE(inativo,false)=false
      AND pendente_omie IS TRUE
      AND COALESCE("Pedido recebido",false)=false
      AND BTRIM(COALESCE(c_etapa,'')) IN ('10','15')
      AND d_inc_data >= '2026-01-01'
  `);

  const emCompra = await pool.query(`
    SELECT COUNT(*)::int AS n FROM (
      SELECT 1 FROM compras.solicitacao_compras sc
      WHERE produto_codigo='05.MP.N.61107'
        AND LOWER(TRIM(status)) NOT IN ('carrinho','recebido','concluído','concluido','cancelado','reprovado','excluido','excluído')
      UNION ALL
      SELECT 1 FROM compras.pedidos_omie_produtos pi
      JOIN compras.pedidos_omie po ON po.n_cod_ped=pi.n_cod_ped
      WHERE pi.c_produto='05.MP.N.61107'
        AND COALESCE(po.inativo,false)=false
        AND COALESCE(po."Pedido recebido",false)=false
        AND po.pendente_omie IS TRUE
        AND COALESCE(pi.n_qtde,0) > COALESCE(pi.n_qtde_rec,0)
    ) t
  `);

  const sc3000 = await pool.query(`
    SELECT id, status, cnumero FROM compras.solicitacao_compras
    WHERE produto_codigo='05.MP.N.61107' ORDER BY id DESC LIMIT 3
  `);
  const po3000 = await pool.query(`
    SELECT c_numero, c_etapa, pendente_omie, "Pedido recebido" AS rec
    FROM compras.pedidos_omie WHERE c_numero='3000'
  `);

  log(JSON.stringify({
    omie_abertos: pendentesOmie.size,
    cards_compra_realizada: cards[0].n,
    inativados, etapaAjustada, fechados, reabertos, importados,
    solicitacoes: sol,
    produto_61107_ainda_em_compra: emCompra.rows[0].n,
    sc_61107: sc3000.rows,
    po_3000: po3000.rows
  }, null, 2));

  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
