// src/db.js — pools Postgres compartilhados (evita estouro de conexões no Render)
require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_INTERNAL_URL ||
  null;

function getPgPoolConfig(overrides = {}) {
  if (!DATABASE_URL) return null;
  return {
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: parseInt(process.env.PGPOOL_MAX || '10', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ...overrides,
  };
}

function attachPoolErrorHandler(pgPool, label = 'db') {
  if (!pgPool) return;
  pgPool.on('error', (err) => {
    console.error(`[${label}] erro em cliente ocioso — ignorado para evitar crash:`, err?.message || err);
  });
}

// Pool principal — queries da API
const pool = DATABASE_URL ? new Pool(getPgPoolConfig()) : null;

// Pool dedicado à sessão (login) — não compete com consultas pesadas da API
const sessionPool = DATABASE_URL
  ? new Pool(getPgPoolConfig({
      max: parseInt(process.env.PGSESSION_POOL_MAX || '3', 10),
    }))
  : null;

attachPoolErrorHandler(pool, 'db');
attachPoolErrorHandler(sessionPool, 'session-pool');

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
  console.log('[db] pool principal aquecido');
  return true;
}

async function warmupSessionPool() {
  if (!sessionPool) return false;
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      await sessionPool.query('SELECT 1 AS ok');
      console.log('[db] pool de sessão aquecido');
      return true;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function ensureSessionTableReady() {
  const target = sessionPool || pool;
  if (!target) return;
  let lastErr;
  const sqlTable = `
    CREATE TABLE IF NOT EXISTS public."session" (
      sid    varchar      NOT NULL,
      sess   json         NOT NULL,
      expire timestamp(6) NOT NULL
    )
  `;
  for (let i = 0; i < 4; i++) {
    try {
      await target.query(sqlTable);
      break;
    } catch (err) {
      lastErr = err;
      if (i === 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  await target.query(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON public."session" ("expire")
  `).catch(() => {});
  console.log('[db] tabela session pronta');
}

async function dbGetClient() {
  if (!pool) throw new Error('DATABASE_URL não configurada (modo local/sem DB).');
  return pool.connect();
}

async function dbClose() {
  const closes = [];
  if (pool) closes.push(pool.end());
  if (sessionPool && sessionPool !== pool) closes.push(sessionPool.end());
  await Promise.all(closes);
}

const isDbEnabled = !!pool;

module.exports = {
  pool,
  sessionPool,
  getPgPoolConfig,
  dbQuery,
  dbQueryWithRetry,
  warmupPgPool,
  warmupSessionPool,
  ensureSessionTableReady,
  dbGetClient,
  dbClose,
  isDbEnabled,
  DATABASE_URL,
};
