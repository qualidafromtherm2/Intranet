const fs = require('fs');
const { Pool } = require('pg');

const sql = fs.readFileSync(__dirname + '/migrations/create_compras_sem_cadastro.sql', 'utf8');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query(sql)
  .then(() => {
    console.log('✅ Tabela compras.compras_sem_cadastro criada com sucesso!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Erro ao criar tabela:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
