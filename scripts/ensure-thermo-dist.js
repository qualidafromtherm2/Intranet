#!/usr/bin/env node
/**
 * Garante thermo-web/dist quando THERMO_FRONTEND_ENABLED=true.
 * Serve de rede de segurança se o Build Command do Render ainda não
 * inclui `npm run build:thermo`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const enabled = String(process.env.THERMO_FRONTEND_ENABLED || '').toLowerCase() === 'true';
if (!enabled) {
  console.log('[thermo] ensure-dist: flag desligada — pulando build.');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const indexHtml = path.join(root, 'thermo-web', 'dist', 'index.html');
if (fs.existsSync(indexHtml)) {
  console.log('[thermo] ensure-dist: dist já existe.');
  process.exit(0);
}

console.log('[thermo] ensure-dist: dist ausente — executando npm run build:thermo…');
try {
  execSync('npm run build:thermo', {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
} catch (err) {
  console.error('[thermo] ensure-dist: falha no build:', err.message || err);
  // Não derruba o legado: o mount devolve 503 em /thermo/ se não houver dist.
  process.exit(0);
}

if (fs.existsSync(indexHtml)) {
  console.log('[thermo] ensure-dist: build ok.');
} else {
  console.error('[thermo] ensure-dist: build terminou sem gerar index.html.');
}
process.exit(0);
