/**
 * scripts/backfill_etq_rec_impresso_produto.js
 *
 * Preenche codigo_produto e descricao_produto em etiqueta."ETQ_rec_impresso"
 * a partir de: ETQ_recebimento, ZPL, logistica."Endereço_pp" (CSV inventário).
 *
 * Uso:
 *   node scripts/backfill_etq_rec_impresso_produto.js
 *   node scripts/backfill_etq_rec_impresso_produto.js "/caminho/inventario.csv"
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { Pool } = require('pg');

const CSV_PATH = process.argv[2] || path.join(
  process.env.HOME || '/home/leandro',
  'Downloads',
  'INVENTARIO FROMTHERM - produtos_enderecos (1).csv'
);

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_INTERNAL_URL,
  ssl: { rejectUnauthorized: false },
});

async function resumo(client, label) {
  const { rows } = await client.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE codigo_produto IS NULL OR TRIM(codigo_produto) = '')::int AS sem_codigo,
           COUNT(*) FILTER (WHERE descricao_produto IS NULL OR TRIM(descricao_produto) = '')::int AS sem_descricao
      FROM etiqueta."ETQ_rec_impresso"
  `);
  console.log(`${label}:`, rows[0]);
  return rows[0];
}

async function garantirEnderecoPp(client) {
  await client.query('CREATE SCHEMA IF NOT EXISTS logistica');
  await client.query(`
    CREATE TABLE IF NOT EXISTS logistica."Endereço_pp" (
      id            SERIAL PRIMARY KEY,
      codigo_produto BIGINT,
      codigo        TEXT,
      descricao     TEXT,
      completo      TEXT,
      rua           TEXT,
      andar         TEXT,
      edificio      TEXT,
      apartamento   TEXT
    )
  `);

  const { rows: cnt } = await client.query(`SELECT COUNT(*)::int AS n FROM logistica."Endereço_pp"`);
  if (cnt[0].n > 0) {
    console.log(`Endereço_pp já tem ${cnt[0].n} registro(s) — pulando carga CSV.`);
    return cnt[0].n;
  }

  if (!fs.existsSync(CSV_PATH)) {
    console.warn(`CSV não encontrado (${CSV_PATH}) — backfill por endereço_pp ignorado.`);
    return 0;
  }

  const records = await new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(CSV_PATH)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }))
      .on('data', (row) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve(rows));
  });

  const BATCH = 150;
  const COLS = 8;
  let inseridos = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const lote = records.slice(i, i + BATCH);
    const ph = lote.map((_, idx) => {
      const b = idx * COLS;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
    }).join(',');
    const flat = lote.flatMap((row) => [
      row.codigo_produto ? String(row.codigo_produto).trim() : null,
      row.codigo || null,
      row.descricao || null,
      row.completo || null,
      row.rua || null,
      row.andar || null,
      row.edificio || null,
      row.apartamento || null,
    ]);
    await client.query(
      `INSERT INTO logistica."Endereço_pp"
         (codigo_produto, codigo, descricao, completo, rua, andar, edificio, apartamento)
       VALUES ${ph}`,
      flat
    );
    inseridos += lote.length;
  }
  console.log(`Endereço_pp carregado do CSV: ${inseridos} registro(s).`);
  return inseridos;
}

async function backfill(client) {
  let total = 0;

  const rec = await client.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = COALESCE(NULLIF(TRIM(i.codigo_produto), ''), p.codigo_produto::text),
           descricao_produto = COALESCE(
             NULLIF(TRIM(i.descricao_produto), ''),
             NULLIF(TRIM(p.descricao), ''),
             NULLIF(TRIM(r.descricao_produto), '')
           )
      FROM etiqueta."ETQ_recebimento" r
      JOIN public.produtos_omie p ON TRIM(p.codigo) = TRIM(r.codigo_produto)
     WHERE r.id = i.origem_id
       AND (
         NULLIF(TRIM(i.codigo_produto), '') IS NULL
         OR NULLIF(TRIM(i.descricao_produto), '') IS NULL
       )
  `);
  console.log(`  via recebimento: ${rec.rowCount}`);
  total += rec.rowCount;

  const zpl = await client.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = p.codigo_produto::text,
           descricao_produto = COALESCE(
             NULLIF(TRIM(i.descricao_produto), ''),
             NULLIF(TRIM(p.descricao), '')
           )
      FROM public.produtos_omie p
     WHERE (i.codigo_produto IS NULL OR TRIM(i.codigo_produto) = '')
       AND i.conteudo_zpl IS NOT NULL
       AND TRIM(i.conteudo_zpl) <> ''
       AND TRIM(SUBSTRING(i.conteudo_zpl FROM 'Cod\\. Produto: ([^\\^\\n\\r]+)')) <> ''
       AND TRIM(p.codigo) = TRIM(SUBSTRING(i.conteudo_zpl FROM 'Cod\\. Produto: ([^\\^\\n\\r]+)'))
       AND p.codigo_produto IS NOT NULL
  `);
  console.log(`  via ZPL: ${zpl.rowCount}`);
  total += zpl.rowCount;

  const ep = await client.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = COALESCE(NULLIF(TRIM(i.codigo_produto), ''), ep.codigo_produto::text),
           descricao_produto = COALESCE(
             NULLIF(TRIM(i.descricao_produto), ''),
             NULLIF(TRIM(ep.descricao), '')
           )
      FROM logistica."Endereço_pp" ep
     WHERE TRIM(COALESCE(i.endereco, '')) = TRIM(ep.completo)
       AND ep.codigo_produto IS NOT NULL
       AND (
         NULLIF(TRIM(i.codigo_produto), '') IS NULL
         OR NULLIF(TRIM(i.descricao_produto), '') IS NULL
       )
  `).catch(() => ({ rowCount: 0 }));
  console.log(`  via Endereço_pp: ${ep.rowCount}`);
  total += ep.rowCount;

  const fix = await client.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = p.codigo_produto::text,
           descricao_produto = COALESCE(NULLIF(TRIM(i.descricao_produto), ''), NULLIF(TRIM(p.descricao), ''))
      FROM public.produtos_omie p
     WHERE TRIM(i.codigo_produto) = TRIM(p.codigo)
       AND p.codigo_produto IS NOT NULL
       AND TRIM(i.codigo_produto) <> TRIM(p.codigo_produto::text)
  `);
  console.log(`  corrige codigo texto→id Omie: ${fix.rowCount}`);
  total += fix.rowCount;

  return total;
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('=== Backfill ETQ_rec_impresso (codigo_produto / descricao_produto) ===');
    await resumo(client, 'Antes');

    await client.query('BEGIN');
    await garantirEnderecoPp(client);
    console.log('Executando backfill...');
    const n = await backfill(client);
    await client.query('COMMIT');
    console.log(`Total atualizado: ${n}`);

    const depois = await resumo(client, 'Depois');
    if (depois.sem_codigo > 0) {
      console.warn(`Atenção: ainda restam ${depois.sem_codigo} registro(s) sem codigo_produto.`);
      process.exitCode = 1;
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
