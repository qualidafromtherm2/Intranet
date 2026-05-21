'use strict';
/**
 * Agente de Impressão SGF v2.0
 *
 * MODOS:
 *   (sem args)   → Instalador: copia para AppData, agenda tarefa, cria atalho, inicia serviço
 *   --service    → Serviço: polling da fila no servidor + UI de config em localhost:9200
 *   --config     → Abre http://localhost:9200 no browser padrão
 */

const http   = require('http');
const https  = require('https');
const { execFile, execFileSync, spawnSync, spawn } = require('child_process');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const PORT       = 9200;
const TASK_NAME  = 'AgenteImpressaoSGF';
const EXE_NAME   = 'agente-impressao.exe';
const SHORTCUT   = 'Agente Impressão SGF.lnk';

const INSTALL_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'AgenteImpressaoSGF'
);
const CONFIG_PATH = path.join(INSTALL_DIR, 'config.json');
const LOG_PATH    = path.join(INSTALL_DIR, 'agent.log');

// ─── Defaults de configuração ────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  serverUrl:    'https://intranet-30av.onrender.com',
  agentToken:   'sgf-agente-2024',
  printer:      '',
  pollInterval: 5000,
  labelWidth:   100,
  labelHeight:  150,
  darkness:     20,
  speed:        4,
};

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
  } catch { return Object.assign({}, DEFAULT_CONFIG); }
}

function saveConfig(data) {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  const current = readConfig();
  const merged  = Object.assign({}, current, data);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch {}
  console.log(msg);
}

// ─── ZPL via PowerShell (winspool.Drv) ───────────────────────────────────────
function printZpl(zpl, printerName, cb) {
  const ps1 = `
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;using System.Text;
public class RawPrint {
  [DllImport("winspool.Drv",SetLastError=true)] public static extern bool OpenPrinter(string p,out IntPtr h,IntPtr d);
  [DllImport("winspool.Drv",SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv",SetLastError=true)] public static extern bool StartDocPrinter(IntPtr h,Int32 l,ref DOCINFOA d);
  [DllImport("winspool.Drv",SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv",SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv",SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv",SetLastError=true)] public static extern bool WritePrinter(IntPtr h,IntPtr b,Int32 bW,out Int32 bW2);
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Ansi)] public struct DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  public static bool SendStringToPrinter(string printerName, string s){
    IntPtr hP;bool ok=OpenPrinter(printerName,out hP,IntPtr.Zero);
    if(!ok)return false;
    var di=new DOCINFOA{pDocName="ZPL",pOutputFile=null,pDataType="RAW"};
    StartDocPrinter(hP,1,ref di);StartPagePrinter(hP);
    byte[] b=Encoding.UTF8.GetBytes(s);IntPtr pB=Marshal.AllocCoTaskMem(b.Length);
    Marshal.Copy(b,0,pB,b.Length);int bW;
    WritePrinter(hP,pB,b.Length,out bW);Marshal.FreeCoTaskMem(pB);
    EndPagePrinter(hP);EndDocPrinter(hP);ClosePrinter(hP);return true;
  }
}
"@ -Language CSharp
$zpl = @'
${zpl.replace(/'/g, "''")}
'@
[RawPrint]::SendStringToPrinter('${printerName.replace(/'/g, "''")}', $zpl)
`.trim();

  const tmp = path.join(os.tmpdir(), `sgf_print_${Date.now()}.ps1`);
  try {
    fs.writeFileSync(tmp, ps1, 'utf8');
    execFile('powershell.exe',
      ['-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      { timeout: 30000 },
      (err) => {
        try { fs.unlinkSync(tmp); } catch {}
        cb(err || null);
      }
    );
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    cb(e);
  }
}

// ─── Lista impressoras via PowerShell ────────────────────────────────────────
function listarImpressoras(cb) {
  execFile('powershell.exe',
    ['-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
     '-Command', 'Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'],
    { timeout: 10000 },
    (err, stdout) => {
      if (err) return cb([]);
      try {
        const parsed = JSON.parse(stdout.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        cb(list.filter(Boolean));
      } catch { cb([]); }
    }
  );
}

// ─── Requisição HTTPS para o servidor ────────────────────────────────────────
function apiRequest(method, urlPath, body, token, cb, extraHeaders = {}) {
  const cfg = readConfig();
  const serverUrl = cfg.serverUrl.replace(/\/$/, '');
  const fullUrl = `${serverUrl}${urlPath}`;
  const url = new URL(fullUrl);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  const bodyStr = body ? JSON.stringify(body) : null;
  const opts = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-agent-token': token || cfg.agentToken,
      ...extraHeaders,
      ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
    },
    timeout: 15000,
  };

  const req = lib.request(opts, (r) => {
    let data = '';
    r.on('data', c => (data += c));
    r.on('end', () => {
      try { cb(null, r.statusCode, JSON.parse(data)); }
      catch { cb(null, r.statusCode, { raw: data }); }
    });
  });
  req.on('error', cb);
  req.on('timeout', () => { req.destroy(new Error('timeout')); });
  if (bodyStr) req.write(bodyStr);
  req.end();
}

// ─── HTML da UI de configuração ───────────────────────────────────────────────
function buildConfigHtml(cfg, printers, status) {
  const printerOptions = printers.map(p =>
    `<option value="${p.replace(/"/g, '&quot;')}"${p === cfg.printer ? ' selected' : ''}>${p}</option>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agente Impressão SGF</title>
<style>
  :root { --bg:#0f0e17; --card:#1a1929; --border:#2d2b50; --accent:#7c3aed; --accent2:#6d28d9;
          --text:#e2e8f0; --muted:#94a3b8; --green:#4ade80; --red:#f87171; --yellow:#facc15; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;padding:24px}
  h1{font-size:1.4rem;font-weight:700;display:flex;align-items:center;gap:10px;margin-bottom:4px}
  h1 span.badge{font-size:.7rem;background:var(--accent);color:#fff;padding:3px 8px;border-radius:20px;font-weight:600}
  .subtitle{color:var(--muted);font-size:.85rem;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:900px}
  @media(max-width:640px){.grid{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px}
  .card h2{font-size:.95rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px;display:flex;align-items:center;gap:8px}
  .card h2 i{color:var(--accent);width:16px;text-align:center}
  .field{margin-bottom:14px}
  label{display:block;font-size:.8rem;color:var(--muted);margin-bottom:5px;font-weight:500}
  input,select{width:100%;background:#0f0e17;border:1px solid var(--border);border-radius:7px;padding:8px 12px;
    color:var(--text);font-size:.9rem;outline:none;transition:border .2s}
  input:focus,select:focus{border-color:var(--accent)}
  select option{background:#1a1929}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;border:none;
    cursor:pointer;font-size:.88rem;font-weight:600;transition:all .2s}
  .btn-primary{background:var(--accent);color:#fff}
  .btn-primary:hover{background:var(--accent2)}
  .btn-secondary{background:transparent;color:var(--muted);border:1px solid var(--border)}
  .btn-secondary:hover{border-color:var(--accent);color:var(--text)}
  .status-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:.88rem}
  .status-row:last-child{border:none}
  .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .dot-green{background:var(--green)}
  .dot-red{background:var(--red)}
  .dot-yellow{background:var(--yellow);animation:pulse 1.5s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .toast{position:fixed;bottom:24px;right:24px;background:#1e1b2e;border:1px solid var(--accent);
    border-radius:10px;padding:12px 20px;color:var(--text);font-size:.88rem;font-weight:500;
    opacity:0;transform:translateY(10px);transition:all .3s;pointer-events:none}
  .toast.show{opacity:1;transform:translateY(0)}
  .log-box{background:#0a0a12;border:1px solid var(--border);border-radius:8px;padding:10px 12px;
    font-family:monospace;font-size:.77rem;color:var(--muted);height:120px;overflow-y:auto;white-space:pre-wrap}
</style>
</head>
<body>
<h1>🖨️ Agente de Impressão SGF <span class="badge">v2.0</span></h1>
<p class="subtitle">Configuração do agente de impressão — monitora a fila e imprime automaticamente.</p>

<div class="grid">
  <!-- Coluna 1: Config -->
  <div>
    <div class="card" style="margin-bottom:16px">
      <h2><i>⚙️</i> Configuração de Impressão</h2>
      <form id="formConfig">
        <div class="field">
          <label>Impressora padrão</label>
          <select name="printer" id="selPrinter">
            <option value="">-- selecione --</option>
            ${printerOptions}
          </select>
        </div>
        <div class="row2">
          <div class="field">
            <label>Largura da etiqueta (mm)</label>
            <input type="number" name="labelWidth" value="${cfg.labelWidth}" min="20" max="300">
          </div>
          <div class="field">
            <label>Altura da etiqueta (mm)</label>
            <input type="number" name="labelHeight" value="${cfg.labelHeight}" min="10" max="500">
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>Escuridão (0–30)</label>
            <input type="number" name="darkness" value="${cfg.darkness}" min="0" max="30">
          </div>
          <div class="field">
            <label>Velocidade (1–14)</label>
            <input type="number" name="speed" value="${cfg.speed}" min="1" max="14">
          </div>
        </div>
        <div class="field">
          <label>Intervalo de polling (ms)</label>
          <input type="number" name="pollInterval" value="${cfg.pollInterval}" min="1000" max="60000" step="500">
        </div>
        <button type="submit" class="btn btn-primary">💾 Salvar configuração</button>
      </form>
    </div>

    <div class="card">
      <h2><i>🔗</i> Conexão com Servidor</h2>
      <form id="formServer">
        <div class="field">
          <label>URL do servidor</label>
          <input type="url" name="serverUrl" value="${cfg.serverUrl}">
        </div>
        <div class="field">
          <label>Token do agente</label>
          <input type="text" name="agentToken" value="${cfg.agentToken}">
        </div>
        <button type="submit" class="btn btn-secondary">Salvar conexão</button>
      </form>
    </div>
  </div>

  <!-- Coluna 2: Status -->
  <div>
    <div class="card" style="margin-bottom:16px">
      <h2><i>📊</i> Status do Agente</h2>
      <div class="status-row">
        <div class="dot dot-green"></div>
        <span><b>Serviço:</b> Rodando em localhost:${PORT}</span>
      </div>
      <div class="status-row">
        <div class="dot ${status.polling ? 'dot-green' : 'dot-red'}"></div>
        <span><b>Polling:</b> ${status.polling ? 'Ativo' : 'Pausado'}</span>
      </div>
      <div class="status-row">
        <div class="dot dot-${status.lastPrintOk === null ? 'yellow' : status.lastPrintOk ? 'green' : 'red'}"></div>
        <span><b>Última impressão:</b> ${status.lastPrint || 'Nenhuma ainda'}</span>
      </div>
      <div class="status-row">
        <span><b>Impressora ativa:</b> ${cfg.printer || '<span style="color:var(--yellow)">Não configurada</span>'}</span>
      </div>
      <div class="status-row">
        <span><b>Jobs impressos:</b> ${status.totalPrinted}</span>
        <span style="margin-left:auto;color:var(--red)"><b>Erros:</b> ${status.totalErrors}</span>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px">
        <button class="btn btn-secondary" onclick="location.reload()">🔄 Atualizar</button>
        <button class="btn btn-secondary" onclick="testPrint()">🧪 Teste de impressão</button>
      </div>
    </div>

    <div class="card">
      <h2><i>📋</i> Log recente</h2>
      <div class="log-box" id="logBox">${status.recentLog || 'Nenhum log ainda.'}</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn btn-secondary" style="font-size:.78rem" onclick="reloadLog()">🔄 Recarregar log</button>
      </div>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
function toast(msg, ok=true) {
  const t = document.getElementById('toast');
  t.textContent = (ok ? '✅ ' : '❌ ') + msg;
  t.style.borderColor = ok ? 'var(--green)' : 'var(--red)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

document.getElementById('formConfig').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  ['labelWidth','labelHeight','darkness','speed','pollInterval'].forEach(k => data[k] = Number(data[k]));
  const r = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  const j = await r.json();
  toast(j.ok ? 'Configuração salva!' : (j.error || 'Erro'), j.ok);
});

document.getElementById('formServer').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  const r = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  const j = await r.json();
  toast(j.ok ? 'Conexão salva! Agente reiniciará o polling.' : (j.error || 'Erro'), j.ok);
});

async function testPrint() {
  const r = await fetch('/api/test-print', { method:'POST' });
  const j = await r.json();
  toast(j.ok ? 'Etiqueta de teste enviada!' : (j.error || 'Erro ao testar'), j.ok);
}

async function reloadLog() {
  const r = await fetch('/api/log');
  const j = await r.json();
  document.getElementById('logBox').textContent = j.log || '';
  document.getElementById('logBox').scrollTop = 999999;
}

// Auto-refresh status a cada 10s
setInterval(async () => {
  try {
    const r = await fetch('/api/status');
    const j = await r.json();
    if (j.lastPrint) document.querySelector('.status-row:nth-child(3) span').innerHTML =
      '<b>Última impressão:</b> ' + j.lastPrint;
  } catch {}
}, 10000);
</script>
</body>
</html>`;
}

// ─── MODO SERVIÇO ─────────────────────────────────────────────────────────────
function runService() {
  log('=== Agente SGF v2.0 iniciando (modo serviço) ===');
  log(`INSTALL_DIR: ${INSTALL_DIR}`);

  // ─── Heartbeat ─────────────────────────────────────────────────────────────
  function sendHeartbeat() {
    const c = readConfig();
    apiRequest('POST', '/api/etiquetas/agente/heartbeat',
      { printer: c.printer || '', version: '2.0', host: os.hostname() },
      c.agentToken, () => {});
  }
  sendHeartbeat();                          // imediato ao iniciar
  setInterval(sendHeartbeat, 30000);        // a cada 30s

  // Estado em memória
  const state = {
    polling: false,
    lastPrint: null,
    lastPrintOk: null,
    totalPrinted: 0,
    totalErrors: 0,
    recentLog: '',
    printers: [],
  };

  // Carrega lista de impressoras na inicialização
  listarImpressoras(list => {
    state.printers = list;
    log(`Impressoras detectadas: ${list.length} — ${list.join(', ')}`);
    // Seleciona primeira Zebra encontrada se não houver configurada
    const cfg = readConfig();
    if (!cfg.printer) {
      const zebra = list.find(p => /zebra|zdesigner|zt|zd|tlp/i.test(p));
      if (zebra) {
        saveConfig({ printer: zebra });
        log(`Auto-selecionada impressora: ${zebra}`);
      }
    }
  });

  // ─── Loop de polling ────────────────────────────────────────────────────────
  async function pollOnce() {
    const cfg = readConfig();
    if (!cfg.printer) {
      log('[poll] Sem impressora configurada — abrindo config em localhost:' + PORT);
      return;
    }

    return new Promise(resolve => {
      const extraHdr = { 'x-agent-printer': cfg.printer || '', 'x-agent-version': '2.0', 'x-agent-host': os.hostname() };
      apiRequest('GET', '/api/etiquetas/fila/pendentes', null, cfg.agentToken, (err, status, body) => {
        if (err) {
          log(`[poll] Erro de conexão: ${err.message}`);
          return resolve();
        }
        if (status === 401) { log('[poll] Token inválido!'); return resolve(); }
        if (!body?.jobs?.length) return resolve();

        log(`[poll] ${body.jobs.length} job(s) na fila`);
        let pending = body.jobs.length;

        for (const job of body.jobs) {
          log(`[poll] Imprimindo job #${job.id} (${job.quantidade} etiqueta(s)) em "${cfg.printer}"`);
          printZpl(job.zpl, cfg.printer, (err2) => {
            const ok = !err2;
            const erroMsg = err2?.message || null;
            if (ok) {
              state.totalPrinted++;
              state.lastPrint = new Date().toLocaleString('pt-BR');
              state.lastPrintOk = true;
              log(`[poll] Job #${job.id} → OK`);
            } else {
              state.totalErrors++;
              state.lastPrint = new Date().toLocaleString('pt-BR');
              state.lastPrintOk = false;
              log(`[poll] Job #${job.id} → ERRO: ${erroMsg}`);
            }

            apiRequest('POST', '/api/etiquetas/fila/confirmar', {
              id: job.id, success: ok, error: erroMsg,
              agent_host: os.hostname(),
            }, cfg.agentToken, () => {});

            pending--;
            if (pending === 0) resolve();
          });
        }
      }, extraHdr);
    });
  }

  state.polling = true;

  async function pollingLoop() {
    while (true) {
      const cfg = readConfig();
      try { await pollOnce(); } catch (e) { log(`[poll] Exceção: ${e.message}`); }
      await new Promise(r => setTimeout(r, cfg.pollInterval || 5000));
    }
  }
  pollingLoop();

  // ─── Servidor HTTP para UI de config ────────────────────────────────────────
  function respJson(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(obj));
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,x-agent-token', 'Access-Control-Allow-Methods': 'GET,POST' });
      return res.end();
    }

    // GET / — Config UI
    if (req.method === 'GET' && req.url === '/') {
      listarImpressoras(list => {
        state.printers = list;
        const cfg = readConfig();
        let recentLog = '';
        try { recentLog = fs.readFileSync(LOG_PATH, 'utf8').split('\n').slice(-20).join('\n'); } catch {}
        const html = buildConfigHtml(cfg, list, { ...state, recentLog });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }

    // GET /api/status  (também responde em /status para compatibilidade com v1.0)
    if (req.method === 'GET' && (req.url === '/api/status' || req.url === '/status')) {
      const cfg = readConfig();
      return respJson(res, 200, {
        ok: true,
        printer: cfg.printer || null,
        polling: state.polling,
        lastPrint: state.lastPrint,
        lastPrintOk: state.lastPrintOk,
        totalPrinted: state.totalPrinted,
        totalErrors: state.totalErrors,
        version: '2.0',
      });
    }

    // GET /api/config
    if (req.method === 'GET' && req.url === '/api/config') {
      return respJson(res, 200, readConfig());
    }

    // POST /api/config
    if (req.method === 'POST' && req.url === '/api/config') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const saved = saveConfig(data);
          log(`[config] Configuração atualizada: ${JSON.stringify(data)}`);
          return respJson(res, 200, { ok: true, config: saved });
        } catch (e) {
          return respJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    // GET /api/printers
    if (req.method === 'GET' && req.url === '/api/printers') {
      listarImpressoras(list => {
        state.printers = list;
        respJson(res, 200, { ok: true, printers: list });
      });
      return;
    }

    // GET /api/log
    if (req.method === 'GET' && req.url === '/api/log') {
      let log2 = '';
      try { log2 = fs.readFileSync(LOG_PATH, 'utf8').split('\n').slice(-50).join('\n'); } catch {}
      return respJson(res, 200, { ok: true, log: log2 });
    }

    // POST /api/test-print — imprime etiqueta de teste
    if (req.method === 'POST' && req.url === '/api/test-print') {
      const cfg = readConfig();
      if (!cfg.printer) return respJson(res, 400, { error: 'Nenhuma impressora configurada' });
      const testZpl = [
        '^XA', '^CI28', '^PW812', '^LL200',
        '^FO30,30^A0N,40,40^FDAgente SGF — Teste^FS',
        '^FO30,80^A0N,25,25^FDImpressao funcionando!^FS',
        `^FO30,115^A0N,20,20^FD${new Date().toLocaleString('pt-BR')}^FS`,
        '^XZ',
      ].join('\n');
      printZpl(testZpl, cfg.printer, (err2) => {
        if (err2) return respJson(res, 500, { error: err2.message });
        log(`[test] Etiqueta de teste impressa em "${cfg.printer}"`);
        respJson(res, 200, { ok: true });
      });
      return;
    }

    respJson(res, 404, { error: 'Rota não encontrada' });
  });

  server.listen(PORT, '0.0.0.0', () => {
    log(`UI de config disponível em http://localhost:${PORT}`);
  });
}

// ─── MODO INSTALADOR ──────────────────────────────────────────────────────────
async function install() {
  const LINE = '═'.repeat(52);
  console.log(`\n╔${LINE}╗`);
  console.log('║  Agente de Impressão SGF v2.0 — Instalador          ║');
  console.log(`╚${LINE}╝\n`);

  const step = msg => process.stdout.write(`  ► ${msg}... `);
  const ok   = ()  => console.log('OK ✓');
  const warn = msg => console.log(`AVISO: ${msg}`);

  try {
    // 1. Criar diretório
    step('Criando pasta de instalação');
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    ok();

    // 2. Encerrar versão anterior (se estiver rodando) e copiar executável
    step('Encerrando versão anterior (se houver)');
    spawnSync('taskkill', ['/IM', EXE_NAME, '/F'], { encoding: 'utf8', windowsHide: true });
    await new Promise(r => setTimeout(r, 1500));
    ok();

    const exeDest = path.join(INSTALL_DIR, EXE_NAME);
    step('Copiando executável');
    try { fs.copyFileSync(process.execPath, exeDest); ok(); }
    catch (e) { console.log(`(aviso: ${e.message})`); }

    // 3. Gravar config padrão se não existir
    if (!fs.existsSync(CONFIG_PATH)) {
      step('Criando config padrão');
      saveConfig(DEFAULT_CONFIG);
      ok();
    }

    // 4. Criar script PS1 launcher (inicia serviço sem janela de console)
    step('Criando launcher sem janela');
    const exeRun     = path.join(INSTALL_DIR, EXE_NAME);
    const ps1Path    = path.join(INSTALL_DIR, 'start-service.ps1');
    const ps1Content = `Start-Process -FilePath "${exeRun.replace(/\\/g, '\\\\')}" -ArgumentList "--service" -WindowStyle Hidden\r\n`;
    fs.writeFileSync(ps1Path, ps1Content, 'utf8');
    ok();

    // 5. Tarefa de inicialização automática (usa PS1 para iniciar sem janela)
    step('Configurando início automático com o Windows');
    const taskTr = `powershell.exe -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ps1Path}"`;
    const schtaskCmd = `schtasks /create /tn "${TASK_NAME}" /tr "${taskTr}" /sc ONLOGON /rl HIGHEST /f`;
    const r = spawnSync('cmd', ['/c', schtaskCmd], { encoding: 'utf8' });
    if (r.status === 0) { ok(); } else { warn('execute como Administrador para início automático'); }

    // 5. Criar atalho na área de trabalho (abre o browser na UI)
    step('Criando atalho na área de trabalho');
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const shortcutPath = path.join(desktopPath, SHORTCUT);
    const shortcutPs1 = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}")
$Shortcut.TargetPath = "${exeRun.replace(/\\/g, '\\\\')}"
$Shortcut.Arguments = "--config"
$Shortcut.Description = "Configurar Agente Impressao SGF"
$Shortcut.Save()
`.trim();
    const tmpPs = path.join(os.tmpdir(), 'sgf_shortcut.ps1');
    fs.writeFileSync(tmpPs, shortcutPs1, 'utf8');
    const rsShortcut = spawnSync('powershell.exe',
      ['-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', tmpPs],
      { encoding: 'utf8' });
    try { fs.unlinkSync(tmpPs); } catch {}
    if (rsShortcut.status === 0) { ok(); } else { warn('não foi possível criar atalho automático'); }

    // 7. Inicia o serviço agora via PowerShell (sem janela de console)
    step('Iniciando agente em background');
    try {
      // PowerShell Start-Process com -WindowStyle Hidden é mais confiável que spawn
      spawnSync('powershell.exe',
        ['-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ps1Path],
        { encoding: 'utf8', windowsHide: true });
      ok();
    } catch (spawnErr) {
      console.log(`AVISO: ${spawnErr.message}`);
    }

    // 7. Aguarda serviço iniciar — tenta por até 10s (poll a cada 1s)
    step('Verificando serviço em localhost:' + PORT);
    let serviceOk = false;
    for (let _i = 0; _i < 10 && !serviceOk; _i++) {
      await new Promise(res => setTimeout(res, 1000));
      serviceOk = await new Promise(resolve => {
        const req = http.get({ hostname: '127.0.0.1', port: PORT, path: '/api/status', timeout: 2000 }, r => {
          resolve(r.statusCode === 200); r.resume();
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
    }

    if (serviceOk) {
      ok();
      // 8. Abre a UI de configuração no browser
      step('Abrindo interface de configuração');
      spawnSync('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { windowsHide: true });
      ok();
    } else {
      // Serviço não subiu em background (provavelmente bloqueado pelo antivírus)
      // → inicia o serviço NESTA janela como fallback automático
      const SEP = '═'.repeat(62);
      console.log('BLOQUEADO\n');
      console.log(`╔${SEP}╗`);
      console.log('║  ⚠️  Windows bloqueou o início automático do agente            ║');
      console.log(`╠${SEP}╣`);
      console.log('║  O agente está iniciando NESTA JANELA como alternativa.       ║');
      console.log('║  ⚠️  MANTENHA ESTA JANELA ABERTA enquanto usar etiquetas.      ║');
      console.log(`╠${SEP}╣`);
      console.log('║  Para que funcione em background no próximo login:            ║');
      console.log('║  1. Pressione  Win + S  e abra  "Segurança do Windows"        ║');
      console.log('║  2. Proteção contra vírus → Gerenciar configurações           ║');
      console.log('║  3. Exclusões → Adicionar exclusão → Pasta → selecione:       ║');
      console.log(`║     ${INSTALL_DIR.padEnd(58)}║`);
      console.log('║  4. Execute o instalador novamente após adicionar a exclusão. ║');
      console.log(`╚${SEP}╝\n`);
      // Abre browser na UI de config
      spawnSync('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { windowsHide: true });
      // Inicia serviço nesta janela (process fica vivo pelo server.listen)
      runService();
      return;
    }

    console.log(`\n╔${LINE}╗`);
    console.log('║  ✅  Instalação concluída!                           ║');
    console.log('║  Atalho criado na área de trabalho.                 ║');
    console.log('║  O agente iniciará automaticamente com o Windows.   ║');
    console.log(`╚${LINE}╝\n`);

  } catch (e) {
    console.error('\n  Erro:', e.message || e);
    console.log('\n❌ Instalação falhou. Tente executar como Administrador.\n');
  }

  console.log('Pressione ENTER para fechar...');
  process.stdin.setEncoding('utf8');
  process.stdin.once('data', () => process.exit(0));
  process.stdin.resume();
}

// ─── MODO ABRIR CONFIG ────────────────────────────────────────────────────────
function openConfig() {
  // Verifica se o serviço já está rodando
  const req = http.get({ hostname: '127.0.0.1', port: PORT, path: '/api/status', timeout: 2000 }, r => {
    r.resume();
    // Serviço rodando — abre browser
    spawnSync('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { windowsHide: true });
    process.exit(0);
  });
  req.on('error', () => {
    // Serviço não está rodando — inicia primeiro, depois abre
    const exeRun = path.join(INSTALL_DIR, EXE_NAME);
    const child = spawn(exeRun, ['--service'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    setTimeout(() => {
      spawnSync('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { windowsHide: true });
      process.exit(0);
    }, 2000);
  });
  req.on('timeout', () => { req.destroy(); });
}

// ─── ENTRYPOINT ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--service')) {
  runService();
} else if (args.includes('--config')) {
  openConfig();
} else {
  install();
}
