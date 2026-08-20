'use strict';

/**
 * Movimentações Omie da NIQ (Área vermelha):
 * - TRF: armazém origem (padrão Produção) → 7. AREA VERMELHA
 * - SAI: baixa scrap (PER | perda/quebra) na Área vermelha
 */

const { dbQuery } = require('../src/db');
const omieCall = require('./omieCall');
const { anexarHoraObs } = require('./anexarHoraObs');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.server');
const {
  LOCAL_AREA_VERMELHA,
  NOME_AREA_VERMELHA,
} = require('./locaisSeparacaoBloqueados');

const LOCAL_ESTOQUE_PRODUCAO = '10431538872';
const NOME_ESTOQUE_PRODUCAO = '3. ESTOQUE PRODUÇÃO';

function formatarDataBR(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const ano = String(d.getFullYear());
  return `${dia}/${mes}/${ano}`;
}

function normalizaNumero(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim().replace(/\s+/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function buscarNomeLocal(codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return '';
  try {
    const { rows } = await dbQuery(
      `SELECT nome FROM omie.omie_locais_estoque WHERE local_codigo::text = $1 LIMIT 1`,
      [cod]
    );
    if (rows[0]?.nome) return String(rows[0].nome).trim();
  } catch (_) { /* silencioso */ }
  if (cod === LOCAL_ESTOQUE_PRODUCAO) return NOME_ESTOQUE_PRODUCAO;
  if (cod === LOCAL_AREA_VERMELHA) return NOME_AREA_VERMELHA;
  return '';
}

async function buscarCmc({ codigo, localCodigo, idProd }) {
  const codigoTxt = String(codigo || '').trim();
  const local = String(localCodigo || '').trim();
  if (codigoTxt && local) {
    const { rows } = await dbQuery(
      `SELECT COALESCE(NULLIF(cmc, 0), NULLIF(preco_unitario, 0), 0) AS cmc
         FROM logistica.estoque_atual
        WHERE TRIM(codigo) = TRIM($1) AND local_codigo::text = $2
        LIMIT 1`,
      [codigoTxt, local]
    );
    const cmc = normalizaNumero(rows[0]?.cmc);
    if (cmc && cmc > 0) return cmc;
  }
  const { rows: prod } = await dbQuery(
    `SELECT COALESCE(NULLIF(valor_unitario, 0), 0.01) AS valor
       FROM produto.produtos_omie
      WHERE ($1 <> '' AND TRIM(codigo) = TRIM($1))
         OR ($2::bigint > 0 AND codigo_produto = $2)
      LIMIT 1`,
    [codigoTxt, Number(idProd) || 0]
  );
  return normalizaNumero(prod[0]?.valor) || 0.01;
}

async function resolverProdutoOmie(codigo) {
  const cod = String(codigo || '').trim();
  const { rows } = await dbQuery(
    `SELECT codigo, codigo_produto::text AS codigo_produto, descricao,
            COALESCE(NULLIF(valor_unitario, 0), 0.01) AS valor_unitario
       FROM produto.produtos_omie
      WHERE TRIM(codigo) = TRIM($1)
         OR TRIM(codigo_produto::text) = TRIM($1)
      ORDER BY codigo_produto DESC
      LIMIT 1`,
    [cod]
  );
  return rows[0] || null;
}

async function trfParaAreaVermelha({
  codigo,
  quantidade,
  localOrigemCodigo,
  usuario,
  numeroOp,
  niqId,
}) {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    const err = new Error('Credenciais Omie não configuradas no servidor.');
    err.status = 500;
    throw err;
  }
  const origem = String(localOrigemCodigo || LOCAL_ESTOQUE_PRODUCAO).trim() || LOCAL_ESTOQUE_PRODUCAO;
  const destino = LOCAL_AREA_VERMELHA;
  if (origem === destino) {
    const err = new Error('Origem e destino de estoque não podem ser iguais.');
    err.status = 400;
    throw err;
  }
  const qtd = normalizaNumero(quantidade);
  if (!qtd || qtd <= 0) {
    const err = new Error('Quantidade inválida para transferência Omie.');
    err.status = 400;
    throw err;
  }
  const prod = await resolverProdutoOmie(codigo);
  if (!prod) {
    const err = new Error('Produto não encontrado no cadastro Omie.');
    err.status = 400;
    throw err;
  }
  const idProd = normalizaNumero(prod.codigo_produto);
  if (!idProd) {
    const err = new Error('Produto sem código Omie (id_prod) para transferência.');
    err.status = 400;
    throw err;
  }
  const valor = await buscarCmc({
    codigo: prod.codigo,
    localCodigo: origem,
    idProd,
  });
  const origemNome = (await buscarNomeLocal(origem)) || NOME_ESTOQUE_PRODUCAO;
  const destinoNome = NOME_AREA_VERMELHA;
  const obs = anexarHoraObs(
    `NIQ #${niqId || '?'} | TRF para Área vermelha | ${prod.codigo}`
      + (numeroOp ? ` | OP ${numeroOp}` : '')
      + (usuario ? ` | Por: ${usuario}` : '')
  ).slice(0, 200);

  const payload = {
    call: 'IncluirAjusteEstoque',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      codigo_local_estoque: origem,
      codigo_local_estoque_destino: destino,
      id_prod: idProd,
      data: formatarDataBR(new Date()),
      tipo: 'TRF',
      quan: String(qtd),
      valor,
      obs,
      origem: 'AJU',
      motivo: 'TRF',
    }],
  };

  const resp = await omieCall('https://app.omie.com.br/api/v1/estoque/ajuste/', payload);
  if (resp?.faultstring) {
    const err = new Error(String(resp.faultstring));
    err.status = 502;
    throw err;
  }
  if (resp?.codigo_status != null && String(resp.codigo_status) !== '0') {
    const err = new Error(String(resp.descricao_status || 'Omie rejeitou a transferência.'));
    err.status = 502;
    throw err;
  }

  return {
    omie: resp,
    omie_codigo: String(
      resp?.codigo_lancamento_omie || resp?.nCodAjuste || resp?.codigo_ajuste || ''
    ),
    local_origem_codigo: origem,
    local_origem_nome: origemNome,
    local_destino_codigo: destino,
    local_destino_nome: destinoNome,
    codigo: prod.codigo,
    codigo_produto: prod.codigo_produto,
    descricao: prod.descricao,
  };
}

async function saiScrapAreaVermelha({
  codigo,
  quantidade,
  usuario,
  niqId,
  numeroOp,
}) {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    const err = new Error('Credenciais Omie não configuradas no servidor.');
    err.status = 500;
    throw err;
  }
  const qtd = normalizaNumero(quantidade);
  if (!qtd || qtd <= 0) {
    const err = new Error('Quantidade inválida para saída Omie.');
    err.status = 400;
    throw err;
  }
  const prod = await resolverProdutoOmie(codigo);
  if (!prod) {
    const err = new Error('Produto não encontrado no cadastro Omie.');
    err.status = 400;
    throw err;
  }
  const idProd = normalizaNumero(prod.codigo_produto);
  if (!idProd) {
    const err = new Error('Produto sem código Omie (id_prod) para saída.');
    err.status = 400;
    throw err;
  }
  const local = LOCAL_AREA_VERMELHA;
  const valor = await buscarCmc({
    codigo: prod.codigo,
    localCodigo: local,
    idProd,
  });
  const obs = anexarHoraObs(
    `NIQ #${niqId || '?'} | SAI scrap (PER) Área vermelha | ${prod.codigo}`
      + (numeroOp ? ` | OP ${numeroOp}` : '')
      + (usuario ? ` | Por: ${usuario}` : '')
  ).slice(0, 200);

  const payload = {
    call: 'IncluirAjusteEstoque',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      codigo_local_estoque: local,
      id_prod: idProd,
      data: formatarDataBR(new Date()),
      tipo: 'SAI',
      quan: String(qtd),
      valor,
      obs,
      origem: 'AJU',
      motivo: 'PER',
    }],
  };

  const resp = await omieCall('https://app.omie.com.br/api/v1/estoque/ajuste/', payload);
  if (resp?.faultstring) {
    const err = new Error(String(resp.faultstring));
    err.status = 502;
    throw err;
  }
  if (resp?.codigo_status != null && String(resp.codigo_status) !== '0') {
    const err = new Error(String(resp.descricao_status || 'Omie rejeitou a saída de scrap.'));
    err.status = 502;
    throw err;
  }

  return {
    omie: resp,
    omie_codigo: String(
      resp?.codigo_lancamento_omie || resp?.nCodAjuste || resp?.codigo_ajuste || ''
    ),
  };
}

module.exports = {
  LOCAL_ESTOQUE_PRODUCAO,
  NOME_ESTOQUE_PRODUCAO,
  LOCAL_AREA_VERMELHA,
  NOME_AREA_VERMELHA,
  buscarNomeLocal,
  trfParaAreaVermelha,
  saiScrapAreaVermelha,
};
