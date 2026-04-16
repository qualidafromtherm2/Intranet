'use strict';
/**
 * Re-sincroniza pedidos de hoje (2026-04-15) que estão sem itens em compras.pedidos_omie_produtos.
 * Consulta a Omie via ConsultarPedCompra e insere os produtos.
 * Limite: 3 req/s (aguarda 400ms entre chamadas).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const https = require('https');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APP_KEY = process.env.OMIE_APP_KEY;
const APP_SECRET = process.env.OMIE_APP_SECRET;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function omieCall(call, param) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] });
    const req = https.request(
      {
        hostname: 'app.omie.com.br',
        path: '/api/v1/produtos/pedidocompra/',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sincronizarPedido(nCodPed, cNumero) {
  console.log(`\n--- Pedido ${cNumero} (${nCodPed}) ---`);
  const resp = await omieCall('ConsultarPedCompra', { nCodPed: parseInt(nCodPed, 10) });

  if (resp.faultstring) {
    console.error('Erro Omie:', resp.faultstring);
    return false;
  }

  const ped = resp.pedido_status_consulta || resp;
  const produtos = ped.produtos || ped.produtos_consulta || [];

  if (!Array.isArray(produtos) || produtos.length === 0) {
    console.warn('Nenhum produto retornado pela Omie para', cNumero);
    return false;
  }

  console.log('Itens retornados pela Omie:', produtos.length);
  produtos.forEach((p, i) => console.log(`  ${i + 1}. ${p.cProduto || '-'} — ${p.cDescricao || '-'}`));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM compras.pedidos_omie_produtos WHERE n_cod_ped = $1', [nCodPed]);

    for (const prod of produtos) {
      await client.query(
        `INSERT INTO compras.pedidos_omie_produtos (
          n_cod_ped, c_cod_int_item, n_cod_item,
          c_cod_int_prod, n_cod_prod, c_produto, c_descricao,
          c_ncm, c_unidade, c_ean, n_peso_liq, n_peso_bruto,
          n_qtde, n_qtde_rec, n_val_unit, n_val_merc, n_desconto, n_val_tot,
          n_valor_icms, n_valor_st, n_valor_ipi, n_valor_pis, n_valor_cofins,
          n_frete, n_seguro, n_despesas,
          c_obs, c_mkp_atu_pv, c_mkp_atu_sm, n_mkp_perc,
          codigo_local_estoque, c_cod_categ
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
          $24,$25,$26,$27,$28,$29,$30,$31,$32
        )`,
        [
          nCodPed,
          prod.cCodIntItem || null, prod.nCodItem || null,
          prod.cCodIntProd || null, prod.nCodProd || null,
          prod.cProduto || null, prod.cDescricao || null,
          prod.cNCM || null, prod.cUnidade || null, prod.cEAN || null,
          prod.nPesoLiq || null, prod.nPesoBruto || null,
          prod.nQtde || null, prod.nQtdeRec || null,
          prod.nValUnit || null, prod.nValMerc || null,
          prod.nDesconto || null, prod.nValTot || null,
          prod.nValorIcms || null, prod.nValorSt || null,
          prod.nValorIpi || null, prod.nValorPis || null, prod.nValorCofins || null,
          prod.nFrete || null, prod.nSeguro || null, prod.nDespesas || null,
          prod.cObs || null, prod.cMkpAtuPv || null, prod.cMkpAtuSm || null, prod.nMkpPerc || null,
          prod.codigo_local_estoque || null, prod.cCodCateg || null,
        ]
      );
    }

    await client.query('COMMIT');
    console.log('✓ Itens inseridos:', produtos.length);
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Erro no banco:', e.message);
    return false;
  } finally {
    client.release();
  }
}

async function main() {
  // Busca todos os pedidos de hoje sem itens
  const { rows: semItens } = await pool.query(`
    SELECT po.n_cod_ped::text AS n_cod_ped, po.c_numero
    FROM compras.pedidos_omie po
    WHERE po.data_webhook::date = '2026-04-15'
      AND COALESCE(po.inativo, false) = false
      AND (SELECT COUNT(*) FROM compras.pedidos_omie_produtos WHERE n_cod_ped = po.n_cod_ped) = 0
    ORDER BY po.n_cod_ped
  `);

  if (semItens.length === 0) {
    console.log('Nenhum pedido de hoje sem itens. Nada a fazer.');
    await pool.end();
    return;
  }

  console.log(`Pedidos sem itens hoje: ${semItens.length}`);
  console.table(semItens);

  for (let i = 0; i < semItens.length; i++) {
    const { n_cod_ped, c_numero } = semItens[i];
    await sincronizarPedido(n_cod_ped, c_numero);
    if (i < semItens.length - 1) await sleep(400); // ≤ 3 req/s
  }

  // Confirmação final
  console.log('\n--- Confirmação final ---');
  const { rows: conf } = await pool.query(`
    SELECT po.c_numero,
      (SELECT COUNT(*) FROM compras.pedidos_omie_produtos WHERE n_cod_ped = po.n_cod_ped) AS qtd_itens
    FROM compras.pedidos_omie po
    WHERE po.n_cod_ped = ANY($1::bigint[])
  `, [semItens.map((p) => p.n_cod_ped)]);
  console.table(conf);

  await pool.end();
}

main().catch((err) => {
  console.error('Erro geral:', err.message);
  process.exit(1);
});
