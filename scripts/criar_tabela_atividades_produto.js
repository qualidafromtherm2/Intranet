/**
 * Script para criar a tabela engenharia.atividades_produto
 * Execute com: node scripts/criar_tabela_atividades_produto.js
 */

require('dotenv').config();
const { Pool } = require('pg');

// Configuração do banco (mesmo do server.js)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function criarTabela() {
  try {
    console.log('🔄 Conectando ao banco de dados...');
    
    const sql = `
      -- Tabela para armazenar atividades específicas de cada produto
      CREATE TABLE IF NOT EXISTS engenharia.atividades_produto (
        id SERIAL PRIMARY KEY,
        produto_codigo TEXT NOT NULL,
        descricao TEXT NOT NULL,
        observacoes TEXT,
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT NOW(),
        atualizado_em TIMESTAMP DEFAULT NOW()
      );

      -- Índice para buscar atividades por produto
      CREATE INDEX IF NOT EXISTS idx_atividades_produto_codigo 
        ON engenharia.atividades_produto(produto_codigo) 
        WHERE ativo = true;
    `;
    
    await pool.query(sql);
    
    console.log('✅ Tabela engenharia.atividades_produto criada com sucesso!');
    
    // Adiciona comentários
    await pool.query(`
      COMMENT ON TABLE engenharia.atividades_produto IS 
        'Atividades específicas de um produto individual (independente da família)';
      COMMENT ON COLUMN engenharia.atividades_produto.produto_codigo IS 
        'Código do produto no formato XX.XX.X.XXXXX';
      COMMENT ON COLUMN engenharia.atividades_produto.descricao IS 
        'Descrição da atividade específica do produto';
      COMMENT ON COLUMN engenharia.atividades_produto.observacoes IS 
        'Observações adicionais sobre a atividade';
      COMMENT ON COLUMN engenharia.atividades_produto.ativo IS 
        'Indica se a atividade está ativa (não excluída logicamente)';
    `);
    
    console.log('✅ Comentários adicionados com sucesso!');
    
    // Verifica se a tabela foi criada
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'engenharia' 
        AND table_name = 'atividades_produto'
      ORDER BY ordinal_position;
    `);
    
    console.log('\n📋 Estrutura da tabela:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    console.log('\n🎉 Tudo pronto! A tabela está criada e funcionando.');
    
  } catch (error) {
    console.error('❌ Erro ao criar tabela:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

criarTabela();
