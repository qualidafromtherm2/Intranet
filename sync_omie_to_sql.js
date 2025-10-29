// Objetivo: Script para atualizar diretamente produtos Omie no banco Postgres (Node.js → Omie → SQL)
// Uso: node sync_omie_to_sql.js [max_paginas]

const axios = require('axios');
const http = require('http');
const https = require('https');
const dns = require('dns');
const { Client } = require('pg');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('./config.server');

const OMIE_URL = 'https://app.omie.com.br/api/v1/geral/produtos/';
const MAX_POR_PAGINA = 500;
const MAX_PAGINAS = Number(process.argv[2]) || 1;

const PG_CONN = {
  host: 'dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com',
  port: 5432,
  user: 'intranet_db_yd0w_user',
  password: 'amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho',
  database: 'intranet_db_yd0w',
  ssl: { rejectUnauthorized: false }
};

async function omieListarProdutos(pagina) {
  const payload = {
    call: 'ListarProdutos',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      pagina,
      registros_por_pagina: MAX_POR_PAGINA,
      apenas_importado_api: "N",
      filtrar_apenas_omiepdv: "N"
    }]
  };
  const resp = await axios.post(OMIE_URL, payload, {
    timeout: 15000,
    timeoutErrorMessage: 'Timeout Omie',
    headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
    httpAgent: new http.Agent({ keepAlive: false, timeout: 17000 }),
    httpsAgent: new https.Agent({ keepAlive: false, timeout: 17000 }),
    proxy: false,
    lookup: (hostname, opts, cb) => dns.lookup(hostname, { family: 4, all: false }, cb),
    decompress: true,
    responseType: 'json',
    transitional: { clarifyTimeoutError: true },
    maxBodyLength: 20 * 1024 * 1024,
    maxContentLength: 20 * 1024 * 1024,
    validateStatus: () => true
  });
  if (resp.status !== 200) throw new Error('HTTP ' + resp.status);
  return resp.data;
}

async function main() {
  const client = new Client(PG_CONN);
  await client.connect();
  let total = 0;
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    console.log(`Baixando página ${pagina}...`);
    const lote = await omieListarProdutos(pagina);
    const produtos = Array.isArray(lote.produto_servico_cadastro)
      ? lote.produto_servico_cadastro
      : (lote.produto_servico_cadastro ? [lote.produto_servico_cadastro] : []);
    if (!produtos.length) {
      console.log('Nenhum produto nesta página.');
      break;
    }
    console.log(`Inserindo ${produtos.length} produtos no SQL...`);
    const wrapper = { produto_servico_cadastro: produtos };
    const r = await client.query('SELECT public.omie_import_listarprodutos($1::jsonb) AS qtd', [JSON.stringify(wrapper)]);
    console.log('Upserts realizados:', r.rows[0]?.qtd);
    total += Number(r.rows[0]?.qtd || 0);
    await new Promise(r => setTimeout(r, 400)); // respeita limite Omie
  }
  await client.end();
  console.log('Total de upserts:', total);
}

// Executar main() apenas se chamado diretamente (não como módulo)
if (require.main === module) {
  main().catch(e => { console.error('Erro:', e); process.exit(1); });
}

// Exportar para uso como módulo
module.exports = { omieListarProdutos, main: async (maxPaginas, logger = console) => {
  const client = new Client(PG_CONN);
  await client.connect();
  let total = 0;
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    logger.log(`Baixando página ${pagina}...`);
    const lote = await omieListarProdutos(pagina);
    const produtos = Array.isArray(lote.produto_servico_cadastro)
      ? lote.produto_servico_cadastro
      : (lote.produto_servico_cadastro ? [lote.produto_servico_cadastro] : []);
    if (!produtos.length) {
      logger.log('Nenhum produto nesta página.');
      break;
    }
    logger.log(`Inserindo ${produtos.length} produtos no SQL...`);
    const wrapper = { produto_servico_cadastro: produtos };
    const r = await client.query('SELECT public.omie_import_listarprodutos($1::jsonb) AS qtd', [JSON.stringify(wrapper)]);
    logger.log('Upserts realizados:', r.rows[0]?.qtd);
    total += Number(r.rows[0]?.qtd || 0);
    await new Promise(r => setTimeout(r, 400));
  }
  await client.end();
  logger.log('Total de upserts:', total);
  return total;
}};
