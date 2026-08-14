const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
const frontend = fs.readFileSync(path.resolve(__dirname, '..', 'menu_produto.js'), 'utf8');

test('backend restringe exclusao da identificacao ao usuario Jair.R', () => {
  assert.match(server, /function usuarioPodeExcluirIdentificacaoRecebimento/);
  assert.match(server, /includes\('jair\.r'\)/);
  assert.match(server, /app\.delete\('\/api\/etiquetas\/recebimento\/:id\/identificacao', exigirJairExclusaoIdentificacao/);
  assert.match(server, /Somente o usuário Jair\.R pode excluir identificações/);
});

test('exclusao e logica, auditavel e nao remove estoque ou cadastro', () => {
  const start = server.indexOf("app.delete('/api/etiquetas/recebimento/:id/identificacao'");
  const end = server.indexOf('// GET /api/etiquetas/impressoras', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const route = server.slice(start, end);
  assert.match(route, /SET qtd = 0/);
  assert.match(route, /status = 'excluida_identificacao'/);
  assert.match(route, /qtd AS qtd_original/);
  assert.match(route, /quantidade_original: removida\.qtd_original/);
  assert.match(route, /acao: 'identificacao_excluida'/);
  assert.doesNotMatch(route, /DELETE FROM/);
  assert.doesNotMatch(route, /IncluirAjusteEstoque|omieCall/);
});

test('frontend mostra e executa a acao apenas para Jair.R com confirmacao explicita', () => {
  assert.match(frontend, /function usuarioPodeExcluirIdentificacaoProduto/);
  assert.match(frontend, /=== 'jair\.r'/);
  assert.match(frontend, /etq-btn-excluir-identificacao/);
  assert.match(frontend, /Esta ação não desfaz a entrada de estoque\/Omie/);
  assert.match(frontend, /method: 'DELETE'/);
});
