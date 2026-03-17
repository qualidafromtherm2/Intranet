require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const { rows } = await pool.query('SELECT cod_req_compra FROM compras.requisicoes_omie ORDER BY cod_req_compra');
  console.log('Iniciando populacao - Total:', rows.length);
  let ok = 0, erros = 0, semItens = 0;

  for (const row of rows) {
    const codReqCompra = row.cod_req_compra;
    try {
      await sleep(350); // ~2.8 req/s (limite Omie: 3/s)
      const resp = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call: 'ConsultarReq',
          app_key: process.env.OMIE_APP_KEY,
          app_secret: process.env.OMIE_APP_SECRET,
          param: [{ codReqCompra: parseInt(codReqCompra) }]
        })
      });
      const data = await resp.json();
      if (resp.status !== 200 || data.faultcode) {
        console.warn('[ERRO API]', codReqCompra, data && data.faultstring ? data.faultstring : resp.status);
        erros++;
        continue;
      }

      // Busca itens em qualquer chave que contenha "item/iten" ou primeiro array
      let itens = [];
      const req = data.requisicaoCadastro || data;
      for (const k of Object.keys(req)) {
        if (Array.isArray(req[k]) && req[k].length > 0 &&
            (k.toLowerCase().includes('item') || k.toLowerCase().includes('iten'))) {
          itens = req[k];
          break;
        }
      }
      if (itens.length === 0) {
        // fallback: primeiro array não-vazio
        for (const k of Object.keys(req)) {
          if (Array.isArray(req[k]) && req[k].length > 0) { itens = req[k]; break; }
        }
      }

      if (itens.length === 0) {
        semItens++;
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM compras.requisicoes_omie_itens WHERE cod_req_compra = $1', [codReqCompra]);
        for (const item of itens) {
          await client.query(
            'INSERT INTO compras.requisicoes_omie_itens (cod_req_compra, cod_item, cod_int_item, cod_prod, cod_int_prod, qtde, preco_unit, obs_item) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              codReqCompra,
              item.nCodItem    || item.codItem    || null,
              item.cCodIntItem || item.codIntItem || null,
              item.nCodProd    || item.codProd    || null,
              item.cCodIntProd || item.codIntProd || null,
              item.nQtde       || item.qtde       || null,
              item.nValUnit    || item.precoUnit  || null,
              item.cObsItem    || item.obsItem    || null
            ]
          );
        }
        await client.query('COMMIT');
        ok++;
        console.log('[' + ok + '/' + rows.length + '] req ' + codReqCompra + ' -> ' + itens.length + ' itens');
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('[DB ERRO]', codReqCompra, e.message);
        erros++;
      } finally {
        client.release();
      }
    } catch (e) {
      console.error('[FETCH ERRO]', codReqCompra, e.message);
      erros++;
    }
  }

  const { rows: total } = await pool.query('SELECT COUNT(*) AS n FROM compras.requisicoes_omie_itens');
  console.log('\n=== CONCLUÍDO ===');
  console.log('Com itens:', ok, '| Sem itens (Omie):', semItens, '| Erros:', erros);
  console.log('Total de itens na tabela agora:', total[0].n);
  pool.end();
}

run().catch(e => { console.error(e); pool.end(); });
