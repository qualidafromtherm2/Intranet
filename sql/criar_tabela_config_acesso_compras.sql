-- Script para criar tabela de configuração de acesso aos botões de compras
-- Objetivo: Controlar quem pode ver e usar os botões "Abrir tudo" de Aprovação e Pedido de Compra

CREATE TABLE IF NOT EXISTS compras.config_acesso_botoes (
  id SERIAL PRIMARY KEY,
  tipo_botao TEXT NOT NULL CHECK (tipo_botao IN ('aprovacao', 'pedido_compra')),
  responsavel_username TEXT NOT NULL,
  departamento_nome TEXT NOT NULL,
  data_criacao TIMESTAMP DEFAULT NOW(),
  UNIQUE(tipo_botao, responsavel_username, departamento_nome)
);

-- Comentários na tabela
COMMENT ON TABLE compras.config_acesso_botoes IS 'Configuração de acesso aos botões Abrir tudo de Aprovação e Pedido de Compra';
COMMENT ON COLUMN compras.config_acesso_botoes.tipo_botao IS 'Tipo do botão: aprovacao ou pedido_compra';
COMMENT ON COLUMN compras.config_acesso_botoes.responsavel_username IS 'Username do colaborador responsável';
COMMENT ON COLUMN compras.config_acesso_botoes.departamento_nome IS 'Nome do departamento com acesso';

-- Index para melhorar performance nas consultas
CREATE INDEX IF NOT EXISTS idx_config_acesso_responsavel ON compras.config_acesso_botoes(responsavel_username);
CREATE INDEX IF NOT EXISTS idx_config_acesso_tipo ON compras.config_acesso_botoes(tipo_botao);
