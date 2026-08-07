const test = require('node:test');
const assert = require('node:assert/strict');
const {
  reconciliarEstoqueAtualOmie,
  aplicarDeltaEstoqueLocal,
  aguardarConfirmacaoViaWebhook,
  saldoMudouNaDirecaoEsperada
} = require('../utils/reconciliarEstoqueOmie');

test('nao confirma saldo apenas porque o horario de sincronizacao mudou', () => {
  assert.equal(saldoMudouNaDirecaoEsperada(198, 178, -20), true);
  assert.equal(saldoMudouNaDirecaoEsperada(-20, -20, 20), false);
  assert.equal(saldoMudouNaDirecaoEsperada(-20, 0, 20), true);
});

test('aceita atualizacao maior que o delta quando a base local ja estava defasada', () => {
  assert.equal(saldoMudouNaDirecaoEsperada(198, 158, -20), true);
  assert.equal(saldoMudouNaDirecaoEsperada(-20, 5, 20), true);
});

test('consulta a posição pontual na Omie e atualiza estoque_atual', async () => {
  let payloadEnviado;
  let queryExecutada;
  const fetchImpl = async (_url, options) => {
    payloadEnviado = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        codigo_status: '0', saldo: 0, fisico: 0, reservado: 0,
        pendente: 0, estoque_minimo: 0, cmc: 3814.51,
        codigo_local_estoque: 10408201806
      })
    };
  };
  const query = async (sql, params) => {
    queryExecutada = { sql, params };
    return { rows: [], rowCount: 1 };
  };

  const posicao = await reconciliarEstoqueAtualOmie({
    codigoProduto: 10782754493,
    codigo: 'FTI165HPTBR',
    localCodigo: '10408201806',
    fetchImpl,
    query,
    appKey: 'teste',
    appSecret: 'teste'
  });

  assert.equal(payloadEnviado.call, 'PosicaoEstoque');
  assert.equal(payloadEnviado.param[0].id_prod, 10782754493);
  assert.equal(posicao.saldo, 0);
  assert.equal(posicao.gravado, true);
  assert.match(queryExecutada.sql, /INSERT INTO logistica\.estoque_atual/);
  assert.equal(queryExecutada.params[0], '10408201806');
  assert.equal(queryExecutada.params[3], 0);
  assert.equal(queryExecutada.params[9], 'omie_reconcile');
});

test('nao grava saldo stale da Omie quando o delta esperado ainda nao refletiu', async () => {
  let gravou = false;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      codigo_status: '0', saldo: 15, fisico: 15, reservado: 0,
      pendente: 0, estoque_minimo: 0, cmc: 800,
      codigo_local_estoque: 10717096386
    })
  });
  const query = async () => {
    gravou = true;
    return { rows: [], rowCount: 1 };
  };

  const posicao = await reconciliarEstoqueAtualOmie({
    codigoProduto: 10660833911,
    codigo: 'MOCKUP-FTi25',
    localCodigo: '10717096386',
    saldoAntes: 15,
    deltaEsperado: -15,
    fetchImpl,
    query,
    appKey: 'teste',
    appSecret: 'teste'
  });

  assert.equal(posicao.saldo, 15);
  assert.equal(posicao.gravado, false);
  assert.equal(posicao.pendente, true);
  assert.equal(gravou, false);
});

test('grava quando a Omie finalmente reflete o delta esperado', async () => {
  let queryExecutada;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      codigo_status: '0', saldo: 0, fisico: 0, reservado: 0,
      pendente: 0, estoque_minimo: 0, cmc: 800,
      codigo_local_estoque: 10717096386
    })
  });
  const query = async (sql, params) => {
    queryExecutada = { sql, params };
    return { rows: [], rowCount: 1 };
  };

  const posicao = await reconciliarEstoqueAtualOmie({
    codigoProduto: 10660833911,
    codigo: 'MOCKUP-FTi25',
    localCodigo: '10717096386',
    saldoAntes: 15,
    deltaEsperado: -15,
    fetchImpl,
    query,
    appKey: 'teste',
    appSecret: 'teste'
  });

  assert.equal(posicao.saldo, 0);
  assert.equal(posicao.gravado, true);
  assert.equal(queryExecutada.params[3], 0);
  assert.equal(queryExecutada.params[9], 'omie_reconcile');
});

test('aplica delta local otimista no estoque_atual', async () => {
  let queryExecutada;
  let consultas = 0;
  const query = async (sql, params) => {
    consultas += 1;
    if (consultas === 1) {
      // buscarPosicaoLocal: ainda sem webhook
      return { rows: [{ saldo: 15, fisico: 15, origem: 'omie_sync', updated_at: new Date() }], rowCount: 1 };
    }
    queryExecutada = { sql, params };
    return { rows: [{ saldo: 0, fisico: 0, local_codigo: '10717096386', origem: 'movimento_local' }], rowCount: 1 };
  };

  const row = await aplicarDeltaEstoqueLocal({
    codigoProduto: 10660833911,
    codigo: 'MOCKUP-FTi25',
    localCodigo: '10717096386',
    deltaEsperado: -15,
    query
  });

  assert.equal(row.saldo, 0);
  assert.match(queryExecutada.sql, /movimento_local/);
  assert.match(queryExecutada.sql, /origem.*<> 'webhook'|<> 'webhook'/);
  assert.equal(queryExecutada.params[3], -15);
});

test('nao aplica delta otimista se o webhook ja gravou a posicao', async () => {
  let tentouUpsert = false;
  const query = async (sql) => {
    if (/INSERT INTO logistica\.estoque_atual/i.test(sql)) {
      tentouUpsert = true;
      return { rows: [], rowCount: 0 };
    }
    return {
      rows: [{ saldo: 0, fisico: 0, origem: 'webhook', updated_at: new Date() }],
      rowCount: 1
    };
  };

  const row = await aplicarDeltaEstoqueLocal({
    codigoProduto: 10660833911,
    codigo: 'MOCKUP-FTi25',
    localCodigo: '10717096386',
    deltaEsperado: -15,
    query
  });

  assert.equal(row.origem, 'webhook');
  assert.equal(row.saldo, 0);
  assert.equal(tentouUpsert, false);
});

test('confirma via webhook quando origem=webhook e delta numericamente ok', async () => {
  const query = async () => ({
    rows: [{ saldo: 0, fisico: 0, origem: 'webhook', updated_at: new Date() }],
    rowCount: 1
  });

  const resultado = await aguardarConfirmacaoViaWebhook({
    codigo: 'MOCKUP-FTi25',
    localCodigo: '10717096386',
    saldoAntes: 15,
    deltaEsperado: -15,
    query,
    timeoutMs: 50,
    pollMs: 10,
    aguardarFn: async () => {}
  });

  assert.equal(resultado.confirmado, true);
  assert.equal(resultado.via, 'webhook');
  assert.equal(resultado.saldo, 0);
});

test('nao confirma webhook com saldo stale e esgota o timeout', async () => {
  const query = async () => ({
    rows: [{ saldo: 15, fisico: 15, origem: 'webhook', updated_at: new Date() }],
    rowCount: 1
  });

  const resultado = await aguardarConfirmacaoViaWebhook({
    codigo: 'MOCKUP-FTi25',
    localCodigo: '10717096386',
    saldoAntes: 15,
    deltaEsperado: -15,
    query,
    timeoutMs: 30,
    pollMs: 10,
    aguardarFn: async () => {}
  });

  assert.equal(resultado.confirmado, false);
  assert.equal(resultado.via, null);
});
