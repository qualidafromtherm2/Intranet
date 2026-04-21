-- Cria schema de vendas e transfere tabelas de pedidos para ele.
-- Mantém views de compatibilidade em public para reduzir risco de quebra
-- em funções legadas ainda qualificadas com public.

BEGIN;

CREATE SCHEMA IF NOT EXISTS "Vendas";

DO $$
BEGIN
  IF to_regclass('"Vendas".pedidos_venda') IS NULL
     AND to_regclass('public.pedidos_venda') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pedidos_venda SET SCHEMA "Vendas"';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"Vendas".pedidos_venda_itens') IS NULL
     AND to_regclass('public.pedidos_venda_itens') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pedidos_venda_itens SET SCHEMA "Vendas"';
  END IF;
END $$;

-- Compatibilidade para SQL legado (simples e updatable)
DO $$
BEGIN
  IF to_regclass('public.pedidos_venda') IS NULL
     AND to_regclass('"Vendas".pedidos_venda') IS NOT NULL THEN
    EXECUTE 'CREATE VIEW public.pedidos_venda AS SELECT * FROM "Vendas".pedidos_venda';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.pedidos_venda_itens') IS NULL
     AND to_regclass('"Vendas".pedidos_venda_itens') IS NOT NULL THEN
    EXECUTE 'CREATE VIEW public.pedidos_venda_itens AS SELECT * FROM "Vendas".pedidos_venda_itens';
  END IF;
END $$;

-- Wrapper no novo schema para direcionar chamadas de webhook/agendamento.
CREATE OR REPLACE FUNCTION "Vendas".pedido_upsert_from_payload(payload jsonb)
RETURNS void
LANGUAGE sql
AS $$
  SELECT public.pedido_upsert_from_payload(payload);
$$;

CREATE OR REPLACE FUNCTION "Vendas".pedidos_upsert_from_list(payload jsonb)
RETURNS bigint
LANGUAGE sql
AS $$
  SELECT public.pedidos_upsert_from_list(payload);
$$;

COMMIT;
