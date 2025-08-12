// src/db.js (CJS)
require('dotenv').config();
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Render usa SSL
    })
  : null;

async function dbQuery(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL não configurada (modo local/sem DB).');
  const res = await pool.query(text, params);
  return res;
}

const isDbEnabled = !!pool;

module.exports = { pool, dbQuery, isDbEnabled };
