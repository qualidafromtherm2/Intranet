-- omie_upsert_produto: upsert + inativa IDs antigos do mesmo SKU.
-- Quando a Omie recria um produto (mesmo codigo, novo codigo_produto),
-- o registro ativo novo desativa os irmãos locais para não gerar
-- Client-1235 / Client-105 na separação e transferências.

CREATE OR REPLACE FUNCTION public.omie_upsert_produto(item jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_codigo_produto BIGINT;
  v_exists BOOLEAN;
  v_payload_rico BOOLEAN;
  v_codigo TEXT;
  v_integracao TEXT;
  v_inativo TEXT;
BEGIN
  v_codigo_produto := NULLIF(item->>'codigo_produto','')::BIGINT;
  IF v_codigo_produto IS NULL THEN
    RAISE NOTICE '[upsert] sem codigo_produto no JSON, ignorado';
    RETURN;
  END IF;

  v_payload_rico := (item ? 'descricao')
                    OR ((item ? 'codigo') AND (item ? 'codigo_produto_integracao'));

  SELECT TRUE INTO v_exists
  FROM produtos_omie
  WHERE codigo_produto = v_codigo_produto
  LIMIT 1;

  IF v_exists THEN
    UPDATE produtos_omie p SET
      codigo_produto_integracao = COALESCE(NULLIF(item->>'codigo_produto_integracao',''), p.codigo_produto_integracao),
      codigo                    = COALESCE(NULLIF(item->>'codigo',''),                     p.codigo),
      descricao                 = COALESCE(NULLIF(item->>'descricao',''),                  p.descricao),
      descr_detalhada           = COALESCE(NULLIF(item->>'descr_detalhada',''),            p.descr_detalhada),
      unidade                   = COALESCE(NULLIF(item->>'unidade',''),                    p.unidade),
      tipoitem                  = COALESCE(NULLIF(item->>'tipoItem',''),                   p.tipoitem),
      ncm                       = COALESCE(NULLIF(item->>'ncm',''),                        p.ncm),
      marca                     = COALESCE(NULLIF(item->>'marca',''),                      p.marca),
      modelo                    = COALESCE(NULLIF(item->>'modelo',''),                     p.modelo),
      inativo                   = COALESCE(NULLIF(item->>'inativo',''),                    p.inativo),
      bloqueado                 = COALESCE(NULLIF(item->>'bloqueado',''),                  p.bloqueado),
      valor_unitario            = COALESCE((item->>'valor_unitario')::NUMERIC,             p.valor_unitario),
      quantidade_estoque        = COALESCE((item->>'quantidade_estoque')::NUMERIC,         p.quantidade_estoque),
      dalt                      = COALESCE(TO_DATE(NULLIF(item#>>'{info,dAlt}',''),'DD/MM/YYYY'), p.dalt),
      halt                      = COALESCE(NULLIF(item#>>'{info,hAlt}','')::TIME,               p.halt),
      dinc                      = COALESCE(TO_DATE(NULLIF(item#>>'{info,dInc}',''),'DD/MM/YYYY'), p.dinc),
      hinc                      = COALESCE(NULLIF(item#>>'{info,hInc}','')::TIME,               p.hinc),
      raw                       = CASE WHEN v_payload_rico THEN item ELSE p.raw END,
      updated_at                = NOW()
    WHERE p.codigo_produto = v_codigo_produto;

  ELSE
    IF NULLIF(item->>'codigo','') IS NULL
       OR NULLIF(item->>'codigo_produto_integracao','') IS NULL THEN
      RAISE NOTICE '[upsert] produto % ainda não existe e payload magro. Ignorado.', v_codigo_produto;
      RETURN;
    END IF;

    INSERT INTO produtos_omie (
      codigo_produto,
      codigo_produto_integracao,
      codigo,
      descricao,
      descr_detalhada,
      unidade,
      tipoitem,
      ncm,
      marca,
      modelo,
      inativo,
      bloqueado,
      valor_unitario,
      quantidade_estoque,
      dalt, halt, dinc, hinc,
      raw,
      created_at, updated_at
    )
    VALUES (
      v_codigo_produto,
      item->>'codigo_produto_integracao',
      item->>'codigo',
      item->>'descricao',
      item->>'descr_detalhada',
      item->>'unidade',
      item->>'tipoItem',
      item->>'ncm',
      item->>'marca',
      item->>'modelo',
      item->>'inativo',
      item->>'bloqueado',
      NULLIF(item->>'valor_unitario','')::NUMERIC,
      NULLIF(item->>'quantidade_estoque','')::NUMERIC,
      TO_DATE(NULLIF(item#>>'{info,dAlt}',''),'DD/MM/YYYY'),
      NULLIF(item#>>'{info,hAlt}','')::TIME,
      TO_DATE(NULLIF(item#>>'{info,dInc}',''),'DD/MM/YYYY'),
      NULLIF(item#>>'{info,hInc}','')::TIME,
      item,
      NOW(), NOW()
    );
  END IF;

  -- Produto ativo: inativa IDs antigos com o mesmo SKU / código de integração.
  SELECT TRIM(codigo), TRIM(COALESCE(codigo_produto_integracao, '')),
         COALESCE(NULLIF(UPPER(TRIM(inativo)), ''), 'N')
    INTO v_codigo, v_integracao, v_inativo
    FROM produtos_omie
   WHERE codigo_produto = v_codigo_produto;

  IF v_inativo NOT IN ('S', 'SIM') AND (COALESCE(v_codigo, '') <> '' OR COALESCE(v_integracao, '') <> '') THEN
    UPDATE produtos_omie
       SET inativo = 'S',
           updated_at = NOW()
     WHERE codigo_produto <> v_codigo_produto
       AND COALESCE(UPPER(TRIM(inativo)), 'N') <> 'S'
       AND (
         (COALESCE(v_codigo, '') <> '' AND TRIM(codigo) = v_codigo)
         OR (COALESCE(v_integracao, '') <> '' AND TRIM(COALESCE(codigo_produto_integracao, '')) = v_integracao)
       );
  END IF;

  -- IMAGENS NÃO SÃO MAIS SINCRONIZADAS A PARTIR DA OMIE.
  -- Elas residem no Supabase Storage e são gerenciadas via /api/produtos/:codigo/fotos.
END;
$function$;

COMMENT ON FUNCTION public.omie_upsert_produto(jsonb) IS
'Upsert produtos_omie + inativa duplicatas do mesmo SKU (ID antigo). Imagens no Supabase.';
