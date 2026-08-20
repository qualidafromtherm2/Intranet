'use strict';

/**
 * Garante upsert de pedidos de venda alinhado à Omie:
 * - grava faturado / dinc / dalt / dfat a partir de infoCadastro
 * - se faturado=S e etapa ainda não for 70/80, força etapa 70
 *   (Omie às vezes demora a mudar a etapa após faturar; o cron
 *   antigo não re-sincroniza pedidos fora da janela de 7 dias)
 */
async function ensurePedidoVendaUpsert(poolOrClient) {
  if (!poolOrClient || typeof poolOrClient.query !== 'function') {
    throw new Error('ensurePedidoVendaUpsert: pool/client inválido');
  }

  await poolOrClient.query(`
CREATE OR REPLACE FUNCTION public.pedido_upsert_from_payload(p jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  cab jsonb := p->'cabecalho';
  total jsonb := p->'total_pedido';
  info jsonb := p->'informacoes_adicionais';
  obs jsonb := p->'observacoes';
  cad jsonb := p->'infoCadastro';
  v_codigo_pedido bigint;
  v_data_prev date;
  v_etapa text;
  v_faturado text;
BEGIN
  IF cab IS NULL THEN
    RETURN 0;
  END IF;

  v_codigo_pedido := NULLIF(cab->>'codigo_pedido','')::bigint;
  IF v_codigo_pedido IS NULL THEN
    RETURN 0;
  END IF;

  v_data_prev := public._util_to_date(cab->>'data_previsao');
  v_faturado := NULLIF(TRIM(COALESCE(cad->>'faturado', '')), '');
  v_etapa := NULLIF(TRIM(COALESCE(cab->>'etapa', '')), '');
  IF UPPER(COALESCE(v_faturado, '')) IN ('S', '1', 'SIM', 'TRUE')
     AND COALESCE(v_etapa, '') NOT IN ('70', '80') THEN
    v_etapa := '70';
  END IF;

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
    dinc,
    dalt,
    dfat,
    faturado,
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
    v_etapa,
    v_data_prev,
    NULLIF(cab->>'quantidade_itens','')::integer,
    NULLIF(cab->>'qtde_parcelas','')::integer,
    cab->>'codigo_parcela',
    cab->>'origem_pedido',
    cab->>'bloqueado',
    public._util_to_date(cad->>'dInc'),
    public._util_to_date(cad->>'dAlt'),
    public._util_to_date(cad->>'dFat'),
    v_faturado,
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
    dinc = COALESCE(EXCLUDED.dinc, pedidos_venda.dinc),
    dalt = COALESCE(EXCLUDED.dalt, pedidos_venda.dalt),
    dfat = COALESCE(EXCLUDED.dfat, pedidos_venda.dfat),
    faturado = COALESCE(EXCLUDED.faturado, pedidos_venda.faturado),
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
  `);
}

/**
 * Corrige pedidos já gravados: faturado=S no payload mas etapa antiga (ex.: 60).
 */
async function reconciliarPedidosFaturadosEtapa(poolOrClient) {
  if (!poolOrClient || typeof poolOrClient.query !== 'function') {
    throw new Error('reconciliarPedidosFaturadosEtapa: pool/client inválido');
  }
  const { rowCount } = await poolOrClient.query(`
    UPDATE vendas.pedidos_venda p
       SET faturado = COALESCE(
             NULLIF(TRIM(p.faturado), ''),
             NULLIF(TRIM(p.raw_payload->'infoCadastro'->>'faturado'), '')
           ),
           dfat = COALESCE(
             p.dfat,
             public._util_to_date(p.raw_payload->'infoCadastro'->>'dFat')
           ),
           etapa = '70',
           updated_at = NOW()
     WHERE UPPER(TRIM(COALESCE(
             NULLIF(TRIM(p.faturado), ''),
             p.raw_payload->'infoCadastro'->>'faturado',
             ''
           ))) IN ('S', '1', 'SIM', 'TRUE')
       AND TRIM(COALESCE(p.etapa::text, '')) NOT IN ('70', '80')
  `);
  return rowCount || 0;
}

module.exports = {
  ensurePedidoVendaUpsert,
  reconciliarPedidosFaturadosEtapa,
};
