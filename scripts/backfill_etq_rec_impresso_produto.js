/**
 * scripts/backfill_etq_rec_impresso_produto.js
 *
 * Preenche codigo_produto e descricao_produto em etiqueta."ETQ_rec_impresso".
 * O boot da API já faz isso automaticamente; use este script só para forçar manualmente.
 *
 * Uso:
 *   node scripts/backfill_etq_rec_impresso_produto.js
 *   node scripts/backfill_etq_rec_impresso_produto.js "/caminho/inventario.csv"
 */
require('dotenv').config();
const { Pool } = require('pg');
const {
  garantirEnderecoPp,
  backfillEtqRecImpresso,
} = require('../utils/etqRecImpressoBackfill');

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

async function main() {
  const csvPath = process.argv[2] || null;
  const client = await pool.connect();
  try {
    console.log('=== Backfill ETQ_rec_impresso (codigo_produto / descricao_produto) ===');
    await resumo(client, 'Antes');

    await client.query('BEGIN');
    await garantirEnderecoPp(client, csvPath);
    const n = await backfillEtqRecImpresso(client);
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
