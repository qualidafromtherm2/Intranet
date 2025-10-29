// Objetivo: Testar chamada mínima à Omie usando axios+agent igual ao server.js
const axios = require('axios');
const http = require('http');
const https = require('https');
const dns = require('dns');

const OMIE_APP_KEY = process.env.OMIE_APP_KEY || require('./config.server').OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || require('./config.server').OMIE_APP_SECRET;

async function main() {
  const payload = {
    call: 'ListarProdutos',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{ pagina: 1, registros_por_pagina: 1 }]
  };
  try {
    const resp = await axios.post(
      'https://app.omie.com.br/api/v1/geral/produtos/',
      payload,
      {
        timeout: 15000,
        timeoutErrorMessage: 'Timeout ao chamar Omie',
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
      }
    );
    console.log('Status:', resp.status);
    console.log('Body:', resp.data);
  } catch (e) {
    console.error('Erro:', e?.message || e);
    if (e.response) {
      console.error('Status:', e.response.status);
      console.error('Body:', e.response.data);
    }
  }
}

main();
