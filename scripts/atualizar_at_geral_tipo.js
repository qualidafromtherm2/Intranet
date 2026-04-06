/**
 * Atualiza sac.at.tipo = 'Atendimento Rapido' para todos os registros
 * importados da aba "Atendimentos Gerais" (gid=1804958693).
 *
 * Uso:
 *   node scripts/atualizar_at_geral_tipo.js            (executa)
 *   node scripts/atualizar_at_geral_tipo.js --dry-run  (só conta)
 */

require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');
const { parse } = require('csv-parse/sync');

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI/export?format=csv&gid=1804958693';

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

function baixarCSV(url) {
  return new Promise((resolve, reject) => {
    const go = (u) => {
      https.get(u, { headers: { 'User-Agent': 'nodejs-update' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
          return go(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      }).on('error', reject);
    };
    go(url);
  });
}

async function main() {
  console.log('⬇  Baixando planilha Atendimentos Gerais…');
  const csvText = await baixarCSV(SHEET_URL);

  const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`   ${rows.length} linhas na planilha`);

  const protcs = rows
    .map(r => (r['PROTC.'] || '').trim())
    .filter(Boolean);

  console.log(`   ${protcs.length} PROTC. coletados\n`);

  if (DRY_RUN) {
    // Verifica quantos existem no banco com tipo diferente
    const { rows: preview } = await pool.query(
      `SELECT COUNT(*) AS total FROM sac.at
       WHERE atendimento_inicial = ANY($1::TEXT[])
         AND (tipo IS DISTINCT FROM 'Atendimento Rapido')`,
      [protcs]
    );
    console.log(`⚠  Modo DRY-RUN — nenhuma alteração será feita.`);
    console.log(`   Registros que seriam atualizados: ${preview[0].total}`);
    await pool.end();
    return;
  }

  // UPDATE em lote via unnest
  const result = await pool.query(
    `UPDATE sac.at
     SET tipo = 'Atendimento Rapido'
     WHERE atendimento_inicial = ANY($1::TEXT[])`,
    [protcs]
  );

  console.log('──────────────────────────────');
  console.log(`✅ Registros atualizados: ${result.rowCount}`);
  console.log('   tipo → Atendimento Rapido');
  console.log('──────────────────────────────');

  await pool.end();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
