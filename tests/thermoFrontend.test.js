const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { injectLegacyThermoSwitch, mountThermoFrontend } = require('../utils/thermoFrontend');

function request(server, pathname) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

test('não registra rotas quando a flag está desligada', async (t) => {
  const app = express();
  mountThermoFrontend(app, { enabled: false, distRoot: 'inexistente' });
  const server = await listen(app);
  t.after(() => server.close());
  const response = await request(server, '/thermo/');
  assert.equal(response.status, 404);
});

test('serve assets e fallback do SPA somente quando habilitado', async (t) => {
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thermo-front-'));
  fs.mkdirSync(path.join(distRoot, 'assets'));
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<main>Thermo</main>');
  fs.writeFileSync(path.join(distRoot, 'assets', 'app.js'), 'window.THERMO=true;');
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));

  const app = express();
  mountThermoFrontend(app, { enabled: true, distRoot });
  const server = await listen(app);
  t.after(() => server.close());

  const asset = await request(server, '/thermo/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.body, /THERMO=true/);

  const fallback = await request(server, '/thermo/products');
  assert.equal(fallback.status, 200);
  assert.match(fallback.body, /Thermo/);
});

test('preserva o bloqueio de sessão injetado pelo legado', async (t) => {
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thermo-auth-'));
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<main>Thermo</main>');
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));

  const app = express();
  const requireSession = (_req, res) => res.sendStatus(401);
  mountThermoFrontend(app, { enabled: true, distRoot, requireSession });
  const server = await listen(app);
  t.after(() => server.close());

  const response = await request(server, '/thermo/');
  assert.equal(response.status, 401);
});

test('injeta a alternância no legado somente quando habilitada', () => {
  const html = '<header>Legado</header>\n  <!-- Ícones da direita -->';
  assert.equal(injectLegacyThermoSwitch(html, false), html);

  const enabled = injectLegacyThermoSwitch(html, true);
  assert.match(enabled, /id="thermo-ui-switch"/);
  assert.match(enabled, /href="\/thermo\/"/);
  assert.equal((enabled.match(/id="thermo-ui-switch"/g) || []).length, 1);
  assert.equal(injectLegacyThermoSwitch(enabled, true), enabled);
});
