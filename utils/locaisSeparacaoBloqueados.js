'use strict';

/** Armazéns que não entram em separação logística (Omie). */
const LOCAL_AREA_VERMELHA = '10408747792';
const LOCAL_ENG_AMOSTRAS = '10408747807';
const NOME_AREA_VERMELHA = '7. AREA VERMELHA';
const NOME_ENG_AMOSTRAS = '8. ENGENHARIA E AMOSTRAS';

const LOCAIS_BLOQUEADOS_SEPARACAO = Object.freeze([LOCAL_AREA_VERMELHA, LOCAL_ENG_AMOSTRAS]);

function isLocalBloqueadoSeparacao(codigo) {
  return LOCAIS_BLOQUEADOS_SEPARACAO.includes(String(codigo || '').trim());
}

function destinoPorStatusPirEng(status) {
  const st = String(status || '').trim().toLowerCase();
  if (st === 'reprovado') {
    return { codigo: LOCAL_AREA_VERMELHA, nome: NOME_AREA_VERMELHA };
  }
  if (st === 'projeto') {
    return { codigo: LOCAL_ENG_AMOSTRAS, nome: NOME_ENG_AMOSTRAS };
  }
  return null;
}

module.exports = {
  LOCAL_AREA_VERMELHA,
  LOCAL_ENG_AMOSTRAS,
  NOME_AREA_VERMELHA,
  NOME_ENG_AMOSTRAS,
  LOCAIS_BLOQUEADOS_SEPARACAO,
  isLocalBloqueadoSeparacao,
  destinoPorStatusPirEng
};
