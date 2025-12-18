/**
 * Script para criar a tabela compras.atividades_produto_status_especificas
 * Execute com: node scripts/criar_tabela_atividades_produto_status_especificas_compras.js
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

async function criarTabelaAtividadesProdutoStatusEspecificasCompras() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Criando tabela compras.atividades_produto_status_especificas...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS compras.atividades_produto_status_especificas (
        id SERIAL PRIMARY KEY,
        produto_codigo VARCHAR(50) NOT NULL,
        atividade_produto_id INTEGER NOT NULL REFERENCES compras.atividades_produto(id),
        concluido BOOLEAN DEFAULT false,
        nao_aplicavel BOOLEAN DEFAULT false,
        observacao_status TEXT,
        data_conclusao TIMESTAMP,
        responsavel_username TEXT,
        autor_username TEXT,
        prazo TIMESTAMP,
        criado_em TIMESTAMP DEFAULT NOW(),
        atualizado_em TIMESTAMP DEFAULT NOW(),
        UNIQUE(produto_codigo, atividade_produto_id)
      );
    `);
    
    console.log('✅ Tabela compras.atividades_produto_status_especificas criada com sucesso!');
    
    // Índices
    console.log('🔄 Criando índices...');
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_atividades_produto_status_especificas_compras_codigo 
        ON compras.atividades_produto_status_especificas(produto_codigo);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_atividades_produto_status_especificas_compras_atividade 
        ON compras.atividades_produto_status_especificas(atividade_produto_id);
    `);
    
    console.log('✅ Índices criados com sucesso!');
    
    // Comentários
    await client.query(`
      COMMENT ON TABLE compras.atividades_produto_status_especificas IS 
        'Status das atividades específicas de compras de cada produto';
      COMMENT ON COLUMN compras.atividades_produto_status_especificas.produto_codigo IS 
        'Código do produto';
      COMMENT ON COLUMN compras.atividades_produto_status_especificas.atividade_produto_id IS 
        'Referência para a atividade específica em atividades_produto';
      COMMENT ON COLUMN compras.atividades_produto_status_especificas.concluido IS 
        'Se a atividade foi concluída';
      COMMENT ON COLUMN compras.atividades_produto_status_especificas.nao_aplicavel IS 
        'Se a atividade não se aplica a este produto';
      COMMENT ON COLUMN compras.atividades_produto_status_especificas.observacao_status IS 
        'Observações sobre o status da atividade';
      COMMENT ON COLUMN compras.atividades_produto_status_especificas.data_conclusao IS 
        'Data e hora da conclusão da atividade';
    `);
    
    console.log('📝 Comentários adicionados com sucesso!');
    
    // Verificar se a tabela foi criada
    const result = await client.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'compras' 
        AND table_name = 'atividades_produto_status_especificas'
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
criarTabelaAtividadesProdutoStatusEspecificasCompras()
  .then(() => {
    console.log('🎉 Script concluído com sucesso!');
    process.exit(0);
  })
  .catch(err => {
    console.error('💥 Erro fatal:', err);
    process.exit(1);
  });
