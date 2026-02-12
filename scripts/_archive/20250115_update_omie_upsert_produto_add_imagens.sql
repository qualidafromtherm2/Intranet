-- ========================================================
-- OBJETIVO: Modificar a função omie_upsert_produto para 
-- também sincronizar as imagens dos produtos na tabela
-- produtos_omie_imagens
-- ========================================================

-- Nome do arquivo: 20250115_update_omie_upsert_produto_add_imagens<. Additionalql
-- Data: 15/01/2026
-- Descrição: Atualiza a função omie_upsert_produto para processar
--            o array 'imagens' do JSON da Omie e popular a tabela
--            produtos_omie_imagens com as URLs das imagens

CREATE OR REPLACE FUNCTION public.omie_upsert_produto(item jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_codigo_produto BIGINT;
  v_exists BOOLEAN;
  v_payload_rico BOOLEAN;
  v_imagem JSONB;
  v_pos SMALLINT := 0;
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
  FROM produtos_omie
  WHERE codigo_produto = v_codigo_produto
  LIMIT 1;

  IF v_exists THEN
    -- UPDATE "parcial"
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
    -- Só INSERE se tiver o mínimo para NOT NULL
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

  -- ===== NOVO: PROCESSAR IMAGENS =====
  -- Se o JSON contém array 'imagens', atualiza a tabela produtos_omie_imagens
  IF item ? 'imagens' AND jsonb_typeof(item->'imagens') = 'array' THEN
    -- Remove imagens antigas deste produto
    DELETE FROM produtos_omie_imagens
    WHERE codigo_produto = v_codigo_produto;
    
    -- Insere novas imagens
    FOR v_imagem IN
      SELECT elem
      FROM jsonb_array_elements(item->'imagens') AS elem
    LOOP
      IF v_imagem ? 'url_imagem' AND NULLIF(v_imagem->>'url_imagem','') IS NOT NULL THEN
        INSERT INTO produtos_omie_imagens (
          codigo_produto,
          pos,
          url_imagem,
          path_key
        )
        VALUES (
          v_codigo_produto,
          v_pos,
          v_imagem->>'url_imagem',
          NULLIF(v_imagem->>'path_key','')
        );
        v_pos := v_pos + 1;
      END IF;
    END LOOP;
  END IF;

END;
$$;

-- Comentário da função
COMMENT ON FUNCTION public.omie_upsert_produto(jsonb) IS 
'Faz UPSERT de um produto da Omie na tabela produtos_omie e sincroniza as imagens na tabela produtos_omie_imagens';
