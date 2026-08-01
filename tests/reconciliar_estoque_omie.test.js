const test = require('node:test');
const assert = require('node:assert/strict');
const { reconciliarEstoqueAtualOmie } = require('../utils/reconciliarEstoqueOmie');

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
  assert.match(queryExecutada.sql, /omie_reconcile/);
  assert.equal(queryExecutada.params[0], '10408201806');
  assert.equal(queryExecutada.params[3], 0);
});
