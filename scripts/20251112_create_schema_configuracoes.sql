-- Objetivo: Criar schema configuracoes para armazenar configurações do sistema
-- Este schema separará tabelas de configuração das tabelas principais

CREATE SCHEMA IF NOT EXISTS configuracoes;

COMMENT ON SCHEMA configuracoes IS 'Schema para tabelas de configuração do sistema';
