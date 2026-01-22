-- Adiciona o status 'retificar' na tabela de status de compras
INSERT INTO configuracoes.status_compras (nome, ordem, ativo) 
VALUES ('retificar', 3, true) 
ON CONFLICT (nome) DO UPDATE SET ativo = true, ordem = 3;

-- Verifica se foi inserido
SELECT * FROM configuracoes.status_compras WHERE nome = 'retificar';
