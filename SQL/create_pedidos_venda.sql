DROP VIEW IF EXISTS public.kanban_comercial_view CASCADE;
DROP FUNCTION IF EXISTS public.pedidos_upsert_from_list(jsonb);
DROP FUNCTION IF EXISTS public.pedido_upsert_from_payload(jsonb);
DROP FUNCTION IF EXISTS public.pedido_itens_upsert_from_payload(jsonb);
DROP FUNCTION IF EXISTS public._pedido_insert_item(bigint, jsonb);
DROP FUNCTION IF EXISTS public._util_to_date(text);
DROP FUNCTION IF EXISTS public._util_to_numeric(text);

-- Pedidos de venda — estrutura principal
CREATE TABLE IF NOT EXISTS public.pedidos_venda (
    codigo_pedido               bigint PRIMARY KEY,
    codigo_pedido_integracao    text,
    numero_pedido               text,
    numero_pedido_cliente       text,
    codigo_cliente              text,
    codigo_cliente_integracao   text,
    data_previsao               date,
    etapa                       text,
    origem_pedido               text,
    codigo_empresa              text,
    codigo_empresa_integracao   text,
    tipo_desconto_pedido        text,
    perc_desconto_pedido        numeric,
    valor_desconto_pedido       numeric,
    bloqueado                   text,
    encerrado                   text,
    enc_motivo                  text,
    enc_data                    text,
    enc_hora                    text,
    enc_user                    text,
    nao_gerar_boleto            text,
    status                      text,
    cabecalho                   jsonb,
    total_pedido                jsonb,
    informacoes_adicionais      jsonb,
    raw_payload                 jsonb,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_venda_numero
    ON public.pedidos_venda (numero_pedido);

CREATE INDEX IF NOT EXISTS idx_pedidos_venda_cliente
    ON public.pedidos_venda (codigo_cliente);

CREATE INDEX IF NOT EXISTS idx_pedidos_venda_etapa
    ON public.pedidos_venda (etapa);


-- Itens do pedido de venda
CREATE TABLE IF NOT EXISTS public.pedidos_venda_itens (
    codigo_pedido                 bigint REFERENCES public.pedidos_venda(codigo_pedido) ON DELETE CASCADE,
    codigo_item                   text    NOT NULL DEFAULT '',
    codigo_item_integracao        text,
    sequencial                    integer NOT NULL DEFAULT 0,
    codigo                        text,
    codigo_produto                text,
    codigo_produto_integracao     text,
    descricao                     text,
    unidade                       text,
    quantidade                    numeric,
    valor_unitario                numeric,
    valor_mercadoria              numeric,
    valor_desconto                numeric,
    valor_total                   numeric,
    cfop                          text,
    ncm                           text,
    situacao                      text,
    dados_item                    jsonb,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    updated_at                    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (codigo_pedido, sequencial, codigo_item)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_venda_itens_produto
    ON public.pedidos_venda_itens (codigo_produto);


-- View simplificada para o Kanban comercial
CREATE OR REPLACE VIEW public.kanban_comercial_view AS
SELECT
    pv.codigo_pedido,
    pv.numero_pedido,
    pv.numero_pedido_cliente,
    pv.codigo_cliente,
    pv.data_previsao,
    pv.etapa,
    CASE
        WHEN pv.etapa = '80' THEN 'Pedido aprovado'
        WHEN pv.etapa IN ('60','70') THEN 'Fila de produção'
        ELSE 'Aguardando prazo'
    END AS kanban_coluna,
    it.codigo        AS produto_codigo,
    it.descricao     AS produto_descricao,
    it.quantidade,
    it.valor_total
FROM public.pedidos_venda pv
JOIN public.pedidos_venda_itens it
  ON it.codigo_pedido = pv.codigo_pedido;


-- Utilitário: converte texto para NUMERIC (substitui vírgula por ponto)
CREATE OR REPLACE FUNCTION public._util_to_numeric(v text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    out numeric;
BEGIN
    IF v IS NULL THEN
        RETURN NULL;
    END IF;
    BEGIN
        out := NULLIF(REPLACE(trim(v), ',', '.'), '')::numeric;
        RETURN out;
    EXCEPTION WHEN others THEN
        RETURN NULL;
    END;
END;
$$;


-- Converte texto para DATE aceitando dd/mm/aaaa ou aaaa-mm-dd
CREATE OR REPLACE FUNCTION public._util_to_date(v text)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    out date;
BEGIN
    IF v IS NULL OR trim(v) = '' THEN
        RETURN NULL;
    END IF;
    BEGIN
        IF v ~ '^\d{4}-\d{2}-\d{2}$' THEN
            out := v::date;
        ELSIF v ~ '^\d{2}/\d{2}/\d{4}$' THEN
            out := to_date(v, 'DD/MM/YYYY');
        ELSIF v ~ '^\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}$' THEN
            out := to_timestamp(v, 'DD/MM/YYYY HH24:MI:SS')::date;
        ELSE
            out := NULL;
        END IF;
    EXCEPTION WHEN others THEN
        out := NULL;
    END;
    RETURN out;
END;
$$;


CREATE OR REPLACE FUNCTION public._pedido_insert_item(p_codigo_pedido bigint, item jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    ide jsonb := item->'ide';
    prod jsonb := item->'produto';
    seq integer;
BEGIN
    IF prod IS NULL THEN
      RETURN;
    END IF;

    seq := NULLIF(ide->>'codigo_item', '')::integer;

    INSERT INTO public.pedidos_venda_itens (
        codigo_pedido,
        codigo_item,
        codigo_item_integracao,
        sequencial,
        codigo,
        codigo_produto,
        codigo_produto_integracao,
        descricao,
        unidade,
        quantidade,
        valor_unitario,
        valor_mercadoria,
        valor_desconto,
        valor_total,
        cfop,
        ncm,
        situacao,
        dados_item,
        updated_at
    ) VALUES (
        p_codigo_pedido,
        COALESCE(ide->>'codigo_item', ''),
        ide->>'codigo_item_integracao',
        COALESCE(seq, 0),
        prod->>'codigo',
        prod->>'codigo_produto',
        prod->>'codigo_produto_integracao',
        prod->>'descricao',
        prod->>'unidade',
        public._util_to_numeric(prod->>'quantidade'),
        public._util_to_numeric(prod->>'valor_unitario'),
        public._util_to_numeric(prod->>'valor_mercadoria'),
        public._util_to_numeric(prod->>'valor_desconto'),
        public._util_to_numeric(prod->>'valor_total'),
        prod->>'cfop',
        prod->>'ncm',
        prod->>'situacao',
        item,
        now()
    )
    ON CONFLICT (codigo_pedido, COALESCE(sequencial,0), COALESCE(codigo_item,'')) DO UPDATE SET
        codigo_item_integracao = EXCLUDED.codigo_item_integracao,
        codigo                = EXCLUDED.codigo,
        codigo_produto        = EXCLUDED.codigo_produto,
        codigo_produto_integracao = EXCLUDED.codigo_produto_integracao,
        descricao             = EXCLUDED.descricao,
        unidade               = EXCLUDED.unidade,
        quantidade            = EXCLUDED.quantidade,
        valor_unitario        = EXCLUDED.valor_unitario,
        valor_mercadoria      = EXCLUDED.valor_mercadoria,
        valor_desconto        = EXCLUDED.valor_desconto,
        valor_total           = EXCLUDED.valor_total,
        cfop                  = EXCLUDED.cfop,
        ncm                   = EXCLUDED.ncm,
        situacao              = EXCLUDED.situacao,
        dados_item            = EXCLUDED.dados_item,
        updated_at            = now();
END;
$$;


CREATE OR REPLACE FUNCTION public.pedido_itens_upsert_from_payload(p jsonb)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    cab jsonb := p->'cabecalho';
    v_codigo_pedido bigint;
    det jsonb;
    elem jsonb;
    inserted integer := 0;
BEGIN
    IF cab IS NULL THEN
        RETURN 0;
    END IF;

    v_codigo_pedido := NULLIF(cab->>'codigo_pedido', '')::bigint;
    IF v_codigo_pedido IS NULL THEN
        RETURN 0;
    END IF;

    DELETE FROM public.pedidos_venda_itens WHERE codigo_pedido = v_codigo_pedido;

    det := p->'det';
    IF det IS NULL THEN
        RETURN 0;
    END IF;

    IF jsonb_typeof(det) = 'array' THEN
      FOR elem IN SELECT value FROM jsonb_array_elements(det) LOOP
        PERFORM public._pedido_insert_item(v_codigo_pedido, elem);
        inserted := inserted + 1;
      END LOOP;
    ELSE
      PERFORM public._pedido_insert_item(v_codigo_pedido, det);
      inserted := inserted + 1;
    END IF;

    RETURN inserted;
END;
$$;


CREATE OR REPLACE FUNCTION public.pedido_upsert_from_payload(p jsonb)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    cab jsonb := p->'cabecalho';
    total jsonb := p->'total_pedido';
    info jsonb := p->'informacoes_adicionais';
    codigo_pedido bigint;
    data_prev date;
BEGIN
    IF cab IS NULL THEN
        RETURN 0;
    END IF;

    codigo_pedido := NULLIF(cab->>'codigo_pedido', '')::bigint;
    IF codigo_pedido IS NULL THEN
        RETURN 0;
    END IF;

    data_prev := public._util_to_date(cab->>'data_previsao');

    INSERT INTO public.pedidos_venda (
        codigo_pedido,
        codigo_pedido_integracao,
        numero_pedido,
        numero_pedido_cliente,
        codigo_cliente,
        codigo_cliente_integracao,
        data_previsao,
        etapa,
        origem_pedido,
        codigo_empresa,
        codigo_empresa_integracao,
        tipo_desconto_pedido,
        perc_desconto_pedido,
        valor_desconto_pedido,
        bloqueado,
        encerrado,
        enc_motivo,
        enc_data,
        enc_hora,
        enc_user,
        nao_gerar_boleto,
        status,
        cabecalho,
        total_pedido,
        informacoes_adicionais,
        raw_payload,
        updated_at
    ) VALUES (
        codigo_pedido,
        cab->>'codigo_pedido_integracao',
        cab->>'numero_pedido',
        cab->>'numero_pedido_cliente',
        cab->>'codigo_cliente',
        cab->>'codigo_cliente_integracao',
        data_prev,
        cab->>'etapa',
        cab->>'origem_pedido',
        cab->>'codigo_empresa',
        cab->>'codigo_empresa_integracao',
        cab->>'tipo_desconto_pedido',
        public._util_to_numeric(cab->>'perc_desconto_pedido'),
        public._util_to_numeric(cab->>'valor_desconto_pedido'),
        cab->>'bloqueado',
        cab->>'encerrado',
        cab->>'enc_motivo',
        cab->>'enc_data',
        cab->>'enc_hora',
        cab->>'enc_user',
        cab->>'nao_gerar_boleto',
        cab->>'status',
        cab,
        total,
        info,
        p,
        now()
    )
    ON CONFLICT (codigo_pedido) DO UPDATE SET
        codigo_pedido_integracao  = EXCLUDED.codigo_pedido_integracao,
        numero_pedido             = EXCLUDED.numero_pedido,
        numero_pedido_cliente     = EXCLUDED.numero_pedido_cliente,
        codigo_cliente            = EXCLUDED.codigo_cliente,
        codigo_cliente_integracao = EXCLUDED.codigo_cliente_integracao,
        data_previsao             = EXCLUDED.data_previsao,
        etapa                     = EXCLUDED.etapa,
        origem_pedido             = EXCLUDED.origem_pedido,
        codigo_empresa            = EXCLUDED.codigo_empresa,
        codigo_empresa_integracao = EXCLUDED.codigo_empresa_integracao,
        tipo_desconto_pedido      = EXCLUDED.tipo_desconto_pedido,
        perc_desconto_pedido      = EXCLUDED.perc_desconto_pedido,
        valor_desconto_pedido     = EXCLUDED.valor_desconto_pedido,
        bloqueado                 = EXCLUDED.bloqueado,
        encerrado                 = EXCLUDED.encerrado,
        enc_motivo                = EXCLUDED.enc_motivo,
        enc_data                  = EXCLUDED.enc_data,
        enc_hora                  = EXCLUDED.enc_hora,
        enc_user                  = EXCLUDED.enc_user,
        nao_gerar_boleto          = EXCLUDED.nao_gerar_boleto,
        status                    = EXCLUDED.status,
        cabecalho                 = EXCLUDED.cabecalho,
        total_pedido              = EXCLUDED.total_pedido,
        informacoes_adicionais    = EXCLUDED.informacoes_adicionais,
        raw_payload               = EXCLUDED.raw_payload,
        updated_at                = now();

    RETURN 1;
END;
$$;


CREATE OR REPLACE FUNCTION public.pedidos_upsert_from_list(payload jsonb)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    arr jsonb;
    elem jsonb;
    total integer := 0;
BEGIN
    IF payload IS NULL THEN
      RETURN 0;
    END IF;

    arr := payload->'pedido_venda_produto';

    IF jsonb_typeof(arr) = 'array' THEN
      FOR elem IN SELECT value FROM jsonb_array_elements(arr) LOOP
        total := total + public.pedido_upsert_from_payload(elem);
        PERFORM public.pedido_itens_upsert_from_payload(elem);
      END LOOP;
    ELSIF arr IS NOT NULL THEN
      total := total + public.pedido_upsert_from_payload(arr);
      PERFORM public.pedido_itens_upsert_from_payload(arr);
    ELSE
      total := total + public.pedido_upsert_from_payload(payload);
      PERFORM public.pedido_itens_upsert_from_payload(payload);
    END IF;

    RETURN total;
END;
$$;
