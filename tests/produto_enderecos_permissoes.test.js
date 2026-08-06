const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  usuarioEhMembroLogistica,
  usuarioEhSupervisorMovimentacao
} = require('../utils/permissoesOperacionaisProduto');

test('enderecos ficam disponiveis para qualquer membro da Logistica', () => {
  ['Logistica', 'LOGÍSTICA', 'Equipe de Logística'].forEach((setor) => {
    assert.equal(usuarioEhMembroLogistica({ setor }), true, setor);
  });
  ['Qualidade', 'Compras', '', null].forEach((setor) => {
    assert.equal(usuarioEhMembroLogistica({ setor }), false, String(setor));
  });
});

test('movimentacoes permitem somente supervisores de Logistica ou Qualidade', () => {
  assert.equal(usuarioEhSupervisorMovimentacao({ funcao_nome: 'Supervisor de Logística', setor: 'Logística' }), true);
  assert.equal(usuarioEhSupervisorMovimentacao({ funcao_nome: 'Supervisor de Qualidade', setor: 'Qualidade' }), true);
  assert.equal(usuarioEhSupervisorMovimentacao({ funcao_nome: 'Supervisor', setor: 'Logística' }), true);
  assert.equal(usuarioEhSupervisorMovimentacao({ funcao_nome: 'Supervisor', setor: 'Qualidade' }), true);
  assert.equal(usuarioEhSupervisorMovimentacao({ funcao_nome: 'Assistente de Logística', setor: 'Logística' }), false);
  assert.equal(usuarioEhSupervisorMovimentacao({ funcao_nome: 'Supervisor de Produção', setor: 'Produção' }), false);
});

test('rotas de enderecos exigem membro da Logistica, trava transacional e nao chamam a Omie', () => {
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

test('criacao de ajustes e transferencias comuns exige supervisor operacional', () => {
  const ajustes = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'ajustes.js'), 'utf8');
  const transferencias = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'transferencias.js'), 'utf8');
  assert.match(ajustes, /router\.post\('\/', express\.json\(\), exigirSupervisorMovimentacao/);
  assert.match(transferencias, /autorizarSupervisorMovimentacao\(req, res\)/);
  assert.match(transferencias, /chavePermissaoTransferencia\(origem, destino\) === 'side:log:solicitacao-ajuste'/);
});
