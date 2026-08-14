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
  assert.match(routes, /quantidadeInformada/);
  assert.match(routes, /quantidade > saldo \+ 0\.000001/);
  assert.match(routes, /qtd: quantidade/);
  assert.match(routes, /saldo_origem_restante/);
  assert.doesNotMatch(routes, /omieCall|IncluirAjusteEstoque|fetch\s*\(/);
});

test('formulario de troca de endereco permite movimentacao parcial e mantem opcao de saldo total', () => {
  const frontend = fs.readFileSync(path.resolve(__dirname, '..', 'menu_produto.js'), 'utf8');
  assert.match(frontend, /data-transfer-quantidade/);
  assert.match(frontend, /data-action="usar-total"/);
  assert.match(frontend, /JSON\.stringify\(\{ origem, destino, quantidade \}\)/);
  assert.match(frontend, /Saldo restante na origem/);
});

test('guardar materiais permite escolher armazem ativo e preserva Almoxarifado como padrao', () => {
  const backend = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
  const frontend = fs.readFileSync(path.resolve(__dirname, '..', 'menu_produto.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'menu_produto.html'), 'utf8');
  const start = backend.indexOf("app.patch('/api/etiquetas/rec-impresso/:id/endereco'");
  const end = backend.indexOf('// POST /api/etiquetas/rec-impresso/registrar-movimentacao', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const route = backend.slice(start, end);

  assert.match(backend, /ETQ_ARMAZENAR_LOCAL_PADRAO[^\n]+10717096386/);
  assert.match(route, /local_destino_codigo/);
  assert.match(route, /omie\.omie_locais_estoque/);
  assert.match(route, /COALESCE\(ativo, TRUE\) = TRUE/);
  assert.match(route, /codigo_local_estoque_destino:\s+COD_DESTINO/);
  assert.match(frontend, /\/api\/armazem\/locais\?fonte=db/);
  assert.match(frontend, /local_destino_codigo: _armDestinoCodigo/);
  assert.match(html, /id="etqArmazemDestinoSelect"/);
  assert.match(html, /id="etqArmazenarDestinoSelect"/);
});

test('criacao de ajustes e transferencias comuns exige supervisor operacional', () => {
  const ajustes = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'ajustes.js'), 'utf8');
  const transferencias = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'transferencias.js'), 'utf8');
  assert.match(ajustes, /router\.post\('\/', express\.json\(\), exigirSupervisorMovimentacao/);
  assert.match(transferencias, /autorizarSupervisorMovimentacao\(req, res\)/);
  assert.match(transferencias, /chavePermissaoTransferencia\(origem, destino\) === 'side:log:solicitacao-ajuste'/);
});
