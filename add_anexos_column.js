const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function addAnexosColumn() {
  const client = await pool.connect();
  try {
    console.log('Adicionando coluna anexos...');
    
    await client.query(`
      ALTER TABLE compras.solicitacao_compras 
      ADD COLUMN IF NOT EXISTS anexos JSONB
    `);
    
    console.log('✅ Coluna anexos adicionada com sucesso!');
    
    // Verificar se foi criada
    const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'compras' 
      AND table_name = 'solicitacao_compras' 
      AND column_name = 'anexos'
    `);
    
    if (result.rows.length > 0) {
      console.log('Coluna encontrada:', result.rows[0]);
    } else {
      console.log('❌ Coluna não foi criada');
    }
    
  } catch (error) {
    console.error('Erro:', error.message);
  } finally {
    client.release();
    pool.end();
  }
}

addAnexosColumn();
