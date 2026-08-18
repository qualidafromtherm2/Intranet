const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { interpretarLeitura } = require('../utils/bipagemContagem');
const ler = (arquivo) => fs.readFileSync(path.resolve(__dirname, '..', arquivo), 'utf8');

test('interpreta etiqueta antiga separada por pipe', () => {
  const lida = interpretarLeitura('04.MP.N.71040|COMPRESSOR|12345|ID1');
  assert.equal(lida.valido, true);
  assert.equal(lida.formato, 'etiqueta_op');
  assert.equal(lida.modelo, '04.MP.N.71040');
  assert.equal(lida.ordemProducao, '12345');
});

test('aceita formatos antigos de modelo e OP com ou sem sequência', () => {
  const simples = interpretarLeitura('04.MP.N.71040-12345');
  const sequencial = interpretarLeitura('04.MP.N.71040-12345-1');
  assert.deepEqual([simples.modelo, simples.ordemProducao], ['04.MP.N.71040', '12345']);
  assert.deepEqual([sequencial.modelo, sequencial.ordemProducao], ['04.MP.N.71040', '12345']);
});

test('aceita MODELO-OP-DATA com data brasileira ou compacta', () => {
  const brasileira = interpretarLeitura('FTI145D40PT-98765-14/08/2026');
  const compacta = interpretarLeitura('FTI145D40PT-98765-20260814');
  for (const lida of [brasileira, compacta]) {
    assert.equal(lida.formato, 'modelo_op_data');
    assert.equal(lida.modelo, 'FTI145D40PT');
    assert.equal(lida.ordemProducao, '98765');
    assert.equal(lida.dataReferencia, '2026-08-14');
  }
});

test('diferencia OP simples de código de barras numérico longo', () => {
  assert.equal(interpretarLeitura('12345').formato, 'op');
  assert.equal(interpretarLeitura('7891234567890').formato, 'codigo_barras');
});

test('rejeita conteúdo vazio ou incompleto', () => {
  assert.equal(interpretarLeitura('   ').valido, false);
  assert.equal(interpretarLeitura('A1').valido, false);
});

test('backend garante unicidade por sessão e trilha de auditoria', () => {
  const rota = ler('routes/bipagemContagem.js');
  assert.match(rota, /UNIQUE \(sessao_id, valor_normalizado\)/);
  assert.match(rota, /lido_por_id/);
  assert.match(rota, /router\.post\('\/sessoes\/:id\/leituras'/);
  assert.match(rota, /router\.delete\('\/sessoes\/:sessaoId\/leituras\/:leituraId'/);
  assert.match(rota, /side:log:bipagem-contagem/);
  assert.match(rota, /side:log:identificacao-produto/);
  assert.match(rota, /auth_role_permission/);
});

test('interface aceita Enter e Tab, câmera contínua e fila de rede', () => {
  const frontend = ler('public/js/bipagem-contagem.js');
  const html = ler('menu_produto.html');
  const css = ler('public/css/bipagem-contagem.css');
  assert.match(frontend, /e\.key === 'Enter' \|\| e\.key === 'Tab'/);
  assert.match(frontend, /new BarcodeDetector/);
  assert.match(frontend, /window\.jsQR/);
  assert.match(frontend, /if \(!state\.cameraStream \|\| !state\.cameraMode\) return;/);
  assert.doesNotMatch(frontend, /if \(!state\.cameraStream \|\| !state\.detector\) return;/);
  assert.match(ler('menu_produto.js'), /source\.id === 'bipagem-contagem-atalho'/);
  assert.match(frontend, /qr_code/);
  assert.match(frontend, /code_128/);
  assert.match(frontend, /localStorage\.setItem\(QUEUE_KEY/);
  assert.match(frontend, /requestAnimationFrame\(detectarCamera\)/);
  assert.match(html, /id="bipagem-contagem-atalho"/);
  assert.match(html, /id="bipagemContagemPane"/);
  assert.match(css, /@media \(max-width: 640px\)/);
});

test('bipagem permite copiar todas as leituras em formato tabular', () => {
  const rota = ler('routes/bipagemContagem.js');
  const frontend = ler('public/js/bipagem-contagem.js');
  const html = ler('menu_produto.html');
  assert.match(rota, /router\.get\('\/sessoes\/:id\/leituras'/);
  assert.match(frontend, /async function copiarLeituras\(\)/);
  assert.match(frontend, /cabecalho\.join\('\\t'\)/);
  assert.match(html, /id="bipCopyReadings"/);
});
