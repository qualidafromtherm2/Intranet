const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ler = arquivo => fs.readFileSync(path.resolve(__dirname, '..', arquivo), 'utf8');

function trecho(fonte, inicio, fim) {
  const a = fonte.indexOf(inicio);
  const b = fonte.indexOf(fim, a + inicio.length);
  assert.notEqual(a, -1, `Inicio nao encontrado: ${inicio}`);
  assert.notEqual(b, -1, `Fim nao encontrado: ${fim}`);
  return fonte.slice(a, b);
}

test('associacao compara precos unitarios equivalentes, sem usar total tributado', () => {
  const server = ler('server.js');
  const avaliacao = trecho(
    server,
    'function avaliarAssociacaoNfePedido',
    'function calcularScoreAssociacaoNfePedido'
  );

  assert.match(avaliacao, /itensCabec\?\.nPrecoUnit/);
  assert.match(avaliacao, /itemPedido\?\.n_val_unit/);
  assert.doesNotMatch(avaliacao, /itensCabec\?\.vTotalItem/);
  assert.doesNotMatch(avaliacao, /itemPedido\?\.n_val_tot/);
});

test('preco editado atualiza o pedido Omie antes de associar a nota', () => {
  const server = ler('server.js');
  const rota = trecho(
    server,
    "app.post('/api/compras/pedidos-omie/nfe-associar-pedido'",
    '// POST /api/compras/pedidos-omie/nfe-disponibilidade'
  );

  assert.match(rota, /atualizarPrecosUnitariosPedidosOmie\(itensOverride\)/);
  assert.ok(
    rota.indexOf('atualizarPrecosUnitariosPedidosOmie(itensOverride)') < rota.indexOf("'AlterarRecebimento'"),
    'o pedido deve ser alterado antes do recebimento'
  );
  assert.match(server, /chamarApiPedidoCompraOmie\('AlteraPedCompra'/);
  assert.match(server, /produtoAlterar\.nValUnit = alteracao\.nValUnit/);
});

test('frontend envia nValUnit somente quando o usuario realmente editou o campo', () => {
  const frontend = ler('menu_produto.js');
  assert.match(frontend, /input\.dataset\.editado = 'true'/);
  assert.match(frontend, /input\.dataset\.editado !== 'true'/);
  assert.match(frontend, /nValUnit = Number\.isFinite\(valor\)/);
  assert.doesNotMatch(
    trecho(frontend, 'function snapshotEdicoesQtdUnidAssociacaoNfe', 'function trocarVinculoPedidoEntreSequenciasAssociacaoNfe'),
    /nValTot/
  );
});
