-- ============================================================================
-- Desativa automações de preenchimento em pedidos_omie e pedidos_omie_produtos
-- Data: 27/02/2026
-- Objetivo:
--   - parar preenchimento automático de compras.pedidos_omie.n_valor
--   - parar preenchimento automático de compras.pedidos_omie."Etapa_NF"
--   - parar preenchimento automático de compras.pedidos_omie_produtos.c_link_nfe_pdf
--   - parar preenchimento automático de compras.pedidos_omie_produtos.c_dados_adicionais_nfe
-- ============================================================================

-- 1) Desativa automação de n_valor
DROP TRIGGER IF EXISTS trg_pedidos_omie_set_n_valor ON compras.pedidos_omie;
DROP TRIGGER IF EXISTS trg_pedidos_omie_produtos_sync_n_valor ON compras.pedidos_omie_produtos;

DROP FUNCTION IF EXISTS compras.fn_pedidos_omie_set_n_valor();
DROP FUNCTION IF EXISTS compras.fn_pedidos_omie_produtos_sync_n_valor();
DROP FUNCTION IF EXISTS compras.fn_recalcular_n_valor_pedido_omie(BIGINT);

-- 2) Desativa automação de vínculo com recebimentos NF-e
DROP TRIGGER IF EXISTS trg_vincular_recebimento_nfe_produtos ON logistica.recebimentos_nfe_omie;
DROP TRIGGER IF EXISTS trg_vincular_recebimento_nfe_pedido_produto ON logistica.recebimentos_nfe_omie;
DROP TRIGGER IF EXISTS trg_vincular_recebimento_nfe_por_pedido ON compras.pedidos_omie;
DROP TRIGGER IF EXISTS trg_vincular_recebimento_nfe_por_produto_pedido ON compras.pedidos_omie_produtos;

DROP FUNCTION IF EXISTS compras.fn_trg_vincular_recebimento_nfe_produtos();
DROP FUNCTION IF EXISTS compras.fn_trg_vincular_recebimento_nfe_por_pedido();
DROP FUNCTION IF EXISTS compras.fn_trg_vincular_recebimento_nfe_por_produto_pedido();
DROP FUNCTION IF EXISTS compras.fn_aplicar_vinculo_nfe_por_recebimento(BIGINT);
DROP FUNCTION IF EXISTS compras.fn_aplicar_vinculo_nfe_por_pedido(BIGINT);
