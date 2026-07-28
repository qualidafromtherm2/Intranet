const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizarLocaisPermitidos } = require('../utils/movimentacaoPermissoes');

test('mantem compatibilidade com permissao antiga de codigo unico', () => {
  assert.deepEqual(normalizarLocaisPermitidos('10717096386'), ['10717096386']);
});

test('normaliza a lista de locais permitidos sem valores vazios', () => {
  assert.deepEqual(
    normalizarLocaisPermitidos(['10717096386', '10445659161', '']),
    ['10717096386', '10445659161']
  );
});
