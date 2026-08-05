const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const raiz = path.resolve(__dirname, '..');
const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');

test('painel destaca a solicitação e exibe o tempo médio operacional', () => {
  const html = ler('menu_produto.html');
  const frontend = ler('menu_produto.js');

  assert.match(html, /id="envioMetricMedia7d"/);
  assert.match(html, /envio-card-request-date/);
  assert.match(frontend, /metricas\?\.media_horas_7d/);
  assert.match(frontend, /toLocaleDateString\('pt-BR'\)/);
});

test('backend calcula média apenas entre solicitação e envio dos últimos sete dias', () => {
  const backend = ler('routes/sacEnvios.js');

  assert.match(backend, /AS horas_operacao_uteis/);
  assert.match(backend, /EXTRACT\(ISODOW FROM dia\) BETWEEN 1 AND 5/);
  assert.match(backend, /AVG\(horas_operacao_uteis\)/);
  assert.match(backend, /data_envio >= NOW\(\) - INTERVAL '7 days'/);
  assert.match(backend, /media_horas_7d:/);
});

test('contador visual de atraso ignora sabado e domingo', () => {
  const frontend = ler('menu_produto.js');

  assert.match(frontend, /function calcularHorasUteisEnvioMercadoria/);
  assert.match(frontend, /diaSemana !== 0 && diaSemana !== 6/);
  assert.match(frontend, /calcularHorasUteisEnvioMercadoria\(limite, agora\)/);
});

test('envio exibe status oficial da SEP, atalho e saldos ALMOX e SAC', () => {
  const html = ler('menu_produto.html');
  const frontend = ler('menu_produto.js');
  const backend = ler('routes/sacEnvios.js');

  assert.match(backend, /AS sep_status/);
  assert.match(backend, /WHEN BOOL_OR\(i\.status = 'pendente'\) THEN 'Solicitado'/);
  assert.match(backend, /WHEN BOOL_OR\(i\.status IN \('Separação', 'Em Separação'\)\) THEN 'Em Separação'/);
  assert.match(frontend, /class="envio-sep-status/);
  assert.match(frontend, /abrirSepDoEnvioMercadoria/);
  assert.match(frontend, /10717096386/);
  assert.match(frontend, /10445659161/);
  assert.match(html, /envio-stock-tooltip/);
});
