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

test('matching nao compara quantidade e preco unitario de unidades diferentes', () => {
  const server = ler('server.js');
  const normalizacao = trecho(server, 'function normalizarUnidadeAssociacaoNfePedido', 'function avaliarAssociacaoNfePedido');
  const avaliacao = trecho(server, 'function avaliarAssociacaoNfePedido', 'function calcularScoreAssociacaoNfePedido');

  assert.match(normalizacao, /UNIDAD: 'UN'/);
  assert.match(avaliacao, /conversaoUnidadeNecessaria/);
  assert.match(avaliacao, /!conversaoUnidadeNecessaria && Number\.isFinite\(qtdRec\)/);
  assert.match(avaliacao, /!conversaoUnidadeNecessaria && Number\.isFinite\(valorRec\)/);
  assert.match(avaliacao, /conversao_unidade_necessaria/);
});

test('backend exige quantidade convertida positiva e unidade do pedido', () => {
  const server = ler('server.js');
  const rota = trecho(
    server,
    "app.post('/api/compras/pedidos-omie/nfe-associar-pedido'",
    '// POST /api/compras/pedidos-omie/nfe-disponibilidade'
  );

  assert.match(rota, /conversoesInvalidas/);
  assert.match(rota, /override\?\.conversaoUnidade/);
  assert.match(rota, /quantidadeConvertida <= 0/);
  assert.match(rota, /conversao_unidade_invalida/);
});

test('materia-prima nacional e importada usam CFOP de industrializacao', () => {
  const server = ler('server.js');
  const fonteFuncao = trecho(
    server,
    'function calcularCfopEntradaPorCategoriaCompra',
    'function normalizarCfopServicoRecebimento'
  );
  const calcular = Function(`${fonteFuncao}; return calcularCfopEntradaPorCategoriaCompra;`)();

  assert.equal(calcular('2.01.03', 'SC'), '1.101');
  assert.equal(calcular('2.01.04', 'SC'), '1.101');
  assert.equal(calcular('2.01.03', 'OUTRA'), '2.101');
  assert.equal(calcular('2.01.04', 'OUTRA'), '2.101');
  assert.equal(calcular('outra-categoria', 'SC'), '1.556');
  assert.equal(calcular('outra-categoria', 'OUTRA'), '2.556');
});

test('frontend vincula item nao associado e so exige conversao para unidades diferentes', () => {
  const frontend = ler('menu_produto.js');

  assert.match(frontend, /Vincular à NF-e/);
  assert.match(frontend, /function abrirVinculoItemPedidoAssociacaoNfe/);
  assert.match(frontend, /!unidadesEquivalentesPreview\(unidadeOrigem, unidadeDestino\)/);
  assert.match(frontend, /conversao_unidade_manual: requerConversao/);
  assert.match(frontend, /Nenhuma conversão será gravada para este vínculo/);
  assert.match(frontend, /Fator informado:/);
  assert.match(frontend, /entryPedido\.conversaoUnidade = true/);
});

test('realinhamento devolve o vinculo substituido para a lista de revisao', () => {
  const frontend = ler('menu_produto.js');
  const aplicar = trecho(
    frontend,
    'function aplicarVinculoItemPedidoAssociacao',
    'function abrirVinculoItemPedidoAssociacaoNfe'
  );

  assert.match(aplicar, /itemAnterior/);
  assert.match(aplicar, /itens_pedido_informativos\.push\(itemAnterior\)/);
  assert.match(aplicar, /Item removido do vínculo durante o realinhamento manual/);
});
