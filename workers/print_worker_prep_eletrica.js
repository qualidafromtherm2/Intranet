// print_worker_prep_eletrica.js
// Agente que imprime etiquetas da "Preparação elétrica" a partir do PostgreSQL

require('dotenv').config();
const { Pool } = require('pg');
const net = require('net');
const { execFile } = require('child_process');
const fs = require('fs');

const CONFIG_PATH = process.env.PRINT_WORKER_CONFIG || './print_worker_config.json';

// Carrega config (host/porta da impressora, modo de envio, etc.)
function loadConfig() {
  try {
    const txt = fs.readFileSync(CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(txt);
    return {
      mode: cfg.mode || 'socket9100',        // 'socket9100' | 'cups'
      host: cfg.host || '192.168.0.90',      // IP da Zebra (se socket9100)
      port: Number(cfg.port || 9100),
      cupsPrinter: cfg.cupsPrinter || 'Zebra', // nome da impressora no CUPS (se cups)
      pollMs: Number(cfg.pollMs || 3000),      // intervalo de varredura
      batchSize: Number(cfg.batchSize || 1),   // quantas por rodada
      area: cfg.area || 'Preparação elétrica', // valor esperado em local_impressao
      debug: !!cfg.debug,
    };
  } catch (e) {
    console.error('[worker] Falha ao carregar config:', e.message);
    process.exit(1);
  }
}

const CFG = loadConfig();

// Pool do Postgres: use DATABASE_URL ou as variáveis separadas
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  // Se usar variáveis separadas, comente a linha acima e descomente abaixo:
  // host: process.env.PGHOST,
  // user: process.env.PGUSER,
  // password: process.env.PGPASSWORD,
  // database: process.env.PGDATABASE,
  // port: Number(process.env.PGPORT || 5432),
  ssl: { rejectUnauthorized: false }, // Render geralmente precisa de SSL
});

// Impressão via socket 9100 (Zebra em rede)
function printViaSocket9100(zpl, { host, port }) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(10000);
    socket.connect(port, host, () => {
      socket.write(zpl, 'utf8', () => {
        socket.end();
      });
    });
    socket.on('error', reject);
    socket.on('timeout', () => reject(new Error('Timeout enviando para 9100')));
    socket.on('close', hadError => (hadError ? reject(new Error('Conexão fechada com erro')) : resolve()));
  });
}

// Impressão via CUPS (lp)
function printViaCups(zpl, printerName) {
  return new Promise((resolve, reject) => {
    // envia ZPL como stdin para lp
    const child = execFile('lp', ['-d', printerName, '-o', 'raw'], { maxBuffer: 10 * 1024 * 1024 }, (err) => {
      if (err) return reject(err);
      resolve();
    });
    child.stdin.write(zpl, 'utf8');
    child.stdin.end();
  });
}

// Escolhe backend de impressão
async function sendToPrinter(zpl) {
  if (CFG.mode === 'cups') {
    return printViaCups(zpl, CFG.cupsPrinter);
  }
  // padrão: socket 9100
  return printViaSocket9100(zpl, { host: CFG.host, port: CFG.port });
}

// Loop principal: pega etiqueta(s), imprime, marca impressa
async function tick() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Seleciona UMA (ou algumas) etiqueta(s) pendente(s) dessa área, com lock para evitar corrida:
    const sel = await client.query(
      `
  SELECT id, numero_op, codigo_produto, conteudo_zpl
  FROM "OrdemProducao".tab_op
      WHERE impressa = FALSE
        AND local_impressao = $1
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $2
      `,
      [CFG.area, CFG.batchSize]
    );

    if (sel.rowCount === 0) {
      await client.query('COMMIT');
      if (CFG.debug) console.log('[worker] nada a imprimir…');
      return;
    }

    for (const row of sel.rows) {
      const { id, numero_op, codigo_produto, conteudo_zpl } = row;

      if (CFG.debug) {
        console.log(`[worker] imprimindo id=${id} OP=${numero_op} COD=${codigo_produto}`);
      }

      // Tenta imprimir
      try {
        await sendToPrinter(conteudo_zpl);

        // Marca como impressa
        await client.query(
          `UPDATE "OrdemProducao".tab_op
             SET impressa = TRUE,
                 data_impressao = NOW()
           WHERE id = $1`,
          [id]
        );

        if (CFG.debug) console.log(`[worker] OK id=${id} marcado como impresso`);
      } catch (printErr) {
        // Não marca como impresso; apenas loga. O lock é liberado ao COMMIT e ela volta a ser tentada no próximo tick.
        console.error(`[worker] Falha ao imprimir id=${id}:`, printErr.message);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[worker] erro no tick:', err.message);
  } finally {
    client.release();
  }
}

async function main() {
  console.log(`[worker] Preparação elétrica → monitorando ${CFG.area} a cada ${CFG.pollMs} ms, modo=${CFG.mode}`);
  setInterval(() => tick().catch(e => console.error('[worker] tick err:', e)), CFG.pollMs);
}

main().catch(err => {
  console.error('[worker] erro fatal:', err);
  process.exit(1);
});
