'use strict';

/**
 * Movimentação de estoque EPI no local ##RH (RECURSOS HUMANOS).
 * ENT/SAI via IncluirAjusteEstoque Omie + delta local + reconciliação.
 */

const { anexarHoraObs } = require('./anexarHoraObs');
const { agendarReconciliacaoEstoqueOmie } = require('./reconciliarEstoqueOmie');

const EPI_RH_LOCAL_CODIGO = '10893459151';
const EPI_RH_LOCAL_NOME = '##RH — RECURSOS HUMANOS';

const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizaNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function formatarDataBR(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function isErroOmieRetryable({ httpStatus, texto }) {
  const t = String(texto || '').toLowerCase();
  if (httpStatus === 429 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504) return true;
  return (
    t.includes('limite') ||
    t.includes('rate') ||
    t.includes('timeout') ||
    t.includes('temporar') ||
    t.includes('try again') ||
    t.includes('aguarde')
  );
}

/**
 * CMC ao vivo na Omie (mesma fonte da aba Compras: ObterEstoqueProduto → nCMC).
 */
async function buscarCmcOmie(codigo) {
  const codigoStr = String(codigo || '').trim();
  if (!codigoStr || !OMIE_APP_KEY || !OMIE_APP_SECRET) return null;

  try {
    const resp = await fetch('https://app.omie.com.br/api/v1/estoque/resumo/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ObterEstoqueProduto',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{ cCodigo: codigoStr, dDia: formatarDataBR(new Date()) }]
      })
    });
    const texto = await resp.text();
    let json = {};
    try {
      json = texto ? JSON.parse(texto) : {};
    } catch (_) {
      return null;
    }
    if (!resp.ok) {
      console.warn('[epi-estoque-rh] ObterEstoqueProduto falhou', {
        codigo: codigoStr,
        status: resp.status,
        fault: json?.faultstring || json?.error
      });
      return null;
    }

    const lista = Array.isArray(json)
      ? json
      : Array.isArray(json.resumo)
        ? json.resumo
        : Array.isArray(json.listaEstoque)
          ? json.listaEstoque
          : [];
    const item = lista[0] || {};
    for (const campo of ['nCMC', 'nPrecoUltComp']) {
      const v = normalizaNumero(item[campo]);
      if (v != null && v > 0) {
        console.info('[epi-estoque-rh] CMC via Omie', { codigo: codigoStr, campo, cmc: v });
        return v;
      }
    }
  } catch (err) {
    console.warn('[epi-estoque-rh] Falha ao buscar CMC na Omie', {
      codigo: codigoStr,
      erro: err?.message || String(err)
    });
  }
  return null;
}

/**
 * Busca CMC: ##RH local → qualquer local → produtos_omie → Omie (nCMC / última compra).
 */
async function buscarCmc(dbQuery, { codigo, codigo_produto, localCodigo = EPI_RH_LOCAL_CODIGO } = {}) {
  const codigoStr = String(codigo || '').trim();
  const codigoProd = codigo_produto != null ? String(codigo_produto) : null;
  const local = String(localCodigo || EPI_RH_LOCAL_CODIGO).trim();

  if (codigoStr && local) {
    const r = await dbQuery(
      `SELECT cmc FROM logistica.estoque_atual
        WHERE codigo = $1 AND local_codigo = $2 AND cmc IS NOT NULL AND cmc > 0
        LIMIT 1`,
      [codigoStr, local]
    );
    if (r.rows[0]?.cmc != null) {
      const v = Number(r.rows[0].cmc);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }

  if (codigoStr) {
    const r = await dbQuery(
      `SELECT cmc FROM logistica.estoque_atual
        WHERE codigo = $1 AND cmc IS NOT NULL AND cmc > 0
        ORDER BY (local_codigo = $2) DESC, updated_at DESC NULLS LAST
        LIMIT 1`,
      [codigoStr, local]
    );
    if (r.rows[0]?.cmc != null) {
      const v = Number(r.rows[0].cmc);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }

  if (codigoProd) {
    const r = await dbQuery(
      `SELECT cmc FROM logistica.estoque_atual
        WHERE omie_prod_id::text = $1 AND cmc IS NOT NULL AND cmc > 0
        ORDER BY (local_codigo = $2) DESC, updated_at DESC NULLS LAST
        LIMIT 1`,
      [String(codigoProd), local]
    );
    if (r.rows[0]?.cmc != null) {
      const v = Number(r.rows[0].cmc);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }

  if (codigoStr) {
    const r = await dbQuery(
      `SELECT COALESCE(valor_unitario, 0) AS cmc
         FROM produto.produtos_omie
        WHERE TRIM(codigo) = TRIM($1)
           OR TRIM(codigo_produto::text) = TRIM($1)
        LIMIT 1`,
      [codigoStr]
    );
    const v = Number(r.rows[0]?.cmc);
    if (Number.isFinite(v) && v > 0) return v;
  }

  if (codigoStr) {
    const cmcOmie = await buscarCmcOmie(codigoStr);
    if (cmcOmie != null && cmcOmie > 0) return cmcOmie;
  }

  return null;
}

async function resolverCodigoProduto(dbQuery, { codigo, codigo_produto } = {}) {
  const idInformado = normalizaNumero(codigo_produto);
  if (idInformado) return idInformado;

  const codigoStr = String(codigo || '').trim();
  if (!codigoStr) return null;

  const r = await dbQuery(
    `SELECT codigo_produto
       FROM produto.produtos_omie
      WHERE TRIM(codigo) = TRIM($1)
         OR TRIM(codigo_produto::text) = TRIM($1)
      ORDER BY CASE WHEN TRIM(codigo) = TRIM($1) THEN 0 ELSE 1 END
      LIMIT 1`,
    [codigoStr]
  );
  return normalizaNumero(r.rows[0]?.codigo_produto);
}

/**
 * Inclui ENT ou SAI no local ##RH via Omie e agenda reconciliação local.
 * @param {object} opts
 * @param {function} opts.dbQuery
 * @param {'ENT'|'SAI'} opts.tipo
 * @param {string} opts.codigo - sku
 * @param {string|number} [opts.codigo_produto] - id Omie
 * @param {number} opts.qtd
 * @param {string} [opts.obs]
 * @param {string} [opts.usuario]
 * @param {string} [opts.motivo] - padrão INV
 * @param {number} [opts.cmc] - custo unitário informado (sobrescreve busca local/Omie)
 */
async function incluirAjusteEpiRh(opts = {}) {
  const {
    dbQuery,
    tipo,
    codigo,
    codigo_produto,
    qtd,
    obs,
    usuario = 'sistema',
    motivo = 'INV',
    cmc: cmcInformado
  } = opts;

  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    const err = new Error('Credenciais da Omie ausentes.');
    err.status = 500;
    throw err;
  }

  const tipoOmie = String(tipo || '').toUpperCase();
  if (tipoOmie !== 'ENT' && tipoOmie !== 'SAI') {
    const err = new Error('Tipo deve ser ENT ou SAI.');
    err.status = 400;
    throw err;
  }

  const quantidadeFinal = normalizaNumero(qtd);
  if (!quantidadeFinal || quantidadeFinal <= 0) {
    const err = new Error('Quantidade inválida.');
    err.status = 400;
    throw err;
  }

  const codigoStr = String(codigo || '').trim();
  if (!codigoStr) {
    const err = new Error('Código do produto é obrigatório.');
    err.status = 400;
    throw err;
  }

  const idProduto = await resolverCodigoProduto(dbQuery, { codigo: codigoStr, codigo_produto });
  if (!idProduto) {
    const err = new Error(`Produto ${codigoStr} sem código Omie (id).`);
    err.status = 400;
    throw err;
  }

  const cmcOverride = normalizaNumero(cmcInformado);
  let valorCmc =
    cmcOverride != null && cmcOverride > 0
      ? cmcOverride
      : await buscarCmc(dbQuery, { codigo: codigoStr, codigo_produto: idProduto });
  if (!valorCmc || valorCmc <= 0) {
    const err = new Error(
      `CMC ausente ou inválido para o produto ${codigoStr}. Informe o custo/CMC na entrada do ##RH.`
    );
    err.status = 400;
    throw err;
  }

  const obsBase =
    obs ||
    `EPI ${tipoOmie} ##RH — ${codigoStr} x${quantidadeFinal}. Por ${usuario}.`;
  const obsTexto = anexarHoraObs(obsBase);

  const payload = {
    call: 'IncluirAjusteEstoque',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [
      {
        codigo_local_estoque: Number(EPI_RH_LOCAL_CODIGO) || EPI_RH_LOCAL_CODIGO,
        id_prod: idProduto,
        data: formatarDataBR(new Date()),
        quan: String(quantidadeFinal),
        obs: obsTexto,
        origem: 'AJU',
        tipo: tipoOmie,
        motivo: String(motivo || 'INV').toUpperCase(),
        valor: valorCmc
      }
    ]
  };

  console.info('[epi-estoque-rh] Enviando ajuste Omie', {
    tipo: tipoOmie,
    local: EPI_RH_LOCAL_CODIGO,
    produto: idProduto,
    codigo: codigoStr,
    qtd: quantidadeFinal,
    cmc: valorCmc
  });

  const delays = [3000, 6000, 12000, 24000, 45000];
  let ultimoErro = null;
  let jsonOk = null;

  for (let tentativa = 0; tentativa <= delays.length; tentativa++) {
    let resp;
    let texto = '';
    try {
      resp = await fetch('https://app.omie.com.br/api/v1/estoque/ajuste/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      texto = await resp.text();
    } catch (fetchErr) {
      ultimoErro = fetchErr;
      if (tentativa < delays.length) {
        await sleep(delays[tentativa]);
        continue;
      }
      const err = new Error(`Falha ao comunicar com a Omie: ${fetchErr.message || fetchErr}`);
      err.status = 502;
      throw err;
    }

    let json;
    try {
      json = texto ? JSON.parse(texto) : {};
    } catch (parseErr) {
      ultimoErro = parseErr;
      if (isErroOmieRetryable({ httpStatus: resp.status, texto }) && tentativa < delays.length) {
        await sleep(delays[tentativa]);
        continue;
      }
      const err = new Error(`Resposta inválida da Omie. HTTP ${resp.status}.`);
      err.status = resp.status >= 400 ? resp.status : 502;
      throw err;
    }

    if (resp.ok && String(json?.codigo_status || '') === '0') {
      jsonOk = json;
      break;
    }

    const retryable = isErroOmieRetryable({
      httpStatus: resp.status,
      texto: texto || json?.descricao_status || json?.faultstring
    });
    if (retryable && tentativa < delays.length) {
      await sleep(delays[tentativa]);
      continue;
    }

    const msg = json?.descricao_status || json?.faultstring || `Falha na Omie (HTTP ${resp.status}).`;
    const err = new Error(msg);
    err.status = resp.status >= 400 ? resp.status : 502;
    throw err;
  }

  if (!jsonOk) {
    const err = new Error(
      `Omie não confirmou o ajuste após várias tentativas. ${ultimoErro?.message || ''}`.trim()
    );
    err.status = 429;
    throw err;
  }

  const deltaEsperado = tipoOmie === 'ENT' ? quantidadeFinal : -quantidadeFinal;
  agendarReconciliacaoEstoqueOmie({
    codigo: codigoStr,
    codigoProduto: String(idProduto),
    localCodigo: EPI_RH_LOCAL_CODIGO,
    deltaEsperado,
    query: dbQuery
  });

  return {
    ok: true,
    omie: jsonOk,
    codigo: codigoStr,
    codigo_produto: idProduto,
    tipo: tipoOmie,
    qtd: quantidadeFinal,
    local: EPI_RH_LOCAL_CODIGO,
    cmc: valorCmc,
    deltaEsperado
  };
}

module.exports = {
  EPI_RH_LOCAL_CODIGO,
  EPI_RH_LOCAL_NOME,
  buscarCmc,
  buscarCmcOmie,
  incluirAjusteEpiRh,
  resolverCodigoProduto
};
