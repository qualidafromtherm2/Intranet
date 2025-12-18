/**
 * Script para criar a tabela compras.atividades_produto
 * Execute com: node scripts/criar_tabela_atividades_produto_compras.js
 */

const { Pool } = require('pg');

// Configuração do pool de conexão
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'intranet',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'sua_senha'
});

async function criarTabelaAtividadesProdutoCompras() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Criando tabela compras.atividades_produto...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS compras.atividades_produto (
        id SERIAL PRIMARY KEY,
        produto_codigo VARCHAR(50) NOT NULL,
        descricao TEXT NOT NULL,
        observacoes TEXT,
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT NOW(),
        atualizado_em TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Índice para buscar atividades por produto
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_atividades_produto_compras_codigo 
        ON compras.atividades_produto(produto_codigo) 
        WHERE ativo = true;
    `);
    
    console.log('✅ Tabela compras.atividades_produto criada com sucesso!');
    
    // Adicionar comentários
    await client.query(`
      COMMENT ON TABLE compras.atividades_produto IS 
        'Atividades específicas de compras para cada produto (não vinculadas à família)';
      COMMENT ON COLUMN compras.atividades_produto.produto_codigo IS 
        'Código do produto (ex: 02.MP.N.02630)';
      COMMENT ON COLUMN compras.atividades_produto.descricao IS 
        'Descrição da atividade específica';
      COMMENT ON COLUMN compras.atividades_produto.observacoes IS 
        'Observações adicionais sobre a atividade';
      COMMENT ON COLUMN compras.atividades_produto.ativo IS 
        'Se false, a atividade foi excluída (soft delete)';
    `);
    
    console.log('📝 Comentários adicionados com sucesso!');
    
    // Verificar se a tabela foi criada
    const result = await client.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'compras' 
        AND table_name = 'atividades_produto'
    `);
    
    if (result.rows[0].count > 0) {
      console.log('✅ Verificação concluída: tabela existe no banco de dados');
    } else {
      console.log('❌ Erro: tabela não foi criada');
    }
    
  } catch (error) {
    console.error('❌ Erro ao criar tabela:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Executar o script
criarTabelaAtividadesProdutoCompras()
  .then(() => {
    console.log('🎉 Script concluído com sucesso!');
    process.exit(0);
  })
  .catch(err => {
    console.error('💥 Erro fatal:', err);
    process.exit(1);
  });
