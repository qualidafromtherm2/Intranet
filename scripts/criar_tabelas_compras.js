#!/usr/bin/env node
/**
 * Script para criar tabelas de atividades específicas de compras
 * Usa a mesma configuração de conexão do server.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

async function criarTabelas() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Criando tabelas de atividades de compras...\n');
    
    // Ler o arquivo SQL
    const sqlPath = path.join(__dirname, '20251210_create_compras_atividades_produto.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Executar o SQL
    await client.query(sql);
    
    console.log('✅ Tabelas criadas com sucesso!\n');
    
    // Verificar se as tabelas foram criadas
    const result = await client.query(`
      SELECT 
        table_schema,
        table_name,
        (SELECT COUNT(*) FROM information_schema.columns 
         WHERE table_schema = t.table_schema AND table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_schema = 'compras' 
        AND table_name IN ('atividades_produto', 'atividades_produto_status_especificas')
      ORDER BY table_name;
    `);
    
    if (result.rows.length > 0) {
      console.log('📊 Tabelas verificadas:');
      result.rows.forEach(row => {
        console.log(`  ✓ ${row.table_schema}.${row.table_name} (${row.column_count} colunas)`);
      });
    } else {
      console.log('❌ Erro: tabelas não foram criadas');
    }
    
  } catch (error) {
    console.error('❌ Erro ao criar tabelas:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Executar o script
criarTabelas()
  .then(() => {
    console.log('\n🎉 Script concluído com sucesso!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n💥 Erro fatal:', err.message);
    process.exit(1);
  });
