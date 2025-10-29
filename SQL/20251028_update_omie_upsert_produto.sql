-- Atualiza a função public.omie_upsert_produto para mapear campos adicionais
-- sem alterar a assinatura, preservando compatibilidade com webhooks/processos existentes.

CREATE OR REPLACE FUNCTION public.omie_upsert_produto(item jsonb) RETURNS void
    LANGUAGE plpgsql
AS $$
DECLARE
  v_codigo_produto BIGINT;
  v_exists BOOLEAN;
  v_payload_rico BOOLEAN;
BEGIN
  v_codigo_produto := NULLIF(item->>'codigo_produto','')::BIGINT;
  IF v_codigo_produto IS NULL THEN
    RAISE NOTICE '[upsert] sem codigo_produto no JSON, ignorado';
    RETURN;
  END IF;

  -- define se o payload é "rico" (tem dados que valem guardar no RAW)
  v_payload_rico := (item ? 'descricao')
                    OR ((item ? 'codigo') AND (item ? 'codigo_produto_integracao'));

  -- existe row?
  SELECT TRUE INTO v_exists
  FROM public.produtos_omie
  WHERE codigo_produto = v_codigo_produto
  LIMIT 1;

  IF v_exists THEN
    -- UPDATE com preenchimento incremental (não sobrescreve com vazio)
    UPDATE public.produtos_omie AS p SET
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
      valor_unitario            = COALESCE(NULLIF(item->>'valor_unitario','')::NUMERIC,    p.valor_unitario),
      quantidade_estoque        = COALESCE(NULLIF(item->>'quantidade_estoque','')::NUMERIC,p.quantidade_estoque),
      -- novos mapeamentos de família
      descricao_familia         = COALESCE(NULLIF(item->>'descricao_familia',''),          p.descricao_familia),
      codigo_familia            = COALESCE(NULLIF(item->>'codigo_familia','')::BIGINT,     p.codigo_familia),
      codint_familia            = COALESCE(NULLIF(item->>'codInt_familia',''),             p.codint_familia),
      -- recomendacoes_fiscais
      origem_mercadoria         = COALESCE(NULLIF(item#>>'{recomendacoes_fiscais,origem_mercadoria}',''), p.origem_mercadoria),
      market_place              = COALESCE(NULLIF(item#>>'{recomendacoes_fiscais,market_place}',''),      p.market_place),
      -- datas/usuários
      dalt                      = COALESCE(TO_DATE(NULLIF(item#>>'{info,dAlt}',''),'DD/MM/YYYY'), p.dalt),
      halt                      = COALESCE(NULLIF(item#>>'{info,hAlt}','')::TIME,               p.halt),
      dinc                      = COALESCE(TO_DATE(NULLIF(item#>>'{info,dInc}',''),'DD/MM/YYYY'), p.dinc),
      hinc                      = COALESCE(NULLIF(item#>>'{info,hInc}','')::TIME,               p.hinc),
      raw                       = CASE WHEN v_payload_rico THEN item ELSE p.raw END,
      updated_at                = NOW()
    WHERE p.codigo_produto = v_codigo_produto;

  ELSE
    -- Só INSERE se tiver o mínimo para NOT NULL
    IF NULLIF(item->>'codigo','') IS NULL
       OR NULLIF(item->>'codigo_produto_integracao','') IS NULL THEN
      RAISE NOTICE '[upsert] produto % ainda não existe e payload magro. Ignorado.', v_codigo_produto;
      RETURN;
    END IF;

    INSERT INTO public.produtos_omie (
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
      -- campos de família
      descricao_familia,
      codigo_familia,
      codint_familia,
      -- recomendacoes_fiscais
      origem_mercadoria,
      market_place,
      -- datas/usuários
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
      -- familia
      NULLIF(item->>'descricao_familia',''),
      NULLIF(item->>'codigo_familia','')::BIGINT,
      NULLIF(item->>'codInt_familia',''),
      -- recomendacoes_fiscais
      NULLIF(item#>>'{recomendacoes_fiscais,origem_mercadoria}',''),
      NULLIF(item#>>'{recomendacoes_fiscais,market_place}',''),
      -- datas/usuários
      TO_DATE(NULLIF(item#>>'{info,dAlt}',''),'DD/MM/YYYY'),
      NULLIF(item#>>'{info,hAlt}','')::TIME,
      TO_DATE(NULLIF(item#>>'{info,dInc}',''),'DD/MM/YYYY'),
      NULLIF(item#>>'{info,hInc}','')::TIME,
      item,
      NOW(), NOW()
    );
  END IF;
END;
$$;