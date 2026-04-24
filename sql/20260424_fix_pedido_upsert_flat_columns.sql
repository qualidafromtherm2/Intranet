-- Corrige upsert de pedidos para preencher colunas planas
-- a partir do payload Omie (mantendo também os JSONB brutos).

BEGIN;

CREATE OR REPLACE FUNCTION public.pedido_upsert_from_payload(p jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  cab jsonb := p->'cabecalho';
  total jsonb := p->'total_pedido';
  info jsonb := p->'informacoes_adicionais';
  obs jsonb := p->'observacoes';
  v_codigo_pedido bigint;
  v_data_prev date;
BEGIN
  IF cab IS NULL THEN
    RETURN 0;
  END IF;

  v_codigo_pedido := NULLIF(cab->>'codigo_pedido','')::bigint;
  IF v_codigo_pedido IS NULL THEN
    RETURN 0;
  END IF;

  v_data_prev := public._util_to_date(cab->>'data_previsao');

  INSERT INTO public.pedidos_venda (
    codigo_pedido,
    codigo_pedido_integracao,
    numero_pedido,
    numero_pedido_cliente,
    codigo_cliente,
    codigo_cliente_integracao,
    codigo_empresa,
    codigo_empresa_integracao,
    etapa,
    data_previsao,
    quantidade_itens,
    qtde_parcelas,
    codigo_parcela,
    origem_pedido,
    bloqueado,
    tipo_desconto_pedido,
    perc_desconto_pedido,
    valor_desconto_pedido,
    encerrado,
    enc_motivo,
    enc_data,
    enc_hora,
    enc_user,
    nao_gerar_boleto,
    status,
    consumidor_final,
    enviar_email,
    enviar_pix,
    obs_venda,
    valor_total_pedido,
    valor_mercadorias,
    valor_icms,
    valor_pis,
    valor_cofins,
    cabecalho,
    total_pedido,
    informacoes_adicionais,
    raw_payload,
    updated_at
  )
  VALUES (
    v_codigo_pedido,
    cab->>'codigo_pedido_integracao',
    cab->>'numero_pedido',
    COALESCE(NULLIF(cab->>'numero_pedido_cliente',''), NULLIF(info->>'numero_pedido_cliente','')),
    cab->>'codigo_cliente',
    cab->>'codigo_cliente_integracao',
    cab->>'codigo_empresa',
    cab->>'codigo_empresa_integracao',
    cab->>'etapa',
    v_data_prev,
    NULLIF(cab->>'quantidade_itens','')::integer,
    NULLIF(cab->>'qtde_parcelas','')::integer,
    cab->>'codigo_parcela',
    cab->>'origem_pedido',
    cab->>'bloqueado',
    cab->>'tipo_desconto_pedido',
    public._util_to_numeric(cab->>'perc_desconto_pedido'),
    public._util_to_numeric(cab->>'valor_desconto_pedido'),
    cab->>'encerrado',
    cab->>'enc_motivo',
    cab->>'enc_data',
    cab->>'enc_hora',
    cab->>'enc_user',
    cab->>'nao_gerar_boleto',
    cab->>'status',
    COALESCE(NULLIF(info->>'consumidor_final',''), NULLIF(cab->>'consumidor_final','')),
    COALESCE(NULLIF(info->>'enviar_email',''), NULLIF(cab->>'enviar_email','')),
    COALESCE(NULLIF(info->>'enviar_pix',''), NULLIF(cab->>'enviar_pix','')),
    COALESCE(NULLIF(obs->>'obs_venda',''), NULLIF(info->>'obs_venda','')),
    public._util_to_numeric(total->>'valor_total_pedido'),
    public._util_to_numeric(total->>'valor_mercadorias'),
    public._util_to_numeric(total->>'valor_icms'),
    public._util_to_numeric(total->>'valor_pis'),
    public._util_to_numeric(total->>'valor_cofins'),
    cab,
    total,
    info,
    p,
    now()
  )
  ON CONFLICT (codigo_pedido) DO UPDATE SET
    codigo_pedido_integracao = EXCLUDED.codigo_pedido_integracao,
    numero_pedido = EXCLUDED.numero_pedido,
    numero_pedido_cliente = EXCLUDED.numero_pedido_cliente,
    codigo_cliente = EXCLUDED.codigo_cliente,
    codigo_cliente_integracao = EXCLUDED.codigo_cliente_integracao,
    codigo_empresa = EXCLUDED.codigo_empresa,
    codigo_empresa_integracao = EXCLUDED.codigo_empresa_integracao,
    etapa = EXCLUDED.etapa,
    data_previsao = EXCLUDED.data_previsao,
    quantidade_itens = EXCLUDED.quantidade_itens,
    qtde_parcelas = EXCLUDED.qtde_parcelas,
    codigo_parcela = EXCLUDED.codigo_parcela,
    origem_pedido = EXCLUDED.origem_pedido,
    bloqueado = EXCLUDED.bloqueado,
    tipo_desconto_pedido = EXCLUDED.tipo_desconto_pedido,
    perc_desconto_pedido = EXCLUDED.perc_desconto_pedido,
    valor_desconto_pedido = EXCLUDED.valor_desconto_pedido,
    encerrado = EXCLUDED.encerrado,
    enc_motivo = EXCLUDED.enc_motivo,
    enc_data = EXCLUDED.enc_data,
    enc_hora = EXCLUDED.enc_hora,
    enc_user = EXCLUDED.enc_user,
    nao_gerar_boleto = EXCLUDED.nao_gerar_boleto,
    status = EXCLUDED.status,
    consumidor_final = EXCLUDED.consumidor_final,
    enviar_email = EXCLUDED.enviar_email,
    enviar_pix = EXCLUDED.enviar_pix,
    obs_venda = EXCLUDED.obs_venda,
    valor_total_pedido = EXCLUDED.valor_total_pedido,
    valor_mercadorias = EXCLUDED.valor_mercadorias,
    valor_icms = EXCLUDED.valor_icms,
    valor_pis = EXCLUDED.valor_pis,
    valor_cofins = EXCLUDED.valor_cofins,
    cabecalho = EXCLUDED.cabecalho,
    total_pedido = EXCLUDED.total_pedido,
    informacoes_adicionais = EXCLUDED.informacoes_adicionais,
    raw_payload = EXCLUDED.raw_payload,
    updated_at = now();

  RETURN 1;
END;
$function$;

COMMIT;
