// src/db.js — pool Postgres compartilhado (evita estouro de conexões no Render)
require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_INTERNAL_URL ||
  null;

function getPgPoolConfig() {
  if (!DATABASE_URL) return null;
  return {
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: parseInt(process.env.PGPOOL_MAX || '5', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  };
}

const pool = DATABASE_URL ? new Pool(getPgPoolConfig()) : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('[db] erro em cliente ocioso — ignorado para evitar crash:', err?.message || err);
  });
}

async function dbQuery(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL não configurada (modo local/sem DB).');
  return pool.query(text, params);
}

async function dbGetClient() {
  if (!pool) throw new Error('DATABASE_URL não configurada (modo local/sem DB).');
  return pool.connect();
}

async function dbClose() {
  if (pool) await pool.end();
}

const isDbEnabled = !!pool;

module.exports = {
  pool,
  getPgPoolConfig,
  dbQuery,
  dbGetClient,
  dbClose,
  isDbEnabled,
  DATABASE_URL,
};
