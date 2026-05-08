/**
 * scripts/create_endereco_pp.js
 * Cria a tabela logistica."Endereço_pp" e popula com o CSV de inventário.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { Pool } = require('pg');

const CSV_PATH = path.join(
  process.env.HOME || '/home/leandro',
  'Downloads',
  'INVENTARIO FROMTHERM - produtos_enderecos.csv'
);

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_INTERNAL_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    // 1. Garantir schema
    await client.query('CREATE SCHEMA IF NOT EXISTS logistica;');

    // 2. Criar tabela (idempotente)
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
      );
    `);
    console.log('Tabela logistica."Endereço_pp" OK.');

    // 3. Limpar dados anteriores (re-carga limpa)
    await client.query('TRUNCATE logistica."Endereço_pp" RESTART IDENTITY;');

    // 4. Ler CSV
    const records = await new Promise((resolve, reject) => {
      const rows = [];
      fs.createReadStream(CSV_PATH)
        .pipe(
          parse({
            columns: true,       // usa a 1ª linha como header
            skip_empty_lines: true,
            trim: true,
            relax_column_count: true, // permite linhas com menos colunas
          })
        )
        .on('data', (row) => rows.push(row))
        .on('error', reject)
        .on('end', () => resolve(rows));
    });

    console.log(`Linhas lidas: ${records.length}`);

    // 5. Inserir em lote único (muito mais rápido para banco remoto)
    await client.query('BEGIN');
    const COLS = 8;
    const valuePlaceholders = records
      .map((_, i) => `($${i * COLS + 1},$${i * COLS + 2},$${i * COLS + 3},$${i * COLS + 4},$${i * COLS + 5},$${i * COLS + 6},$${i * COLS + 7},$${i * COLS + 8})`)
      .join(',');
    const flatValues = records.flatMap((row) => [
      row.codigo_produto ? row.codigo_produto.toString() : null,
      row.codigo      || null,
      row.descricao   || null,
      row.completo    || null,
      row.rua         || null,
      row.andar       || null,
      row.edificio    || null,
      row.apartamento || null,
    ]);
    await client.query(
      `INSERT INTO logistica."Endereço_pp"
         (codigo_produto, codigo, descricao, completo, rua, andar, edificio, apartamento)
       VALUES ${valuePlaceholders}`,
      flatValues
    );
    await client.query('COMMIT');
    console.log(`Registros inseridos: ${records.length}`);
    console.log('Concluído com sucesso!');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
