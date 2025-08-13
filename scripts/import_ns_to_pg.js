// scripts/import_ns_to_pg.js
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Arquivo local que você já usa hoje
const estoqueFile = path.join(__dirname, '..', 'data', 'estoque_acabado.json');

(async () => {
  // checa env
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL no ambiente.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();

  try {
    const raw = fs.readFileSync(estoqueFile, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('JSON não é um array');

    let inserted = 0;
    let skipped  = 0;

    await client.query('BEGIN');

    for (const item of arr) {
      const codigo = String(item.codigo || '').trim();
      if (!codigo) continue;

      const list = Array.isArray(item.NS) ? item.NS : [];
      for (const ns of list) {
        const txtNs = String(ns).trim();
        if (!txtNs) continue;

        const r = await client.query(
          `INSERT INTO public.ns_pool (codigo, ns)
           VALUES ($1,$2)
           ON CONFLICT (codigo, ns) DO NOTHING`,
          [codigo, txtNs]
        );
        if (r.rowCount) inserted++; else skipped++;
      }
    }

    await client.query('COMMIT');
    console.log(`OK. NS inseridos: ${inserted}. Já existiam: ${skipped}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Falha na importação:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
