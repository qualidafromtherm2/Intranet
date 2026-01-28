const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

async function disableTrigger() {
  try {
    console.log('Desabilitando trigger...');
    await pool.query('ALTER TABLE compras.solicitacao_compras DISABLE TRIGGER trg_historico_solicitacao_compras;');
    console.log('✅ Trigger desabilitado com sucesso!');
    
    console.log('\nVerificando função armazenada...');
    const result = await pool.query(`
      SELECT pg_get_functiondef(oid) as definition 
      FROM pg_proc 
      WHERE proname = 'fn_registrar_historico_solicitacao'
    `);
    
    if (result.rows.length > 0) {
      console.log('\n📋 Código da função no banco:');
      console.log(result.rows[0].definition);
    }
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    await pool.end();
    process.exit(1);
  }
}

disableTrigger();
