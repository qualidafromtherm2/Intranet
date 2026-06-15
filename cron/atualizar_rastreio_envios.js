#!/usr/bin/env node
/**
 * CRON RENDER — Atualização diária de rastreio (07:00 horário Brasília)
 *
 * Consulta VIPP e Correios para envios com rastreio_status
 * "Valida" ou "Processamento Vipp" e grava em envios.solicitacoes.
 *
 * Schedule Render: 0 10 * * *  (07:00 BRT = 10:00 UTC)
 */
'use strict';

require('dotenv').config();

const {
  executarAtualizacaoRastreioEnvios,
  jaRodouHoje,
  marcarRodouHoje,
} = require('../utils/atualizarRastreioEnvios');

const TAG = '[CronRastreioEnvios]';

async function main() {
  const hoje = new Date().toISOString().slice(0, 10);

  if (await jaRodouHoje(hoje)) {
    console.log(TAG, `Já executado hoje (${hoje}) — ignorando.`);
    process.exit(0);
  }

  console.log(TAG, `Iniciando atualização de rastreio (${hoje})...`);

  try {
    const resumo = await executarAtualizacaoRastreioEnvios();
    await marcarRodouHoje(hoje);
    console.log(TAG, 'Finalizado:', resumo);
    process.exit(resumo.erros > 0 ? 0 : 0);
  } catch (err) {
    console.error(TAG, 'Erro fatal:', err?.message || err);
    process.exit(1);
  }
}

main();
