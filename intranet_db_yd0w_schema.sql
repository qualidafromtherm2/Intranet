--
-- PostgreSQL database dump
--

\restrict w1RVkMBuNYnQ9WxyNnk8FwNeeV9PnW2zXMBzaOR3lv9O0jTE2nVGRnvdAkWRnEK

-- Dumped from database version 17.6 (Debian 17.6-1.pgdg12+1)
-- Dumped by pg_dump version 17.6 (Ubuntu 17.6-1.pgdg24.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: intranet_db_yd0w_user
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO intranet_db_yd0w_user;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: intranet_db_yd0w_user
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: _ddmmyyyy_to_date(text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public._ddmmyyyy_to_date(s text) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF s IS NULL OR s = '' THEN RETURN NULL; END IF;
  RETURN to_date(s, 'DD/MM/YYYY');
END $$;


ALTER FUNCTION public._ddmmyyyy_to_date(s text) OWNER TO intranet_db_yd0w_user;

--
-- Name: _pedido_insert_item(bigint, jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public._pedido_insert_item(p_codigo_pedido bigint, item jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public._pedido_insert_item(p_codigo_pedido bigint, item jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: _sync_omie_operacao(); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public._sync_omie_operacao() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_op text;
BEGIN
  v_op := nullif(trim(NEW.operacao), '');
  IF v_op IS NOT NULL THEN
    INSERT INTO public.omie_operacao (operacao)
    VALUES (v_op)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION public._sync_omie_operacao() OWNER TO intranet_db_yd0w_user;

--
-- Name: _util_to_date(text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public._util_to_date(v text) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
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
$_$;


ALTER FUNCTION public._util_to_date(v text) OWNER TO intranet_db_yd0w_user;

--
-- Name: _util_to_numeric(text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public._util_to_numeric(v text) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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


ALTER FUNCTION public._util_to_numeric(v text) OWNER TO intranet_db_yd0w_user;

--
-- Name: auth__set_updated_at(); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.auth__set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;


ALTER FUNCTION public.auth__set_updated_at() OWNER TO intranet_db_yd0w_user;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auth_user; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.auth_user (
    id bigint NOT NULL,
    username public.citext NOT NULL,
    password_hash text NOT NULL,
    roles text[] DEFAULT ARRAY[]::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email text
);


ALTER TABLE public.auth_user OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_create_user(text, text, text[]); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.auth_create_user(p_username text, p_password text, p_roles text[] DEFAULT ARRAY[]::text[]) RETURNS public.auth_user
    LANGUAGE plpgsql
    AS $$
DECLARE v public.auth_user;
BEGIN
  INSERT INTO public.auth_user(username, password_hash, roles)
  VALUES (p_username, crypt(p_password, gen_salt('bf')), COALESCE(p_roles, ARRAY[]::TEXT[]))
  ON CONFLICT (username) DO NOTHING;

  SELECT * INTO v FROM public.auth_user WHERE username = p_username;
  RETURN v;
END$$;


ALTER FUNCTION public.auth_create_user(p_username text, p_password text, p_roles text[]) OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_login(text, text, inet, text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.auth_login(p_username text, p_password text, p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text) RETURNS TABLE(id bigint, username text, roles text[])
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  urec public.auth_user%ROWTYPE;
  ok   BOOLEAN;
  why  TEXT;
BEGIN
  SELECT * INTO urec
    FROM public.auth_user u
   WHERE u.username = (p_username)::citext
     AND u.is_active = TRUE
   LIMIT 1;

  IF NOT FOUND THEN
    why := 'USER_NOT_FOUND';
    INSERT INTO public.auth_login_event(user_id, username, success, reason, ip, user_agent)
    VALUES (NULL, p_username, FALSE, why, p_ip, p_user_agent);
    RETURN;
  END IF;

  ok := crypt(p_password, urec.password_hash) = urec.password_hash;
  IF NOT ok THEN
    why := 'INVALID_PASSWORD';
    INSERT INTO public.auth_login_event(user_id, username, success, reason, ip, user_agent)
    VALUES (urec.id, urec.username, FALSE, why, p_ip, p_user_agent);
    RETURN;
  END IF;

  INSERT INTO public.auth_login_event(user_id, username, success, reason, ip, user_agent)
  VALUES (urec.id, urec.username, TRUE, NULL, p_ip, p_user_agent);

  id := urec.id; username := urec.username::text; roles := urec.roles;
  RETURN NEXT;
END $$;


ALTER FUNCTION public.auth_login(p_username text, p_password text, p_ip inet, p_user_agent text) OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_message_delete(bigint, bigint); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.auth_message_delete(p_user_id bigint, p_message_id bigint) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE v INT;
BEGIN
  DELETE FROM public.user_message WHERE id = p_message_id AND user_id = p_user_id;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v > 0;
END$$;


ALTER FUNCTION public.auth_message_delete(p_user_id bigint, p_message_id bigint) OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_messages_for(bigint); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.auth_messages_for(p_user_id bigint) RETURNS TABLE(id bigint, body text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.body, m.created_at
    FROM public.user_message m
   WHERE m.user_id = p_user_id
   ORDER BY m.created_at DESC, m.id DESC;
END$$;


ALTER FUNCTION public.auth_messages_for(p_user_id bigint) OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_profile__set_updated_at(); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.auth_profile__set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;


ALTER FUNCTION public.auth_profile__set_updated_at() OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_profile_set(bigint, text, text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.auth_profile_set(p_user_id bigint, p_setor text, p_funcao text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE v_sector BIGINT; v_funcao BIGINT;
BEGIN
  SELECT id INTO v_sector FROM public.auth_sector WHERE name = p_setor;
  SELECT id INTO v_funcao FROM public.auth_funcao WHERE name = p_funcao;

  INSERT INTO public.auth_user_profile(user_id, sector_id, funcao_id)
  VALUES (p_user_id, v_sector, v_funcao)
  ON CONFLICT (user_id) DO UPDATE
    SET sector_id = EXCLUDED.sector_id,
        funcao_id = EXCLUDED.funcao_id,
        updated_at = now();
END $$;


ALTER FUNCTION public.auth_profile_set(p_user_id bigint, p_setor text, p_funcao text) OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_request_reset(text, bigint); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.auth_request_reset(p_username text, p_requested_by bigint DEFAULT NULL::bigint) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO public.auth_reset_request(username, requested_by)
  VALUES (p_username, p_requested_by);

  INSERT INTO public.user_message(user_id, body)
  SELECT id, 'Recuperar acesso para o usuário "' || p_username || '"'
    FROM public.auth_user
   WHERE roles @> ARRAY['admin']::TEXT[];
END$$;


ALTER FUNCTION public.auth_request_reset(p_username text, p_requested_by bigint) OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_set_password(text, text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.auth_set_password(p_username text, p_password text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE public.auth_user
     SET password_hash = crypt(p_password, gen_salt('bf'))
   WHERE username = p_username;
END$$;


ALTER FUNCTION public.auth_set_password(p_username text, p_password text) OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_user_has_nav(bigint, text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.auth_user_has_nav(p_user_id bigint, p_key text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE((
    SELECT allowed
      FROM public.auth_user_permissions_tree(p_user_id)
     WHERE key = p_key
     LIMIT 1
  ), FALSE);
$$;


ALTER FUNCTION public.auth_user_has_nav(p_user_id bigint, p_key text) OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_user_permissions_tree(bigint); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.auth_user_permissions_tree(p_user_id bigint) RETURNS TABLE(id bigint, parent_id bigint, key text, label text, pos text, sort integer, selector text, allowed boolean, user_override boolean)
    LANGUAGE sql
    AS $$
  WITH me AS (
    SELECT u.id, u.roles
      FROM public.auth_user u WHERE u.id = p_user_id
  ),
  base AS (
    SELECT n.* FROM public.nav_node n WHERE n.active = TRUE
  ),
  upr AS (   -- overrides por usuário
    SELECT aup.node_id, aup.allow
      FROM public.auth_user_permission aup
     WHERE aup.user_id = p_user_id
  ),
  rpr AS (   -- permissões por role (OR)
    SELECT arp.node_id, bool_or(arp.allow) AS allow
      FROM public.auth_role_permission arp
      CROSS JOIN me
     WHERE arp.role = ANY (me.roles)
     GROUP BY arp.node_id
  )
  SELECT
    b.id, b.parent_id, b.key, b.label, b.position::text AS pos, b.sort,
    b.selector,                               -- 👈 AQUI TAMBÉM
    CASE
      WHEN EXISTS (SELECT 1 FROM me WHERE 'admin' = ANY(me.roles)) THEN TRUE
      WHEN upr.node_id IS NOT NULL THEN upr.allow
      WHEN rpr.node_id IS NOT NULL THEN rpr.allow
      ELSE TRUE
    END AS allowed,
    CASE WHEN upr.node_id IS NOT NULL THEN TRUE ELSE FALSE END AS user_override
  FROM base b
  LEFT JOIN upr ON upr.node_id = b.id
  LEFT JOIN rpr ON rpr.node_id = b.id
  ORDER BY b.position, COALESCE(b.parent_id,0), b.sort, b.id;
$$;


ALTER FUNCTION public.auth_user_permissions_tree(p_user_id bigint) OWNER TO intranet_db_yd0w_user;

--
-- Name: cliente_upsert_from_payload(jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.cliente_upsert_from_payload(p jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.cliente_upsert_from_payload(p jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: clientes_upsert_from_list(jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.clientes_upsert_from_list(payload jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.clientes_upsert_from_list(payload jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: etapa_to_status(text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.etapa_to_status(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case trim(coalesce(p,'')) 
           when '10' then 'A Produzir'
           when '20' then 'Produzindo'
           when '30' then 'teste 1'
           when '40' then 'teste final'
           when '60' then 'concluido'
           else 'A Produzir'
         end
$$;


ALTER FUNCTION public.etapa_to_status(p text) OWNER TO intranet_db_yd0w_user;

--
-- Name: mover_op(text, text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.mover_op(p_op text, p_status text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
declare
  v_etapa text := public.status_to_etapa(p_status);
  v_rows  int;
begin
  update public.op_info
     set c_etapa   = v_etapa,
         updated_at= now()
   where c_num_op = p_op
      or n_cod_op::text = p_op;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end
$$;


ALTER FUNCTION public.mover_op(p_op text, p_status text) OWNER TO intranet_db_yd0w_user;

--
-- Name: next_c_cod_int_op(text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.next_c_cod_int_op(prod_codigo text) RETURNS text
    LANGUAGE plpgsql
    AS $_$
DECLARE
  max_op   bigint;
  next_num bigint;
  prefix   text := '';
BEGIN
  SELECT MAX( (regexp_replace(op_txt, '\D', '', 'g'))::bigint ) INTO max_op
  FROM (
    SELECT c_cod_int_op AS op_txt FROM op_info        WHERE c_cod_int_op IS NOT NULL AND btrim(c_cod_int_op) <> ''
    UNION ALL
    SELECT op           AS op_txt FROM op_status      WHERE op           IS NOT NULL AND btrim(op)           <> ''
    UNION ALL
    SELECT op           AS op_txt FROM op_movimentos  WHERE op           IS NOT NULL AND btrim(op)           <> ''
  ) ops;

  next_num := COALESCE(max_op, 100000) + 1;

  IF btrim(COALESCE(prod_codigo, '')) ~ '^[0-9]{2}\.PP(\.|$)' THEN
    prefix := 'P';
  END IF;

  RETURN prefix || next_num::text;
END;
$_$;


ALTER FUNCTION public.next_c_cod_int_op(prod_codigo text) OWNER TO intranet_db_yd0w_user;

--
-- Name: next_op_text(text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.next_op_text(prefix text DEFAULT 'P'::text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  max_op bigint;
  next_num bigint;
BEGIN
  SELECT MAX((regexp_replace(op, '\D', '', 'g'))::bigint) INTO max_op
  FROM (
    SELECT op FROM op_status
    UNION ALL
    SELECT op FROM op_movimentos
  ) t;

  next_num := COALESCE(max_op, 100000) + 1;
  RETURN prefix || next_num::text;
END;
$$;


ALTER FUNCTION public.next_op_text(prefix text) OWNER TO intranet_db_yd0w_user;

--
-- Name: ns_take_next(text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.ns_take_next(p_codigo text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_ns text;
BEGIN
  WITH cand AS (
    SELECT id
      FROM public.ns_pool
     WHERE codigo = p_codigo
       AND consumed = false
     ORDER BY ns
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.ns_pool n
     SET consumed = true,
         consumed_at = now()
    FROM cand
   WHERE n.id = cand.id
  RETURNING n.ns INTO v_ns;

  RETURN v_ns;  -- NULL se não havia disponível
END;
$$;


ALTER FUNCTION public.ns_take_next(p_codigo text) OWNER TO intranet_db_yd0w_user;

--
-- Name: null_if_empty(text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.null_if_empty(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
  select nullif(btrim($1), '')
$_$;


ALTER FUNCTION public.null_if_empty(p text) OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_estoque_posicao_sanitize(); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.omie_estoque_posicao_sanitize() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- numéricos
  NEW.preco_unitario := COALESCE(NEW.preco_unitario, 0);
  NEW.saldo          := COALESCE(NEW.saldo, 0);
  NEW.cmc            := COALESCE(NEW.cmc, 0);
  NEW.pendente       := COALESCE(NEW.pendente, 0);
  NEW.estoque_minimo := COALESCE(NEW.estoque_minimo, 0);
  NEW.reservado      := COALESCE(NEW.reservado, 0);
  NEW.fisico         := COALESCE(NEW.fisico, 0);

  -- identificadores de produto (nunca nulos)
  NEW.omie_prod_id   := COALESCE(NEW.omie_prod_id, 0);
  NEW.codigo         := COALESCE(NEW.codigo, '');

  -- clamp negativos
  IF NEW.preco_unitario < 0 THEN NEW.preco_unitario := 0; END IF;
  IF NEW.saldo          < 0 THEN NEW.saldo          := 0; END IF;
  IF NEW.cmc            < 0 THEN NEW.cmc            := 0; END IF;
  IF NEW.pendente       < 0 THEN NEW.pendente       := 0; END IF;
  IF NEW.estoque_minimo < 0 THEN NEW.estoque_minimo := 0; END IF;
  IF NEW.reservado      < 0 THEN NEW.reservado      := 0; END IF;
  IF NEW.fisico         < 0 THEN NEW.fisico         := 0; END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.omie_estoque_posicao_sanitize() OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_import_listarprodutos(jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.omie_import_listarprodutos(payload jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_count INTEGER := 0;
  v_item  JSONB;
BEGIN
  IF payload ? 'produto_servico_cadastro' THEN
    FOR v_item IN
      SELECT elem
      FROM jsonb_array_elements(payload->'produto_servico_cadastro') AS elem
    LOOP
      PERFORM omie_upsert_produto(v_item);
      v_count := v_count + 1;
    END LOOP;
  END IF;
  RETURN v_count;
END;
$$;


ALTER FUNCTION public.omie_import_listarprodutos(payload jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_malha_item_sanitize(); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.omie_malha_item_sanitize() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.item_prod_id := COALESCE(NEW.item_prod_id, 0);
  NEW.item_codigo  := COALESCE(NEW.item_codigo, '');
  NEW.quantidade   := COALESCE(NEW.quantidade, 0);
  NEW.perc_perda   := COALESCE(NEW.perc_perda, 0);
  IF NEW.quantidade < 0 THEN NEW.quantidade := 0; END IF;
  IF NEW.perc_perda < 0 THEN NEW.perc_perda := 0; END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.omie_malha_item_sanitize() OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_upsert_produto(jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.omie_upsert_produto(item jsonb) RETURNS void
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
END;
$$;


ALTER FUNCTION public.omie_upsert_produto(item jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: op_upsert_from_payload(jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.op_upsert_from_payload(p jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  ident jsonb := p->'identificacao';
  inf   jsonb := p->'infAdicionais';
  out   jsonb := p->'outrasInf';

  v_n_cod_op        bigint;
  v_c_num_op        text;
  v_c_cod_int_op    text;
  v_n_cod_prod      bigint;
  v_produto_codigo  text;
  v_qtde            numeric;
  v_cod_local       bigint;
  v_etapa           text;
  v_concluida       text;
  v_prev            date;
  v_inicio          date;
  v_conclusao       date;
  v_inc             date;
  v_alt             date;
  v_u_inc           text;
  v_u_alt           text;
begin
  -- chaves básicas
  v_n_cod_op     := nullif(ident->>'nCodOP','')::bigint;
  v_c_num_op     := ident->>'cNumOP';
  v_c_cod_int_op := ident->>'cCodIntOP';

  -- produto (usa id ou código interno)
  v_n_cod_prod      := nullif(ident->>'nCodProduto','')::bigint;
  v_produto_codigo  := coalesce(ident->>'cCodIntProd', ident->>'nCodProduto');

  v_qtde      := nullif(ident->>'nQtde','')::numeric;
  v_cod_local := nullif(ident->>'codigo_local_estoque','')::bigint;

  v_etapa     := btrim(coalesce(inf->>'cEtapa',''));
  v_concluida := out->>'cConcluida';

  v_prev      := public.parse_date_br(ident->>'dDtPrevisao');
  v_inicio    := public.parse_date_br(inf->>'dDtInicio');
  v_conclusao := public.parse_date_br(inf->>'dDtConclusao');
  v_inc       := public.parse_date_br(out->>'dInclusao');
  v_alt       := public.parse_date_br(out->>'dAlteracao');
  v_u_inc     := out->>'uInc';
  v_u_alt     := out->>'uAlt';

  -- fallback: extrai número da cNumOP se nCodOP vier ausente
  if v_n_cod_op is null and v_c_num_op is not null then
    v_n_cod_op := regexp_replace(v_c_num_op, '[^0-9]', '', 'g')::bigint;
  end if;
  if v_n_cod_op is null then
    raise exception 'Payload sem nCodOP/cNumOP válido: %', p;
  end if;

  -- op_raw: sempre atualiza payload e last_seen_at
  insert into public.op_raw (n_cod_op, c_num_op, payload, last_seen_at)
  values (v_n_cod_op, v_c_num_op, p, now())
  on conflict (n_cod_op) do update
    set c_num_op     = excluded.c_num_op,
        payload      = excluded.payload,
        last_seen_at = now();

  -- op_info: NÃO sobrescreve valores com NULL ou ""
  insert into public.op_info as t (
    n_cod_op, c_num_op, c_cod_int_op, n_cod_prod, produto_codigo,
    codigo_local_estoque, n_qtde, c_etapa, c_concluida,
    d_dt_previsao, d_dt_inicio, d_dt_conclusao, d_inclusao, d_alteracao,
    u_inc, u_alt, updated_at
  )
  values (
    v_n_cod_op, v_c_num_op, v_c_cod_int_op, v_n_cod_prod, v_produto_codigo,
    v_cod_local, v_qtde, v_etapa, v_concluida,
    v_prev, v_inicio, v_conclusao, v_inc, v_alt,
    v_u_inc, v_u_alt, now()
  )
  on conflict (n_cod_op) do update
    set c_num_op             = coalesce(public.null_if_empty(excluded.c_num_op),             t.c_num_op),
        c_cod_int_op         = coalesce(public.null_if_empty(excluded.c_cod_int_op),         t.c_cod_int_op),
        n_cod_prod           = coalesce(excluded.n_cod_prod,                                 t.n_cod_prod),
        produto_codigo       = coalesce(public.null_if_empty(excluded.produto_codigo),       t.produto_codigo),
        codigo_local_estoque = coalesce(excluded.codigo_local_estoque,                       t.codigo_local_estoque),
        n_qtde               = coalesce(excluded.n_qtde,                                     t.n_qtde),
        c_etapa              = coalesce(public.null_if_empty(excluded.c_etapa),              t.c_etapa),
        c_concluida          = coalesce(public.null_if_empty(excluded.c_concluida),          t.c_concluida),
        d_dt_previsao        = coalesce(excluded.d_dt_previsao,                              t.d_dt_previsao),
        d_dt_inicio          = coalesce(excluded.d_dt_inicio,                                t.d_dt_inicio),
        d_dt_conclusao       = coalesce(excluded.d_dt_conclusao,                             t.d_dt_conclusao),
        d_inclusao           = coalesce(excluded.d_inclusao,                                  t.d_inclusao),
        d_alteracao          = coalesce(excluded.d_alteracao,                                 t.d_alteracao),
        u_inc                = coalesce(public.null_if_empty(excluded.u_inc),                t.u_inc),
        u_alt                = coalesce(public.null_if_empty(excluded.u_alt),                t.u_alt),
        updated_at           = now();
end;
$$;


ALTER FUNCTION public.op_upsert_from_payload(p jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: parse_date_br(text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.parse_date_br(p text) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  d date;
begin
  if p is null or trim(p) = '' then
    return null;
  end if;
  -- espera 'dd/mm/aaaa'
  begin
    d := to_date(p, 'DD/MM/YYYY');
    return d;
  exception when others then
    return null;
  end;
end$$;


ALTER FUNCTION public.parse_date_br(p text) OWNER TO intranet_db_yd0w_user;

--
-- Name: pedido_itens_upsert_from_payload(jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.pedido_itens_upsert_from_payload(p jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.pedido_itens_upsert_from_payload(p jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: pedido_upsert_from_payload(jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.pedido_upsert_from_payload(p jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.pedido_upsert_from_payload(p jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: pedidos_upsert_from_list(jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.pedidos_upsert_from_list(payload jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.pedidos_upsert_from_list(payload jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO intranet_db_yd0w_user;

--
-- Name: set_updated_at_produtos(); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.set_updated_at_produtos() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END
    $$;


ALTER FUNCTION public.set_updated_at_produtos() OWNER TO intranet_db_yd0w_user;

--
-- Name: simple_item_upsert(bigint, integer, text, text, numeric, numeric, numeric, jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.simple_item_upsert(p_codigo_pedido bigint, p_sequencial integer, p_codigo text, p_descricao text, p_quantidade numeric, p_valor_unitario numeric, p_valor_total numeric, p_dados_item jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public.pedidos_venda_itens (
        codigo_pedido, seq, codigo, descricao, quantidade,
        valor_unitario, valor_total, updated_at
    ) VALUES (
        p_codigo_pedido, COALESCE(p_sequencial, 1), p_codigo, p_descricao, p_quantidade,
        p_valor_unitario, p_valor_total, now()
    )
    ON CONFLICT (codigo_pedido, seq) DO UPDATE SET
        codigo = EXCLUDED.codigo,
        descricao = EXCLUDED.descricao,
        quantidade = EXCLUDED.quantidade,
        valor_unitario = EXCLUDED.valor_unitario,
        valor_total = EXCLUDED.valor_total,
        updated_at = now();
END;
$$;


ALTER FUNCTION public.simple_item_upsert(p_codigo_pedido bigint, p_sequencial integer, p_codigo text, p_descricao text, p_quantidade numeric, p_valor_unitario numeric, p_valor_total numeric, p_dados_item jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: simple_item_upsert(bigint, bigint, text, text, numeric, numeric, numeric, jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.simple_item_upsert(p_codigo_pedido bigint, p_sequencial bigint, p_codigo text, p_descricao text, p_quantidade numeric, p_valor_unitario numeric, p_valor_total numeric, p_dados_item jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public.pedidos_venda_itens (
        codigo_pedido, seq, codigo, descricao, quantidade,
        valor_unitario, valor_total, updated_at
    ) VALUES (
        p_codigo_pedido, COALESCE(p_sequencial, 1), p_codigo, p_descricao, p_quantidade,
        p_valor_unitario, p_valor_total, now()
    )
    ON CONFLICT (codigo_pedido, seq) DO UPDATE SET
        codigo = EXCLUDED.codigo,
        descricao = EXCLUDED.descricao,
        quantidade = EXCLUDED.quantidade,
        valor_unitario = EXCLUDED.valor_unitario,
        valor_total = EXCLUDED.valor_total,
        updated_at = now();
END;
$$;


ALTER FUNCTION public.simple_item_upsert(p_codigo_pedido bigint, p_sequencial bigint, p_codigo text, p_descricao text, p_quantidade numeric, p_valor_unitario numeric, p_valor_total numeric, p_dados_item jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: simple_pedido_upsert(bigint, text, text, text, date, text, text, text, numeric, jsonb); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.simple_pedido_upsert(p_codigo_pedido bigint, p_numero_pedido text, p_numero_pedido_cliente text, p_codigo_cliente text, p_data_previsao date, p_etapa text, p_origem_pedido text, p_bloqueado text, p_valor_total numeric, p_raw_payload jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public.pedidos_venda (
        codigo_pedido, numero_pedido, numero_pedido_cliente, codigo_cliente,
        data_previsao, etapa, origem_pedido, bloqueado, valor_total_pedido,
        raw_payload, created_at, updated_at
    ) VALUES (
        p_codigo_pedido, p_numero_pedido, p_numero_pedido_cliente, p_codigo_cliente,
        p_data_previsao, p_etapa, p_origem_pedido, p_bloqueado, p_valor_total,
        p_raw_payload, now(), now()
    )
    ON CONFLICT (codigo_pedido) DO UPDATE SET
        numero_pedido = EXCLUDED.numero_pedido,
        numero_pedido_cliente = EXCLUDED.numero_pedido_cliente,
        codigo_cliente = EXCLUDED.codigo_cliente,
        data_previsao = EXCLUDED.data_previsao,
        etapa = EXCLUDED.etapa,
        origem_pedido = EXCLUDED.origem_pedido,
        bloqueado = EXCLUDED.bloqueado,
        valor_total_pedido = EXCLUDED.valor_total_pedido,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now();
END;
$$;


ALTER FUNCTION public.simple_pedido_upsert(p_codigo_pedido bigint, p_numero_pedido text, p_numero_pedido_cliente text, p_codigo_cliente text, p_data_previsao date, p_etapa text, p_origem_pedido text, p_bloqueado text, p_valor_total numeric, p_raw_payload jsonb) OWNER TO intranet_db_yd0w_user;

--
-- Name: status_to_etapa(text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.status_to_etapa(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case btrim(lower(coalesce(p,'')))
           when 'a produzir'  then '10'
           when 'produzindo'  then '20'
           when 'teste 1'     then '30'
           when 'teste final' then '40'
           when 'concluido'   then '60'
           else '10'
         end
$$;


ALTER FUNCTION public.status_to_etapa(p text) OWNER TO intranet_db_yd0w_user;

--
-- Name: sync_item_upsert(bigint, bigint, bigint, text, numeric, numeric, numeric, text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.sync_item_upsert(p_codigo_pedido bigint, p_seq bigint, p_codigo_produto bigint, p_descricao_produto text, p_quantidade numeric, p_valor_unitario numeric, p_valor_total numeric, p_codigo_produto_integracao text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO pedidos_venda_itens (
        codigo_pedido, seq, codigo_produto, descricao_produto, quantidade, valor_unitario, valor_total, codigo_produto_integracao
    ) VALUES (
        p_codigo_pedido, p_seq, p_codigo_produto, p_descricao_produto, p_quantidade, p_valor_unitario, p_valor_total, p_codigo_produto_integracao
    )
    ON CONFLICT (codigo_pedido, seq) DO UPDATE SET
        codigo_produto = EXCLUDED.codigo_produto,
        descricao_produto = EXCLUDED.descricao_produto,
        quantidade = EXCLUDED.quantidade,
        valor_unitario = EXCLUDED.valor_unitario,
        valor_total = EXCLUDED.valor_total,
        codigo_produto_integracao = EXCLUDED.codigo_produto_integracao;
END;
$$;


ALTER FUNCTION public.sync_item_upsert(p_codigo_pedido bigint, p_seq bigint, p_codigo_produto bigint, p_descricao_produto text, p_quantidade numeric, p_valor_unitario numeric, p_valor_total numeric, p_codigo_produto_integracao text) OWNER TO intranet_db_yd0w_user;

--
-- Name: sync_pedido_upsert(bigint, text, bigint, text, text, text); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.sync_pedido_upsert(p_codigo_pedido bigint, p_numero_pedido text, p_codigo_cliente bigint, p_razao_social text, p_nome_fantasia text, p_codigo_cliente_integracao text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO pedidos_venda (
        codigo_pedido, numero_pedido, codigo_cliente, razao_social, nome_fantasia, codigo_cliente_integracao
    ) VALUES (
        p_codigo_pedido, p_numero_pedido, p_codigo_cliente, p_razao_social, p_nome_fantasia, p_codigo_cliente_integracao
    )
    ON CONFLICT (codigo_pedido) DO UPDATE SET
        numero_pedido = EXCLUDED.numero_pedido,
        codigo_cliente = EXCLUDED.codigo_cliente,
        razao_social = EXCLUDED.razao_social,
        nome_fantasia = EXCLUDED.nome_fantasia,
        codigo_cliente_integracao = EXCLUDED.codigo_cliente_integracao;
END;
$$;


ALTER FUNCTION public.sync_pedido_upsert(p_codigo_pedido bigint, p_numero_pedido text, p_codigo_cliente bigint, p_razao_social text, p_nome_fantasia text, p_codigo_cliente_integracao text) OWNER TO intranet_db_yd0w_user;

--
-- Name: trg_set_updated_at(); Type: FUNCTION; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE FUNCTION public.trg_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.trg_set_updated_at() OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_funcao; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.auth_funcao (
    id bigint NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL
);


ALTER TABLE public.auth_funcao OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_funcao_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.auth_funcao_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auth_funcao_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_funcao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.auth_funcao_id_seq OWNED BY public.auth_funcao.id;


--
-- Name: auth_login_event; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.auth_login_event (
    id bigint NOT NULL,
    user_id bigint,
    username public.citext,
    success boolean NOT NULL,
    reason text,
    ip inet,
    user_agent text,
    at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.auth_login_event OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_login_event_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.auth_login_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auth_login_event_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_login_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.auth_login_event_id_seq OWNED BY public.auth_login_event.id;


--
-- Name: auth_password_reset; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.auth_password_reset (
    id integer NOT NULL,
    user_id bigint NOT NULL,
    code character varying(6) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false
);


ALTER TABLE public.auth_password_reset OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_password_reset_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.auth_password_reset_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auth_password_reset_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_password_reset_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.auth_password_reset_id_seq OWNED BY public.auth_password_reset.id;


--
-- Name: auth_reset_request; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.auth_reset_request (
    id bigint NOT NULL,
    username public.citext NOT NULL,
    requested_by bigint,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT auth_reset_request_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'ignored'::text])))
);


ALTER TABLE public.auth_reset_request OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_reset_request_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.auth_reset_request_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auth_reset_request_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_reset_request_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.auth_reset_request_id_seq OWNED BY public.auth_reset_request.id;


--
-- Name: auth_role_permission; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.auth_role_permission (
    role text NOT NULL,
    node_id bigint NOT NULL,
    allow boolean NOT NULL
);


ALTER TABLE public.auth_role_permission OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_sector; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.auth_sector (
    id bigint NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL
);


ALTER TABLE public.auth_sector OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_sector_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.auth_sector_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auth_sector_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_sector_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.auth_sector_id_seq OWNED BY public.auth_sector.id;


--
-- Name: auth_user_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.auth_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auth_user_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.auth_user_id_seq OWNED BY public.auth_user.id;


--
-- Name: auth_user_operacao; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.auth_user_operacao (
    user_id bigint NOT NULL,
    operacao_id public.citext NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.auth_user_operacao OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_user_permission; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.auth_user_permission (
    user_id bigint NOT NULL,
    node_id bigint NOT NULL,
    allow boolean NOT NULL
);


ALTER TABLE public.auth_user_permission OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_user_profile; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.auth_user_profile (
    user_id bigint NOT NULL,
    sector_id bigint,
    funcao_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.auth_user_profile OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_user_profile_v; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.auth_user_profile_v AS
 SELECT u.id AS user_id,
    (u.username)::text AS username,
    s.name AS setor,
    f.name AS funcao
   FROM (((public.auth_user u
     LEFT JOIN public.auth_user_profile up ON ((up.user_id = u.id)))
     LEFT JOIN public.auth_sector s ON ((s.id = up.sector_id)))
     LEFT JOIN public.auth_funcao f ON ((f.id = up.funcao_id)));


ALTER VIEW public.auth_user_profile_v OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_users_public; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.auth_users_public AS
 SELECT id,
    (username)::text AS username,
    roles
   FROM public.auth_user;


ALTER VIEW public.auth_users_public OWNER TO intranet_db_yd0w_user;

--
-- Name: clientes_cadastro; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.clientes_cadastro (
    codigo_cliente_omie bigint NOT NULL,
    codigo_cliente_integracao text,
    razao_social text,
    nome_fantasia text,
    cnpj_cpf text,
    pessoa_fisica text,
    telefone1_ddd text,
    telefone1_numero text,
    telefone2_ddd text,
    telefone2_numero text,
    contato text,
    email text,
    estado text,
    cidade text,
    cidade_ibge text,
    cep text,
    bairro text,
    endereco text,
    endereco_numero text,
    complemento text,
    pais text,
    inscricao_estadual text,
    inscricao_municipal text,
    inscricao_suframa text,
    optante_simples_nacional text,
    tipo_atividade text,
    cnae text,
    produtor_rural text,
    contribuinte text,
    observacao text,
    tags text[],
    bloqueado text,
    inativo text,
    valor_limite_credito numeric,
    bloquear_faturamento text,
    dados_adicionais jsonb,
    endereco_entrega jsonb,
    dados_bancarios jsonb,
    informacoes jsonb,
    raw_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.clientes_cadastro OWNER TO intranet_db_yd0w_user;

--
-- Name: controle_assistencia_tecnica; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.controle_assistencia_tecnica (
    protc text,
    data text,
    tipo text,
    contato_wpp text,
    cliente text,
    cpf_cnpj text,
    celular_fone text,
    cep text,
    endereco text,
    cidade text,
    uf text,
    agendar_com text,
    n_s text,
    revenda text,
    equipamento text,
    data_venda text,
    n_nf text,
    reclamacao text,
    peca_defeituosa text,
    problema_real text,
    causa_raiz text,
    status text,
    acao_corretiva text,
    observacao_do_fechamento text,
    acao_interna text,
    numero_de_rastreio text,
    destinatario text,
    peca_encaminhada text,
    a_t text,
    nf_de_servico text,
    devolucao text,
    nf_de_devolucao text,
    modelo text,
    data_de_fechamento text,
    custo_do_frete_devolucao text,
    fechamento text,
    custos text,
    classificacao_de_atendimento text,
    tag_sintomas text,
    tag_perguntas_importantes text,
    campo_livre text,
    custo_assistencia_tecnica text,
    custo_envio_de_pecas text,
    pre_atendimento text
);


ALTER TABLE public.controle_assistencia_tecnica OWNER TO intranet_db_yd0w_user;

--
-- Name: controle_at_fechamento; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.controle_at_fechamento (
    n_o_s_sac text,
    descricao_do_servico_realizado text,
    pecas_de_reposicao text,
    valor_gasto_com_pecas text,
    valor_total_mao_de_obra text,
    valor_total_deslocamento_r text,
    nome_da_assist_tecnica text,
    data_de_conclusao_do_servico text,
    carimbo_de_data_hora text,
    celular_do_tecn_para_contato text,
    endereco_de_e_mail text,
    videos_fotos_e_dados_do_servico_realizado text,
    observacoes text,
    distancia_percorrida_km text,
    col_vazio text,
    col_1 text
);


ALTER TABLE public.controle_at_fechamento OWNER TO intranet_db_yd0w_user;

--
-- Name: controle_atendimento_rapido; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.controle_atendimento_rapido (
    protc text,
    data text,
    tipo text,
    contato_wpp text,
    cliente text,
    uf text,
    revenda text,
    identificacao text,
    reclamacao text,
    tag_do_problema text,
    acao_corretiva text,
    plataforma_do_atendimento text,
    dinamica text,
    column_14 text
);


ALTER TABLE public.controle_atendimento_rapido OWNER TO intranet_db_yd0w_user;

--
-- Name: controle_tecnicos; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.controle_tecnicos (
    nome text,
    cnpj_cpf text,
    endereco text,
    municipio text,
    uf text,
    cep text,
    celular text,
    tipo text,
    qtd_atend_ult_1_ano text,
    tempo_medio text
);


ALTER TABLE public.controle_tecnicos OWNER TO intranet_db_yd0w_user;

--
-- Name: etiquetas_impressas; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.etiquetas_impressas (
    id integer NOT NULL,
    numero_op character varying(50) NOT NULL,
    codigo_produto character varying(100) NOT NULL,
    tipo_etiqueta character varying(50) NOT NULL,
    local_impressao character varying(50) NOT NULL,
    conteudo_zpl text NOT NULL,
    impressa boolean DEFAULT false,
    data_criacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    data_impressao timestamp without time zone,
    usuario_criacao character varying(100),
    observacoes text,
    etapa text
);


ALTER TABLE public.etiquetas_impressas OWNER TO intranet_db_yd0w_user;

--
-- Name: etiquetas_impressas_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.etiquetas_impressas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.etiquetas_impressas_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: etiquetas_impressas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.etiquetas_impressas_id_seq OWNED BY public.etiquetas_impressas.id;


--
-- Name: historico_estrutura_iapp; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.historico_estrutura_iapp (
    identificacao_do_produto text,
    descricao_do_produto text,
    identificacao_da_linha_de_producao numeric,
    descricao_da_linha_de_producao text,
    identificacao_da_ficha_tecnica bigint,
    descricao_da_ficha_tecnica text,
    data_de_criacao timestamp without time zone,
    revisao text,
    projeto numeric,
    status text,
    qtde bigint,
    lote_minimo bigint,
    lote_maximo bigint,
    vcpp numeric,
    data_do_vcpp timestamp without time zone,
    mascara_de_lote_antecipado numeric,
    vcp numeric,
    qtde_batelada bigint,
    data_de_validade numeric,
    mao_de_obra_direta bigint,
    gastos_gerais_de_fabricacao bigint,
    margem_de_lucro_bruta bigint,
    status_de_aprovacao text,
    identificacao_da_operacao bigint,
    descricao_da_operacao text,
    tempo_previsto numeric,
    tempo_preparacao numeric,
    tempo_de_espera bigint,
    tempo_de_transporte bigint,
    tempo_de_fila bigint,
    tempo_total numeric,
    unidade_tempo text,
    identificacao_do_produto_consumido text,
    descricao_do_produto_consumido text,
    quantidade_prevista_de_consumo numeric,
    quantidade_prevista_de_perdas numeric,
    identificacao_do_produto_produzido text,
    descricao_do_produto_produzido text,
    quantidade_prevista_de_producao numeric
);


ALTER TABLE public.historico_estrutura_iapp OWNER TO intranet_db_yd0w_user;

--
-- Name: historico_op_glide; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.historico_op_glide (
    concessao text,
    condensadora text,
    controlador text,
    data_de_edicao_de_teste text,
    data_de_fim text,
    data_de_inicio text,
    data_fim_montagem text,
    data_inicio_montagem text,
    data_ultima_conferencia text,
    entran_equipamento text,
    entran_rigidez_dieletrica_maquina_completa_m text,
    entran_tensao_suportavel_maquina_completa_ma text,
    entran_testado_deprovacao_na_conferencia_das_conformidades text,
    funcionarios_envolvidos text,
    funcionarios_envolvidos_2 text,
    glide_record_id text,
    lote_base_debs text,
    lote_compressor text,
    lote_condensadora text,
    lote_evaporador text,
    lote_filtro_secador text,
    lote_marca_do_compressor text,
    lote_motor_ventilador text,
    lote_op_quadro_eletrico text,
    lote_pressostato_de_baixa text,
    lote_pressostato_delta text,
    lote_tampa_debs text,
    lote_tampa_superior_debs_ft20 text,
    lote_tampa_traseira_debs_ft20 text,
    lote_valvula_de_reversao_degelo text,
    modelo text,
    n_da_etapa text,
    n_lote_capacitor_compressor text,
    n_lote_capacitor_partida text,
    n_lote_capacitor_ventilador text,
    n_lote_chave_comutador text,
    n_lote_chicote_eletrico text,
    n_lote_contatora_bipolar text,
    n_lote_controlador text,
    n_lote_gabinete_painel_debs text,
    n_lote_transformador text,
    ordem_de_producao text,
    pedido text,
    prep_base text,
    prep_kit text,
    prep_ventilador text,
    previsao_de_entrega text,
    previsao_de_inicio text,
    primeiro_teste_2_corrente_compressor text,
    primeiro_teste_cop text,
    primeiro_teste_corrente_compressor text,
    primeiro_teste_corrente_total text,
    primeiro_teste_corrente_ventilador text,
    primeiro_teste_dif_temperatura text,
    primeiro_teste_potencia text,
    primeiro_teste_pressao_alta text,
    primeiro_teste_pressao_alta_2_compressores text,
    primeiro_teste_pressao_baixa text,
    primeiro_teste_pressao_baixa_2_compressores text,
    primeiro_teste_qtd_de_gas text,
    primeiro_teste_qtd_de_gas_2_compressores text,
    primeiro_teste_rendimento text,
    primeiro_teste_temperatura_da_agua text,
    primeiro_teste_temperatura_dambiente text,
    primeiro_teste_temperatura_descarga text,
    primeiro_teste_temperatura_filtro text,
    primeiro_teste_temperatura_succao text,
    primeiro_teste_tensao text,
    primeiro_teste_tipo_de_gas text,
    primeiro_teste_vazao text,
    qrcode text,
    ref_fluido_refrigerante text,
    ref_pressao_alta text,
    ref_pressao_alta_max text,
    ref_pressao_alta_min text,
    ref_pressao_baixa text,
    ref_pressao_baixa_max text,
    ref_pressao_baixa_min text,
    ref_quantidade_de_gas_g text,
    ref_rendimento_kcal text,
    ref_vazao_ideal_l_h text,
    referencia_corrente_compressor_a text,
    ri_registro_de_liberacao text,
    rnc text,
    status_deprovacao text,
    tecnico_envolvido text,
    tipo_de_sensor text
);


ALTER TABLE public.historico_op_glide OWNER TO intranet_db_yd0w_user;

--
-- Name: historico_op_glide_f_escopo; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.historico_op_glide_f_escopo (
    colaborador_do_posto_2_primeiro_teste text,
    controlador text,
    data_de_fim text,
    data_de_inicio text,
    data_e_hora_finalizacao text,
    entran_equipamento text,
    entran_rigidez_dieletrica_maquina_completa_m text,
    entran_tensao_suportavel_maquina_completa_ma text,
    entran_testado_deprovacao_na_conferencia_das_conformidades text,
    equi text,
    estanqueidade text,
    estanqueidade_fim text,
    estanqueidade_inicio text,
    funcionarios_envolvidos text,
    funcionarios_envolvidos_2 text,
    glide_record_id text,
    lote_base_debs text,
    lote_compressor text,
    lote_compressor_segundo text,
    lote_condensadora text,
    lote_cor_condensadora text,
    lote_evaporador text,
    lote_filtro_secador text,
    lote_marca_do_compressor text,
    lote_marca_do_compressor_segundo text,
    lote_motor_ventilador text,
    lote_op_quadro_eletrico text,
    lote_pressostato_de_baixa text,
    lote_pressostato_delta text,
    lote_tampa_debs text,
    lote_valvula_de_reversao_degelo text,
    modelo text,
    n_da_etapa text,
    n_lote_capacitor_compressor text,
    n_lote_capacitor_partida text,
    n_lote_capacitor_ventilador text,
    n_lote_chave_comutador text,
    n_lote_chicote_eletrico text,
    n_lote_contatora_bipolar text,
    n_lote_contatora_tripolar text,
    n_lote_controlador text,
    n_lote_gabinete_painel_debs text,
    n_lote_transformador text,
    ordem_de_producao text,
    pedido text,
    posto_1_fim_montagem text,
    posto_1_inicio_montagem text,
    posto_2_fim_primeiro_teste text,
    posto_2_inicio_primeiro_teste text,
    posto_3_fim_higienizacao text,
    posto_3_inicio_higienizacao text,
    posto_4_inicio text,
    prep_base text,
    prep_kit text,
    prep_ventilador text,
    previsao_de_entrega text,
    previsao_de_inicio text,
    primeira_referencia_fluido_refrigerante text,
    primeira_referencia_pressao_alta text,
    primeira_referencia_pressao_alta_max text,
    primeira_referencia_pressao_alta_min text,
    primeira_referencia_pressao_baixa text,
    primeira_referencia_pressao_baixa_max text,
    primeira_referencia_pressao_baixa_min text,
    primeira_referencia_quantidade_de_gas_g text,
    primeira_referencia_rendimento_kcal text,
    primeira_referencia_vazao_ideal_l_h text,
    primeiro_teste_2_corrente_compressor text,
    primeiro_teste_cop text,
    primeiro_teste_corrente_compressor text,
    primeiro_teste_corrente_total text,
    primeiro_teste_corrente_ventilador text,
    primeiro_teste_dif_temperatura text,
    primeiro_teste_potencia text,
    primeiro_teste_pressao_alta text,
    primeiro_teste_pressao_alta_2_compressores text,
    primeiro_teste_pressao_baixa text,
    primeiro_teste_pressao_baixa_2_compressores text,
    primeiro_teste_qtd_de_gas text,
    primeiro_teste_qtd_de_gas_2_compressores text,
    primeiro_teste_rendimento text,
    primeiro_teste_temperatura_da_agua text,
    primeiro_teste_temperatura_dambiente text,
    primeiro_teste_temperatura_descarga text,
    primeiro_teste_temperatura_descarga_compressor_2 text,
    primeiro_teste_temperatura_filtro text,
    primeiro_teste_temperatura_filtro_compressor_2 text,
    primeiro_teste_temperatura_succao text,
    primeiro_teste_temperatura_succao_compressor_2 text,
    primeiro_teste_tensao text,
    primeiro_teste_tipo_de_gas text,
    primeiro_teste_vazao text,
    qrcode text,
    referencia_corrente_compressor_a text,
    ri_registro_de_liberacao text,
    rnc text,
    segunda_referencia_consumo_teste_2 text,
    segunda_referencia_corrente_compressor_teste_2 text,
    segunda_referencia_rendimento_teste_2 text,
    segundo_teste_cop text,
    segundo_teste_corrente_compressor text,
    segundo_teste_corrente_total text,
    segundo_teste_corrente_ventilador text,
    segundo_teste_diferencial_temperatura text,
    segundo_teste_potencia text,
    segundo_teste_rendimento text,
    segundo_teste_temperaturagua text,
    segundo_teste_temperaturambiente text,
    segundo_teste_tensao text,
    segundo_teste_vazao_degua text,
    status_deprovacao text,
    status_do_quadro_eletrico text,
    tecnico_envolvido text,
    tipo_de_sensor_de_fluxo text
);


ALTER TABLE public.historico_op_glide_f_escopo OWNER TO intranet_db_yd0w_user;

--
-- Name: historico_op_iapp; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.historico_op_iapp (
    produto_identificacao text,
    produto_descricao text,
    projeto numeric,
    ficha_tecnica_identificacao bigint,
    ficha_tecnica_descricao text,
    ficha_tecnica_mod bigint,
    ficha_tecnica_ggf bigint,
    cliente text,
    status text,
    identificacao bigint,
    data_de_abertura date,
    data_prevista_inicio timestamp without time zone,
    data_prevista_final timestamp without time zone,
    qtde_a_produzir bigint,
    data_de_criacao timestamp without time zone,
    tempo_total numeric,
    data_de_encerramento timestamp without time zone,
    data_previsao_de_faturamento timestamp without time zone,
    data_de_previsao_de_entrega timestamp without time zone,
    lote_antecipado numeric,
    documento numeric,
    vcp numeric,
    data_do_vcp timestamp without time zone,
    volumes bigint,
    pedido_xped numeric,
    origem text,
    empenhada numeric,
    mao_de_obra_direta bigint,
    gastos_gerais_de_fabricacao bigint,
    ordem_nivel_anterior numeric,
    linha_de_producao text,
    total_qtde_produzida bigint,
    origem_completa text,
    usuario_criador text
);


ALTER TABLE public.historico_op_iapp OWNER TO intranet_db_yd0w_user;

--
-- Name: historico_pedido_originalis; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.historico_pedido_originalis (
    aprovado_por text,
    cliente text,
    control text,
    data_aprovacao text,
    data_da_entrega_futura text,
    data_entrega text,
    data_finalizacao text,
    data_integracao text,
    esq_esf text,
    estado text,
    expedido_por text,
    finalizado_por text,
    glide_row_id text,
    impressao_logistica text,
    impressao_producao text,
    integrado_por text,
    modelo text,
    nota_fiscal text,
    observacao text,
    opcional text,
    ordem_de_producao text,
    pedido text,
    qty text,
    qty_em_estoque text,
    redespacho text,
    situacao text,
    transportadora text,
    veiculo text,
    volumes text
);


ALTER TABLE public.historico_pedido_originalis OWNER TO intranet_db_yd0w_user;

--
-- Name: pedidos_venda; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.pedidos_venda (
    codigo_pedido bigint NOT NULL,
    numero_pedido text,
    codigo_pedido_integracao text,
    codigo_cliente text,
    codigo_empresa text,
    etapa text,
    data_previsao date,
    quantidade_itens integer,
    qtde_parcelas integer,
    codigo_parcela text,
    origem_pedido text,
    bloqueado text,
    dinc date,
    dalt date,
    dfat date,
    faturado text,
    consumidor_final text,
    numero_pedido_cliente text,
    enviar_email text,
    enviar_pix text,
    obs_venda text,
    valor_total_pedido numeric(18,2),
    valor_mercadorias numeric(18,2),
    valor_icms numeric(18,2),
    valor_pis numeric(18,2),
    valor_cofins numeric(18,2),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    codigo_cliente_integracao text,
    codigo_empresa_integracao text,
    tipo_desconto_pedido text,
    perc_desconto_pedido numeric,
    valor_desconto_pedido numeric,
    encerrado text,
    enc_motivo text,
    enc_data text,
    enc_hora text,
    enc_user text,
    nao_gerar_boleto text,
    status text,
    cabecalho jsonb,
    total_pedido jsonb,
    informacoes_adicionais jsonb,
    raw_payload jsonb,
    created_at timestamp with time zone DEFAULT now(),
    razao_social text,
    nome_fantasia text
);


ALTER TABLE public.pedidos_venda OWNER TO intranet_db_yd0w_user;

--
-- Name: pedidos_venda_itens; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.pedidos_venda_itens (
    codigo_pedido bigint NOT NULL,
    seq bigint DEFAULT 1 NOT NULL,
    codigo_produto bigint,
    codigo text,
    descricao text,
    unidade text,
    quantidade numeric(18,4),
    valor_unitario numeric(18,4),
    valor_total numeric(18,2),
    peso_liquido numeric(18,3),
    peso_bruto numeric(18,3),
    ncm text,
    cfop text,
    descricao_produto text,
    codigo_produto_integracao text
);


ALTER TABLE public.pedidos_venda_itens OWNER TO intranet_db_yd0w_user;

--
-- Name: kanban_comercial_view; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.kanban_comercial_view AS
 SELECT pv.codigo_pedido,
    pv.numero_pedido,
    pv.numero_pedido_cliente,
    pv.codigo_cliente,
    pv.data_previsao,
    pv.etapa,
        CASE
            WHEN (pv.etapa = '80'::text) THEN 'Pedido aprovado'::text
            WHEN (pv.etapa = ANY (ARRAY['60'::text, '70'::text])) THEN 'Fila de produção'::text
            ELSE 'Aguardando prazo'::text
        END AS kanban_coluna,
    it.codigo AS produto_codigo,
    it.descricao AS produto_descricao,
    it.quantidade,
    it.valor_total
   FROM (public.pedidos_venda pv
     JOIN public.pedidos_venda_itens it ON ((it.codigo_pedido = pv.codigo_pedido)));


ALTER VIEW public.kanban_comercial_view OWNER TO intranet_db_yd0w_user;

--
-- Name: op_info; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.op_info (
    n_cod_op bigint NOT NULL,
    c_num_op text,
    c_cod_int_op text,
    n_cod_prod bigint,
    produto_codigo text,
    codigo_local_estoque bigint,
    n_qtde numeric,
    c_etapa text,
    c_concluida text,
    d_dt_previsao date,
    d_dt_inicio date,
    d_dt_conclusao date,
    d_inclusao date,
    d_alteracao date,
    u_inc text,
    u_alt text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.op_info OWNER TO intranet_db_yd0w_user;

--
-- Name: kanban_preparacao_view; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.kanban_preparacao_view AS
 SELECT n_cod_op,
    COALESCE(NULLIF(c_cod_int_op, ''::text), c_num_op, (n_cod_op)::text) AS op,
    COALESCE(produto_codigo, (n_cod_prod)::text) AS c_cod_int_prod,
        CASE c_etapa
            WHEN '10'::text THEN 'A Produzir'::text
            WHEN '20'::text THEN 'Produzindo'::text
            WHEN '30'::text THEN 'teste 1'::text
            WHEN '40'::text THEN 'teste final'::text
            WHEN '60'::text THEN 'concluido'::text
            ELSE NULL::text
        END AS kanban_coluna
   FROM public.op_info i
  WHERE (c_etapa = ANY (ARRAY['10'::text, '20'::text, '30'::text, '40'::text, '60'::text]));


ALTER VIEW public.kanban_preparacao_view OWNER TO intranet_db_yd0w_user;

--
-- Name: nav_node; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.nav_node (
    id bigint NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    "position" text NOT NULL,
    parent_id bigint,
    sort integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    selector text,
    CONSTRAINT nav_node_position_check CHECK (("position" = ANY (ARRAY['top'::text, 'side'::text])))
);


ALTER TABLE public.nav_node OWNER TO intranet_db_yd0w_user;

--
-- Name: nav_node_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.nav_node_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.nav_node_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: nav_node_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.nav_node_id_seq OWNED BY public.nav_node.id;


--
-- Name: ns_pool; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.ns_pool (
    id bigint NOT NULL,
    codigo text NOT NULL,
    ns text NOT NULL,
    consumed boolean DEFAULT false NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ns_pool OWNER TO intranet_db_yd0w_user;

--
-- Name: ns_pool_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.ns_pool_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ns_pool_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: ns_pool_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.ns_pool_id_seq OWNED BY public.ns_pool.id;


--
-- Name: omie_estoque_posicao; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.omie_estoque_posicao (
    id bigint NOT NULL,
    data_posicao date NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    local_codigo text NOT NULL,
    omie_prod_id bigint,
    cod_int text,
    codigo text,
    descricao text,
    preco_unitario numeric(18,4),
    saldo numeric(18,4) DEFAULT 0 NOT NULL,
    cmc numeric(18,4),
    pendente numeric(18,4),
    estoque_minimo numeric(18,4),
    reservado numeric(18,4),
    fisico numeric(18,4),
    omie_prod_id_key bigint GENERATED ALWAYS AS (COALESCE(omie_prod_id, (0)::bigint)) STORED,
    codigo_key text GENERATED ALWAYS AS (COALESCE(codigo, ''::text)) STORED,
    CONSTRAINT omie_estoque_posicao_cmc_check CHECK (((cmc IS NULL) OR (cmc >= (0)::numeric))),
    CONSTRAINT omie_estoque_posicao_estoque_minimo_check CHECK (((estoque_minimo IS NULL) OR (estoque_minimo >= (0)::numeric))),
    CONSTRAINT omie_estoque_posicao_fisico_check CHECK (((fisico IS NULL) OR (fisico >= (0)::numeric))),
    CONSTRAINT omie_estoque_posicao_pendente_check CHECK (((pendente IS NULL) OR (pendente >= (0)::numeric))),
    CONSTRAINT omie_estoque_posicao_reservado_check CHECK (((reservado IS NULL) OR (reservado >= (0)::numeric))),
    CONSTRAINT omie_estoque_posicao_saldo_check CHECK ((saldo >= (0)::numeric))
);


ALTER TABLE public.omie_estoque_posicao OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_estoque_posicao_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.omie_estoque_posicao_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.omie_estoque_posicao_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_estoque_posicao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.omie_estoque_posicao_id_seq OWNED BY public.omie_estoque_posicao.id;


--
-- Name: omie_estrutura; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.omie_estrutura (
    id bigint NOT NULL,
    id_produto bigint,
    int_produto text,
    cod_produto text,
    descr_produto text,
    tipo_produto text,
    unid_produto text,
    peso_liq_produto numeric(20,6),
    peso_bruto_produto numeric(20,6),
    obs_relevantes text,
    v_mod numeric(20,6),
    v_ggf numeric(20,6),
    origem text DEFAULT 'omie'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    versao integer DEFAULT 1 NOT NULL,
    modificador text
);


ALTER TABLE public.omie_estrutura OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_estrutura_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.omie_estrutura_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.omie_estrutura_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_estrutura_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.omie_estrutura_id_seq OWNED BY public.omie_estrutura.id;


--
-- Name: omie_estrutura_item; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.omie_estrutura_item (
    id bigint NOT NULL,
    parent_id bigint NOT NULL,
    id_malha bigint,
    int_malha text,
    id_prod_malha bigint,
    int_prod_malha text,
    cod_prod_malha text,
    descr_prod_malha text,
    quant_prod_malha numeric(20,6) DEFAULT 0 NOT NULL,
    unid_prod_malha text,
    tipo_prod_malha text,
    id_fam_malha bigint,
    cod_fam_malha text,
    descr_fam_malha text,
    peso_liq_prod_malha numeric(20,6),
    peso_bruto_prod_malha numeric(20,6),
    perc_perda_prod_malha numeric(10,4),
    obs_prod_malha text,
    d_inc_prod_malha date,
    h_inc_prod_malha time without time zone,
    u_inc_prod_malha text,
    d_alt_prod_malha date,
    h_alt_prod_malha time without time zone,
    u_alt_prod_malha text,
    codigo_local_estoque text,
    custo_real numeric(20,6),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    comp_operacao text,
    origem text,
    destino text,
    operacao text
);


ALTER TABLE public.omie_estrutura_item OWNER TO intranet_db_yd0w_user;

--
-- Name: COLUMN omie_estrutura_item.origem; Type: COMMENT; Schema: public; Owner: intranet_db_yd0w_user
--

COMMENT ON COLUMN public.omie_estrutura_item.origem IS 'Origem do componente (ex.: QUADRO ELÉTRICO); antes era "operacao".';


--
-- Name: COLUMN omie_estrutura_item.destino; Type: COMMENT; Schema: public; Owner: intranet_db_yd0w_user
--

COMMENT ON COLUMN public.omie_estrutura_item.destino IS 'Destino do componente, importado do CSV (coluna "Destino").';


--
-- Name: COLUMN omie_estrutura_item.operacao; Type: COMMENT; Schema: public; Owner: intranet_db_yd0w_user
--

COMMENT ON COLUMN public.omie_estrutura_item.operacao IS 'Origem: coluna "Operação" do CSV B.O.M.';


--
-- Name: omie_estrutura_item_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.omie_estrutura_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.omie_estrutura_item_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_estrutura_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.omie_estrutura_item_id_seq OWNED BY public.omie_estrutura_item.id;


--
-- Name: omie_estrutura_item_versao; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.omie_estrutura_item_versao (
    id bigint,
    parent_id bigint,
    id_malha bigint,
    int_malha text,
    id_prod_malha bigint,
    int_prod_malha text,
    cod_prod_malha text,
    descr_prod_malha text,
    quant_prod_malha numeric(20,6),
    unid_prod_malha text,
    tipo_prod_malha text,
    id_fam_malha bigint,
    cod_fam_malha text,
    descr_fam_malha text,
    peso_liq_prod_malha numeric(20,6),
    peso_bruto_prod_malha numeric(20,6),
    perc_perda_prod_malha numeric(10,4),
    obs_prod_malha text,
    d_inc_prod_malha date,
    h_inc_prod_malha time without time zone,
    u_inc_prod_malha text,
    d_alt_prod_malha date,
    h_alt_prod_malha time without time zone,
    u_alt_prod_malha text,
    codigo_local_estoque text,
    custo_real numeric(20,6),
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    comp_operacao text,
    origem text,
    destino text,
    operacao text,
    versao integer NOT NULL,
    modificador text,
    snapshot_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.omie_estrutura_item_versao OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_estrutura_raw; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.omie_estrutura_raw (
    id bigint NOT NULL,
    key_ref text,
    payload jsonb NOT NULL,
    captured_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.omie_estrutura_raw OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_estrutura_raw_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.omie_estrutura_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.omie_estrutura_raw_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_estrutura_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.omie_estrutura_raw_id_seq OWNED BY public.omie_estrutura_raw.id;


--
-- Name: omie_locais_estoque; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.omie_locais_estoque (
    local_codigo text NOT NULL,
    nome text,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.omie_locais_estoque OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_malha_cab; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.omie_malha_cab (
    produto_id bigint NOT NULL,
    produto_codigo text,
    produto_descricao text,
    familia_id bigint,
    familia_codigo text,
    familia_descricao text,
    tipo_produto text,
    unidade text,
    peso_liq numeric(18,6),
    peso_bruto numeric(18,6),
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.omie_malha_cab OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_malha_item; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.omie_malha_item (
    id bigint NOT NULL,
    produto_id bigint NOT NULL,
    item_malha_id bigint,
    item_prod_id bigint,
    item_codigo text,
    item_descricao text,
    item_unidade text,
    item_tipo text,
    item_familia_id bigint,
    item_familia_codigo text,
    item_familia_desc text,
    quantidade numeric(18,6) DEFAULT 0 NOT NULL,
    perc_perda numeric(9,6) DEFAULT 0 NOT NULL,
    peso_liq numeric(18,6),
    peso_bruto numeric(18,6),
    codigo_local_estoque bigint,
    d_inc date,
    h_inc time without time zone,
    u_inc text,
    d_alt date,
    h_alt time without time zone,
    u_alt text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT omie_malha_item_perc_perda_check CHECK (((perc_perda >= (0)::numeric) AND (perc_perda <= (100)::numeric))),
    CONSTRAINT omie_malha_item_quantidade_check CHECK ((quantidade >= (0)::numeric))
);


ALTER TABLE public.omie_malha_item OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_malha_item_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.omie_malha_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.omie_malha_item_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_malha_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.omie_malha_item_id_seq OWNED BY public.omie_malha_item.id;


--
-- Name: omie_operacao; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.omie_operacao (
    operacao public.citext NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.omie_operacao OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_webhook_events; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.omie_webhook_events (
    id bigint NOT NULL,
    event_id text,
    event_type text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    payload_json jsonb NOT NULL
);


ALTER TABLE public.omie_webhook_events OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_webhook_events_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.omie_webhook_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.omie_webhook_events_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: omie_webhook_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.omie_webhook_events_id_seq OWNED BY public.omie_webhook_events.id;


--
-- Name: op_codigos_log; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.op_codigos_log (
    id bigint NOT NULL,
    ccodintop text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.op_codigos_log OWNER TO intranet_db_yd0w_user;

--
-- Name: op_codigos_log_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.op_codigos_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.op_codigos_log_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: op_codigos_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.op_codigos_log_id_seq OWNED BY public.op_codigos_log.id;


--
-- Name: op_etapa_kanban_map; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.op_etapa_kanban_map (
    c_etapa text NOT NULL,
    kanban_coluna text NOT NULL
);


ALTER TABLE public.op_etapa_kanban_map OWNER TO intranet_db_yd0w_user;

--
-- Name: op_ordens; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.op_ordens (
    n_cod_op bigint NOT NULL,
    c_cod_int_op text,
    c_num_op text,
    n_cod_produto bigint,
    c_cod_int_prod text,
    d_dt_previsao date,
    n_qtde numeric(14,4),
    codigo_local_estoque bigint,
    n_id_lote_op bigint,
    d_dt_inicio date,
    d_dt_conclusao date,
    n_cod_projeto bigint,
    c_etapa text,
    c_obs text,
    c_concluida character(1),
    d_conclusao date,
    h_conclusao time without time zone,
    d_inclusao date,
    h_inclusao time without time zone,
    u_inc text,
    d_alteracao date,
    h_alteracao time without time zone,
    u_alt text,
    last_payload jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.op_ordens OWNER TO intranet_db_yd0w_user;

--
-- Name: op_etapa_kanban_view; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.op_etapa_kanban_view AS
 SELECT o.n_cod_op,
    o.c_etapa,
    COALESCE(m.kanban_coluna, 'A Produzir'::text) AS kanban_coluna
   FROM (public.op_ordens o
     LEFT JOIN public.op_etapa_kanban_map m ON ((m.c_etapa = o.c_etapa)));


ALTER VIEW public.op_etapa_kanban_view OWNER TO intranet_db_yd0w_user;

--
-- Name: op_event; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.op_event (
    id bigint NOT NULL,
    op text,
    tipo text NOT NULL,
    usuario text NOT NULL,
    momento timestamp with time zone DEFAULT now() NOT NULL,
    payload jsonb,
    CONSTRAINT op_event_tipo_check CHECK ((tipo = ANY (ARRAY['I'::text, 'F'::text, 'arrasto'::text])))
);


ALTER TABLE public.op_event OWNER TO intranet_db_yd0w_user;

--
-- Name: op_event_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.op_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.op_event_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: op_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.op_event_id_seq OWNED BY public.op_event.id;


--
-- Name: op_movimentos; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.op_movimentos (
    id bigint NOT NULL,
    op text NOT NULL,
    de_status text,
    para_status text NOT NULL,
    carimbo timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT op_movimentos_para_status_check CHECK ((para_status = ANY (ARRAY['Fila de produção'::text, 'Em produção'::text, 'No estoque'::text])))
);


ALTER TABLE public.op_movimentos OWNER TO intranet_db_yd0w_user;

--
-- Name: op_movimentos_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.op_movimentos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.op_movimentos_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: op_movimentos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.op_movimentos_id_seq OWNED BY public.op_movimentos.id;


--
-- Name: op_raw; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.op_raw (
    n_cod_op bigint NOT NULL,
    c_num_op text,
    payload jsonb NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.op_raw OWNER TO intranet_db_yd0w_user;

--
-- Name: op_status; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.op_status (
    id bigint NOT NULL,
    produto_codigo text NOT NULL,
    op text NOT NULL,
    status text NOT NULL,
    pedido text,
    quantidade integer DEFAULT 1,
    estoque integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT op_status_status_check CHECK ((status = ANY (ARRAY['Fila de produção'::text, 'Em produção'::text, 'No estoque'::text])))
);


ALTER TABLE public.op_status OWNER TO intranet_db_yd0w_user;

--
-- Name: op_status_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.op_status_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.op_status_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: op_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.op_status_id_seq OWNED BY public.op_status.id;


--
-- Name: op_status_overlay; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.op_status_overlay (
    op text NOT NULL,
    status text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.op_status_overlay OWNER TO intranet_db_yd0w_user;

--
-- Name: pcp_personalizacao; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.pcp_personalizacao (
    id bigint NOT NULL,
    codigo_pai text NOT NULL,
    versao_base integer,
    numero_referencia text,
    criado_por text,
    criado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.pcp_personalizacao OWNER TO intranet_db_yd0w_user;

--
-- Name: pcp_personalizacao_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.pcp_personalizacao_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pcp_personalizacao_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: pcp_personalizacao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.pcp_personalizacao_id_seq OWNED BY public.pcp_personalizacao.id;


--
-- Name: pcp_personalizacao_item; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.pcp_personalizacao_item (
    id bigint NOT NULL,
    personalizacao_id bigint NOT NULL,
    tipo text,
    grupo text,
    codigo_original text,
    codigo_trocado text,
    descricao_original text,
    descricao_trocada text,
    parent_codigo text,
    quantidade numeric(20,6),
    criado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.pcp_personalizacao_item OWNER TO intranet_db_yd0w_user;

--
-- Name: pcp_personalizacao_item_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.pcp_personalizacao_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pcp_personalizacao_item_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: pcp_personalizacao_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.pcp_personalizacao_item_id_seq OWNED BY public.pcp_personalizacao_item.id;


--
-- Name: produtos; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.produtos (
    id bigint NOT NULL,
    codigo text NOT NULL,
    codigo_prod bigint,
    descricao text,
    tipo text,
    ncm text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.produtos OWNER TO intranet_db_yd0w_user;

--
-- Name: produtos_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.produtos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.produtos_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: produtos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.produtos_id_seq OWNED BY public.produtos.id;


--
-- Name: produtos_omie; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.produtos_omie (
    codigo_produto bigint NOT NULL,
    codigo_produto_integracao text NOT NULL,
    codigo text NOT NULL,
    descricao text,
    descr_detalhada text,
    unidade text,
    tipoitem text,
    ncm text,
    marca text,
    modelo text,
    inativo character(1),
    bloqueado character(1),
    bloquear_exclusao character(1),
    importado_api character(1),
    exibir_descricao_nfe character(1),
    exibir_descricao_pedido character(1),
    produto_lote character(1),
    produto_variacao character(1),
    ean text,
    codint_familia text,
    codigo_familia bigint,
    descricao_familia text,
    cfop text,
    cest text,
    codigo_beneficio text,
    csosn_icms text,
    cst_icms text,
    cst_pis text,
    cst_cofins text,
    aliquota_icms numeric(7,4),
    per_icms_fcp numeric(7,4),
    aliquota_pis numeric(7,4),
    aliquota_cofins numeric(7,4),
    aliquota_ibpt numeric(7,4),
    red_base_icms numeric(7,4),
    red_base_pis numeric(7,4),
    red_base_cofins numeric(7,4),
    motivo_deson_icms text,
    estoque_minimo numeric(18,3),
    quantidade_estoque numeric(18,3),
    valor_unitario numeric(18,2),
    altura numeric(18,3),
    largura numeric(18,3),
    profundidade numeric(18,3),
    peso_bruto numeric(18,3),
    peso_liq numeric(18,3),
    dias_garantia integer,
    dias_crossdocking integer,
    lead_time integer,
    obs_internas text,
    cnpj_fabricante text,
    cupom_fiscal character(1),
    id_cest text,
    id_preco_tabelado bigint,
    indicador_escala text,
    market_place character(1),
    origem_mercadoria text,
    dalt date,
    halt time without time zone,
    dinc date,
    hinc time without time zone,
    ualt text,
    uinc text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    raw jsonb
);


ALTER TABLE public.produtos_omie OWNER TO intranet_db_yd0w_user;

--
-- Name: produtos_omie_imagens; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.produtos_omie_imagens (
    codigo_produto bigint NOT NULL,
    pos smallint NOT NULL,
    url_imagem text NOT NULL,
    path_key text
);


ALTER TABLE public.produtos_omie_imagens OWNER TO intranet_db_yd0w_user;

--
-- Name: user_message; Type: TABLE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TABLE public.user_message (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_message OWNER TO intranet_db_yd0w_user;

--
-- Name: user_message_id_seq; Type: SEQUENCE; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE SEQUENCE public.user_message_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_message_id_seq OWNER TO intranet_db_yd0w_user;

--
-- Name: user_message_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER SEQUENCE public.user_message_id_seq OWNED BY public.user_message.id;


--
-- Name: v_omie_estoque_posicao_atual; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.v_omie_estoque_posicao_atual AS
 WITH ranked AS (
         SELECT omie_estoque_posicao.id,
            omie_estoque_posicao.data_posicao,
            omie_estoque_posicao.ingested_at,
            omie_estoque_posicao.local_codigo,
            omie_estoque_posicao.omie_prod_id,
            omie_estoque_posicao.cod_int,
            omie_estoque_posicao.codigo,
            omie_estoque_posicao.descricao,
            omie_estoque_posicao.preco_unitario,
            omie_estoque_posicao.saldo,
            omie_estoque_posicao.cmc,
            omie_estoque_posicao.pendente,
            omie_estoque_posicao.estoque_minimo,
            omie_estoque_posicao.reservado,
            omie_estoque_posicao.fisico,
            row_number() OVER (PARTITION BY omie_estoque_posicao.local_codigo, COALESCE(omie_estoque_posicao.omie_prod_id, (0)::bigint), COALESCE(omie_estoque_posicao.codigo, ''::text) ORDER BY omie_estoque_posicao.data_posicao DESC, omie_estoque_posicao.ingested_at DESC, omie_estoque_posicao.id DESC) AS rk
           FROM public.omie_estoque_posicao
        )
 SELECT id,
    data_posicao,
    ingested_at,
    local_codigo,
    omie_prod_id,
    cod_int,
    codigo,
    descricao,
    preco_unitario,
    saldo,
    cmc,
    pendente,
    estoque_minimo,
    reservado,
    fisico
   FROM ranked
  WHERE (rk = 1);


ALTER VIEW public.v_omie_estoque_posicao_atual OWNER TO intranet_db_yd0w_user;

--
-- Name: v_almoxarifado_grid; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.v_almoxarifado_grid AS
 SELECT local_codigo AS local,
    codigo AS produto_codigo,
    descricao AS produto_descricao,
    COALESCE(saldo, (0)::numeric) AS saldo,
    COALESCE(reservado, (0)::numeric) AS reservado,
    COALESCE(pendente, (0)::numeric) AS pendente,
    COALESCE(fisico, (0)::numeric) AS fisico,
    COALESCE(cmc, (0)::numeric) AS cmc,
    COALESCE(estoque_minimo, (0)::numeric) AS estoque_minimo,
    preco_unitario,
    data_posicao,
    ingested_at
   FROM public.v_omie_estoque_posicao_atual p
  ORDER BY local_codigo, codigo;


ALTER VIEW public.v_almoxarifado_grid OWNER TO intranet_db_yd0w_user;

--
-- Name: v_omie_estoque_posicao_atual_por_local; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.v_omie_estoque_posicao_atual_por_local AS
 WITH latest_date AS (
         SELECT omie_estoque_posicao.local_codigo,
            max(omie_estoque_posicao.data_posicao) AS data_posicao
           FROM public.omie_estoque_posicao
          GROUP BY omie_estoque_posicao.local_codigo
        ), ranked AS (
         SELECT p.id,
            p.data_posicao,
            p.ingested_at,
            p.local_codigo,
            p.omie_prod_id,
            p.cod_int,
            p.codigo,
            p.descricao,
            p.preco_unitario,
            p.saldo,
            p.cmc,
            p.pendente,
            p.estoque_minimo,
            p.reservado,
            p.fisico,
            p.omie_prod_id_key,
            p.codigo_key,
            row_number() OVER (PARTITION BY p.local_codigo, p.omie_prod_id, p.codigo ORDER BY p.data_posicao DESC, p.ingested_at DESC, p.id DESC) AS rk
           FROM (public.omie_estoque_posicao p
             JOIN latest_date d ON (((d.local_codigo = p.local_codigo) AND (d.data_posicao = p.data_posicao))))
        )
 SELECT id,
    data_posicao,
    ingested_at,
    local_codigo,
    omie_prod_id,
    cod_int,
    codigo,
    descricao,
    preco_unitario,
    saldo,
    cmc,
    pendente,
    estoque_minimo,
    reservado,
    fisico
   FROM ranked
  WHERE (rk = 1);


ALTER VIEW public.v_omie_estoque_posicao_atual_por_local OWNER TO intranet_db_yd0w_user;

--
-- Name: v_almoxarifado_grid_atual; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.v_almoxarifado_grid_atual AS
 SELECT local_codigo AS local,
    codigo AS produto_codigo,
    descricao AS produto_descricao,
    COALESCE(saldo, (0)::numeric) AS saldo,
    COALESCE(reservado, (0)::numeric) AS reservado,
    COALESCE(fisico, (0)::numeric) AS fisico,
    COALESCE(cmc, (0)::numeric) AS cmc,
    COALESCE(estoque_minimo, (0)::numeric) AS estoque_minimo,
    preco_unitario,
    data_posicao,
    ingested_at
   FROM public.v_omie_estoque_posicao_atual_por_local p
  ORDER BY local_codigo, codigo;


ALTER VIEW public.v_almoxarifado_grid_atual OWNER TO intranet_db_yd0w_user;

--
-- Name: v_pcp_estrutura; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.v_pcp_estrutura AS
 SELECT cab.produto_id AS pai_id,
    cab.produto_codigo AS pai_codigo,
    cab.produto_descricao AS pai_descricao,
    cab.familia_codigo AS pai_familia,
    cab.familia_descricao AS pai_familia_desc,
    cab.tipo_produto AS pai_tipo,
    cab.unidade AS pai_unid,
    it.item_prod_id AS comp_id,
    it.item_codigo AS comp_codigo,
    it.item_descricao AS comp_descricao,
    it.item_unidade AS comp_unid,
    it.item_tipo AS comp_tipo,
    it.quantidade AS comp_qtd,
    it.perc_perda AS comp_perda_pct,
    ((it.quantidade * ((1)::numeric + (COALESCE(it.perc_perda, (0)::numeric) / 100.0))))::numeric(18,6) AS comp_qtd_bruta,
    it.codigo_local_estoque AS comp_local,
    ei.comp_operacao,
    it.d_inc,
    it.h_inc,
    it.u_inc,
    it.d_alt,
    it.h_alt,
    it.u_alt,
    cab.last_synced_at
   FROM (((public.omie_malha_item it
     JOIN public.omie_malha_cab cab ON ((cab.produto_id = it.produto_id)))
     LEFT JOIN public.omie_estrutura e ON ((e.cod_produto = cab.produto_codigo)))
     LEFT JOIN public.omie_estrutura_item ei ON (((ei.parent_id = e.id) AND ((ei.id_prod_malha = it.item_prod_id) OR (ei.int_prod_malha = it.item_codigo) OR (ei.cod_prod_malha = it.item_codigo)))))
  ORDER BY cab.produto_codigo, it.item_codigo;


ALTER VIEW public.v_pcp_estrutura OWNER TO intranet_db_yd0w_user;

--
-- Name: vw_estrutura_para_front; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.vw_estrutura_para_front AS
 SELECT e.cod_produto AS pai_cod_produto,
    COALESCE(i.cod_prod_malha, (i.id_prod_malha)::text, i.int_prod_malha) AS comp_codigo,
    i.descr_prod_malha AS comp_descricao,
    i.quant_prod_malha AS comp_qtd,
    i.unid_prod_malha AS comp_unid,
    i.custo_real,
    NULLIF(COALESCE(i.comp_operacao, i.obs_prod_malha), ''::text) AS comp_operacao
   FROM (public.omie_estrutura e
     JOIN public.omie_estrutura_item i ON ((i.parent_id = e.id)));


ALTER VIEW public.vw_estrutura_para_front OWNER TO intranet_db_yd0w_user;

--
-- Name: vw_estrutura_para_front_v2; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.vw_estrutura_para_front_v2 AS
 SELECT e.cod_produto AS pai_cod_produto,
    COALESCE(i.cod_prod_malha, (i.id_prod_malha)::text, i.int_prod_malha) AS comp_codigo,
    i.descr_prod_malha AS comp_descricao,
    i.quant_prod_malha AS comp_qtd,
    i.unid_prod_malha AS comp_unid,
    i.operacao AS comp_operacao,
    i.custo_real,
    NULL::integer AS ordem
   FROM (public.omie_estrutura e
     JOIN public.omie_estrutura_item i ON ((i.parent_id = e.id)));


ALTER VIEW public.vw_estrutura_para_front_v2 OWNER TO intranet_db_yd0w_user;

--
-- Name: vw_estrutura_para_front_v3; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.vw_estrutura_para_front_v3 AS
 SELECT e.cod_produto AS pai_cod_produto,
    COALESCE(i.cod_prod_malha, (i.id_prod_malha)::text, i.int_prod_malha) AS comp_codigo,
    i.descr_prod_malha AS comp_descricao,
    i.quant_prod_malha AS comp_qtd,
    i.unid_prod_malha AS comp_unid,
    i.origem AS comp_operacao,
    i.destino AS comp_destino,
    i.custo_real,
    NULL::integer AS ordem
   FROM (public.omie_estrutura e
     JOIN public.omie_estrutura_item i ON ((i.parent_id = e.id)));


ALTER VIEW public.vw_estrutura_para_front_v3 OWNER TO intranet_db_yd0w_user;

--
-- Name: vw_lista_produtos; Type: VIEW; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE VIEW public.vw_lista_produtos AS
 SELECT p.codigo_produto,
    p.codigo_produto_integracao,
    p.codigo,
    p.descricao,
    p.unidade,
    p.tipoitem,
    p.ncm,
    p.valor_unitario,
    p.quantidade_estoque,
    p.inativo,
    p.bloqueado,
    p.marca,
    p.modelo,
    p.dalt,
    p.halt,
    p.dinc,
    p.hinc,
    img.url_imagem AS primeira_imagem
   FROM (public.produtos_omie p
     LEFT JOIN LATERAL ( SELECT i.url_imagem
           FROM public.produtos_omie_imagens i
          WHERE (i.codigo_produto = p.codigo_produto)
          ORDER BY i.pos
         LIMIT 1) img ON (true));


ALTER VIEW public.vw_lista_produtos OWNER TO intranet_db_yd0w_user;

--
-- Name: auth_funcao id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_funcao ALTER COLUMN id SET DEFAULT nextval('public.auth_funcao_id_seq'::regclass);


--
-- Name: auth_login_event id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_login_event ALTER COLUMN id SET DEFAULT nextval('public.auth_login_event_id_seq'::regclass);


--
-- Name: auth_password_reset id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_password_reset ALTER COLUMN id SET DEFAULT nextval('public.auth_password_reset_id_seq'::regclass);


--
-- Name: auth_reset_request id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_reset_request ALTER COLUMN id SET DEFAULT nextval('public.auth_reset_request_id_seq'::regclass);


--
-- Name: auth_sector id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_sector ALTER COLUMN id SET DEFAULT nextval('public.auth_sector_id_seq'::regclass);


--
-- Name: auth_user id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user ALTER COLUMN id SET DEFAULT nextval('public.auth_user_id_seq'::regclass);


--
-- Name: etiquetas_impressas id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.etiquetas_impressas ALTER COLUMN id SET DEFAULT nextval('public.etiquetas_impressas_id_seq'::regclass);


--
-- Name: nav_node id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.nav_node ALTER COLUMN id SET DEFAULT nextval('public.nav_node_id_seq'::regclass);


--
-- Name: ns_pool id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.ns_pool ALTER COLUMN id SET DEFAULT nextval('public.ns_pool_id_seq'::regclass);


--
-- Name: omie_estoque_posicao id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_estoque_posicao ALTER COLUMN id SET DEFAULT nextval('public.omie_estoque_posicao_id_seq'::regclass);


--
-- Name: omie_estrutura id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_estrutura ALTER COLUMN id SET DEFAULT nextval('public.omie_estrutura_id_seq'::regclass);


--
-- Name: omie_estrutura_item id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_estrutura_item ALTER COLUMN id SET DEFAULT nextval('public.omie_estrutura_item_id_seq'::regclass);


--
-- Name: omie_estrutura_raw id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_estrutura_raw ALTER COLUMN id SET DEFAULT nextval('public.omie_estrutura_raw_id_seq'::regclass);


--
-- Name: omie_malha_item id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_malha_item ALTER COLUMN id SET DEFAULT nextval('public.omie_malha_item_id_seq'::regclass);


--
-- Name: omie_webhook_events id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_webhook_events ALTER COLUMN id SET DEFAULT nextval('public.omie_webhook_events_id_seq'::regclass);


--
-- Name: op_codigos_log id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_codigos_log ALTER COLUMN id SET DEFAULT nextval('public.op_codigos_log_id_seq'::regclass);


--
-- Name: op_event id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_event ALTER COLUMN id SET DEFAULT nextval('public.op_event_id_seq'::regclass);


--
-- Name: op_movimentos id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_movimentos ALTER COLUMN id SET DEFAULT nextval('public.op_movimentos_id_seq'::regclass);


--
-- Name: op_status id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_status ALTER COLUMN id SET DEFAULT nextval('public.op_status_id_seq'::regclass);


--
-- Name: pcp_personalizacao id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.pcp_personalizacao ALTER COLUMN id SET DEFAULT nextval('public.pcp_personalizacao_id_seq'::regclass);


--
-- Name: pcp_personalizacao_item id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.pcp_personalizacao_item ALTER COLUMN id SET DEFAULT nextval('public.pcp_personalizacao_item_id_seq'::regclass);


--
-- Name: produtos id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.produtos ALTER COLUMN id SET DEFAULT nextval('public.produtos_id_seq'::regclass);


--
-- Name: user_message id; Type: DEFAULT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.user_message ALTER COLUMN id SET DEFAULT nextval('public.user_message_id_seq'::regclass);


--
-- Name: auth_funcao auth_funcao_name_key; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_funcao
    ADD CONSTRAINT auth_funcao_name_key UNIQUE (name);


--
-- Name: auth_funcao auth_funcao_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_funcao
    ADD CONSTRAINT auth_funcao_pkey PRIMARY KEY (id);


--
-- Name: auth_login_event auth_login_event_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_login_event
    ADD CONSTRAINT auth_login_event_pkey PRIMARY KEY (id);


--
-- Name: auth_password_reset auth_password_reset_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_password_reset
    ADD CONSTRAINT auth_password_reset_pkey PRIMARY KEY (id);


--
-- Name: auth_reset_request auth_reset_request_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_reset_request
    ADD CONSTRAINT auth_reset_request_pkey PRIMARY KEY (id);


--
-- Name: auth_role_permission auth_role_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_role_permission
    ADD CONSTRAINT auth_role_permission_pkey PRIMARY KEY (role, node_id);


--
-- Name: auth_sector auth_sector_name_key; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_sector
    ADD CONSTRAINT auth_sector_name_key UNIQUE (name);


--
-- Name: auth_sector auth_sector_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_sector
    ADD CONSTRAINT auth_sector_pkey PRIMARY KEY (id);


--
-- Name: auth_user_operacao auth_user_operacao_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user_operacao
    ADD CONSTRAINT auth_user_operacao_pkey PRIMARY KEY (user_id, operacao_id);


--
-- Name: auth_user_permission auth_user_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user_permission
    ADD CONSTRAINT auth_user_permission_pkey PRIMARY KEY (user_id, node_id);


--
-- Name: auth_user auth_user_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user
    ADD CONSTRAINT auth_user_pkey PRIMARY KEY (id);


--
-- Name: auth_user_profile auth_user_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user_profile
    ADD CONSTRAINT auth_user_profile_pkey PRIMARY KEY (user_id);


--
-- Name: auth_user auth_user_username_key; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user
    ADD CONSTRAINT auth_user_username_key UNIQUE (username);


--
-- Name: clientes_cadastro clientes_cadastro_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.clientes_cadastro
    ADD CONSTRAINT clientes_cadastro_pkey PRIMARY KEY (codigo_cliente_omie);


--
-- Name: etiquetas_impressas etiquetas_impressas_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.etiquetas_impressas
    ADD CONSTRAINT etiquetas_impressas_pkey PRIMARY KEY (id);


--
-- Name: nav_node nav_node_key_key; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.nav_node
    ADD CONSTRAINT nav_node_key_key UNIQUE (key);


--
-- Name: nav_node nav_node_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.nav_node
    ADD CONSTRAINT nav_node_pkey PRIMARY KEY (id);


--
-- Name: ns_pool ns_pool_codigo_ns_key; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.ns_pool
    ADD CONSTRAINT ns_pool_codigo_ns_key UNIQUE (codigo, ns);


--
-- Name: ns_pool ns_pool_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.ns_pool
    ADD CONSTRAINT ns_pool_pkey PRIMARY KEY (id);


--
-- Name: omie_estoque_posicao omie_estoque_posicao_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_estoque_posicao
    ADD CONSTRAINT omie_estoque_posicao_pkey PRIMARY KEY (id);


--
-- Name: omie_estrutura_item omie_estrutura_item_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_estrutura_item
    ADD CONSTRAINT omie_estrutura_item_pkey PRIMARY KEY (id);


--
-- Name: omie_estrutura omie_estrutura_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_estrutura
    ADD CONSTRAINT omie_estrutura_pkey PRIMARY KEY (id);


--
-- Name: omie_estrutura_raw omie_estrutura_raw_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_estrutura_raw
    ADD CONSTRAINT omie_estrutura_raw_pkey PRIMARY KEY (id);


--
-- Name: omie_locais_estoque omie_locais_estoque_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_locais_estoque
    ADD CONSTRAINT omie_locais_estoque_pkey PRIMARY KEY (local_codigo);


--
-- Name: omie_malha_cab omie_malha_cab_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_malha_cab
    ADD CONSTRAINT omie_malha_cab_pkey PRIMARY KEY (produto_id);


--
-- Name: omie_malha_item omie_malha_item_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_malha_item
    ADD CONSTRAINT omie_malha_item_pkey PRIMARY KEY (id);


--
-- Name: omie_operacao omie_operacao_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_operacao
    ADD CONSTRAINT omie_operacao_pkey PRIMARY KEY (operacao);


--
-- Name: omie_webhook_events omie_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_webhook_events
    ADD CONSTRAINT omie_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: op_codigos_log op_codigos_log_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_codigos_log
    ADD CONSTRAINT op_codigos_log_pkey PRIMARY KEY (id);


--
-- Name: op_etapa_kanban_map op_etapa_kanban_map_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_etapa_kanban_map
    ADD CONSTRAINT op_etapa_kanban_map_pkey PRIMARY KEY (c_etapa);


--
-- Name: op_event op_event_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_event
    ADD CONSTRAINT op_event_pkey PRIMARY KEY (id);


--
-- Name: op_info op_info_c_num_op_key; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_info
    ADD CONSTRAINT op_info_c_num_op_key UNIQUE (c_num_op);


--
-- Name: op_info op_info_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_info
    ADD CONSTRAINT op_info_pkey PRIMARY KEY (n_cod_op);


--
-- Name: op_movimentos op_movimentos_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_movimentos
    ADD CONSTRAINT op_movimentos_pkey PRIMARY KEY (id);


--
-- Name: op_ordens op_ordens_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_ordens
    ADD CONSTRAINT op_ordens_pkey PRIMARY KEY (n_cod_op);


--
-- Name: op_raw op_raw_c_num_op_key; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_raw
    ADD CONSTRAINT op_raw_c_num_op_key UNIQUE (c_num_op);


--
-- Name: op_raw op_raw_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_raw
    ADD CONSTRAINT op_raw_pkey PRIMARY KEY (n_cod_op);


--
-- Name: op_status op_status_op_key; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_status
    ADD CONSTRAINT op_status_op_key UNIQUE (op);


--
-- Name: op_status_overlay op_status_overlay_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_status_overlay
    ADD CONSTRAINT op_status_overlay_pkey PRIMARY KEY (op);


--
-- Name: op_status op_status_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_status
    ADD CONSTRAINT op_status_pkey PRIMARY KEY (id);


--
-- Name: pcp_personalizacao_item pcp_personalizacao_item_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.pcp_personalizacao_item
    ADD CONSTRAINT pcp_personalizacao_item_pkey PRIMARY KEY (id);


--
-- Name: pcp_personalizacao pcp_personalizacao_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.pcp_personalizacao
    ADD CONSTRAINT pcp_personalizacao_pkey PRIMARY KEY (id);


--
-- Name: pedidos_venda_itens pedidos_venda_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.pedidos_venda_itens
    ADD CONSTRAINT pedidos_venda_itens_pkey PRIMARY KEY (codigo_pedido, seq);


--
-- Name: pedidos_venda pedidos_venda_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.pedidos_venda
    ADD CONSTRAINT pedidos_venda_pkey PRIMARY KEY (codigo_pedido);


--
-- Name: produtos produtos_codigo_key; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_codigo_key UNIQUE (codigo);


--
-- Name: produtos produtos_codigo_prod_uk; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_codigo_prod_uk UNIQUE (codigo_prod);


--
-- Name: produtos_omie_imagens produtos_omie_imagens_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.produtos_omie_imagens
    ADD CONSTRAINT produtos_omie_imagens_pkey PRIMARY KEY (codigo_produto, pos);


--
-- Name: produtos_omie produtos_omie_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.produtos_omie
    ADD CONSTRAINT produtos_omie_pkey PRIMARY KEY (codigo_produto);


--
-- Name: produtos produtos_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_pkey PRIMARY KEY (id);


--
-- Name: omie_malha_item uq_malha_item; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_malha_item
    ADD CONSTRAINT uq_malha_item UNIQUE (produto_id, item_prod_id, item_codigo);


--
-- Name: omie_estoque_posicao uq_posicao_uni; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_estoque_posicao
    ADD CONSTRAINT uq_posicao_uni UNIQUE (data_posicao, local_codigo, omie_prod_id_key, codigo_key);


--
-- Name: user_message user_message_pkey; Type: CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.user_message
    ADD CONSTRAINT user_message_pkey PRIMARY KEY (id);


--
-- Name: auth_user_operacao_operacao_idx; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX auth_user_operacao_operacao_idx ON public.auth_user_operacao USING btree (operacao_id);


--
-- Name: idx_auo_user; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_auo_user ON public.auth_user_operacao USING btree (user_id);


--
-- Name: idx_clientes_cadastro_cnpj; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_clientes_cadastro_cnpj ON public.clientes_cadastro USING btree (cnpj_cpf);


--
-- Name: idx_clientes_cadastro_razao; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_clientes_cadastro_razao ON public.clientes_cadastro USING gin (to_tsvector('simple'::regconfig, ((COALESCE(razao_social, ''::text) || ' '::text) || COALESCE(nome_fantasia, ''::text))));


--
-- Name: idx_etiquetas_codigo_produto; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_etiquetas_codigo_produto ON public.etiquetas_impressas USING btree (codigo_produto);


--
-- Name: idx_etiquetas_data_criacao; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_etiquetas_data_criacao ON public.etiquetas_impressas USING btree (data_criacao);


--
-- Name: idx_etiquetas_impressa; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_etiquetas_impressa ON public.etiquetas_impressas USING btree (impressa);


--
-- Name: idx_etiquetas_numero_op; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_etiquetas_numero_op ON public.etiquetas_impressas USING btree (numero_op);


--
-- Name: idx_event_op_momento; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_event_op_momento ON public.op_event USING btree (op, momento DESC);


--
-- Name: idx_event_tipo_momento; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_event_tipo_momento ON public.op_event USING btree (tipo, momento DESC);


--
-- Name: idx_ns_pool_codigo_avail; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_ns_pool_codigo_avail ON public.ns_pool USING btree (codigo, ns) WHERE (consumed = false);


--
-- Name: idx_op_event_op_momento; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_op_event_op_momento ON public.op_event USING btree (op, momento DESC);


--
-- Name: idx_op_info_etapa; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_op_info_etapa ON public.op_info USING btree (c_etapa);


--
-- Name: idx_op_info_produto; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_op_info_produto ON public.op_info USING btree (produto_codigo);


--
-- Name: idx_op_status_produto; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_op_status_produto ON public.op_status USING btree (produto_codigo);


--
-- Name: idx_op_status_status; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_op_status_status ON public.op_status USING btree (status);


--
-- Name: idx_op_status_status_op; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_op_status_status_op ON public.op_status USING btree (status, op);


--
-- Name: idx_pcp_personalizacao_codigo_pai; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_pcp_personalizacao_codigo_pai ON public.pcp_personalizacao USING btree (codigo_pai);


--
-- Name: idx_pcp_personalizacao_item_personalizacao_id; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_pcp_personalizacao_item_personalizacao_id ON public.pcp_personalizacao_item USING btree (personalizacao_id);


--
-- Name: idx_pedidos_venda_cliente; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_pedidos_venda_cliente ON public.pedidos_venda USING btree (codigo_cliente);


--
-- Name: idx_pedidos_venda_etapa; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_pedidos_venda_etapa ON public.pedidos_venda USING btree (etapa);


--
-- Name: idx_pedidos_venda_itens_produto; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_pedidos_venda_itens_produto ON public.pedidos_venda_itens USING btree (codigo_produto);


--
-- Name: idx_pedidos_venda_numero; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_pedidos_venda_numero ON public.pedidos_venda USING btree (numero_pedido);


--
-- Name: idx_produtos_codigo; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_produtos_codigo ON public.produtos USING btree (codigo);


--
-- Name: idx_produtos_desc_trgm; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_produtos_desc_trgm ON public.produtos USING gin (descricao public.gin_trgm_ops);


--
-- Name: idx_produtos_omie_codigo; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_produtos_omie_codigo ON public.produtos_omie USING btree (codigo);


--
-- Name: idx_produtos_omie_codigo_integracao; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_produtos_omie_codigo_integracao ON public.produtos_omie USING btree (codigo_produto_integracao);


--
-- Name: idx_produtos_omie_descricao_gin; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_produtos_omie_descricao_gin ON public.produtos_omie USING gin (descricao public.gin_trgm_ops);


--
-- Name: idx_produtos_omie_ncm_tipo; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_produtos_omie_ncm_tipo ON public.produtos_omie USING btree (ncm, tipoitem);


--
-- Name: idx_produtos_omie_raw_gin; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_produtos_omie_raw_gin ON public.produtos_omie USING gin (raw);


--
-- Name: idx_pvi_pedido; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_pvi_pedido ON public.pedidos_venda_itens USING btree (codigo_pedido);


--
-- Name: idx_user_message_user_id; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX idx_user_message_user_id ON public.user_message USING btree (user_id);


--
-- Name: ix_malha_cab_codigo; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_malha_cab_codigo ON public.omie_malha_cab USING btree (produto_codigo);


--
-- Name: ix_malha_cab_desc_trgm; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_malha_cab_desc_trgm ON public.omie_malha_cab USING gin (produto_descricao public.gin_trgm_ops);


--
-- Name: ix_malha_cab_produto_id; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_malha_cab_produto_id ON public.omie_malha_cab USING btree (produto_id);


--
-- Name: ix_malha_item_codigo; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_malha_item_codigo ON public.omie_malha_item USING btree (item_codigo);


--
-- Name: ix_malha_item_desc_trgm; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_malha_item_desc_trgm ON public.omie_malha_item USING gin (item_descricao public.gin_trgm_ops);


--
-- Name: ix_malha_item_prodid; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_malha_item_prodid ON public.omie_malha_item USING btree (item_prod_id);


--
-- Name: ix_malha_item_produto; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_malha_item_produto ON public.omie_malha_item USING btree (produto_id);


--
-- Name: ix_omie_webhook_events_ts; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_omie_webhook_events_ts ON public.omie_webhook_events USING btree (received_at);


--
-- Name: ix_omie_webhook_events_type; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_omie_webhook_events_type ON public.omie_webhook_events USING btree (event_type);


--
-- Name: ix_pos_codigo; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_pos_codigo ON public.omie_estoque_posicao USING btree (codigo);


--
-- Name: ix_pos_codint; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_pos_codint ON public.omie_estoque_posicao USING btree (cod_int);


--
-- Name: ix_pos_desc_trgm; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_pos_desc_trgm ON public.omie_estoque_posicao USING gin (descricao public.gin_trgm_ops);


--
-- Name: ix_pos_local; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_pos_local ON public.omie_estoque_posicao USING btree (local_codigo);


--
-- Name: ix_pos_prodid; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX ix_pos_prodid ON public.omie_estoque_posicao USING btree (omie_prod_id);


--
-- Name: omie_estr_item_versao_parent_ix; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX omie_estr_item_versao_parent_ix ON public.omie_estrutura_item_versao USING btree (parent_id);


--
-- Name: omie_estr_item_versao_parent_v_ix; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX omie_estr_item_versao_parent_v_ix ON public.omie_estrutura_item_versao USING btree (parent_id, versao);


--
-- Name: omie_estr_item_versao_versao_ix; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX omie_estr_item_versao_versao_ix ON public.omie_estrutura_item_versao USING btree (versao);


--
-- Name: omie_estrutura_item_comp_cod_idx; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX omie_estrutura_item_comp_cod_idx ON public.omie_estrutura_item USING btree (cod_prod_malha);


--
-- Name: omie_estrutura_item_parent_idx; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX omie_estrutura_item_parent_idx ON public.omie_estrutura_item USING btree (parent_id);


--
-- Name: omie_estrutura_item_uniq; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE UNIQUE INDEX omie_estrutura_item_uniq ON public.omie_estrutura_item USING btree (parent_id, COALESCE(cod_prod_malha, ''::text), COALESCE(int_prod_malha, ''::text), COALESCE((id_prod_malha)::text, ''::text), COALESCE(operacao, ''::text));


--
-- Name: omie_estrutura_raw_gin; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX omie_estrutura_raw_gin ON public.omie_estrutura_raw USING gin (payload);


--
-- Name: omie_estrutura_raw_key_idx; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX omie_estrutura_raw_key_idx ON public.omie_estrutura_raw USING btree (key_ref);


--
-- Name: omie_estrutura_uq_cod; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE UNIQUE INDEX omie_estrutura_uq_cod ON public.omie_estrutura USING btree (cod_produto) WHERE (cod_produto IS NOT NULL);


--
-- Name: omie_estrutura_uq_id; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE UNIQUE INDEX omie_estrutura_uq_id ON public.omie_estrutura USING btree (id_produto) WHERE (id_produto IS NOT NULL);


--
-- Name: omie_estrutura_uq_int; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE UNIQUE INDEX omie_estrutura_uq_int ON public.omie_estrutura USING btree (int_produto) WHERE (int_produto IS NOT NULL);


--
-- Name: op_ordens_c_cod_int_op_idx; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE UNIQUE INDEX op_ordens_c_cod_int_op_idx ON public.op_ordens USING btree (c_cod_int_op) WHERE (c_cod_int_op IS NOT NULL);


--
-- Name: op_ordens_c_etapa_idx; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX op_ordens_c_etapa_idx ON public.op_ordens USING btree (c_etapa);


--
-- Name: op_ordens_codigo_local_estoque_idx; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX op_ordens_codigo_local_estoque_idx ON public.op_ordens USING btree (codigo_local_estoque);


--
-- Name: op_ordens_d_dt_previsao_idx; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE INDEX op_ordens_d_dt_previsao_idx ON public.op_ordens USING btree (d_dt_previsao);


--
-- Name: uniq_event_triplet; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE UNIQUE INDEX uniq_event_triplet ON public.op_event USING btree (op, momento, tipo);


--
-- Name: ux_auth_user_email; Type: INDEX; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE UNIQUE INDEX ux_auth_user_email ON public.auth_user USING btree (lower(email)) WHERE (email IS NOT NULL);


--
-- Name: auth_user auth__set_updated_at; Type: TRIGGER; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TRIGGER auth__set_updated_at BEFORE UPDATE ON public.auth_user FOR EACH ROW EXECUTE FUNCTION public.auth__set_updated_at();


--
-- Name: auth_user_profile auth_profile__set_updated_at; Type: TRIGGER; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TRIGGER auth_profile__set_updated_at BEFORE UPDATE ON public.auth_user_profile FOR EACH ROW EXECUTE FUNCTION public.auth_profile__set_updated_at();


--
-- Name: produtos_omie set_updated_at_produtos_omie; Type: TRIGGER; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TRIGGER set_updated_at_produtos_omie BEFORE UPDATE ON public.produtos_omie FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at();


--
-- Name: omie_malha_item trg_malha_item_sanitize; Type: TRIGGER; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TRIGGER trg_malha_item_sanitize BEFORE INSERT OR UPDATE ON public.omie_malha_item FOR EACH ROW EXECUTE FUNCTION public.omie_malha_item_sanitize();


--
-- Name: omie_malha_item trg_malha_item_updated; Type: TRIGGER; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TRIGGER trg_malha_item_updated BEFORE UPDATE ON public.omie_malha_item FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: omie_estoque_posicao trg_omie_estoque_posicao_sanitize; Type: TRIGGER; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TRIGGER trg_omie_estoque_posicao_sanitize BEFORE INSERT OR UPDATE ON public.omie_estoque_posicao FOR EACH ROW EXECUTE FUNCTION public.omie_estoque_posicao_sanitize();


--
-- Name: produtos trg_produtos_updated_at; Type: TRIGGER; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TRIGGER trg_produtos_updated_at BEFORE UPDATE ON public.produtos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_produtos();


--
-- Name: omie_estrutura_item trg_sync_omie_operacao_ins; Type: TRIGGER; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TRIGGER trg_sync_omie_operacao_ins AFTER INSERT ON public.omie_estrutura_item FOR EACH ROW EXECUTE FUNCTION public._sync_omie_operacao();


--
-- Name: omie_estrutura_item trg_sync_omie_operacao_upd; Type: TRIGGER; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TRIGGER trg_sync_omie_operacao_upd AFTER UPDATE OF operacao ON public.omie_estrutura_item FOR EACH ROW EXECUTE FUNCTION public._sync_omie_operacao();


--
-- Name: omie_estrutura trg_upd_omie_estrutura; Type: TRIGGER; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TRIGGER trg_upd_omie_estrutura BEFORE UPDATE ON public.omie_estrutura FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: omie_estrutura_item trg_upd_omie_estrutura_item; Type: TRIGGER; Schema: public; Owner: intranet_db_yd0w_user
--

CREATE TRIGGER trg_upd_omie_estrutura_item BEFORE UPDATE ON public.omie_estrutura_item FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: auth_login_event auth_login_event_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_login_event
    ADD CONSTRAINT auth_login_event_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_user(id) ON DELETE SET NULL;


--
-- Name: auth_password_reset auth_password_reset_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_password_reset
    ADD CONSTRAINT auth_password_reset_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_user(id) ON DELETE CASCADE;


--
-- Name: auth_reset_request auth_reset_request_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_reset_request
    ADD CONSTRAINT auth_reset_request_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.auth_user(id) ON DELETE SET NULL;


--
-- Name: auth_role_permission auth_role_permission_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_role_permission
    ADD CONSTRAINT auth_role_permission_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nav_node(id) ON DELETE CASCADE;


--
-- Name: auth_user_operacao auth_user_operacao_operacao_fk; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user_operacao
    ADD CONSTRAINT auth_user_operacao_operacao_fk FOREIGN KEY (operacao_id) REFERENCES public.omie_operacao(operacao) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: auth_user_operacao auth_user_operacao_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user_operacao
    ADD CONSTRAINT auth_user_operacao_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_user(id) ON DELETE CASCADE;


--
-- Name: auth_user_permission auth_user_permission_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user_permission
    ADD CONSTRAINT auth_user_permission_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nav_node(id) ON DELETE CASCADE;


--
-- Name: auth_user_permission auth_user_permission_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user_permission
    ADD CONSTRAINT auth_user_permission_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_user(id) ON DELETE CASCADE;


--
-- Name: auth_user_profile auth_user_profile_funcao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user_profile
    ADD CONSTRAINT auth_user_profile_funcao_id_fkey FOREIGN KEY (funcao_id) REFERENCES public.auth_funcao(id);


--
-- Name: auth_user_profile auth_user_profile_sector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user_profile
    ADD CONSTRAINT auth_user_profile_sector_id_fkey FOREIGN KEY (sector_id) REFERENCES public.auth_sector(id);


--
-- Name: auth_user_profile auth_user_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.auth_user_profile
    ADD CONSTRAINT auth_user_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_user(id) ON DELETE CASCADE;


--
-- Name: nav_node nav_node_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.nav_node
    ADD CONSTRAINT nav_node_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.nav_node(id) ON DELETE CASCADE;


--
-- Name: omie_estoque_posicao omie_estoque_posicao_local_codigo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_estoque_posicao
    ADD CONSTRAINT omie_estoque_posicao_local_codigo_fkey FOREIGN KEY (local_codigo) REFERENCES public.omie_locais_estoque(local_codigo) ON UPDATE CASCADE;


--
-- Name: omie_estrutura_item omie_estrutura_item_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_estrutura_item
    ADD CONSTRAINT omie_estrutura_item_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.omie_estrutura(id) ON DELETE CASCADE;


--
-- Name: omie_malha_item omie_malha_item_produto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.omie_malha_item
    ADD CONSTRAINT omie_malha_item_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.omie_malha_cab(produto_id) ON DELETE CASCADE;


--
-- Name: op_info op_info_n_cod_op_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_info
    ADD CONSTRAINT op_info_n_cod_op_fkey FOREIGN KEY (n_cod_op) REFERENCES public.op_raw(n_cod_op) ON DELETE CASCADE;


--
-- Name: op_movimentos op_movimentos_op_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_movimentos
    ADD CONSTRAINT op_movimentos_op_fkey FOREIGN KEY (op) REFERENCES public.op_status(op) ON DELETE CASCADE;


--
-- Name: op_status op_status_produto_codigo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.op_status
    ADD CONSTRAINT op_status_produto_codigo_fkey FOREIGN KEY (produto_codigo) REFERENCES public.produtos(codigo) ON DELETE CASCADE;


--
-- Name: pcp_personalizacao_item pcp_personalizacao_item_personalizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.pcp_personalizacao_item
    ADD CONSTRAINT pcp_personalizacao_item_personalizacao_id_fkey FOREIGN KEY (personalizacao_id) REFERENCES public.pcp_personalizacao(id) ON DELETE CASCADE;


--
-- Name: produtos_omie_imagens produtos_omie_imagens_codigo_produto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.produtos_omie_imagens
    ADD CONSTRAINT produtos_omie_imagens_codigo_produto_fkey FOREIGN KEY (codigo_produto) REFERENCES public.produtos_omie(codigo_produto) ON DELETE CASCADE;


--
-- Name: user_message user_message_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: intranet_db_yd0w_user
--

ALTER TABLE ONLY public.user_message
    ADD CONSTRAINT user_message_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_user(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict w1RVkMBuNYnQ9WxyNnk8FwNeeV9PnW2zXMBzaOR3lv9O0jTE2nVGRnvdAkWRnEK

