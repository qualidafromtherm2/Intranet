const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');

function routeSource(startMarker, endMarker) {
  const start = serverSource.indexOf(startMarker);
  const end = serverSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Rota não encontrada: ${startMarker}`);
  assert.notEqual(end, -1, `Fim da rota não encontrado: ${endMarker}`);
  return serverSource.slice(start, end);
}

test('preview gera código somente com dados locais e registra zero chamadas externas', () => {
  const preview = routeSource(
    "app.post('/api/produtos/cadastro/preview'",
    "app.post('/api/produtos/incluir-omie'"
  );

  assert.match(preview, /public\.produtos_omie/);
  assert.match(preview, /public\.produto_codigo_reserva/);
  assert.match(preview, /pg_advisory_xact_lock/);
  assert.match(preview, /external_calls=0/);
  assert.doesNotMatch(preview, /\bfetch\s*\(/);
  assert.doesNotMatch(preview, /ConsultarProduto|_cadastroConsultarCodigoNaOmie/);
});

test('cadastro realiza uma única chamada IncluirProduto e não faz consulta preventiva', () => {
  const incluir = routeSource(
    "app.post('/api/produtos/incluir-omie'",
    '// === Consultar produto na Omie'
  );

  assert.equal((incluir.match(/\bfetch\s*\(/g) || []).length, 1);
  assert.equal((incluir.match(/call:\s*'IncluirProduto'/g) || []).length, 1);
  assert.doesNotMatch(incluir, /ConsultarProduto|_cadastroConsultarCodigoNaOmie/);
  assert.match(incluir, /external_call=\$\{omieExternalCalls\} call=IncluirProduto/);
});

test('falha da Omie é devolvida sem retry e libera a reserva local', () => {
  const incluir = routeSource(
    "app.post('/api/produtos/incluir-omie'",
    '// === Consultar produto na Omie'
  );

  assert.match(incluir, /REDUNDANT/);
  assert.match(incluir, /OMIE_CONSUMPTION_BLOCKED/);
  assert.match(incluir, /não realizará nova tentativa automática/);
  assert.match(incluir, /retry:\s*false/);
  assert.match(incluir, /DELETE FROM public\.produto_codigo_reserva/);
  assert.ok((incluir.match(/await liberarReservaLocal\(\)/g) || []).length >= 2);
});

test('cadastro em lote interrompe envios quando a Omie bloqueia o consumo', () => {
  const frontendSource = fs.readFileSync(path.resolve(__dirname, '..', 'menu_produto.js'), 'utf8');
  const inicio = frontendSource.indexOf('async function cadastrarLote()');
  const fim = frontendSource.indexOf("el('cadProdFechar').addEventListener", inicio);
  assert.notEqual(inicio, -1);
  assert.notEqual(fim, -1);
  const cadastrarLote = frontendSource.slice(inicio, fim);

  assert.match(cadastrarLote, /OMIE_CONSUMPTION_BLOCKED/);
  assert.match(cadastrarLote, /Aguardando liberação da Omie/);
  assert.match(cadastrarLote, /\bbreak;/);
  assert.doesNotMatch(cadastrarLote, /setTimeout|retry|tentativa/i);
});
