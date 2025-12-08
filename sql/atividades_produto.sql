-- Tabela para armazenar atividades específicas de cada produto
-- Independente das atividades da família

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
