const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function criarTabela() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Criando tabela engenharia.atividades_produto_status_especificas...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS engenharia.atividades_produto_status_especificas (
        id SERIAL PRIMARY KEY,
        atividade_produto_id INTEGER NOT NULL REFERENCES engenharia.atividades_produto(id),
        produto_codigo TEXT NOT NULL,
        concluido BOOLEAN DEFAULT false,
        nao_aplicavel BOOLEAN DEFAULT false,
        observacao_status TEXT,
        responsavel_username TEXT,
        autor_username TEXT,
        prazo TIMESTAMP,
        atualizado_em TIMESTAMP DEFAULT NOW(),
        UNIQUE(atividade_produto_id, produto_codigo)
      );
    `);
    
    console.log('✅ Tabela engenharia.atividades_produto_status_especificas criada com sucesso!');
    
    // Criar índices
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_aps_especificas_produto_codigo 
      ON engenharia.atividades_produto_status_especificas(produto_codigo);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_aps_especificas_atividade_produto_id 
      ON engenharia.atividades_produto_status_especificas(atividade_produto_id);
    `);
    
    console.log('✅ Índices criados com sucesso!');
    
  } catch (err) {
    console.error('❌ Erro ao criar tabela:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

criarTabela();
