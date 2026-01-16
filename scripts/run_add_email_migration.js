#!/usr/bin/env node
// Script para executar a migration de adicionar coluna email
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔄 Conectando ao banco de dados...');
    
    const sqlPath = path.join(__dirname, 'add_email_column_to_auth_user.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('🔄 Executando migration: adicionar coluna email...');
    
    await pool.query(sql);
    
    console.log('✅ Migration executada com sucesso!');
    console.log('✅ Coluna "email" adicionada à tabela auth_user');
    
    // Verifica se a coluna foi criada
    const check = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'auth_user' 
        AND column_name = 'email'
    `);
    
    if (check.rows.length > 0) {
      console.log('✅ Verificação: coluna email existe');
      console.log('   Tipo:', check.rows[0].data_type);
    } else {
      console.warn('⚠️  Aviso: não foi possível verificar a coluna');
    }
    
  } catch (error) {
    console.error('❌ Erro ao executar migration:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
