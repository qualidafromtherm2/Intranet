-- ===== CRIAR SCHEMA CONFIGURACOES (se não existir) =====
CREATE SCHEMA IF NOT EXISTS configuracoes;

-- ===== CRIAR TABELA VERSAO_SISTEMA =====
-- Objetivo: Armazenar a versão atual do sistema para sincronização com clientes
-- Esta tabela terá apenas UMA linha que será atualizada a cada deploy/push

CREATE TABLE IF NOT EXISTS configuracoes.versao_sistema (
  id SERIAL PRIMARY KEY,
  versao VARCHAR(50) NOT NULL DEFAULT '1.0.0',
  descricao TEXT,
  data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizado_por VARCHAR(100) DEFAULT 'sistema'
);

-- ===== INSERIR VERSÃO INICIAL =====
-- Insere apenas se a tabela estiver vazia
INSERT INTO configuracoes.versao_sistema (versao, descricao, atualizado_por)
SELECT '1.0.0', 'Versão inicial do sistema com detecção de atualização', 'sistema'
WHERE NOT EXISTS (SELECT 1 FROM configuracoes.versao_sistema);

-- ===== CRIAR ÍNDICE ÚNICO =====
-- Garante que apenas uma linha seja mantida
CREATE UNIQUE INDEX IF NOT EXISTS idx_versao_unica 
ON configuracoes.versao_sistema((id IS NOT NULL)) 
WHERE id IS NOT NULL;

-- ===== CRIAR FUNÇÃO PARA ATUALIZAR VERSÃO =====
-- Uso: SELECT configuracoes.atualizar_versao_sistema('1.0.1', 'Atualização de segurança');
CREATE OR REPLACE FUNCTION configuracoes.atualizar_versao_sistema(
  p_nova_versao VARCHAR(50),
  p_descricao TEXT DEFAULT NULL,
  p_atualizado_por VARCHAR(100) DEFAULT 'sistema'
)
RETURNS TABLE (versao_anterior VARCHAR(50), versao_nova VARCHAR(50), data_atualizacao TIMESTAMP) AS $$
DECLARE
  v_versao_anterior VARCHAR(50);
BEGIN
  -- Pega versão anterior
  SELECT versao INTO v_versao_anterior FROM configuracoes.versao_sistema LIMIT 1;
  
  -- Atualiza a versão (sempre na primeira linha)
  UPDATE configuracoes.versao_sistema
  SET 
    versao = p_nova_versao,
    descricao = COALESCE(p_descricao, descricao),
    data_atualizacao = CURRENT_TIMESTAMP,
    atualizado_por = p_atualizado_por
  WHERE id = 1;
  
  -- Retorna os dados da atualização
  RETURN QUERY
  SELECT v_versao_anterior, p_nova_versao, CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- ===== CONSULTAS ÚTEIS =====
-- Ver versão atual:
-- SELECT versao, descricao, data_atualizacao, atualizado_por FROM configuracoes.versao_sistema;

-- Atualizar versão para 1.0.1:
-- SELECT * FROM configuracoes.atualizar_versao_sistema('1.0.1', 'Descrição da atualização');

-- Ver histórico (se você quiser manter um histórico, crie outra tabela)
-- Exemplo futura melhoria: audit_versao_sistema com backup automático
