const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarNumeroDecimal } = require('../utils/numeroDecimal');

test('normaliza quantidade decimal brasileira e internacional', () => {
  assert.equal(normalizarNumeroDecimal('40,8'), 40.8);
  assert.equal(normalizarNumeroDecimal('40.8'), 40.8);
  assert.equal(normalizarNumeroDecimal('1.234,56'), 1234.56);
  assert.equal(normalizarNumeroDecimal('1,234.56'), 1234.56);
  assert.equal(normalizarNumeroDecimal(40.8), 40.8);
});

test('rejeita quantidade vazia ou inválida', () => {
  assert.equal(normalizarNumeroDecimal(''), null);
  assert.equal(normalizarNumeroDecimal('abc'), null);
  assert.equal(normalizarNumeroDecimal(null), null);
});
