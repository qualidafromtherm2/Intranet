// scripts/criar_codigo_verificacoes.js
// Cria a tabela engenharia.codigo_verificacoes
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS engenharia.codigo_verificacoes (
        id                SERIAL PRIMARY KEY,
        codigo_erro_id    INTEGER NOT NULL
                            REFERENCES engenharia.codigos_erro(id) ON DELETE CASCADE,
        codigo_analise_id INTEGER
                            REFERENCES engenharia.codigo_analise(id) ON DELETE SET NULL,
        verificacao       TEXT,
        criado_por        TEXT,
        criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_codigo_verificacoes_erro
        ON engenharia.codigo_verificacoes(codigo_erro_id);
    `);
    console.log('✅ Tabela engenharia.codigo_verificacoes criada/verificada.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
