-- Criar tabela de unidades no schema configuracoes
CREATE TABLE IF NOT EXISTS configuracoes.unidade (
    id SERIAL PRIMARY KEY,
    unidade VARCHAR(10) NOT NULL UNIQUE,
    descricao VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inserir unidades padrão
INSERT INTO configuracoes.unidade (unidade, descricao) VALUES
    ('UN', 'Unidade'),
    ('KG', 'Kilograma'),
    ('CX', 'Caixa')
ON CONFLICT (unidade) DO NOTHING;

-- Criar índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_unidade_unidade ON configuracoes.unidade(unidade);

-- Comentários
COMMENT ON TABLE configuracoes.unidade IS 'Tabela de unidades de medida para produtos';
COMMENT ON COLUMN configuracoes.unidade.id IS 'ID único da unidade';
COMMENT ON COLUMN configuracoes.unidade.unidade IS 'Código da unidade (ex: UN, KG, CX)';
COMMENT ON COLUMN configuracoes.unidade.descricao IS 'Descrição completa da unidade';
