-- Tabela para armazenar solicitações de compra de produtos sem cadastro na Omie
-- Criada para separar produtos cadastrados (solicitacao_compras) de não cadastrados

CREATE TABLE IF NOT EXISTS compras.compras_sem_cadastro (
  id SERIAL PRIMARY KEY,
  
  -- Informações do produto
  produto_codigo VARCHAR(255) NOT NULL, -- Código provisório gerado (CODPROV-XXX ou TEMP-XXX)
  produto_descricao TEXT NOT NULL, -- Keywords separadas por ponto e vírgula
  quantidade INTEGER NOT NULL DEFAULT 1,
  
  -- Informações de departamento e categoria
  departamento VARCHAR(255) NOT NULL,
  centro_custo VARCHAR(255) NOT NULL, -- Categoria do departamento
  
  -- Informações de compra
  categoria_compra_codigo VARCHAR(50), -- Código da categoria de compra (padrão: 2.14.94)
  categoria_compra_nome VARCHAR(255), -- Nome da categoria de compra
  objetivo_compra TEXT, -- Objetivo/finalidade da compra
  
  -- Tipo de retorno solicitado
  retorno_cotacao VARCHAR(255), -- Tipo de retorno: valores, características técnicas, etc.
  
  -- Responsável e observações
  resp_inspecao_recebimento VARCHAR(255), -- Responsável pela inspeção ao receber
  observacao_recebimento TEXT, -- Observações específicas para o recebimento
  
  -- Anexos (arquivos: imagens, PDF, Excel)
  anexos JSONB, -- Array de objetos com {nome, tipo, tamanho, base64 ou url}
  
  -- Controle e rastreamento
  solicitante VARCHAR(255) NOT NULL, -- Usuário que fez a solicitação
  status VARCHAR(50) DEFAULT 'pendente', -- Status da solicitação
  grupo_requisicao VARCHAR(100), -- Agrupa múltiplas solicitações
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para melhorar performance de consultas
CREATE INDEX IF NOT EXISTS idx_compras_sem_cadastro_solicitante 
  ON compras.compras_sem_cadastro(solicitante);

CREATE INDEX IF NOT EXISTS idx_compras_sem_cadastro_status 
  ON compras.compras_sem_cadastro(status);

CREATE INDEX IF NOT EXISTS idx_compras_sem_cadastro_departamento 
  ON compras.compras_sem_cadastro(departamento);

CREATE INDEX IF NOT EXISTS idx_compras_sem_cadastro_grupo 
  ON compras.compras_sem_cadastro(grupo_requisicao);

CREATE INDEX IF NOT EXISTS idx_compras_sem_cadastro_created 
  ON compras.compras_sem_cadastro(created_at DESC);

-- Comentários para documentação
COMMENT ON TABLE compras.compras_sem_cadastro IS 'Armazena solicitações de compra para produtos que não possuem cadastro na Omie';
COMMENT ON COLUMN compras.compras_sem_cadastro.produto_codigo IS 'Código provisório gerado pela API (CODPROV-XXX)';
COMMENT ON COLUMN compras.compras_sem_cadastro.produto_descricao IS 'Palavras-chave do produto separadas por ponto e vírgula';
COMMENT ON COLUMN compras.compras_sem_cadastro.anexos IS 'Array JSON com arquivos anexados (imagens, PDFs, planilhas)';
COMMENT ON COLUMN compras.compras_sem_cadastro.categoria_compra_codigo IS 'Código da categoria de compra Omie (padrão: 2.14.94 - Outros Materiais)';
COMMENT ON COLUMN compras.compras_sem_cadastro.grupo_requisicao IS 'Agrupa múltiplas solicitações em uma única requisição';
