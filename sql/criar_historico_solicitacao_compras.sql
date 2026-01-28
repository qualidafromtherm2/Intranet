-- ============================================================================
-- SISTEMA DE HISTÓRICO/AUDITORIA PARA SOLICITAÇÕES DE COMPRAS
-- ============================================================================
-- Objetivo: Registrar automaticamente todas as operações (INSERT/UPDATE/DELETE)
-- realizadas na tabela compras.solicitacao_compras para auditoria completa
-- ============================================================================

-- 1) Criar tabela de histórico
CREATE TABLE IF NOT EXISTS compras.historico_solicitacao_compras (
  id SERIAL PRIMARY KEY,
  solicitacao_id INTEGER NOT NULL,  -- ID do item na tabela solicitacao_compras
  operacao TEXT NOT NULL CHECK (operacao IN ('INSERT', 'UPDATE', 'DELETE')),
  campo_alterado TEXT,              -- Nome do campo que foi alterado (NULL para INSERT/DELETE completo)
  valor_anterior TEXT,              -- Valor antes da alteração (NULL para INSERT)
  valor_novo TEXT,                  -- Valor depois da alteração (NULL para DELETE)
  usuario TEXT,                     -- Username de quem fez a alteração
  descricao_item TEXT,              -- Descrição do produto para facilitar identificação
  status_item TEXT,                 -- Status do item no momento da operação
  departamento TEXT,                -- Departamento do item
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2) Criar índices para otimizar consultas
CREATE INDEX IF NOT EXISTS idx_historico_solicitacao_id 
  ON compras.historico_solicitacao_compras(solicitacao_id);

CREATE INDEX IF NOT EXISTS idx_historico_operacao 
  ON compras.historico_solicitacao_compras(operacao);

CREATE INDEX IF NOT EXISTS idx_historico_created_at 
  ON compras.historico_solicitacao_compras(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_historico_usuario 
  ON compras.historico_solicitacao_compras(usuario);

-- 3) Criar função trigger para registrar histórico automaticamente
CREATE OR REPLACE FUNCTION compras.fn_registrar_historico_solicitacao()
RETURNS TRIGGER AS $$
DECLARE
  v_usuario TEXT;
BEGIN
  -- Tenta pegar o usuário da sessão (se configurado pela aplicação)
  BEGIN
    v_usuario := current_setting('app.current_user', true);
  EXCEPTION WHEN OTHERS THEN
    v_usuario := current_user;
  END;

  -- INSERÇÃO DE NOVO ITEM
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO compras.historico_solicitacao_compras (
      solicitacao_id,
      operacao,
      campo_alterado,
      valor_anterior,
      valor_novo,
      usuario,
      descricao_item,
      status_item,
      departamento
    ) VALUES (
      NEW.id,
      'INSERT',
      'NOVO_ITEM',
      NULL,
      format('Descrição: %s | Qtd: %s | Solicitante: %s',
        COALESCE(NEW.descricao, '-'),
        COALESCE(NEW.quantidade::TEXT, '-'),
        COALESCE(NEW.solicitante, '-')
      ),
      v_usuario,
      NEW.descricao,
      NEW.status,
      NEW.departamento
    );
    RETURN NEW;
  END IF;

  -- ATUALIZAÇÃO DE ITEM EXISTENTE
  IF (TG_OP = 'UPDATE') THEN
    -- Registra mudança de STATUS
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
      INSERT INTO compras.historico_solicitacao_compras (
        solicitacao_id,
        operacao,
        campo_alterado,
        valor_anterior,
        valor_novo,
        usuario,
        descricao_item,
        status_item,
        departamento
      ) VALUES (
        NEW.id,
        'UPDATE',
        'status',
        OLD.status,
        NEW.status,
        v_usuario,
        NEW.descricao,
        NEW.status,
        NEW.departamento
      );
    END IF;

    -- Registra mudança de QUANTIDADE
    IF (OLD.quantidade IS DISTINCT FROM NEW.quantidade) THEN
      INSERT INTO compras.historico_solicitacao_compras (
        solicitacao_id,
        operacao,
        campo_alterado,
        valor_anterior,
        valor_novo,
        usuario,
        descricao_item,
        status_item,
        departamento
      ) VALUES (
        NEW.id,
        'UPDATE',
        'quantidade',
        OLD.quantidade::TEXT,
        NEW.quantidade::TEXT,
        v_usuario,
        NEW.descricao,
        NEW.status,
        NEW.departamento
      );
    END IF;

    -- Registra mudança de DESCRIÇÃO
    IF (OLD.descricao IS DISTINCT FROM NEW.descricao) THEN
      INSERT INTO compras.historico_solicitacao_compras (
        solicitacao_id,
        operacao,
        campo_alterado,
        valor_anterior,
        valor_novo,
        usuario,
        descricao_item,
        status_item,
        departamento
      ) VALUES (
        NEW.id,
        'UPDATE',
        'descricao',
        OLD.descricao,
        NEW.descricao,
        v_usuario,
        NEW.descricao,
        NEW.status,
        NEW.departamento
      );
    END IF;

    -- Registra mudança de DEPARTAMENTO
    IF (OLD.departamento IS DISTINCT FROM NEW.departamento) THEN
      INSERT INTO compras.historico_solicitacao_compras (
        solicitacao_id,
        operacao,
        campo_alterado,
        valor_anterior,
        valor_novo,
        usuario,
        descricao_item,
        status_item,
        departamento
      ) VALUES (
        NEW.id,
        'UPDATE',
        'departamento',
        OLD.departamento,
        NEW.departamento,
        v_usuario,
        NEW.descricao,
        NEW.status,
        NEW.departamento
      );
    END IF;

    -- Registra mudança de SOLICITANTE
    IF (OLD.solicitante IS DISTINCT FROM NEW.solicitante) THEN
      INSERT INTO compras.historico_solicitacao_compras (
        solicitacao_id,
        operacao,
        campo_alterado,
        valor_anterior,
        valor_novo,
        usuario,
        descricao_item,
        status_item,
        departamento
      ) VALUES (
        NEW.id,
        'UPDATE',
        'solicitante',
        OLD.solicitante,
        NEW.solicitante,
        v_usuario,
        NEW.descricao,
        NEW.status,
        NEW.departamento
      );
    END IF;

    -- Registra mudança de CÓDIGO OMIE
    IF (OLD.codigo_produto_omie IS DISTINCT FROM NEW.codigo_produto_omie) THEN
      INSERT INTO compras.historico_solicitacao_compras (
        solicitacao_id,
        operacao,
        campo_alterado,
        valor_anterior,
        valor_novo,
        usuario,
        descricao_item,
        status_item,
        departamento
      ) VALUES (
        NEW.id,
        'UPDATE',
        'codigo_produto_omie',
        OLD.codigo_produto_omie,
        NEW.codigo_produto_omie,
        v_usuario,
        NEW.descricao,
        NEW.status,
        NEW.departamento
      );
    END IF;

    -- Registra mudança de CATEGORIA
    IF (OLD.categoria IS DISTINCT FROM NEW.categoria) THEN
      INSERT INTO compras.historico_solicitacao_compras (
        solicitacao_id,
        operacao,
        campo_alterado,
        valor_anterior,
        valor_novo,
        usuario,
        descricao_item,
        status_item,
        departamento
      ) VALUES (
        NEW.id,
        'UPDATE',
        'categoria',
        OLD.categoria,
        NEW.categoria,
        v_usuario,
        NEW.descricao,
        NEW.status,
        NEW.departamento
      );
    END IF;

    -- Registra mudança de OBSERVAÇÃO
    IF (OLD.observacao IS DISTINCT FROM NEW.observacao) THEN
      INSERT INTO compras.historico_solicitacao_compras (
        solicitacao_id,
        operacao,
        campo_alterado,
        valor_anterior,
        valor_novo,
        usuario,
        descricao_item,
        status_item,
        departamento
      ) VALUES (
        NEW.id,
        'UPDATE',
        'observacao',
        LEFT(OLD.observacao, 200),
        LEFT(NEW.observacao, 200),
        v_usuario,
        NEW.descricao,
        NEW.status,
        NEW.departamento
      );
    END IF;

    -- Registra mudança de OBJETIVO DA COMPRA
    IF (OLD.objetivo_compra IS DISTINCT FROM NEW.objetivo_compra) THEN
      INSERT INTO compras.historico_solicitacao_compras (
        solicitacao_id,
        operacao,
        campo_alterado,
        valor_anterior,
        valor_novo,
        usuario,
        descricao_item,
        status_item,
        departamento
      ) VALUES (
        NEW.id,
        'UPDATE',
        'objetivo_compra',
        LEFT(OLD.objetivo_compra, 200),
        LEFT(NEW.objetivo_compra, 200),
        v_usuario,
        NEW.descricao,
        NEW.status,
        NEW.departamento
      );
    END IF;

    RETURN NEW;
  END IF;

  -- DELEÇÃO DE ITEM
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO compras.historico_solicitacao_compras (
      solicitacao_id,
      operacao,
      campo_alterado,
      valor_anterior,
      valor_novo,
      usuario,
      descricao_item,
      status_item,
      departamento
    ) VALUES (
      OLD.id,
      'DELETE',
      'ITEM_REMOVIDO',
      format('Descrição: %s | Qtd: %s | Status: %s',
        COALESCE(OLD.descricao, '-'),
        COALESCE(OLD.quantidade::TEXT, '-'),
        COALESCE(OLD.status, '-')
      ),
      NULL,
      v_usuario,
      OLD.descricao,
      OLD.status,
      OLD.departamento
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 4) Criar trigger na tabela solicitacao_compras
DROP TRIGGER IF EXISTS trg_historico_solicitacao_compras ON compras.solicitacao_compras;

CREATE TRIGGER trg_historico_solicitacao_compras
  AFTER INSERT OR UPDATE OR DELETE ON compras.solicitacao_compras
  FOR EACH ROW
  EXECUTE FUNCTION compras.fn_registrar_historico_solicitacao();

-- 5) Mensagem de sucesso
SELECT 'Sistema de histórico criado com sucesso!' as status,
       'Tabela: compras.historico_solicitacao_compras' as tabela,
       'Trigger: trg_historico_solicitacao_compras' as trigger;

-- ============================================================================
-- EXEMPLOS DE CONSULTAS ÚTEIS
-- ============================================================================

-- Consultar histórico de um item específico
-- SELECT * FROM compras.historico_solicitacao_compras 
-- WHERE solicitacao_id = 123 
-- ORDER BY created_at DESC;

-- Consultar todas as mudanças de status
-- SELECT * FROM compras.historico_solicitacao_compras 
-- WHERE campo_alterado = 'status' 
-- ORDER BY created_at DESC LIMIT 50;

-- Consultar histórico de um período
-- SELECT * FROM compras.historico_solicitacao_compras 
-- WHERE created_at >= NOW() - INTERVAL '7 days' 
-- ORDER BY created_at DESC;

-- Consultar ações de um usuário específico
-- SELECT * FROM compras.historico_solicitacao_compras 
-- WHERE usuario = 'nome_usuario' 
-- ORDER BY created_at DESC;

-- Relatório resumido de operações
-- SELECT 
--   operacao,
--   campo_alterado,
--   COUNT(*) as total,
--   COUNT(DISTINCT solicitacao_id) as itens_afetados
-- FROM compras.historico_solicitacao_compras
-- WHERE created_at >= NOW() - INTERVAL '30 days'
-- GROUP BY operacao, campo_alterado
-- ORDER BY total DESC;
