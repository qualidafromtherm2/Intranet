DROP FUNCTION IF EXISTS public.clientes_upsert_from_list(jsonb);
DROP FUNCTION IF EXISTS public.cliente_upsert_from_payload(jsonb);

CREATE TABLE IF NOT EXISTS public.clientes_cadastro (
    codigo_cliente_omie         bigint PRIMARY KEY,
    codigo_cliente_integracao   text,
    razao_social                text,
    nome_fantasia               text,
    cnpj_cpf                    text,
    pessoa_fisica               text,
    telefone1_ddd               text,
    telefone1_numero            text,
    telefone2_ddd               text,
    telefone2_numero            text,
    contato                     text,
    email                       text,
    estado                      text,
    cidade                      text,
    cidade_ibge                 text,
    cep                         text,
    bairro                      text,
    endereco                    text,
    endereco_numero             text,
    complemento                 text,
    pais                        text,
    inscricao_estadual          text,
    inscricao_municipal         text,
    inscricao_suframa           text,
    optante_simples_nacional    text,
    tipo_atividade              text,
    cnae                        text,
    produtor_rural              text,
    contribuinte                text,
    observacao                  text,
    tags                        text[],
    bloqueado                   text,
    inativo                     text,
    valor_limite_credito        numeric,
    bloquear_faturamento        text,
    dados_adicionais            jsonb,
    endereco_entrega            jsonb,
    dados_bancarios             jsonb,
    informacoes                 jsonb,
    raw_payload                 jsonb,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clientes_cadastro_cnpj
    ON public.clientes_cadastro (cnpj_cpf);

CREATE INDEX IF NOT EXISTS idx_clientes_cadastro_razao
    ON public.clientes_cadastro USING gin (to_tsvector('simple', coalesce(razao_social, '') || ' ' || coalesce(nome_fantasia, '')));


CREATE OR REPLACE FUNCTION public.cliente_upsert_from_payload(p jsonb)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    cli jsonb := COALESCE(p->'clientes_cadastro', p);
    codigo bigint;
    tagsArr text[];
BEGIN
    IF cli IS NULL THEN
      RETURN 0;
    END IF;

    codigo := NULLIF(cli->>'codigo_cliente_omie', '')::bigint;
    IF codigo IS NULL THEN
      RETURN 0;
    END IF;

    tagsArr := ARRAY(
      SELECT trim(value->>'tag')
        FROM jsonb_array_elements(COALESCE(cli->'tags', '[]'::jsonb)) AS value
       WHERE trim(value->>'tag') <> ''
    );

    INSERT INTO public.clientes_cadastro (
        codigo_cliente_omie,
        codigo_cliente_integracao,
        razao_social,
        nome_fantasia,
        cnpj_cpf,
        pessoa_fisica,
        telefone1_ddd,
        telefone1_numero,
        telefone2_ddd,
        telefone2_numero,
        contato,
        email,
        estado,
        cidade,
        cidade_ibge,
        cep,
        bairro,
        endereco,
        endereco_numero,
        complemento,
        pais,
        inscricao_estadual,
        inscricao_municipal,
        inscricao_suframa,
        optante_simples_nacional,
        tipo_atividade,
        cnae,
        produtor_rural,
        contribuinte,
        observacao,
        tags,
        bloqueado,
        inativo,
        valor_limite_credito,
        bloquear_faturamento,
        dados_adicionais,
        endereco_entrega,
        dados_bancarios,
        informacoes,
        raw_payload,
        updated_at
    ) VALUES (
        codigo,
        cli->>'codigo_cliente_integracao',
        cli->>'razao_social',
        cli->>'nome_fantasia',
        cli->>'cnpj_cpf',
        cli->>'pessoa_fisica',
        cli->>'telefone1_ddd',
        cli->>'telefone1_numero',
        cli->>'telefone2_ddd',
        cli->>'telefone2_numero',
        cli->>'contato',
        cli->>'email',
        cli->>'estado',
        cli->>'cidade',
        cli->>'cidade_ibge',
        cli->>'cep',
        cli->>'bairro',
        COALESCE(cli->>'endereco', cli->>'logradouro'),
        cli->>'endereco_numero',
        cli->>'complemento',
        cli->>'codigo_pais',
        cli->>'inscricao_estadual',
        cli->>'inscricao_municipal',
        cli->>'inscricao_suframa',
        cli->>'optante_simples_nacional',
        cli->>'tipo_atividade',
        cli->>'cnae',
        cli->>'produtor_rural',
        cli->>'contribuinte',
        cli->>'observacao',
        tagsArr,
        cli->>'bloqueado',
        cli->>'inativo',
        public._util_to_numeric(cli->>'valor_limite_credito'),
        cli->>'bloquear_faturamento',
        cli->'obs_detalhadas',
        cli->'enderecoEntrega',
        cli->'dadosBancarios',
        cli->'info',
        p,
        now()
    )
    ON CONFLICT (codigo_cliente_omie) DO UPDATE SET
        codigo_cliente_integracao = EXCLUDED.codigo_cliente_integracao,
        razao_social              = EXCLUDED.razao_social,
        nome_fantasia             = EXCLUDED.nome_fantasia,
        cnpj_cpf                  = EXCLUDED.cnpj_cpf,
        pessoa_fisica             = EXCLUDED.pessoa_fisica,
        telefone1_ddd             = EXCLUDED.telefone1_ddd,
        telefone1_numero          = EXCLUDED.telefone1_numero,
        telefone2_ddd             = EXCLUDED.telefone2_ddd,
        telefone2_numero          = EXCLUDED.telefone2_numero,
        contato                   = EXCLUDED.contato,
        email                     = EXCLUDED.email,
        estado                    = EXCLUDED.estado,
        cidade                    = EXCLUDED.cidade,
        cidade_ibge               = EXCLUDED.cidade_ibge,
        cep                       = EXCLUDED.cep,
        bairro                    = EXCLUDED.bairro,
        endereco                  = EXCLUDED.endereco,
        endereco_numero           = EXCLUDED.endereco_numero,
        complemento               = EXCLUDED.complemento,
        pais                      = EXCLUDED.pais,
        inscricao_estadual        = EXCLUDED.inscricao_estadual,
        inscricao_municipal       = EXCLUDED.inscricao_municipal,
        inscricao_suframa         = EXCLUDED.inscricao_suframa,
        optante_simples_nacional  = EXCLUDED.optante_simples_nacional,
        tipo_atividade            = EXCLUDED.tipo_atividade,
        cnae                      = EXCLUDED.cnae,
        produtor_rural            = EXCLUDED.produtor_rural,
        contribuinte              = EXCLUDED.contribuinte,
        observacao                = EXCLUDED.observacao,
        tags                      = EXCLUDED.tags,
        bloqueado                 = EXCLUDED.bloqueado,
        inativo                   = EXCLUDED.inativo,
        valor_limite_credito      = EXCLUDED.valor_limite_credito,
        bloquear_faturamento      = EXCLUDED.bloquear_faturamento,
        dados_adicionais          = EXCLUDED.dados_adicionais,
        endereco_entrega          = EXCLUDED.endereco_entrega,
        dados_bancarios           = EXCLUDED.dados_bancarios,
        informacoes               = EXCLUDED.informacoes,
        raw_payload               = EXCLUDED.raw_payload,
        updated_at                = now();

    RETURN 1;
END;
$$;


CREATE OR REPLACE FUNCTION public.clientes_upsert_from_list(payload jsonb)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    arr jsonb;
    elem jsonb;
    total integer := 0;
BEGIN
    IF payload IS NULL THEN
      RETURN 0;
    END IF;

    arr := payload->'clientes_cadastro';

    IF jsonb_typeof(arr) = 'array' THEN
      FOR elem IN SELECT value FROM jsonb_array_elements(arr) LOOP
        total := total + public.cliente_upsert_from_payload(elem);
      END LOOP;
    ELSIF arr IS NOT NULL THEN
      total := total + public.cliente_upsert_from_payload(arr);
    ELSE
      total := total + public.cliente_upsert_from_payload(payload);
    END IF;

    RETURN total;
END;
$$;
