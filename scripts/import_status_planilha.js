/**
 * Adiciona coluna `status` em sac.at e preenche a partir da planilha Google Sheets.
 * Correspondência: sac.at.atendimento_inicial  ↔  planilha coluna PROTC.
 *
 * Uso: node scripts/import_status_planilha.js
 */

'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const CSV_PATH = path.join('/tmp/planilha_at.csv');

// ── Parser CSV mínimo (lida com campos entre aspas com quebras de linha) ──────
function parseCSV(text) {
  const rows = [];
  let curRow = [];
  let cur = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { curRow.push(cur); cur = ''; }
      else if (ch === '\r') { /* ignora */ }
      else if (ch === '\n') { curRow.push(cur); cur = ''; rows.push(curRow); curRow = []; }
      else { cur += ch; }
    }
  }
  if (cur || curRow.length) { curRow.push(cur); rows.push(curRow); }
  return rows;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    // 1. Garante coluna status
    console.log('Verificando coluna status em sac.at...');
    await pool.query(`
      ALTER TABLE sac.at
      ADD COLUMN IF NOT EXISTS status TEXT;
    `);
    console.log('✓ Coluna status garantida.');

    // 2. Lê CSV
    const raw = fs.readFileSync(CSV_PATH, 'utf8');
    const rows = parseCSV(raw);
    if (rows.length < 2) throw new Error('CSV vazio ou inválido');

    const headers = rows[0].map(h => h.trim());
    const idxProtc  = headers.findIndex(h => /^PROTC/i.test(h));
    const idxStatus = headers.findIndex(h => /^Status$/i.test(h));

    if (idxProtc  < 0) throw new Error('Coluna PROTC não encontrada no CSV. Headers: ' + headers.join(' | '));
    if (idxStatus < 0) throw new Error('Coluna Status não encontrada no CSV. Headers: ' + headers.join(' | '));

    console.log(`Colunas encontradas → PROTC: índice ${idxProtc}, Status: índice ${idxStatus}`);
    console.log(`Total de linhas de dados: ${rows.length - 1}`);

    // 3. Monta mapa PROTC → Status (pula linhas sem PROTC numérico)
    const mapa = new Map();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const protc  = (row[idxProtc]  || '').trim();
      const status = (row[idxStatus] || '').trim();
      if (!protc || !status) continue;
      mapa.set(protc, status);
    }
    console.log(`Entradas mapeadas (PROTC→Status): ${mapa.size}`);

    // 4. Busca ids no banco que têm atendimento_inicial numérico
    const dbRows = await pool.query(`
      SELECT id, atendimento_inicial
      FROM sac.at
      WHERE atendimento_inicial IS NOT NULL
        AND atendimento_inicial ~ '^[0-9]+$'
    `);
    console.log(`Registros com PROTC numérico no banco: ${dbRows.rows.length}`);

    // 5. Atualiza em batch via unnest
    const ids      = [];
    const statuses = [];
    let semMatch   = 0;

    for (const row of dbRows.rows) {
      const st = mapa.get(row.atendimento_inicial);
      if (st) { ids.push(row.id); statuses.push(st); }
      else    { semMatch++; }
    }

    console.log(`Com match na planilha: ${ids.length} | Sem match: ${semMatch}`);

    if (ids.length > 0) {
      await pool.query(`
        UPDATE sac.at AS t
        SET    status = v.status
        FROM   (SELECT unnest($1::bigint[]) AS id, unnest($2::text[]) AS status) AS v
        WHERE  t.id = v.id
      `, [ids, statuses]);
      console.log(`✓ ${ids.length} registros atualizados.`);
    }

    // 6. Resumo dos valores gravados
    const resumo = await pool.query(`
      SELECT status, COUNT(*) as total
      FROM sac.at
      GROUP BY status
      ORDER BY total DESC
    `);
    console.log('\nResumo de status na tabela:');
    resumo.rows.forEach(r => console.log(`  ${r.status ?? '(null)'}: ${r.total}`));

  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
