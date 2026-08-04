const test = require('node:test');
const assert = require('node:assert/strict');
const {
  migrarEtqCodigoProduto,
  migrarEtqSaldosSkuFantasma
} = require('../utils/etqMigrarCodigoFantasma');

test('migrarEtqCodigoProduto atualiza etiquetas do ID fantasma para o ativo', async () => {
  let updateParams = null;
  const client = {
    query: async (sql, params) => {
      if (sql.includes('UPDATE etiqueta."ETQ_rec_impresso"')) {
        updateParams = params;
        return {
          rows: [
            { id: 1754, endereco: '01-02-19-001', qtd: 166, codigo_produto: '10770703208' }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const r = await migrarEtqCodigoProduto(client, {
    deIds: ['10748663973'],
    paraId: '10770703208',
    descricao: 'ADESIVO MEMBRANA SMARTPOWER'
  });

  assert.equal(r.migrados, 1);
  assert.deepEqual(r.ids, [1754]);
  assert.equal(updateParams[0], '10770703208');
  assert.deepEqual(updateParams[1], ['10748663973']);
  assert.match(updateParams[2], /SMARTPOWER/);
});

test('migrarEtqCodigoProduto ignora quando não há IDs de origem', async () => {
  const client = { query: async () => { throw new Error('não deveria consultar'); } };
  const r = await migrarEtqCodigoProduto(client, { deIds: [], paraId: '10770703208' });
  assert.equal(r.migrados, 0);
});

test('migrarEtqSaldosSkuFantasma percorre pares fantasma→ativo', async () => {
  const updates = [];
  const client = {
    query: async (sql, params) => {
      if (sql.includes('array_agg') || sql.includes('ids_fantasma')) {
        return {
          rows: [{
            sku: '01.MP.N.30100',
            id_ativo: '10770703208',
            descricao: 'SMARTPOWER',
            ids_fantasma: ['10748663973']
          }]
        };
      }
      if (sql.includes('UPDATE etiqueta."ETQ_rec_impresso"')) {
        updates.push(params);
        return { rows: [{ id: 1754, endereco: '01-02-19-001', qtd: 166, codigo_produto: '10770703208' }] };
      }
      return { rows: [] };
    }
  };

  const r = await migrarEtqSaldosSkuFantasma(client);
  assert.equal(r.migrados, 1);
  assert.equal(r.pares, 1);
  assert.equal(r.detalhes[0].sku, '01.MP.N.30100');
  assert.equal(updates.length, 1);
});
