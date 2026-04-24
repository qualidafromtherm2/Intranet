BEGIN;

ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS acao_ultimo VARCHAR(40);
ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS id_nf_omie BIGINT;
ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS serie VARCHAR(10);
ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS url_xml TEXT;
ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS ambiente VARCHAR(10);
ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS operacao VARCHAR(30);
ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS hora_emissao VARCHAR(20);
ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS id_pedido_omie BIGINT;
ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS url_danfe TEXT;
ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS empresa_ie VARCHAR(40);
ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS empresa_uf VARCHAR(5);
ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS empresa_cnpj VARCHAR(20);

COMMIT;