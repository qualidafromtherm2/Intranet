/**
 * Atualiza sac.at_busca_selecionada com ordem_producao, nota_fiscal, data_entrega
 * a partir da planilha de Pedidos (Google Sheets ou CSV local).
 *
 * Uso:
 *   node scripts/atualizar_at_busca_pedidos.js            (match por pedido, planilha online)
 *   node scripts/atualizar_at_busca_pedidos.js --dry-run
 *   node scripts/atualizar_at_busca_pedidos.js --csv "csv/arquivo.csv" --match op
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const https = require('https');
const { parse } = require('csv-parse/sync');

const PEDIDOS_URL =
  'https://docs.google.com/spreadsheets/d/14cmU3eOVH8ZscU-nZqxPb1Do5wTnl0SdQCU1caee6qk/export?format=csv&gid=1642140396';

const BATCH_SIZE = 200;
const DRY_RUN = process.argv.includes('--dry-run');
const MATCH_BY = process.argv.includes('--match') && process.argv[process.argv.indexOf('--match') + 1] === 'op'
  ? 'op'
  : 'pedido';
const CSV_LOCAL = (() => {
  const i = process.argv.indexOf('--csv');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

function baixarCSV(url) {
  return new Promise((resolve, reject) => {
    const go = (u) => {
      https.get(u, { headers: { 'User-Agent': 'nodejs-import' } }, (res) => {
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

function limpar(v) {
  return (v || '').trim() || null;
}

function parseData(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // formato ISO ou timestamp
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function main() {
  let csvText;
  if (CSV_LOCAL) {
    const csvPath = path.isAbsolute(CSV_LOCAL) ? CSV_LOCAL : path.join(process.cwd(), CSV_LOCAL);
    console.log(`📂 Lendo CSV local: ${csvPath}`);
    csvText = fs.readFileSync(csvPath, 'utf-8');
  } else {
    console.log('⬇  Baixando planilha de Pedidos…');
    csvText = await baixarCSV(PEDIDOS_URL);
  }

  const rowsPedidos = parse(csvText, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  console.log(`   ${rowsPedidos.length} linhas na planilha`);
  console.log(`   Match por: ${MATCH_BY === 'op' ? 'ordem_producao' : 'pedido'}`);

  const mapPedidos = new Map();
  for (const row of rowsPedidos) {
    const key = MATCH_BY === 'op'
      ? limpar(row['ORDEM DE PRODUCAO'])
      : (row['PEDIDO'] || '').trim();
    if (key && !mapPedidos.has(key)) {
      mapPedidos.set(key, {
        op: limpar(row['ORDEM DE PRODUCAO']),
        nf: limpar(row['NOTA FISCAL']),
        de: parseData(row['DATA ENTREGA']),
      });
    }
  }
  console.log(`   ${mapPedidos.size} chaves únicas indexadas`);

  console.log('\n🔍 Buscando registros a atualizar no banco…');
  const whereMatch = MATCH_BY === 'op'
    ? `ordem_producao IS NOT NULL AND TRIM(ordem_producao) <> ''`
    : `pedido IS NOT NULL`;
  const { rows: candidatos } = await pool.query(`
    SELECT id, pedido, ordem_producao
    FROM sac.at_busca_selecionada
    WHERE ${whereMatch}
      AND (nota_fiscal IS NULL OR TRIM(nota_fiscal) = '' OR data_entrega IS NULL OR TRIM(data_entrega::text) = '')
    ORDER BY id
  `);
  console.log(`   ${candidatos.length} registros candidatos`);

  const aAtualizar = candidatos
    .map(r => {
      const key = MATCH_BY === 'op' ? String(r.ordem_producao || '').trim() : r.pedido;
      const dados = mapPedidos.get(key);
      return dados ? { id: r.id, pedido: r.pedido, ordem_producao: r.ordem_producao, ...dados } : null;
    })
    .filter(Boolean)
    .filter(r => r.nf || r.de);

  const semMatch = candidatos.length - aAtualizar.length;
  console.log(`   ${aAtualizar.length} com match | ${semMatch} sem match na planilha`);

  if (DRY_RUN) {
    console.log('\n⚠  Modo DRY-RUN — nenhuma atualização será feita.');
    if (aAtualizar.length > 0) {
      console.log('\nAmostra (primeiros 5):');
      aAtualizar.slice(0, 5).forEach(r =>
        console.log(`  id=${r.id} op=${r.ordem_producao || r.op} nf=${r.nf} de=${r.de}`)
      );
    }
    console.log('\n──────────────────────────────');
    console.log(`✅ Seriam atualizados: ${aAtualizar.length}`);
    console.log(`⏭  Sem match         : ${semMatch}`);
    console.log('(Dry-run: nada foi gravado)');
    console.log('──────────────────────────────');
    await pool.end();
    return;
  }

  // Processa em lotes de BATCH_SIZE com UPDATE por batch
  let atualizados = 0;
  for (let i = 0; i < aAtualizar.length; i += BATCH_SIZE) {
    const lote = aAtualizar.slice(i, i + BATCH_SIZE);

    // Monta os valores como registros temporários e faz UPDATE via JOIN
    // Usa unnest para evitar N queries
    const ids    = lote.map(r => r.id);
    const ops    = lote.map(r => r.op);
    const nfs    = lote.map(r => r.nf);
    const des    = lote.map(r => r.de ? r.de : null);

    await pool.query(`
      UPDATE sac.at_busca_selecionada AS t
      SET
        ordem_producao = COALESCE(NULLIF(TRIM(t.ordem_producao), ''), v.op),
        nota_fiscal    = COALESCE(NULLIF(TRIM(t.nota_fiscal), ''), v.nf),
        data_entrega   = COALESCE(NULLIF(TRIM(t.data_entrega::text), ''), v.de)
      FROM (
        SELECT
          unnest($1::BIGINT[])  AS id,
          unnest($2::TEXT[])    AS op,
          unnest($3::TEXT[])    AS nf,
          unnest($4::TEXT[])    AS de
      ) AS v
      WHERE t.id = v.id
        AND (v.nf IS NOT NULL OR v.de IS NOT NULL)
    `, [ids, ops, nfs, des]);

    atualizados += lote.length;
    process.stdout.write(`\r   Processados: ${atualizados}/${aAtualizar.length}`);
  }

  console.log('\n');
  console.log('──────────────────────────────');
  console.log(`✅ Atualizados : ${atualizados}`);
  console.log(`⏭  Sem match   : ${semMatch}`);
  console.log('──────────────────────────────');

  await pool.end();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
