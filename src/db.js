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

async function dbQueryWithRetry(text, params = [], opts = {}) {
  const retries = Number(opts.retries ?? 4);
  const delayMs = Number(opts.delayMs ?? 800);
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await dbQuery(text, params);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      const transient = /terminated unexpectedly|timeout exceeded|ECONNRESET|ECONNREFUSED|connection/i.test(msg);
      if (!transient || i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

async function warmupPgPool() {
  if (!pool) return false;
  await dbQueryWithRetry('SELECT 1 AS ok', [], { retries: 6, delayMs: 1000 });
  console.log('[db] pool aquecido');
  return true;
}

async function ensureSessionTableReady() {
  if (!pool) return;
  await dbQueryWithRetry(`
    CREATE TABLE IF NOT EXISTS public."session" (
      sid    varchar      NOT NULL,
      sess   json         NOT NULL,
      expire timestamp(6) NOT NULL
    )
  `, [], { retries: 4, delayMs: 1000 });
  await dbQueryWithRetry(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON public."session" ("expire")
  `, [], { retries: 3, delayMs: 800 });
  console.log('[db] tabela session pronta');
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
  dbQueryWithRetry,
  warmupPgPool,
  ensureSessionTableReady,
  dbGetClient,
  dbClose,
  isDbEnabled,
  DATABASE_URL,
};
