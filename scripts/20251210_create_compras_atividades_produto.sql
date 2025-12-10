-- Script para criar tabelas de atividades específicas de compras por produto
-- Execute este script no seu banco de dados PostgreSQL

-- 1. Criar tabela de atividades específicas do produto
CREATE TABLE IF NOT EXISTS compras.atividades_produto (
  id SERIAL PRIMARY KEY,
  produto_codigo VARCHAR(50) NOT NULL,
  descricao TEXT NOT NULL,
  observacoes TEXT,
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- 2. Criar índice para buscar atividades por produto
CREATE INDEX IF NOT EXISTS idx_atividades_produto_compras_codigo 
  ON compras.atividades_produto(produto_codigo) 
  WHERE ativo = true;

-- 3. Adicionar comentários
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

-- 4. Criar tabela de status das atividades específicas
CREATE TABLE IF NOT EXISTS compras.atividades_produto_status_especificas (
  id SERIAL PRIMARY KEY,
  produto_codigo VARCHAR(50) NOT NULL,
  atividade_produto_id INTEGER NOT NULL REFERENCES compras.atividades_produto(id),
  concluido BOOLEAN DEFAULT false,
  nao_aplicavel BOOLEAN DEFAULT false,
  observacao_status TEXT,
  data_conclusao TIMESTAMP,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW(),
  UNIQUE(produto_codigo, atividade_produto_id)
);

-- 5. Criar índices para a tabela de status
CREATE INDEX IF NOT EXISTS idx_atividades_produto_status_especificas_compras_codigo 
  ON compras.atividades_produto_status_especificas(produto_codigo);

CREATE INDEX IF NOT EXISTS idx_atividades_produto_status_especificas_compras_atividade 
  ON compras.atividades_produto_status_especificas(atividade_produto_id);

-- 6. Adicionar comentários na tabela de status
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

-- Verificação
SELECT 
  table_schema,
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = t.table_schema AND table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'compras' 
  AND table_name IN ('atividades_produto', 'atividades_produto_status_especificas')
ORDER BY table_name;
