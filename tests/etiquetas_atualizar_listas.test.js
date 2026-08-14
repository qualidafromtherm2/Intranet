const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'menu_produto.html'), 'utf8');
const js = fs.readFileSync(path.resolve(__dirname, '..', 'menu_produto.js'), 'utf8');

test('as duas etapas possuem botao explicito para atualizar a lista', () => {
  assert.match(html, /id="etqBtnAtualizarPendentes"/);
  assert.match(html, /id="etqBtnAtualizarImpresso"/);
  assert.equal((html.match(/<span>Atualizar lista<\/span>/g) || []).length, 2);
});

test('identificacao atualiza preservando pesquisa e filtros ativos', () => {
  const inicio = js.indexOf("etqBtnAtualizarPendentes?.addEventListener('click'");
  const fim = js.indexOf('// Imprimir selecionadas', inicio);
  assert.notEqual(inicio, -1);
  assert.notEqual(fim, -1);
  const bloco = js.slice(inicio, fim);
  assert.match(bloco, /_etqCarregar\(etqBusca\?\.value\.trim\(\) \|\| ''\)/);
  assert.match(bloco, /aria-busy/);
  assert.doesNotMatch(bloco, /location\.reload|window\.location/);
});

test('guardar materiais atualiza preservando a pesquisa ativa', () => {
  const inicio = js.indexOf("document.getElementById('etqBtnAtualizarImpresso')?.addEventListener('click'");
  const fim = js.indexOf('// ── Sub-modal câmera', inicio);
  assert.notEqual(inicio, -1);
  assert.notEqual(fim, -1);
  const bloco = js.slice(inicio, fim);
  assert.match(bloco, /_etqImpressoCarregar\(etqImpressoBusca\?\.value\.trim\(\) \|\| ''\)/);
  assert.match(bloco, /aria-busy/);
  assert.doesNotMatch(bloco, /location\.reload|window\.location/);
});
