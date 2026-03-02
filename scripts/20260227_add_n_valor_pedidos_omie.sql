-- ============================================================================
-- Adiciona coluna n_valor em compras.pedidos_omie
-- Data: 27/02/2026
-- Objetivo: manter o total do pedido com base na soma de n_val_tot dos itens
--           em compras.pedidos_omie_produtos por n_cod_ped.
-- ============================================================================

-- 1) Nova coluna para total do pedido
ALTER TABLE compras.pedidos_omie
ADD COLUMN IF NOT EXISTS n_valor NUMERIC(15,2);

COMMENT ON COLUMN compras.pedidos_omie.n_valor IS
'Soma de compras.pedidos_omie_produtos.n_val_tot por n_cod_ped';

-- 2) Função utilitária: recalcula n_valor para um n_cod_ped específico
CREATE OR REPLACE FUNCTION compras.fn_recalcular_n_valor_pedido_omie(p_n_cod_ped BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE compras.pedidos_omie po
  SET n_valor = COALESCE(src.total, 0),
      updated_at = NOW()
  FROM (
    SELECT p_n_cod_ped AS n_cod_ped,
           SUM(COALESCE(pop.n_val_tot, 0))::NUMERIC(15,2) AS total
    FROM compras.pedidos_omie_produtos pop
    WHERE pop.n_cod_ped = p_n_cod_ped
  ) src
  WHERE po.n_cod_ped = src.n_cod_ped;
END;
$$;

-- 3) Backfill inicial para todos os pedidos já existentes
UPDATE compras.pedidos_omie po
SET n_valor = COALESCE(src.total, 0),
    updated_at = NOW()
FROM (
  SELECT po2.n_cod_ped,
         SUM(COALESCE(pop.n_val_tot, 0))::NUMERIC(15,2) AS total
  FROM compras.pedidos_omie po2
  LEFT JOIN compras.pedidos_omie_produtos pop
    ON pop.n_cod_ped = po2.n_cod_ped
  GROUP BY po2.n_cod_ped
) src
WHERE po.n_cod_ped = src.n_cod_ped;

-- 4) Trigger no cabeçalho para preencher/atualizar n_valor em INSERT/UPDATE
CREATE OR REPLACE FUNCTION compras.fn_pedidos_omie_set_n_valor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.n_valor := COALESCE((
    SELECT SUM(COALESCE(pop.n_val_tot, 0))::NUMERIC(15,2)
    FROM compras.pedidos_omie_produtos pop
    WHERE pop.n_cod_ped = NEW.n_cod_ped
  ), 0);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_omie_set_n_valor ON compras.pedidos_omie;

CREATE TRIGGER trg_pedidos_omie_set_n_valor
BEFORE INSERT OR UPDATE ON compras.pedidos_omie
FOR EACH ROW
EXECUTE FUNCTION compras.fn_pedidos_omie_set_n_valor();

-- 5) Trigger nos produtos para manter o cabeçalho sincronizado em INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION compras.fn_pedidos_omie_produtos_sync_n_valor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM compras.fn_recalcular_n_valor_pedido_omie(NEW.n_cod_ped);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.n_cod_ped IS DISTINCT FROM OLD.n_cod_ped THEN
      PERFORM compras.fn_recalcular_n_valor_pedido_omie(OLD.n_cod_ped);
      PERFORM compras.fn_recalcular_n_valor_pedido_omie(NEW.n_cod_ped);
    ELSE
      PERFORM compras.fn_recalcular_n_valor_pedido_omie(NEW.n_cod_ped);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM compras.fn_recalcular_n_valor_pedido_omie(OLD.n_cod_ped);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_omie_produtos_sync_n_valor
  ON compras.pedidos_omie_produtos;

CREATE TRIGGER trg_pedidos_omie_produtos_sync_n_valor
AFTER INSERT OR UPDATE OR DELETE ON compras.pedidos_omie_produtos
FOR EACH ROW
EXECUTE FUNCTION compras.fn_pedidos_omie_produtos_sync_n_valor();
