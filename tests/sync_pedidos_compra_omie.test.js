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

test('aplicarPendenciaOmieLote fecha quem nao esta na lista aberta da Omie', async () => {
  const { aplicarPendenciaOmieLote } = require('../utils/syncPedidosCompraOmie');
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/pendente_omie = FALSE/.test(sql)) {
        return { rows: [{ n_cod_ped: 1, c_numero: '100' }] };
      }
      if (/pendente_omie = TRUE/.test(sql)) {
        return { rows: [{ n_cod_ped: 2, c_numero: '200' }] };
      }
      return { rows: [] };
    }
  };

  const logs = [];
  const out = await aplicarPendenciaOmieLote(db, ['2', '3'], (msg) => logs.push(msg));
  assert.equal(out.fechados.length, 1);
  assert.equal(out.reabertos.length, 1);
  assert.equal(out.omie_abertos, 2);
  assert.match(logs[0], /fechados=1/);
});
