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

test('cadastro sincroniza o produto local sem uma segunda chamada a Omie', () => {
  const server = ler('server.js');
  const rota = trecho(server, "app.post('/api/produtos/incluir-omie'", '// === Consultar produto na Omie');
  assert.equal((rota.match(/\bfetch\s*\(/g) || []).length, 1);
  assert.match(rota, /sincronizarProdutoParaPostgres\(produtoCriado\)/);
  assert.match(rota, /sincronizado_local/);
});

test('lista reage a mutacoes locais e eventos SSE com refresh serializado', () => {
  const lista = ler('requisicoes_omie/ListarProdutos.js');
  assert.match(lista, /addEventListener\('produtos:atualizar'/);
  assert.match(lista, /__refreshQueue/);
  assert.match(lista, /produtos_updated','produtos_changed','refresh_all','product_updated/);
  assert.equal((lista.match(/window\.__forceListaRefresh\s*=/g) || []).length, 1);
});

test('movimentacoes aguardam saldo absoluto e nao calculam delta nos fluxos principais', () => {
  const menu = ler('menu_produto.js');
  const ajuste = trecho(menu, 'async function salvarAjuste(', 'async function salvarTransferencia(');
  const transferencia = trecho(menu, 'async function salvarTransferencia(', 'if (localSel)');
  assert.match(ajuste, /__capturarVersoesEstoque/);
  assert.match(ajuste, /__reconciliarEstoqueAposMovimentacao/);
  assert.match(ajuste, /\{ \[local\]: tipo === 'ENT' \? qtd : -qtd \}/);
  assert.doesNotMatch(ajuste, /aplicarEstoqueOtimistaMovim/);
  assert.match(transferencia, /__capturarVersoesEstoque/);
  assert.match(transferencia, /__reconciliarEstoqueAposMovimentacao/);
  assert.match(transferencia, /\{ \[origem\]: -qtd, \[destino\]: qtd \}/);
  assert.doesNotMatch(transferencia, /aplicarEstoqueOtimistaMovim/);
});

test('backend publica versao do saldo e reconcilia origem e destino', () => {
  const server = ler('server.js');
  const transferencias = ler('routes/transferencias.js');
  const batch = trecho(server, "app.get('/api/logistica/estoque/batch'", "app.get('/api/logistica/endereco-pp/batch'");
  assert.match(batch, /e\.updated_at/);
  assert.match(batch, /updated_at:\s*row\.updated_at/);
  assert.match(transferencias, /registroAtual\.origem, registroAtual\.destino/);
  assert.match(transferencias, /agendarReconciliacaoEstoqueOmie/);
  assert.match(transferencias, /deltaEsperado: -Number\(registroAtual\.qtd\)/);
  assert.match(transferencias, /deltaEsperado: Number\(registroAtual\.qtd\)/);
});
