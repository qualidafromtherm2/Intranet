-- Migração: adiciona coluna de Número da OP na tabela de registro de verificação
-- Executar uma vez no banco de produção/homologação

ALTER TABLE qualidade."Reg_PC_OK"
ADD COLUMN IF NOT EXISTS numero_op TEXT;
