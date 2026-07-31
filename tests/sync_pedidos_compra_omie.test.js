'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  atualizarFlagsRecebimentoPedido
} = require('../utils/syncPedidosCompraOmie');

test('nao reabre pedido encerrado apenas porque os itens locais ainda estao pendentes', async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/COUNT\(\*\)::int AS total/.test(sql)) {
        return { rows: [{ total: 1, recebidos: 0, pendentes: 1 }] };
      }
      return { rowCount: 0, rows: [] };
    }
  };

  const resultado = await atualizarFlagsRecebimentoPedido(db, 123);

  assert.equal(resultado.fullyReceived, false);
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /pendente_omie IS NOT FALSE/);
  assert.deepEqual(queries[1].params, [123]);
});

test('continua fechando pedido quando todos os itens foram recebidos', async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/COUNT\(\*\)::int AS total/.test(sql)) {
        return { rows: [{ total: 2, recebidos: 2, pendentes: 0 }] };
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const resultado = await atualizarFlagsRecebimentoPedido(db, 456);

  assert.equal(resultado.fullyReceived, true);
  assert.match(queries[1].sql, /pendente_omie = FALSE/);
  assert.match(queries[1].sql, /"Pedido recebido" = TRUE/);
});
