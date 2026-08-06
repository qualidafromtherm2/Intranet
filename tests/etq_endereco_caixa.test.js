const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ETQ_ENDERECO_RE,
  ETQ_CAIXA_RE,
  assertEnderecoEtq,
  resolverEnderecoEtq,
  decomporEnderecoInvalido,
} = require('../utils/etqEndereco');

test('aceita porta-pallet numérico e endereço de caixa alfanumérico', () => {
  assert.equal(assertEnderecoEtq('01-03-21-002'), '01-03-21-002');
  assert.equal(assertEnderecoEtq(' 01-03-21-p01 '), '01-03-21-P01');
  assert.equal(ETQ_ENDERECO_RE.test('01-03-21-P01'), true);
  assert.equal(ETQ_CAIXA_RE.test('01-03-21-P01'), true);
});

test('rejeita código de caixa incompleto ou com tamanho incorreto', () => {
  assert.throws(() => assertEnderecoEtq('01-03-21-P1'), /01-03-21-P01/);
  assert.throws(() => assertEnderecoEtq('01-03-21-P001'), /01-03-21-P01/);
  assert.throws(() => assertEnderecoEtq('01-03-21-ABC'), /01-03-21-P01/);
});

test('leitores e movimentações resolvem caixa sem convertê-la em endereço numérico', () => {
  assert.equal(resolverEnderecoEtq('01_03_21_p01'), '01-03-21-P01');
  assert.deepEqual(decomporEnderecoInvalido('01-03-21-P01'), {
    endereco: '01-03-21-P01',
    complementoExtra: null,
  });
});

test('mantém compatibilidade com endereço legado já conhecido', () => {
  assert.equal(resolverEnderecoEtq('04-03', { conhecidos: ['04-03'] }), '04-03');
});

test('integra alteração de caixa, etiqueta 50x30 e proteção da migração antiga', () => {
  const raiz = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(raiz, 'menu_produto.js'), 'utf8');

  assert.match(server, /'endereco_caixa'\s*,\s*'Endereço de caixa 50x30'\s*,\s*50,\s*30/);
  assert.match(server, /\^PW399/);
  assert.match(server, /\^LL240/);
  assert.match(server, /\(\[0-9\]\{3\}\|\[A-Z\]\[0-9\]\{2\}\)/);
  assert.match(frontend, /data-action="caixa"/);
  assert.match(frontend, /data-caixa-imprimir/);
  assert.match(frontend, /acao:\s*'endereco_caixa'/);
});
