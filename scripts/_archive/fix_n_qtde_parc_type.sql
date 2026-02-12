-- Objetivo: Converter o campo n_qtde_parc de INTEGER para BIGINT
-- Motivo: O Omie está enviando IDs muito grandes que não cabem em INTEGER (máximo ~2 bilhões)

-- Alterar o tipo de dado do campo n_qtde_parc
ALTER TABLE compras.pedidos_omie ALTER COLUMN n_qtde_parc TYPE BIGINT USING n_qtde_parc::BIGINT;

-- Verificar o resultado
\d+ compras.pedidos_omie