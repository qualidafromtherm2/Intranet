const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  usuarioPodeGerenciarEnderecos,
  exigirGestaoEnderecos
} = require('../utils/produtoEnderecosPermissoes');

test('permite somente os quatro usuários definidos para gestão de endereços', () => {
  ['Jair.R', 'leandro.S', 'Denis.M', 'alexsandro.j'].forEach((username) => {
    assert.equal(usuarioPodeGerenciarEnderecos(username), true, username);
  });
  ['Leandro.B', 'Leandro C.', 'Eduardo6760', 'admin', ''].forEach((username) => {
    assert.equal(usuarioPodeGerenciarEnderecos(username), false, username);
  });
});

test('middleware rejeita sessão não autorizada no servidor', () => {
  let statusCode = 0;
  let payload;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; }
  };
  exigirGestaoEnderecos({ session: { user: { username: 'Leandro.B' } } }, res, () => assert.fail('não deveria avançar'));
  assert.equal(statusCode, 403);
  assert.match(payload.error, /não possui permissão/i);
});

test('rotas de endereços exigem permissão, trava transacional e não chamam a Omie', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf("app.get('/api/logistica/produtos/:codigo/enderecos'");
  const end = source.indexOf('// GET /api/etiquetas/rec-impresso/enderecos-por-produto', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const routes = source.slice(start, end);

  assert.equal((routes.match(/exigirGestaoEnderecos/g) || []).length, 3);
  assert.match(routes, /FOR UPDATE/);
  assert.match(routes, /Somente endereços sem saldo podem ser excluídos/);
  assert.match(routes, /_processarMovimentacaoEtqInterna/);
  assert.match(routes, /tipoMov:\s*'TRF'/);
  assert.doesNotMatch(routes, /omieCall|IncluirAjusteEstoque|fetch\s*\(/);
});
