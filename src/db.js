// src/db.js
require('dotenv').config();
const { Pool } = require('pg');

// Render costuma expor DATABASE_URL. Deixamos compatível com outros nomes também.
const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_INTERNAL_URL ||
  null;

// se não houver URL → pool = null (localhost continua no JSON)
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // necessário no Render
      max: parseInt(process.env.PGPOOL_MAX || '5', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('[db] Pool error:', err);
  });
}

// consulta simples
async function dbQuery(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL não configurada (modo local/sem DB).');
  return pool.query(text, params);
}

// pegar client manualmente (transações, etc.)
async function dbGetClient() {
  if (!pool) throw new Error('DATABASE_URL não configurada (modo local/sem DB).');
  return pool.connect();
}

// encerrar pool (opcional em shutdown)
async function dbClose() {
  if (pool) await pool.end();
}

const isDbEnabled = !!pool;

module.exports = {
  pool,
  dbQuery,
  dbGetClient,
  dbClose,
  isDbEnabled,
  DATABASE_URL,
};
