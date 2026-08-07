const { dbQuery: defaultDbQuery } = require('../src/db');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.server');

function dataAtualBr() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function consultarPosicaoEstoqueOmie({
  codigoProduto,
  codigo,
  localCodigo,
  fetchImpl = global.fetch,
  appKey = OMIE_APP_KEY,
  appSecret = OMIE_APP_SECRET
}) {
  if (!appKey || !appSecret) throw new Error('Credenciais da Omie ausentes.');
  if (typeof fetchImpl !== 'function') throw new Error('Cliente HTTP indisponível.');

  const payload = {
    call: 'PosicaoEstoque',
    app_key: appKey,
    app_secret: appSecret,
    param: [{
      codigo_local_estoque: Number(localCodigo),
      id_prod: Number(codigoProduto),
      cod_int: String(codigo || '').trim(),
      data: dataAtualBr()
    }]
  };

  const response = await fetchImpl('https://app.omie.com.br/api/v1/estoque/consulta/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const texto = await response.text();
  let data;
  try { data = texto ? JSON.parse(texto) : {}; }
  catch (_) { throw new Error(`Resposta inválida da Omie (HTTP ${response.status}).`); }

  if (!response.ok || data?.faultstring || String(data?.codigo_status || '0') !== '0') {
    throw new Error(data?.faultstring || data?.descricao_status || `Falha ao consultar estoque na Omie (HTTP ${response.status}).`);
  }

  const saldo = Number(data.saldo);
  const fisico = Number(data.fisico);
  if (!Number.isFinite(saldo) || !Number.isFinite(fisico)) {
    throw new Error('A Omie não retornou uma posição de estoque válida.');
  }

  return {
    saldo,
    fisico,
    reservado: Number(data.reservado) || 0,
    pendente: Number(data.pendente) || 0,
    estoque_minimo: Number(data.estoque_minimo) || 0,
    cmc: Number(data.cmc) || 0,
    local_codigo: String(data.codigo_local_estoque || localCodigo)
  };
}

async function gravarPosicaoEstoqueLocal({
  posicao,
  codigoProduto,
  codigo,
  query = defaultDbQuery,
  origem = 'omie_reconcile'
}) {
  await query(
    `INSERT INTO logistica.estoque_atual (
       local_codigo, local_nome, omie_prod_id, codigo, descricao,
       saldo, fisico, reservado, pendente, estoque_minimo, cmc,
       updated_at, origem
     )
     VALUES (
       $1,
       (SELECT nome FROM omie_locais_estoque WHERE local_codigo::text = $1 LIMIT 1),
       $2, $3,
       (SELECT descricao FROM public.produtos_omie WHERE codigo_produto = $2 LIMIT 1),
       $4, $5, $6, $7, $8, $9, NOW(), $10
     )
     ON CONFLICT ON CONSTRAINT uq_estoque_atual_prod_local
     DO UPDATE SET
       omie_prod_id = EXCLUDED.omie_prod_id,
       saldo = EXCLUDED.saldo,
       fisico = EXCLUDED.fisico,
       reservado = EXCLUDED.reservado,
       pendente = EXCLUDED.pendente,
       estoque_minimo = EXCLUDED.estoque_minimo,
       cmc = CASE WHEN EXCLUDED.cmc > 0 THEN EXCLUDED.cmc ELSE logistica.estoque_atual.cmc END,
       updated_at = NOW(),
       origem = EXCLUDED.origem`,
    [
      posicao.local_codigo,
      Number(codigoProduto),
      String(codigo || '').trim(),
      posicao.saldo,
      posicao.fisico,
      posicao.reservado,
      posicao.pendente,
      posicao.estoque_minimo,
      posicao.cmc,
      origem
    ]
  );
}

async function reconciliarEstoqueAtualOmie({
  codigoProduto,
  codigo,
  localCodigo,
  fetchImpl = global.fetch,
  query = defaultDbQuery,
  appKey = OMIE_APP_KEY,
  appSecret = OMIE_APP_SECRET,
  saldoAntes = null,
  deltaEsperado = null,
  forcarGravacao = false
}) {
  const posicao = await consultarPosicaoEstoqueOmie({
    codigoProduto, codigo, localCodigo, fetchImpl, appKey, appSecret
  });

  const delta = Number(deltaEsperado);
  const exigeConfirmacao = !forcarGravacao
    && Number.isFinite(delta)
    && delta !== 0
    && saldoAntes !== null
    && Number.isFinite(Number(saldoAntes));

  if (exigeConfirmacao && !saldoMudouNaDirecaoEsperada(saldoAntes, posicao.saldo, delta)) {
    return { ...posicao, gravado: false, pendente: true };
  }

  await gravarPosicaoEstoqueLocal({
    posicao,
    codigoProduto,
    codigo,
    query,
    origem: 'omie_reconcile'
  });

  return { ...posicao, gravado: true, pendente: false };
}

function saldoMudouNaDirecaoEsperada(saldoAntes, saldoAtual, deltaEsperado, tolerancia = 0.0001) {
  const antes = Number(saldoAntes);
  const atual = Number(saldoAtual);
  const delta = Number(deltaEsperado);
  if (![antes, atual, delta].every(Number.isFinite) || delta === 0) return false;

  const limite = antes + delta;
  return delta > 0
    ? atual >= limite - tolerancia
    : atual <= limite + tolerancia;
}

async function buscarSaldoLocal({ codigo, localCodigo, query = defaultDbQuery }) {
  const { rows } = await query(
    `SELECT saldo
       FROM logistica.estoque_atual
      WHERE codigo = $1
        AND local_codigo = $2
      LIMIT 1`,
    [String(codigo || '').trim(), String(localCodigo || '').trim()]
  );
  if (!rows?.length) return 0;
  const saldo = Number(rows?.[0]?.saldo);
  return Number.isFinite(saldo) ? saldo : null;
}

/**
 * Aplica o delta da movimentação no SQL local assim que a Omie aceita o ajuste.
 * Evita a tela ficar com saldo antigo enquanto PosicaoEstoque ainda atrasa.
 */
async function aplicarDeltaEstoqueLocal({
  codigoProduto,
  codigo,
  localCodigo,
  deltaEsperado,
  query = defaultDbQuery
}) {
  const delta = Number(deltaEsperado);
  const local = String(localCodigo || '').trim();
  const cod = String(codigo || '').trim();
  if (!local || !cod || !Number.isFinite(delta) || delta === 0) return null;

  const { rows } = await query(
    `INSERT INTO logistica.estoque_atual (
       local_codigo, local_nome, omie_prod_id, codigo, descricao,
       saldo, fisico, reservado, pendente, estoque_minimo, cmc,
       updated_at, origem
     )
     VALUES (
       $1,
       (SELECT nome FROM omie_locais_estoque WHERE local_codigo::text = $1 LIMIT 1),
       $2, $3,
       (SELECT descricao FROM public.produtos_omie WHERE codigo_produto = $2 LIMIT 1),
       $4, $4, 0, 0, 0, 0,
       NOW(), 'movimento_local'
     )
     ON CONFLICT ON CONSTRAINT uq_estoque_atual_prod_local
     DO UPDATE SET
       omie_prod_id = COALESCE(EXCLUDED.omie_prod_id, logistica.estoque_atual.omie_prod_id),
       saldo = COALESCE(logistica.estoque_atual.saldo, 0) + $4,
       fisico = COALESCE(logistica.estoque_atual.fisico, 0) + $4,
       updated_at = NOW(),
       origem = 'movimento_local'
     RETURNING saldo, fisico, local_codigo`,
    [local, Number(codigoProduto) || null, cod, delta]
  );

  return rows?.[0] || null;
}

function aguardar(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function agendarReconciliacaoEstoqueOmie(dados, delayMs = 3000) {
  void (async () => {
    const query = dados?.query || defaultDbQuery;
    const deltaEsperado = Number(dados?.deltaEsperado);
    const saldoAntes = await buscarSaldoLocal({
      codigo: dados?.codigo,
      localCodigo: dados?.localCodigo,
      query
    }).catch(() => null);

    if (Number.isFinite(deltaEsperado) && deltaEsperado !== 0) {
      await aplicarDeltaEstoqueLocal({
        codigoProduto: dados?.codigoProduto,
        codigo: dados?.codigo,
        localCodigo: dados?.localCodigo,
        deltaEsperado,
        query
      }).catch((err) => {
        console.error('[estoque][reconcile] Falha ao aplicar delta local:', err?.message || err);
      });
    }

    // Tentativas curtas + uma tardia: Omie às vezes demora >20s para refletir PosicaoEstoque.
    const intervalos = [Math.max(0, Number(delayMs) || 0), 5000, 10000, 20000, 40000];
    let ultimaPosicao = null;
    let confirmado = false;

    for (const espera of intervalos) {
      await aguardar(espera);
      ultimaPosicao = await reconciliarEstoqueAtualOmie({
        ...dados,
        query,
        saldoAntes,
        deltaEsperado,
        forcarGravacao: false
      });
      if (ultimaPosicao?.gravado) {
        confirmado = true;
        break;
      }
    }

    if (!confirmado) {
      console.warn('[estoque][reconcile] Omie ainda não refletiu o movimento esperado; mantendo saldo local otimista.', {
        codigo: dados?.codigo,
        localCodigo: dados?.localCodigo,
        saldoAntes,
        saldoOmie: ultimaPosicao?.saldo,
        deltaEsperado
      });
    }
  })().catch((err) => {
    console.error('[estoque][reconcile] Falha ao reconciliar posição após ajuste:', err?.message || err);
  });
}

module.exports = {
  consultarPosicaoEstoqueOmie,
  reconciliarEstoqueAtualOmie,
  agendarReconciliacaoEstoqueOmie,
  aplicarDeltaEstoqueLocal,
  saldoMudouNaDirecaoEsperada
};
