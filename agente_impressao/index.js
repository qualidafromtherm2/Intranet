'use strict';
/**
 * Agente de Impressão SGF — Instalador + Serviço
 *
 * Quando executado pelo usuário (duplo-clique / primeira vez):
 *   → Instala em %APPDATA%\AgenteImpressaoSGF\
 *   → Configura inicialização automática com o Windows
 *   → Inicia o serviço imediatamente
 *
 * Quando iniciado automaticamente pelo Windows (--service):
 *   → Roda HTTP server em localhost:9200
 */
const http        = require('http');
const { exec, execFile } = require('child_process');
const { spawn }   = require('child_process');
const fs          = require('fs');
const os          = require('os');
const path        = require('path');

const PORT        = 9200;
const TASK_NAME   = 'AgenteImpressaoSGF';
const EXE_NAME    = 'agente-impressao.exe';
const SERVICE_ARG = '--service';

const INSTALL_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'AgenteImpressaoSGF'
);

// ─── PS1 embutido (winspool.Drv raw ZPL print) ───────────────────────────────
const PS1_CONTENT = [
  'param([Parameter(Mandatory)][string]$ZplFile,[Parameter(Mandatory)][string]$PrinterName)',
  '$ErrorActionPreference = \'Stop\'',
  '$bytes = [IO.File]::ReadAllBytes($ZplFile)',
  'Add-Type -TypeDefinition @\'',
  'using System; using System.Runtime.InteropServices;',
  'public class ZebraRaw {',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]',
  '  public class DocInfo { public int cbSize = 16; public string pDocName; public string pOutputFile; public string pDataType; }',
  '  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", CharSet = CharSet.Ansi, SetLastError = true)]',
  '  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);',
  '  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]',
  '  public static extern bool ClosePrinter(IntPtr handle);',
  '  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", CharSet = CharSet.Ansi, SetLastError = true)]',
  '  public static extern int StartDocPrinter(IntPtr handle, int level, DocInfo docInfo);',
  '  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]',
  '  public static extern bool EndDocPrinter(IntPtr handle);',
  '  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]',
  '  public static extern bool StartPagePrinter(IntPtr handle);',
  '  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]',
  '  public static extern bool EndPagePrinter(IntPtr handle);',
  '  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]',
  '  public static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);',
  '}',
  '\'@',
  '$h = [IntPtr]::Zero',
  'if (-not [ZebraRaw]::OpenPrinter($PrinterName, [ref]$h, [IntPtr]::Zero)) {',
  '  $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()',
  '  throw "Impressora nao encontrada: \'$PrinterName\' (codigo $code)"',
  '}',
  'try {',
  '  $d = New-Object ZebraRaw+DocInfo; $d.pDocName = "ZPL"; $d.pDataType = "RAW"',
  '  if ([ZebraRaw]::StartDocPrinter($h, 1, $d) -le 0) { throw "Falha StartDocPrinter" }',
  '  [ZebraRaw]::StartPagePrinter($h) | Out-Null',
  '  $w = 0; $ok = [ZebraRaw]::WritePrinter($h, $bytes, $bytes.Length, [ref]$w)',
  '  [ZebraRaw]::EndPagePrinter($h) | Out-Null',
  '  [ZebraRaw]::EndDocPrinter($h) | Out-Null',
  '  if (-not $ok) { throw "WritePrinter retornou falso" }',
  '  Write-Output "ENVIADO: $w bytes"',
  '} finally { [ZebraRaw]::ClosePrinter($h) | Out-Null }',
].join('\n');

// ─── Detecta impressora Zebra ─────────────────────────────────────────────────
function detectarImpressora(cb) {
  exec(
    'powershell -NoProfile -Command "Get-Printer | Where-Object { $_.Name -match \'Zebra|ZD|ZTC|ZM\' } | Select-Object -First 1 -ExpandProperty Name"',
    (err, stdout) => cb((stdout || '').trim() || '')
  );
}

function listarImpressoras(cb) {
  exec(
    'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"',
    (err, stdout) => cb((stdout || '').trim().split('\n').map(s => s.trim()).filter(Boolean))
  );
}

// ─── Envia ZPL via PS1 ────────────────────────────────────────────────────────
function imprimirZpl(zpl, printer, cb) {
  const ps1File = path.join(INSTALL_DIR, 'imprimir.ps1');
  if (!fs.existsSync(ps1File)) {
    try { fs.mkdirSync(INSTALL_DIR, { recursive: true }); fs.writeFileSync(ps1File, PS1_CONTENT, 'utf8'); } catch (e) { return cb(e); }
  }
  const id      = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const zplFile = path.join(os.tmpdir(), `etq_${id}.zpl`);
  try { fs.writeFileSync(zplFile, zpl, 'binary'); } catch (e) { return cb(e); }

  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1File}" -ZplFile "${zplFile}" -PrinterName "${printer.replace(/"/g, '')}"`;
  exec(cmd, { timeout: 20000 }, (err, stdout, stderr) => {
    fs.unlink(zplFile, () => {});
    const msg = ((stderr || '').trim() || err?.message || '');
    if (err || msg) return cb(new Error(msg.slice(0, 300)));
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

// ═══════════════════════════════════════════════════════════════════════════════
// MODO SERVIÇO — roda HTTP server em localhost:9200
// ═══════════════════════════════════════════════════════════════════════════════
function startService() {
  detectarImpressora(printerName => {
    console.log(`[SGF-Agente] Iniciando servico na porta ${PORT}`);
    console.log(`[SGF-Agente] Impressora: ${printerName || '(nenhuma detectada)'}`);

    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      if (req.method === 'GET' && req.url === '/status') {
        return respJson(res, 200, { ok: true, printer: printerName || null });
      }
      if (req.method === 'GET' && req.url === '/impressoras') {
        return listarImpressoras(lista => respJson(res, 200, { ok: true, printers: lista }));
      }
      if (req.method === 'POST' && req.url === '/print') {
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
          let data;
          try { data = JSON.parse(body); } catch { return respJson(res, 400, { error: 'JSON inválido' }); }
          const { zpl, printer } = data;
          if (!zpl) return respJson(res, 400, { error: 'Campo "zpl" obrigatório' });
          const p = printer || printerName;
          if (!p) return respJson(res, 500, { error: 'Nenhuma impressora Zebra detectada. Informe o nome no campo "printer".' });
          imprimirZpl(zpl, p, (err) => {
            if (err) { console.error('[print] ERRO:', err.message); return respJson(res, 500, { error: err.message }); }
            console.log(`[print] OK → "${p}"`);
            respJson(res, 200, { ok: true });
          });
        });
        return;
      }
      respJson(res, 404, { error: 'Rota não encontrada' });
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[SGF-Agente] Pronto em http://localhost:${PORT}`);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODO INSTALADOR — configura o PC e inicia o serviço
// ═══════════════════════════════════════════════════════════════════════════════
function install() {
  const LINE = '═'.repeat(50);
  console.log(`\n╔${LINE}╗`);
  console.log('║  Agente de Impressão — Intranet SGF               ║');
  console.log('║  Instalador v1.0                                  ║');
  console.log(`╚${LINE}╝\n`);

  const step = msg => process.stdout.write(`  ► ${msg}... `);
  const ok   = ()  => console.log('OK ✓');
  const warn = msg => console.log(`AVISO: ${msg}`);

  try {
    // 1. Criar diretório
    step('Criando pasta de instalação');
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    ok();

    // 2. Copiar executável para install dir
    const exeDest = path.join(INSTALL_DIR, EXE_NAME);
    step('Copiando executável');
    try { fs.copyFileSync(process.execPath, exeDest); ok(); }
    catch (e) { console.log('(já em uso, ignorado)'); }

    // 3. Gravar PS1
    step('Criando script de impressão');
    fs.writeFileSync(path.join(INSTALL_DIR, 'imprimir.ps1'), PS1_CONTENT, 'utf8');
    ok();

    // 4. Tarefa de inicialização automática
    step('Configurando início automático com o Windows');
    const exeRun = path.join(INSTALL_DIR, EXE_NAME);
    const cmd = `schtasks /create /tn "${TASK_NAME}" /tr "\\"${exeRun}\\" ${SERVICE_ARG}" /sc ONLOGON /rl HIGHEST /f`;
    const r = require('child_process').spawnSync('cmd', ['/c', cmd], { encoding: 'utf8' });
    if (r.status === 0) { ok(); } else { warn('execute como Administrador para início automático'); }

    // 5. Inicia o serviço agora
    step('Iniciando agente');
    spawn(exeRun, [SERVICE_ARG], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    ok();

    console.log(`\n╔${LINE}╗`);
    console.log('║  ✅  Instalação concluída com sucesso!             ║');
    console.log(`╠${LINE}╣`);
    console.log('║  Agente rodando em: http://localhost:9200         ║');
    console.log('║  Será iniciado automaticamente no próximo login.  ║');
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

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
const runningFromInstallDir =
  process.execPath &&
  path.dirname(process.execPath).toLowerCase() === INSTALL_DIR.toLowerCase();

if (process.argv.includes(SERVICE_ARG) || runningFromInstallDir) {
  startService();
} else {
  install();
}
