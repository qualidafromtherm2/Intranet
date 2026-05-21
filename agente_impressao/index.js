'use strict';
/**
 * Agente de Impressão Local — Intranet SGF
 *
 * Instale Node.js (nodejs.org) e execute: node index.js
 *
 * Rotas disponíveis em http://localhost:9200:
 *   GET  /status  → { ok: true, printer: "nome da impressora" }
 *   POST /print   → body: { zpl: "^XA..." [, printer: "nome"] }
 *                → { ok: true } | { error: "mensagem" }
 */

const http = require('http');
const { exec } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const PORT     = 9200;
const PS1_FILE = path.join(__dirname, 'imprimir.ps1');

let printerName = '';

// ─── Detecta primeira impressora Zebra instalada ─────────────────────────────
function detectarImpressora(cb) {
  if (os.platform() !== 'win32') {
    exec("lpstat -p 2>/dev/null | grep -iE 'zebra|zd[0-9]|ztc|zm[0-9]' | head -1 | awk '{print $2}'",
      (err, out) => cb(out.trim() || ''));
    return;
  }
  exec(
    'powershell -NoProfile -Command "Get-Printer | Where-Object { $_.Name -match \'Zebra|ZD|ZTC|ZM\' } | Select-Object -First 1 -ExpandProperty Name"',
    (err, stdout) => cb((stdout || '').trim() || '')
  );
}

// ─── Lista todas as impressoras (Windows) ─────────────────────────────────────
function listarImpressoras(cb) {
  if (os.platform() !== 'win32') {
    exec("lpstat -p 2>/dev/null | awk '{print $2}'", (err, out) => {
      cb(out.trim().split('\n').filter(Boolean));
    });
    return;
  }
  exec(
    'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"',
    (err, stdout) => cb((stdout || '').trim().split('\n').map(s => s.trim()).filter(Boolean))
  );
}

// ─── Envia ZPL raw via script PS1 ────────────────────────────────────────────
function imprimirZpl(zpl, printer, cb) {
  if (os.platform() !== 'win32') {
    // Linux/Mac: usa lp com modo raw
    const tmpFile = path.join(os.tmpdir(), `etq_${Date.now()}.zpl`);
    try { fs.writeFileSync(tmpFile, zpl, 'binary'); } catch (e) { return cb(e); }
    exec(`lp -d "${printer.replace(/"/g, '')}" -o raw "${tmpFile}"`, { timeout: 15000 }, (err, stdout, stderr) => {
      fs.unlink(tmpFile, () => {});
      if (err) return cb(new Error((stderr || err.message).trim()));
      cb(null, stdout.trim());
    });
    return;
  }

  if (!fs.existsSync(PS1_FILE)) {
    return cb(new Error('Arquivo imprimir.ps1 não encontrado. Reinstale o agente.'));
  }

  const id      = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const zplFile = path.join(os.tmpdir(), `etq_${id}.zpl`);
  try { fs.writeFileSync(zplFile, zpl, 'binary'); } catch (e) { return cb(e); }

  const cmd = [
    'powershell',
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', `"${PS1_FILE}"`,
    '-ZplFile', `"${zplFile}"`,
    '-PrinterName', `"${printer.replace(/"/g, '')}"`,
  ].join(' ');

  exec(cmd, { timeout: 20000 }, (err, stdout, stderr) => {
    fs.unlink(zplFile, () => {});
    const errMsg = (stderr || '').trim();
    if (err || errMsg) return cb(new Error(errMsg || err?.message || 'Erro desconhecido'));
    cb(null, stdout.trim());
  });
}

// ─── Resposta JSON com CORS ───────────────────────────────────────────────────
function respJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ─── Inicia ───────────────────────────────────────────────────────────────────
detectarImpressora(nome => {
  printerName = nome;

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Agente de Impressão — Intranet SGF         ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Impressora : ${printerName || '(nenhuma detectada — use o parâmetro "printer")'}`);
  console.log(`  API        : http://localhost:${PORT}`);
  console.log(`  Teste      : http://localhost:${PORT}/status`);
  console.log('  Mantenha esta janela aberta para imprimir.\n');

  const server = http.createServer((req, res) => {
    // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // GET /status
    if (req.method === 'GET' && req.url === '/status') {
      return respJson(res, 200, { ok: true, printer: printerName || null });
    }

    // GET /impressoras — lista todas as impressoras
    if (req.method === 'GET' && req.url === '/impressoras') {
      return listarImpressoras(lista => respJson(res, 200, { ok: true, printers: lista }));
    }

    // POST /print
    if (req.method === 'POST' && req.url === '/print') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        let data;
        try { data = JSON.parse(body); } catch { return respJson(res, 400, { error: 'JSON inválido' }); }

        const { zpl, printer } = data;
        if (!zpl) return respJson(res, 400, { error: 'Campo "zpl" obrigatório' });

        const p = printer || printerName;
        if (!p) return respJson(res, 500, {
          error: 'Nenhuma impressora Zebra detectada automaticamente. ' +
                 'Informe o nome no campo "printer" ou verifique a instalação da impressora.'
        });

        imprimirZpl(zpl, p, (err, msg) => {
          if (err) {
            console.error('[print] ERRO:', err.message);
            return respJson(res, 500, { error: err.message });
          }
          console.log(`[print] OK → "${p}"${msg ? `  (${msg})` : ''}`);
          respJson(res, 200, { ok: true });
        });
      });
      return;
    }

    respJson(res, 404, { error: 'Rota não encontrada' });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log('✅ Pronto.\n');
  });
});
