-- Criação do schema e tabela para auditoria de modificações de produto
CREATE SCHEMA IF NOT EXISTS auditoria_produto;

CREATE TABLE IF NOT EXISTS auditoria_produto.historico_modificacoes (
    id SERIAL PRIMARY KEY,
    codigo_omie VARCHAR(50) NOT NULL,
    tipo_acao VARCHAR(100) NOT NULL, -- Ex: ALTERACAO_CADASTRO, ABERTURA_OP, MUDANCA_ESTRUTURA, MENCAO
    usuario VARCHAR(100) NOT NULL,
    data_hora TIMESTAMP NOT NULL DEFAULT NOW(),
    detalhes TEXT, -- Descrição da modificação
    origem VARCHAR(50) -- Ex: OMIE, SQL, API
);

-- Exemplo de INSERT para registrar uma modificação
-- INSERT INTO auditoria_produto.historico_modificacoes (codigo_omie, tipo_acao, usuario, detalhes, origem)
-- VALUES ('123456', 'ALTERACAO_CADASTRO', 'leandro', 'Alteração no campo X', 'SQL');
