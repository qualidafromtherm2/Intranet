// cron/vipp_enrich_envios.js
//
// Enriquecimento periodico de envios VIPP legados:
//
//  (A) Envios com `identificacao` mas SEM `declaracao_url` valida ->
//      tenta gerar o ZPL da declaracao localmente a partir de `vipp_payload`.
//      Custo zero de API se o payload local for completo (caso novo).
//
//  (B) Envios com `identificacao` mas SEM `vipp_payload` (legado pre-persistencia)
//      -> consulta a API VIPP via _buscarSituacaoPostagem (passa pelo cache SQL
//      e respeita o rate-limit em etiqueta.vipp_rate_limit) para hidratar a
//      situacao no cache e gerar a declaracao a partir dela.
//
// Roda em background, em lotes pequenos, com pausa entre as chamadas para nao
// estourar cota. Se a credencial estiver marcada como bloqueada na tabela
// etiqueta.vipp_rate_limit, o cron pula automaticamente a fase (B).
//
// Configuracao (variaveis de ambiente, todas opcionais):
//   VIPP_ENRICH_INTERVAL_MS   intervalo entre execucoes (default 30 min)
//   VIPP_ENRICH_BATCH_SIZE    quantos registros por execucao (default 10)
//   VIPP_ENRICH_DELAY_MS      pausa entre chamadas a API (default 1500 ms)
//   VIPP_ENRICH_ENABLED       '0' desliga totalmente (default ligado)

'use strict';

const { dbQuery } = require('../src/db');
const vippRouter  = require('../routes/vipp');

const helpers = vippRouter.helpers || {};

const INTERVAL_MS = Number(process.env.VIPP_ENRICH_INTERVAL_MS || 30 * 60 * 1000);
const BATCH_SIZE  = Number(process.env.VIPP_ENRICH_BATCH_SIZE  || 10);
const DELAY_MS    = Number(process.env.VIPP_ENRICH_DELAY_MS    || 1500);
const ENABLED     = String(process.env.VIPP_ENRICH_ENABLED ?? '1') !== '0';

let _executando = false;

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function _temZplDeclaracao(env) {
  const v = String(env?.declaracao_url || '').trimStart();
  return v.startsWith('^XA');
}

// FASE A — gera declaracao local quando ja temos vipp_payload completo
async function _gerarDeclaracoesLocais() {
  const { rows } = await dbQuery(
    `SELECT id, identificacao, id_vipp, conteudo, observacao, declaracao_url,
            numero_sep, chave_dce, vipp_payload
       FROM envios.solicitacoes
      WHERE identificacao IS NOT NULL
        AND identificacao <> ''
        AND vipp_payload IS NOT NULL
        AND (declaracao_url IS NULL
             OR declaracao_url = ''
             OR LEFT(declaracao_url, 3) <> '^XA')
      ORDER BY id DESC
      LIMIT $1`,
    [BATCH_SIZE]
  );

  let okCount = 0;
  for (const env of rows) {
    try {
      const dados = await helpers.resolverDadosDeclaracao(env, '[VIPP-cron] declaracao local');
      if (!helpers.temDadosDeclaracao(dados)) continue;
      await helpers.persistirDeclaracaoCache(env.id, dados, dados.chaveNfe || env.chave_dce || '');
      okCount += 1;
    } catch (err) {
      console.warn(`[VIPP-cron] falha ao gerar declaracao local id=${env.id}:`, err.message);
    }
  }

  if (rows.length) {
    console.log(`[VIPP-cron] fase A: ${okCount}/${rows.length} declaracoes locais geradas`);
  }
  return rows.length;
}

// FASE B — hidrata legados sem vipp_payload via API VIPP (com cache e rate-limit)
async function _hidratarLegadosViaApi() {
  if (typeof helpers.vippEstaBloqueado === 'function') {
    const blq = await helpers.vippEstaBloqueado();
    if (blq) {
      console.log('[VIPP-cron] fase B pulada: credencial em rate-limit ate', blq.bloqueado_ate);
      return 0;
    }
  }

  const { rows } = await dbQuery(
    `SELECT id, identificacao, id_vipp, conteudo, observacao, declaracao_url,
            numero_sep, chave_dce, vipp_payload
       FROM envios.solicitacoes
      WHERE identificacao IS NOT NULL
        AND identificacao <> ''
        AND vipp_payload IS NULL
      ORDER BY id DESC
      LIMIT $1`,
    [BATCH_SIZE]
  );

  let okCount = 0;
  for (const env of rows) {
    try {
      const dadosVipp = await helpers.buscarSituacaoPostagem(env.identificacao);
      if (!helpers.temDadosDeclaracao(dadosVipp)) continue;

      // Monta um vipp_payload minimo a partir do retorno da API,
      // para que proximas execucoes nao precisem mais chamar a API.
      const payload = {
        destinatario: {
          nome:     dadosVipp.destinatario || '',
          cnpjCpf:  dadosVipp.desDoc       || '',
        },
        notaFiscal: {
          numero: dadosVipp.nfeNum  || '',
          serie:  dadosVipp.nfeSerie || '',
        },
        declaracaoConteudo: {
          docDestinatario: dadosVipp.desDoc || '',
          itens:           dadosVipp.itens  || [],
        },
        _origem: 'vipp_api_situacao_postagem',
        _atualizadoEm: new Date().toISOString(),
      };

      await dbQuery(
        `UPDATE envios.solicitacoes
            SET vipp_payload = $1::jsonb,
                chave_dce    = CASE WHEN $2 <> '' AND (chave_dce IS NULL OR chave_dce = '') THEN $2 ELSE chave_dce END
          WHERE id = $3`,
        [JSON.stringify(payload), dadosVipp.chaveNfe || '', env.id]
      );

      // Aproveita para gerar/atualizar a declaracao_url enquanto temos os dados.
      if (!_temZplDeclaracao(env)) {
        await helpers.persistirDeclaracaoCache(env.id, dadosVipp, dadosVipp.chaveNfe || env.chave_dce || '');
      }

      okCount += 1;
    } catch (err) {
      const msg = String(err?.message || err);
      // Para o batch se cair em rate-limit no meio (o _buscarSituacaoPostagem
      // ja gravou a flag em etiqueta.vipp_rate_limit).
      if (/bloqueada\s+ate/i.test(msg) || /limite\s+gratuito/i.test(msg) || /di[áa]rio\s+atingido/i.test(msg)) {
        console.warn(`[VIPP-cron] fase B interrompida (rate-limit detectado em id=${env.id}):`, msg);
        break;
      }
      console.warn(`[VIPP-cron] falha ao hidratar id=${env.id}:`, msg);
    }

    if (DELAY_MS > 0) await _sleep(DELAY_MS);
  }

  if (rows.length) {
    console.log(`[VIPP-cron] fase B: ${okCount}/${rows.length} legados hidratados via API`);
  }
  return rows.length;
}

async function executarCicloVippEnrich() {
  if (_executando) {
    console.log('[VIPP-cron] ciclo anterior ainda rodando, pulando.');
    return;
  }
  _executando = true;
  try {
    await _gerarDeclaracoesLocais();
    await _hidratarLegadosViaApi();
  } catch (err) {
    console.error('[VIPP-cron] erro no ciclo:', err.message);
  } finally {
    _executando = false;
  }
}

function iniciarCronVippEnrich() {
  if (!ENABLED) {
    console.log('[VIPP-cron] desligado por VIPP_ENRICH_ENABLED=0');
    return;
  }
  if (!helpers.resolverDadosDeclaracao || !helpers.buscarSituacaoPostagem) {
    console.warn('[VIPP-cron] helpers de routes/vipp.js indisponiveis; cron NAO sera iniciado.');
    return;
  }
  console.log(`[VIPP-cron] iniciado — intervalo ${Math.round(INTERVAL_MS / 60000)} min, lote ${BATCH_SIZE}.`);
  // Roda uma vez em 30s para nao bloquear o boot.
  setTimeout(() => { executarCicloVippEnrich().catch(() => {}); }, 30 * 1000);
  setInterval(() => { executarCicloVippEnrich().catch(() => {}); }, INTERVAL_MS);
}

module.exports = { iniciarCronVippEnrich, executarCicloVippEnrich };
