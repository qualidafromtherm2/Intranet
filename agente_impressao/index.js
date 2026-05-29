'use strict';
/**
 * Agente de Impressão SGF v2.6
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

const AGENT_VERSION = '2.6';
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
const FILE_JOB_PREFIX = '__FILEJOB__:';

// ─── Defaults de configuração ────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  serverUrl:    'https://intranet-30av.onrender.com',
  agentToken:   'sgf-agente-2024',
  printer:      '',
  pcName:       '',          // identificador deste PC na fila (deixe vazio para usar o hostname)
  pollInterval: 5000,
  labelWidth:   110,
  labelHeight:  70,
  darkness:     20,
  speed:        4,
  labelOffsetX: 0,
  labelOffsetY: 0,
  printerConfigs: {},        // config por impressora: { "NomeImpressora": { labelWidth, labelHeight, ... } }
  printerAliases:  {},        // apelidos amigáveis: { "NomeImpressora": "Zebra Expedição" }
};

// Campos que pertencem à configuração de etiqueta (por impressora)
const PRINTER_CFG_FIELDS = ['labelWidth','labelHeight','darkness','speed','labelOffsetX','labelOffsetY'];

// Retorna a config de etiqueta para uma impressora específica,
// fazendo fallback para os valores globais quando não há config salva pra ela.
function getPrinterConfig(cfg, printerName) {
  const name = printerName || cfg.printer || '';
  const saved = (cfg.printerConfigs || {})[name];
  const base  = { labelWidth: cfg.labelWidth, labelHeight: cfg.labelHeight,
                  darkness: cfg.darkness, speed: cfg.speed,
                  labelOffsetX: cfg.labelOffsetX, labelOffsetY: cfg.labelOffsetY };
  return saved ? Object.assign({}, base, saved) : base;
}

// Verifica se o serviço está rodando em localhost:PORT
function pingService() {
  return new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port: PORT, path: '/api/status', timeout: 2000 }, r => {
      resolve(r.statusCode === 200); r.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Object.assign({}, DEFAULT_CONFIG, parsed,
      { printerConfigs: Object.assign({}, DEFAULT_CONFIG.printerConfigs, parsed.printerConfigs || {}),
        printerAliases: Object.assign({}, DEFAULT_CONFIG.printerAliases, parsed.printerAliases || {}) });
  } catch { return Object.assign({}, DEFAULT_CONFIG); }
}

function saveConfig(data) {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  const current = readConfig();
  const merged  = Object.assign({}, current, data);

  // Se tem impressora e campos de etiqueta → salvar também por impressora
  const printerName = data.printer || current.printer || '';
  const hasPrinterFields = PRINTER_CFG_FIELDS.some(k => data[k] !== undefined);
  if (printerName && hasPrinterFields) {
    merged.printerConfigs = Object.assign({}, current.printerConfigs || {});
    const prev = merged.printerConfigs[printerName] || {};
    merged.printerConfigs[printerName] = Object.assign({}, prev,
      Object.fromEntries(PRINTER_CFG_FIELDS.filter(k => data[k] !== undefined).map(k => [k, data[k]])));
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch {}
  console.log(msg);
}

// Injeta configurações do agente no ZPL:
//   ^LH  — Label Home offset (ajuste de margens)
//   ^PW  — Print Width (largura real da etiqueta em dots, sobrescreve valor do servidor)
//   ^LL  — Label Length (altura real da etiqueta em dots, sobrescreve valor do servidor)
function injectLH(zpl, cfg) {
  const DPI = 203;
  const dpm = DPI / 25.4; // ~7.99 dots/mm
  let result = zpl;

  // ── Substituir ^PW e ^LL pelos valores configurados ─────────────────────
  if (cfg.labelWidth && Number(cfg.labelWidth) > 0) {
    const pw = Math.round(Number(cfg.labelWidth) * dpm);
    if (/\^PW\d+/i.test(result)) {
      result = result.replace(/\^PW\d+/gi, `^PW${pw}`);
    } else {
      result = result.replace(/(\^XA)/i, `$1\n^PW${pw}`);
    }
  }
  if (cfg.labelHeight && Number(cfg.labelHeight) > 0) {
    const ll = Math.round(Number(cfg.labelHeight) * dpm);
    if (/\^LL\d+/i.test(result)) {
      result = result.replace(/\^LL\d+/gi, `^LL${ll}`);
    } else {
      result = result.replace(/(\^XA)/i, `$1\n^LL${ll}`);
    }
  }

  // ── Injetar ^LH (offset de origem) ──────────────────────────────────────
  const x = Number(cfg.labelOffsetX) || 0;
  const y = Number(cfg.labelOffsetY) || 0;
  if (x !== 0 || y !== 0) {
    result = result.replace(/(\^XA)/i, `$1\n^LH${x},${y}`);
  }

  return result;
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

function printRawFile(filePath, printerName, cb) {
  const scriptPath = path.join(__dirname, 'imprimir.ps1');
  execFile('powershell.exe',
    ['-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ZplFile', filePath, '-PrinterName', printerName],
    { timeout: 30000 },
    (err) => cb(err || null)
  );
}

function printFileWithAssociatedApp(filePath, printerName, cb) {
  const filePathEsc = String(filePath || '').replaceAll("'", "''");
  const printerNameEsc = String(printerName || '').replaceAll("'", "''");
  const ps1 = [
    "$ErrorActionPreference = 'Stop'",
    "$filePath = '" + filePathEsc + "'",
    "$printerName = '" + printerNameEsc + "'",
    'if (-not (Test-Path -LiteralPath $filePath)) {',
    '  throw "Arquivo temporario nao encontrado: $filePath"',
    '}',
    "$proc = Start-Process -FilePath $filePath -Verb PrintTo -ArgumentList ('\"' + $printerName + '\"') -PassThru",
    'if ($null -ne $proc) {',
    '  $proc.WaitForExit(15000) | Out-Null',
    '  if (-not $proc.HasExited) {',
    '    try { $proc.CloseMainWindow() | Out-Null } catch {}',
    '    Start-Sleep -Milliseconds 800',
    '    if (-not $proc.HasExited) {',
    '      Stop-Process -Id $proc.Id -Force',
    '    }',
    '  }',
    '}',
  ].join('\n');

  const tmp = path.join(os.tmpdir(), 'sgf_file_print_' + Date.now() + '.ps1');
  try {
    fs.writeFileSync(tmp, ps1, 'utf8');
    execFile('powershell.exe',
      ['-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      { timeout: 45000 },
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

function isRawPrintFile(fileName, mimeType) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return ['.zpl', '.epl', '.prn', '.pcl', '.spl'].includes(ext)
    || /application\/(x-)?zpl/i.test(String(mimeType || ''));
}

function parseFileJobPayload(zplPayload) {
  if (typeof zplPayload !== 'string' || !zplPayload.startsWith(FILE_JOB_PREFIX)) return null;
  const parsed = JSON.parse(zplPayload.slice(FILE_JOB_PREFIX.length));
  if (!parsed || typeof parsed.contentBase64 !== 'string') {
    throw new Error('Payload de arquivo inválido');
  }
  return parsed;
}

function printQueuedFile(jobPayload, printerName, cb) {
  const fileName = String(jobPayload?.fileName || 'arquivo').trim() || 'arquivo';
  const mimeType = String(jobPayload?.mimeType || 'application/octet-stream').trim();
  const ext = (() => {
    const value = path.extname(fileName).toLowerCase();
    return /^\.[a-z0-9]{1,10}$/.test(value) ? value : '';
  })();
  const tempFile = path.join(
    os.tmpdir(),
    'sgf_print_job_' + Date.now() + '_' + Math.random().toString(36).slice(2) + ext
  );

  try {
    fs.writeFileSync(tempFile, Buffer.from(jobPayload.contentBase64, 'base64'));
  } catch (err) {
    return cb(err);
  }

  const finish = (err) => {
    setTimeout(() => {
      try { fs.unlinkSync(tempFile); } catch {}
    }, err ? 0 : 30000);
    cb(err || null);
  };

  if (isRawPrintFile(fileName, mimeType)) {
    return printRawFile(tempFile, printerName, finish);
  }
  return printFileWithAssociatedApp(tempFile, printerName, finish);
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

  const ox = Number(cfg.labelOffsetX) || 0;
  const oy = Number(cfg.labelOffsetY) || 0;

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
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:1100px}
  @media(max-width:700px){.grid{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px}
  .card h2{font-size:.9rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px;display:flex;align-items:center;gap:8px}
  .field{margin-bottom:14px}
  label{display:block;font-size:.8rem;color:var(--muted);margin-bottom:5px;font-weight:500}
  input,select{width:100%;background:#0f0e17;border:1px solid var(--border);border-radius:7px;padding:8px 12px;
    color:var(--text);font-size:.9rem;outline:none;transition:border .2s}
  input:focus,select:focus{border-color:var(--accent)}
  input[type=range]{padding:4px 0;cursor:pointer;accent-color:var(--accent)}
  select option{background:#1a1929}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;border:none;
    cursor:pointer;font-size:.88rem;font-weight:600;transition:all .2s}
  .btn-primary{background:var(--accent);color:#fff}
  .btn-primary:hover{background:var(--accent2)}
  .btn-secondary{background:transparent;color:var(--muted);border:1px solid var(--border)}
  .btn-secondary:hover{border-color:var(--accent);color:var(--text)}
  .btn-green{background:transparent;color:var(--green);border:1px solid #166534}
  .btn-green:hover{background:#166534;color:#fff}
  .btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
  .status-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:.88rem}
  .status-row:last-child{border:none}
  .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .dot-green{background:var(--green)}
  .dot-red{background:var(--red)}
  .dot-yellow{background:var(--yellow);animation:pulse 1.5s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .toast{position:fixed;bottom:24px;right:24px;background:#1e1b2e;border:1px solid var(--accent);
    border-radius:10px;padding:12px 20px;color:var(--text);font-size:.88rem;font-weight:500;
    opacity:0;transform:translateY(10px);transition:all .3s;pointer-events:none;z-index:999}
  .toast.show{opacity:1;transform:translateY(0)}
  .log-box{background:#0a0a12;border:1px solid var(--border);border-radius:8px;padding:10px 12px;
    font-family:monospace;font-size:.77rem;color:var(--muted);height:120px;overflow-y:auto;white-space:pre-wrap}

  /* Preview de etiqueta */
  .preview-wrap{position:relative;background:#111;border:1px solid var(--border);border-radius:8px;
    overflow:hidden;display:flex;align-items:center;justify-content:center;min-height:140px;cursor:move;}
  .preview-wrap img{display:block;max-width:100%;height:auto;transition:opacity .3s}
  .preview-placeholder{color:var(--muted);font-size:.82rem;text-align:center;padding:20px}
  .drag-handle{position:absolute;width:18px;height:18px;border-radius:50%;background:var(--accent);
    border:2px solid #fff;cursor:grab;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10;
    box-shadow:0 0 0 3px rgba(124,58,237,.35)}
  .drag-handle:active{cursor:grabbing}
  .drag-handle:hover{background:var(--accent2)}
  .offset-display{font-size:.78rem;color:var(--muted);text-align:center;margin-top:6px}

  /* Histórico */
  .hist-row{padding:5px 8px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;font-size:.82rem}
  .hist-row:last-child{border:none}
</style>
</head>
<body>
<h1>🖨️ Agente de Impressão SGF <span class="badge">v${AGENT_VERSION}</span></h1>
<p class="subtitle">Configuração e monitoramento do agente — monitora a fila e imprime automaticamente.</p>

<div class="grid">
  <!-- ══ COLUNA 1: Configuração ═══════════════════════════════════════════ -->
  <div>
    <div class="card">
      <h2>⚙️ Configuração de Impressão</h2>
      <div id="printerCfgBanner" style="background:rgba(124,58,237,.15);border:1px solid var(--accent);border-radius:6px;padding:7px 12px;margin-bottom:12px;font-size:.8rem;display:${cfg.printer ? 'flex' : 'none'};align-items:center;gap:8px">
        <span style="color:var(--accent)">&#128427;</span>
        <span>Configurando: <b id="printerCfgLabel">${cfg.printer || ''}</b></span>
        <span style="margin-left:auto;color:var(--muted);font-size:.73rem">Salvar aplica apenas a esta impressora</span>
      </div>
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
            <label>Largura da etiqueta (mm) <span style="color:var(--muted);font-size:.78em">(define ^PW na impressão)</span></label>
            <input type="number" name="labelWidth" value="${cfg.labelWidth}" min="20" max="300">
          </div>
          <div class="field">
            <label>Altura da etiqueta (mm) <span style="color:var(--muted);font-size:.78em">(define ^LL na impressão)</span></label>
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

        <!-- Offset de margem -->
        <div style="border-top:1px solid var(--border);margin:14px 0 10px;padding-top:12px">
          <label style="font-weight:600;color:var(--text);margin-bottom:10px;display:block">📐 Ajuste de margem ^LH <span style="color:var(--muted);font-size:.78em">(offset de origem, em dots)</span></label>
          <div class="field">
            <label>Offset horizontal — <b id="offsetXDisplay">${ox}</b> dots</label>
            <input type="range" id="sliderOffsetX" name="labelOffsetX" value="${ox}" min="-200" max="200" step="1" oninput="syncOffset('X',this.value)">
            <input type="number" id="inputOffsetX" value="${ox}" min="-200" max="200" style="margin-top:5px" oninput="syncOffset('X',this.value)">
          </div>
          <div class="field">
            <label>Offset vertical — <b id="offsetYDisplay">${oy}</b> dots</label>
            <input type="range" id="sliderOffsetY" name="labelOffsetY" value="${oy}" min="-200" max="200" step="1" oninput="syncOffset('Y',this.value)">
            <input type="number" id="inputOffsetY" value="${oy}" min="-200" max="200" style="margin-top:5px" oninput="syncOffset('Y',this.value)">
          </div>
        </div>

        <div class="btn-row">
          <button type="submit" class="btn btn-primary">💾 Salvar configuração</button>
          <button type="button" class="btn btn-secondary" onclick="refreshPreview()">👁 Preview</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>🔗 Conexão com Servidor</h2>
      <form id="formServer">
        <div class="field">
          <label>URL do servidor</label>
          <input type="url" name="serverUrl" value="${cfg.serverUrl}">
        </div>
        <div class="field">
          <label>Nome deste PC <span style="color:var(--muted);font-size:.78em">(identifica este agente na fila — deve ser único por máquina)</span></label>
          <input type="text" name="pcName" value="${cfg.pcName || os.hostname()}" placeholder="${os.hostname()}">
        </div>
        <div class="field">
          <label>Token do agente</label>
          <input type="text" name="agentToken" value="${cfg.agentToken}">
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-secondary">Salvar conexão</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>🏷️ Apelidos das Impressoras</h2>
      <p style="color:var(--muted);font-size:.82rem;margin-bottom:14px">Defina nomes amigáveis para cada impressora. O apelido aparece no intranet para todos os usuários.</p>
      ${printers.length === 0
        ? '<p style="color:var(--muted);font-size:.82rem">Nenhuma impressora detectada. Atualize a página após inicializar o serviço.</p>'
        : `<div id="aliasesList">
          ${printers.map(p => {
            const alias = (cfg.printerAliases || {})[p] || '';
            return `<div class="field" style="margin-bottom:10px">
              <label style="font-size:.8rem;color:var(--muted)">${p.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</label>
              <input type="text" class="alias-input" data-printer="${p.replace(/"/g,'&quot;')}"
                placeholder="Apelido amigável (ex: Zebra Expedição)"
                value="${alias.replace(/"/g,'&quot;')}" maxlength="50"
                style="width:100%;padding:7px 10px;background:#1a1929;color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:.85rem;outline:none">
            </div>`;
          }).join('')}
        </div>
        <div class="btn-row"><button class="btn btn-secondary" onclick="saveAliases()">💾 Salvar apelidos</button></div>`
      }
    </div>
  </div>

  <!-- ══ COLUNA 2: Status / Preview / Histórico / Fila / Log ═══════════ -->
  <div>
    <!-- Status -->
    <div class="card">
      <h2>📊 Status do Agente</h2>
      <div class="status-row">
        <div class="dot dot-green"></div>
        <span><b>Serviço:</b> Rodando em localhost:${PORT}</span>
      </div>
      <div class="status-row">
        <div class="dot ${status.polling ? 'dot-green' : 'dot-red'}"></div>
        <span><b>Polling:</b> ${status.polling ? 'Ativo' : 'Pausado'}</span>
      </div>
      <div class="status-row" id="rowLastPrint">
        <div class="dot dot-${status.lastPrintOk === null ? 'yellow' : status.lastPrintOk ? 'green' : 'red'}"></div>
        <span><b>Última impressão:</b> ${status.lastPrint || 'Nenhuma ainda'}</span>
      </div>
      <div class="status-row">
        <span><b>Impressora ativa:</b> ${cfg.printer || '<span style="color:var(--yellow)">Não configurada</span>'}</span>
      </div>
      <div class="status-row">
        <span><b>Jobs impressos:</b> <span id="cntPrinted">${status.totalPrinted}</span></span>
        <span style="margin-left:auto;color:var(--red)"><b>Erros:</b> <span id="cntErrors">${status.totalErrors}</span></span>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="location.reload()">🔄 Atualizar</button>
        <button class="btn btn-secondary" onclick="testPrint()">🧪 Teste</button>
        <button class="btn btn-green" id="btnReprint" onclick="reprintLast()">🔁 Reimprimir última</button>
      </div>
    </div>

    <!-- Preview da última etiqueta -->
    <div class="card">
      <h2>🏷️ Preview da última etiqueta</h2>
      <div class="preview-wrap" id="previewContainer">
        <img id="labelPreviewImg" src="" alt="" style="display:none;max-width:100%;height:auto">
        <div class="preview-placeholder" id="previewPlaceholder">
          Nenhuma etiqueta impressa ainda.<br>
          <span style="font-size:.75rem">Após imprimir, o preview aparece aqui.</span>
        </div>
        <div class="drag-handle" id="dragHandle" title="Arraste para ajustar o offset"></div>
      </div>
      <div class="offset-display" id="offsetDisplay">
        Offset: X=<span id="oxInfo">${ox}</span> Y=<span id="oyInfo">${oy}</span> dots
        &nbsp;·&nbsp;
        <span style="font-size:.72rem;color:#555">Arraste o ponto roxo para ajustar</span>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-secondary" style="font-size:.8rem" onclick="refreshPreview()">🔄 Atualizar preview</button>
        <span id="previewStatus" style="font-size:.75rem;color:var(--muted);align-self:center"></span>
      </div>
    </div>

    <!-- Histórico de hoje -->
    <div class="card">
      <h2>📅 Impressões de hoje</h2>
      <div id="historyBox" style="max-height:200px;overflow-y:auto">
        <div style="color:var(--muted);font-size:.82rem;padding:6px 0">Carregando...</div>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-secondary" style="font-size:.78rem" onclick="refreshHistory()">🔄 Atualizar</button>
        <span id="histCount" style="font-size:.75rem;color:var(--muted);align-self:center"></span>
      </div>
    </div>

    <!-- Fila pendente -->
    <div class="card">
      <h2>📋 Fila de impressão pendente</h2>
      <div id="queueBox" style="font-size:.85rem;color:var(--muted);min-height:60px">Aguardando polling…</div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-secondary" style="font-size:.78rem" onclick="reloadQueue()">🔄 Atualizar agora</button>
        <span id="queueAt" style="font-size:.72rem;color:var(--muted);margin-left:auto"></span>
      </div>
    </div>

    <!-- Log -->
    <div class="card">
      <h2>📋 Log recente</h2>
      <div class="log-box" id="logBox">${status.recentLog || 'Nenhum log ainda.'}</div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-secondary" style="font-size:.78rem" onclick="reloadLog()">🔄 Recarregar log</button>
      </div>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
// ── Utilitários ───────────────────────────────────────────────────────────────
function toast(msg, ok=true) {
  const t = document.getElementById('toast');
  t.textContent = (ok ? '✅ ' : '❌ ') + msg;
  t.style.borderColor = ok ? 'var(--green)' : 'var(--red)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Salvar Config ─────────────────────────────────────────────────────────────
document.getElementById('formConfig').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  ['labelWidth','labelHeight','darkness','speed','pollInterval','labelOffsetX','labelOffsetY'].forEach(k => data[k] = Number(data[k]));
  const r = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  const j = await r.json();
  const printerName = data.printer || 'impressora';
  toast(j.ok ? ('Configuração de "' + printerName + '" salva!') : (j.error || 'Erro'), j.ok);
  if (j.ok) { document.getElementById('oxInfo').textContent = data.labelOffsetX; document.getElementById('oyInfo').textContent = data.labelOffsetY; setTimeout(refreshPreview, 400); }
});

// ── Trocar impressora → carregar config específica dela ───────────────────────
document.getElementById('selPrinter').addEventListener('change', async function () {
  const name = this.value;
  const banner = document.getElementById('printerCfgBanner');
  const label  = document.getElementById('printerCfgLabel');
  if (banner) { banner.style.display = name ? 'flex' : 'none'; }
  if (label)  { label.textContent = name; }
  if (!name) return;
  const r = await fetch('/api/printer-config?name=' + encodeURIComponent(name)).catch(() => null);
  if (!r || !r.ok) return;
  const j = await r.json();
  if (!j.ok) return;
  const c = j.config;
  document.querySelector('[name=labelWidth]').value  = c.labelWidth;
  document.querySelector('[name=labelHeight]').value = c.labelHeight;
  document.querySelector('[name=darkness]').value    = c.darkness;
  document.querySelector('[name=speed]').value       = c.speed;
  syncOffset('X', c.labelOffsetX || 0);
  syncOffset('Y', c.labelOffsetY || 0);
  clearTimeout(window._prevTimer);
  window._prevTimer = setTimeout(refreshPreview, 700);
});

document.getElementById('formServer').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  const r = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  const j = await r.json();
  toast(j.ok ? 'Conexão salva!' : (j.error || 'Erro'), j.ok);
});

// ── Salvar apelidos das impressoras ───────────────────────────────────────────
async function saveAliases() {
  const aliases = {};
  document.querySelectorAll('.alias-input').forEach(inp => {
    const p = inp.dataset.printer;
    if (p !== undefined) aliases[p] = inp.value.trim();
  });
  const r = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ printerAliases: aliases }) });
  const j = await r.json();
  toast(j.ok ? 'Apelidos salvos! O intranet vai exibi-los no próximo heartbeat.' : (j.error || 'Erro'), j.ok);
}

// ── Offset sliders + inputs sincronizados ─────────────────────────────────────
function syncOffset(axis, val) {
  val = parseInt(val) || 0;
  document.getElementById('slider' + 'Offset' + axis).value = val;
  document.getElementById('input'  + 'Offset' + axis).value = val;
  document.getElementById('offset' + axis + 'Display').textContent = val;
  document.getElementById(axis === 'X' ? 'oxInfo' : 'oyInfo').textContent = val;
  updateHandlePosition();
  clearTimeout(window._prevTimer);
  window._prevTimer = setTimeout(refreshPreview, 700);
}

// ── Preview da etiqueta ───────────────────────────────────────────────────────
async function refreshPreview() {
  const img = document.getElementById('labelPreviewImg');
  const ph  = document.getElementById('previewPlaceholder');
  const st  = document.getElementById('previewStatus');
  if (!img) return;
  if (st) st.textContent = 'Carregando preview...';
  const src = '/api/label-preview?t=' + Date.now();
  // Verifica se tem etiqueta
  const probe = await fetch(src).catch(() => null);
  if (!probe || !probe.ok || probe.status === 404) {
    img.style.display = 'none';
    if (ph) ph.style.display = '';
    if (st) st.textContent = 'Nenhuma etiqueta disponível ainda.';
    return;
  }
  img.src = src;
  img.style.display = 'block';
  if (ph) ph.style.display = 'none';
  img.onload = () => { img.style.opacity = '1'; if (st) st.textContent = ''; };
  img.onerror = () => { img.style.opacity = '.3'; if (st) st.textContent = 'Erro ao gerar preview (sem internet?).'; };
}

// ── Posicionamento do drag-handle ─────────────────────────────────────────────
function updateHandlePosition() {
  const handle = document.getElementById('dragHandle');
  const container = document.getElementById('previewContainer');
  if (!handle || !container) return;
  const ox = parseInt(document.getElementById('inputOffsetX').value) || 0;
  const oy = parseInt(document.getElementById('inputOffsetY').value) || 0;
  const labelWidthMm = parseFloat(document.querySelector('[name=labelWidth]').value) || 100;
  const dotsPerPx = (labelWidthMm * 8) / (container.offsetWidth || 280);
  const pxX = Math.round(ox / (dotsPerPx || 1));
  const pxY = Math.round(oy / (dotsPerPx || 1));
  // Centralizar handle + deslocar pelo offset
  const cx = container.offsetWidth  / 2;
  const cy = container.offsetHeight / 2;
  handle.style.left = Math.max(6, Math.min(container.offsetWidth  - 6, cx + pxX)) + 'px';
  handle.style.top  = Math.max(6, Math.min(container.offsetHeight - 6, cy + pxY)) + 'px';
  handle.style.transform = 'translate(-50%,-50%)';
}

// ── Drag do handle ────────────────────────────────────────────────────────────
(function() {
  let active = false, sx, sy, sox, soy;
  const h = document.getElementById('dragHandle');
  const c = document.getElementById('previewContainer');
  if (!h || !c) return;

  h.addEventListener('mousedown', e => {
    active = true;
    sx = e.clientX; sy = e.clientY;
    sox = parseInt(document.getElementById('inputOffsetX').value) || 0;
    soy = parseInt(document.getElementById('inputOffsetY').value) || 0;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!active) return;
    const labelW = parseFloat(document.querySelector('[name=labelWidth]').value) || 100;
    const dpp = (labelW * 8) / (c.offsetWidth || 280);
    const dx = Math.round((e.clientX - sx) * dpp);
    const dy = Math.round((e.clientY - sy) * dpp);
    const nx = Math.max(-200, Math.min(200, sox + dx));
    const ny = Math.max(-200, Math.min(200, soy + dy));
    syncOffset('X', nx);
    syncOffset('Y', ny);
  });
  document.addEventListener('mouseup', () => {
    if (active) { active = false; }
  });
  // Touch support
  h.addEventListener('touchstart', e => {
    active = true;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    sox = parseInt(document.getElementById('inputOffsetX').value) || 0;
    soy = parseInt(document.getElementById('inputOffsetY').value) || 0;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (!active) return;
    const labelW = parseFloat(document.querySelector('[name=labelWidth]').value) || 100;
    const dpp = (labelW * 8) / (c.offsetWidth || 280);
    const dx = Math.round((e.touches[0].clientX - sx) * dpp);
    const dy = Math.round((e.touches[0].clientY - sy) * dpp);
    syncOffset('X', Math.max(-200, Math.min(200, sox + dx)));
    syncOffset('Y', Math.max(-200, Math.min(200, soy + dy)));
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', () => { active = false; });
})();

// ── Reimprimir última ─────────────────────────────────────────────────────────
async function reprintLast() {
  const btn = document.getElementById('btnReprint');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Reimprimindo...'; }
  try {
    const r = await fetch('/api/reprint-last', { method: 'POST' });
    const j = await r.json();
    toast(j.ok ? 'Última etiqueta reimpressa com sucesso!' : (j.error || 'Erro'), j.ok);
    if (j.ok) { setTimeout(refreshHistory, 500); }
  } catch { toast('Erro ao reimprimir', false); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '🔁 Reimprimir última'; } }
}

// ── Teste de impressão ────────────────────────────────────────────────────────
async function testPrint() {
  const r = await fetch('/api/test-print', { method:'POST' });
  const j = await r.json();
  toast(j.ok ? 'Etiqueta de teste enviada!' : (j.error || 'Erro ao testar'), j.ok);
}

// ── Log ───────────────────────────────────────────────────────────────────────
async function reloadLog() {
  const r = await fetch('/api/log');
  const j = await r.json();
  const box = document.getElementById('logBox');
  box.textContent = j.log || '';
  box.scrollTop = 999999;
}

// ── Fila pendente ─────────────────────────────────────────────────────────────
async function reloadQueue() {
  try {
    const r = await fetch('/api/queue');
    const j = await r.json();
    const box = document.getElementById('queueBox');
    const at  = document.getElementById('queueAt');
    const q   = j.queue || [];
    if (!q.length) {
      box.innerHTML = '<div style="color:var(--green);padding:8px 0"><b>✓ Fila vazia</b> — nenhuma etiqueta pendente.</div>';
    } else {
      box.innerHTML = '<div style="color:var(--yellow);margin-bottom:8px"><b>' + q.length + ' job(s) aguardando:</b></div>' +
        '<div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:6px">' +
        q.map(function(jj){
          return '<div style="padding:6px 10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">' +
            '<span>Job <b>#' + jj.id + '</b></span>' +
            '<span style="color:var(--muted)">' + (jj.quantidade || 1) + ' etiqueta(s)</span></div>';
        }).join('') + '</div>';
    }
    if (j.lastQueueAt) at.textContent = 'Última consulta: ' + new Date(j.lastQueueAt).toLocaleTimeString('pt-BR');
  } catch {}
}

// ── Histórico do dia ──────────────────────────────────────────────────────────
async function refreshHistory() {
  try {
    const r = await fetch('/api/history');
    const j = await r.json();
    const box   = document.getElementById('historyBox');
    const count = document.getElementById('histCount');
    const prints = j.prints || [];
    if (count) count.textContent = prints.length + ' impressão(ões) hoje';
    if (!prints.length) {
      box.innerHTML = '<div style="color:var(--muted);font-size:.82rem;padding:6px 0">Nenhuma etiqueta impressa hoje.</div>';
      return;
    }
    box.innerHTML = prints.slice().reverse().slice(0, 30).map(p =>
      '<div class="hist-row">' +
        '<span style="color:' + (p.ok ? 'var(--green)' : 'var(--red)') + ';font-size:.9rem">' + (p.ok ? '✓' : '✗') + '</span>' +
        '<span style="color:var(--muted)">' + p.time + '</span>' +
        '<span>Job <b>#' + p.jobId + '</b></span>' +
        '<span style="margin-left:auto;color:var(--muted)">' + p.quantidade + ' etq.</span>' +
      '</div>'
    ).join('');
  } catch {}
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────
setInterval(async () => {
  try {
    const r = await fetch('/api/status');
    const j = await r.json();
    if (j.lastPrint) {
      const row = document.getElementById('rowLastPrint');
      if (row) row.querySelector('span').innerHTML = '<b>Última impressão:</b> ' + j.lastPrint;
    }
    const cp = document.getElementById('cntPrinted'); if (cp) cp.textContent = j.totalPrinted;
    const ce = document.getElementById('cntErrors');  if (ce) ce.textContent = j.totalErrors;
  } catch {}
}, 8000);

// Init
reloadQueue();
refreshHistory();
refreshPreview();
updateHandlePosition();
setInterval(reloadQueue, 5000);
setInterval(refreshHistory, 15000);
</script>
</body>
</html>`;
}


// ─── MODO SERVIÇO ─────────────────────────────────────────────────────────────
function runService() {
  log(`=== Agente SGF v${AGENT_VERSION} iniciando (modo serviço) ===`);
  log(`INSTALL_DIR: ${INSTALL_DIR}`);

  // Estado em memória (declarado antes do heartbeat para evitar TDZ)
  const state = {
    polling: false,
    lastPrint: null,
    lastPrintOk: null,
    totalPrinted: 0,
    totalErrors: 0,
    recentLog: '',
    printers: [],
    lastQueue: [],          // última fila vista no polling
    lastQueueAt: null,      // timestamp da última consulta
    lastZpl: null,          // ZPL do último job impresso
    lastJobId: null,        // id do último job impresso
    todayPrints: [],        // histórico do dia
    todayDate: new Date().toDateString(),
  };

  // ─── Heartbeat ─────────────────────────────────────────────────────────────
  function sendHeartbeat() {
    const c = readConfig();
    const pc = c.pcName || os.hostname();
    apiRequest('POST', '/api/etiquetas/agente/heartbeat',
      { printer: c.printer || '', version: AGENT_VERSION, host: os.hostname(),
        pcName: pc, printers: state.printers || [],
        printerAliases: c.printerAliases || {},
        capabilities: { filePrint: true } },
      c.agentToken, () => {});
  }
  sendHeartbeat();                          // imediato ao iniciar
  setInterval(sendHeartbeat, 30000);        // a cada 30s

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
      const extraHdr = {
        'x-agent-printer':  cfg.printer || '',
        'x-agent-version':  AGENT_VERSION,
        'x-agent-host':     os.hostname(),
        'x-agent-pcname':   cfg.pcName || os.hostname(),  // filtra jobs destinados a este PC
      };
      apiRequest('GET', '/api/etiquetas/fila/pendentes', null, cfg.agentToken, (err, status, body) => {
        if (err) {
          log(`[poll] Erro de conexão: ${err.message}`);
          return resolve();
        }
        if (status === 401) { log('[poll] Token inválido!'); return resolve(); }
        state.lastQueueAt = Date.now();
        state.lastQueue = Array.isArray(body?.jobs) ? body.jobs.map(j => ({
          id: j.id, quantidade: j.quantidade, criadaEm: j.criadaEm || j.criada_em || null,
        })) : [];
        if (!body?.jobs?.length) return resolve();

        log(`[poll] ${body.jobs.length} job(s) na fila`);
        let pending = body.jobs.length;

        for (const job of body.jobs) {
          const targetPrinter = job.impressora || cfg.printer;
          let fileJob = null;
          let historyLabel = `${job.quantidade} etiqueta(s)`;
          let executePrint;

          try {
            fileJob = parseFileJobPayload(job.zpl);
            if (fileJob) {
              historyLabel = fileJob.fileName || 'arquivo';
              log(`[poll] Imprimindo job #${job.id} (arquivo: ${historyLabel}) em "${targetPrinter}"`);
              executePrint = (done) => printQueuedFile(fileJob, targetPrinter, done);
            } else {
              log(`[poll] Imprimindo job #${job.id} (${job.quantidade} etiqueta(s)) em "${targetPrinter}"`);
              const zplToUse = injectLH(job.zpl, getPrinterConfig(cfg, targetPrinter));
              executePrint = (done) => printZpl(zplToUse, targetPrinter, done);
            }
          } catch (prepErr) {
            const erroMsg = prepErr?.message || 'Falha ao preparar job';
            state.totalErrors++;
            state.lastPrint = new Date().toLocaleString('pt-BR');
            state.lastPrintOk = false;
            log(`[poll] Job #${job.id} → ERRO: ${erroMsg}`);
            apiRequest('POST', '/api/etiquetas/fila/confirmar', {
              id: job.id, success: false, error: erroMsg,
              agent_host: os.hostname(),
            }, cfg.agentToken, () => {});
            pending--;
            if (pending === 0) resolve();
            continue;
          }

          executePrint((err2) => {
            const ok = !err2;
            const erroMsg = err2?.message || null;
            // Atualiza histórico do dia
            const today = new Date().toDateString();
            if (state.todayDate !== today) { state.todayPrints = []; state.todayDate = today; }
            state.todayPrints.push({ time: new Date().toLocaleTimeString('pt-BR'), jobId: job.id, quantidade: historyLabel, ok });
            if (ok) {
              state.totalPrinted++;
              state.lastPrint = new Date().toLocaleString('pt-BR');
              state.lastPrintOk = true;
              if (!fileJob) {
                state.lastZpl = job.zpl;   // guarda ZPL original (sem LH) para reprint
                state.lastJobId = job.id;
              }
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

    // GET / — Config UI (aceita querystring e hash)
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?') || req.url.startsWith('/#'))) {
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

    // GET /api/queue — fila pendente atual (último polling)
    if (req.method === 'GET' && req.url === '/api/queue') {
      return respJson(res, 200, {
        ok: true,
        queue: state.lastQueue || [],
        lastQueueAt: state.lastQueueAt ? new Date(state.lastQueueAt).toISOString() : null,
      });
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
        version: AGENT_VERSION,
      });
    }

    // GET /api/version
    if (req.method === 'GET' && req.url === '/api/version') {
      return respJson(res, 200, { ok: true, version: AGENT_VERSION });
    }

    // GET /api/config
    if (req.method === 'GET' && req.url === '/api/config') {      return respJson(res, 200, readConfig());
    }

    // GET /api/printer-config?name=NomeImpressora — retorna config de etiqueta por impressora
    if (req.method === 'GET' && req.url.startsWith('/api/printer-config')) {
      const urlObj = new URL('http://localhost' + req.url);
      const name = urlObj.searchParams.get('name') || '';
      const cfg  = readConfig();
      return respJson(res, 200, { ok: true, config: getPrinterConfig(cfg, name) });
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

    // POST /api/reprint-last — reimprime o último ZPL na impressora configurada
    if (req.method === 'POST' && req.url === '/api/reprint-last') {
      const cfg = readConfig();
      if (!cfg.printer) return respJson(res, 400, { error: 'Nenhuma impressora configurada' });
      if (!state.lastZpl) return respJson(res, 404, { error: 'Nenhuma etiqueta na memória para reimprimir' });
      const pcfgReprint = getPrinterConfig(cfg, cfg.printer);
      const zplToUse = injectLH(state.lastZpl, pcfgReprint);
      printZpl(zplToUse, cfg.printer, (err2) => {
        if (err2) return respJson(res, 500, { error: err2.message });
        log(`[reprint] Última etiqueta (job #${state.lastJobId}) reimpressa em "${cfg.printer}"`);
        const today = new Date().toDateString();
        if (state.todayDate !== today) { state.todayPrints = []; state.todayDate = today; }
        state.todayPrints.push({ time: new Date().toLocaleTimeString('pt-BR'), jobId: state.lastJobId, quantidade: '(reimpressão)', ok: true });
        respJson(res, 200, { ok: true });
      });
      return;
    }

    // GET /api/history — histórico de impressões do dia
    if (req.method === 'GET' && req.url === '/api/history') {
      const today = new Date().toDateString();
      if (state.todayDate !== today) { state.todayPrints = []; state.todayDate = today; }
      return respJson(res, 200, { ok: true, prints: state.todayPrints, date: state.todayDate });
    }

    // GET /api/label-preview — proxy para Labelary (ZPL → PNG da última etiqueta)
    if (req.method === 'GET' && req.url.startsWith('/api/label-preview')) {
      const cfg = readConfig();
      const zpl = state.lastZpl;
      if (!zpl) {
        // Retorna placeholder 1x1 transparente
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('no-label');
      }
      const pcfgPrev = getPrinterConfig(cfg, cfg.printer);
      const wIn = (pcfgPrev.labelWidth  / 25.4).toFixed(2);
      const hIn = (pcfgPrev.labelHeight / 25.4).toFixed(2);
      const zplToPreview = injectLH(zpl, pcfgPrev);
      const postReq = http.request({
        hostname: 'api.labelary.com',
        path: `/v1/printers/8dpmm/labels/${wIn}x${hIn}/0/`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'image/png',
          'Content-Length': Buffer.byteLength(zplToPreview),
        },
        timeout: 12000,
      }, (lr) => {
        res.writeHead(lr.statusCode || 200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
        lr.pipe(res);
      });
      postReq.on('error', (e) => {
        if (!res.headersSent) { res.writeHead(502); res.end('Labelary error: ' + e.message); }
      });
      postReq.write(zplToPreview);
      postReq.end();
      return;
    }

    // Catch-all: GET desconhecido → redireciona para a UI
    if (req.method === 'GET') {
      res.writeHead(302, { Location: '/' });
      return res.end();
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
  console.log('║  Agente de Impressão SGF v2.6 — Instalador          ║');
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
    // Mata por nome (todas as variações comuns)
    for (const name of ['agente-impressao.exe', 'agente-impressao-setup.exe', 'agente-impressao-setup (1).exe', 'agente-impressao-setup (2).exe', 'agente-impressao-setup (3).exe', 'agente-impressao-setup (4).exe']) {
      spawnSync('taskkill', ['/IM', name, '/F', '/T'], { encoding: 'utf8', windowsHide: true });
    }
    // Mata quem estiver escutando na porta 9200 (qualquer processo)
    try {
      const ps = `$ErrorActionPreference='SilentlyContinue'; (Get-NetTCPConnection -LocalPort 9200 -State Listen).OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`;
      spawnSync('powershell.exe', ['-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    } catch {}
    await new Promise(r => setTimeout(r, 1800));
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

    // 7. Inicia o serviço agora — tenta via schtasks /run (mais confiável, usa a tarefa já registrada)
    step('Iniciando agente em background');
    try {
      const runTask = spawnSync('schtasks', ['/run', '/tn', TASK_NAME], { encoding: 'utf8', windowsHide: true });
      if (runTask.status !== 0) {
        // Fallback: PowerShell Start-Process (caso schtasks falhe)
        spawnSync('powershell.exe',
          ['-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ps1Path],
          { encoding: 'utf8', windowsHide: true });
      }
      ok();
    } catch (spawnErr) {
      console.log(`AVISO: ${spawnErr.message}`);
    }

    // Aguarda serviço iniciar — tenta por até 15s (poll a cada 1s)
    step('Verificando serviço em localhost:' + PORT);
    let serviceOk = false;
    for (let _i = 0; _i < 15 && !serviceOk; _i++) {
      await new Promise(res => setTimeout(res, 1000));
      serviceOk = await pingService();
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
async function openConfig() {
  // Verifica se o serviço já está rodando
  let serviceOk = await pingService();

  if (!serviceOk) {
    // Tenta disparar via tarefa agendada (método mais confiável)
    spawnSync('schtasks', ['/run', '/tn', TASK_NAME], { encoding: 'utf8', windowsHide: true });

    // Fallback: spawn direto com --service
    const exeRun = path.join(INSTALL_DIR, EXE_NAME);
    if (fs.existsSync(exeRun)) {
      const child = spawn(exeRun, ['--service'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    }

    // Aguarda serviço iniciar (até 15s, poll a cada 1s)
    for (let i = 0; i < 15 && !serviceOk; i++) {
      await new Promise(r => setTimeout(r, 1000));
      serviceOk = await pingService();
    }

    if (!serviceOk) {
      // Serviço não subiu — abre janela de prompt orientando o usuário
      const SEP = '═'.repeat(62);
      console.log(`\n╔${SEP}╗`);
      console.log('║  ⚠️  Agente não está respondendo em localhost:' + PORT + '           ║');
      console.log(`╠${SEP}╣`);
      console.log('║  Possíveis causas:                                            ║');
      console.log('║  1. Windows Defender bloqueou o início automático             ║');
      console.log('║  2. A tarefa agendada não foi criada (execute o              ║');
      console.log('║     instalador como Administrador)                            ║');
      console.log(`╠${SEP}╣`);
      console.log('║  Solução rápida:                                              ║');
      console.log('║  1. Abra o Agendador de Tarefas (taskschd.msc)               ║');
      console.log(`║  2. Localize "${TASK_NAME.padEnd(47)}║`);
      console.log('║  3. Clique com botão direito → Executar                       ║');
      console.log('║  4. Em seguida clique novamente no atalho                     ║');
      console.log(`╚${SEP}╝\n`);
      console.log('Pressione ENTER para fechar...');
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', () => process.exit(1));
      process.stdin.resume();
      return;
    }
  }

  spawnSync('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { windowsHide: true });
  process.exit(0);
}

// ─── ENTRYPOINT ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--service')) {
  runService();
} else if (args.includes('--config')) {
  openConfig().catch(e => { console.error(e); process.exit(1); });
} else {
  install();
}
