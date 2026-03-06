#!/usr/bin/env node

const fetch = require('node-fetch');
const { dbGetClient, dbClose, isDbEnabled } = require('../src/db');

const OMIE_CFOP_URL = 'https://app.omie.com.br/api/v1/produtos/cfop/';
const OMIE_APP_KEY = process.env.OMIE_APP_KEY || '';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '';

function normalizarTexto(valor, fallback = '') {
  const texto = String(valor ?? '').trim();
  return texto || fallback;
}

async function listarCfopOmiePaginado() {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET não configuradas');
  }

  const registrosPorPagina = 100;
  const itens = [];
  let pagina = 1;
  let totalPaginas = 1;

  while (pagina <= totalPaginas) {
    const body = {
      call: 'ListarCFOP',
      param: [{ pagina, registros_por_pagina: registrosPorPagina }],
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };

    const resp = await fetch(OMIE_CFOP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await resp.json().catch(() => ({}));
    const fault = data?.faultstring || data?.faultcode || '';
    if (!resp.ok || fault) {
      throw new Error(fault || `Falha na API Omie ListarCFOP (HTTP ${resp.status})`);
    }

    totalPaginas = Number(data?.total_de_paginas || 1);
    const cadastros = Array.isArray(data?.cadastros) ? data.cadastros : [];

    for (const item of cadastros) {
      const codigo = normalizarTexto(item?.nCodigo);
      if (!codigo) continue;

      itens.push({
        codigo,
        descricao: normalizarTexto(item?.cDescricao, '-'),
        aplicacao: normalizarTexto(item?.cObservacao, normalizarTexto(item?.cDescricao, '-')),
        tipo: normalizarTexto(item?.cTipo, '-')
      });
    }

    pagina += 1;
  }

  const unicos = new Map();
  for (const item of itens) {
    if (!unicos.has(item.codigo)) {
      unicos.set(item.codigo, item);
    }
  }

  return Array.from(unicos.values()).sort((a, b) => {
    const aDig = a.codigo.replace(/\D/g, '');
    const bDig = b.codigo.replace(/\D/g, '');
    return aDig.localeCompare(bDig);
  });
}

async function garantirEstruturaCfop(client) {
  await client.query('CREATE SCHEMA IF NOT EXISTS configuracoes');
  await client.query(`
    CREATE TABLE IF NOT EXISTS configuracoes.cfop (
      id BIGSERIAL PRIMARY KEY,
      codigo VARCHAR(10) NOT NULL,
      descricao TEXT NOT NULL,
      aplicacao TEXT NOT NULL,
      fonte_url TEXT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT cfop_codigo_unico UNIQUE (codigo)
    )
  `);

  await client.query('CREATE INDEX IF NOT EXISTS idx_cfop_codigo ON configuracoes.cfop (codigo)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_cfop_ativo ON configuracoes.cfop (ativo)');
}

async function main() {
  if (!isDbEnabled) {
    throw new Error('DATABASE_URL não configurada. Rode em modo Postgres (--env pg).');
  }

  console.log('[CFOP Sync] Baixando CFOP da API Omie (ListarCFOP)...');
  const cfops = await listarCfopOmiePaginado();
  if (!cfops.length) {
    throw new Error('Nenhum CFOP retornado pela API Omie');
  }

  console.log(`[CFOP Sync] CFOPs encontrados: ${cfops.length}`);

  const client = await dbGetClient();
  let inseridos = 0;
  let atualizados = 0;

  try {
    await client.query('BEGIN');
    await garantirEstruturaCfop(client);

    for (const item of cfops) {
      const result = await client.query(
        `INSERT INTO configuracoes.cfop (codigo, descricao, aplicacao, fonte_url, ativo, atualizado_em, updated_at)
         VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
         ON CONFLICT (codigo) DO UPDATE
           SET descricao = EXCLUDED.descricao,
               aplicacao = EXCLUDED.aplicacao,
               fonte_url = EXCLUDED.fonte_url,
               ativo = TRUE,
               atualizado_em = NOW(),
               updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [item.codigo, item.descricao, item.aplicacao, OMIE_CFOP_URL]
      );

      const inserted = result.rows?.[0]?.inserted === true;
      if (inserted) inseridos += 1;
      else atualizados += 1;
    }

    await client.query('COMMIT');
    console.log(`[CFOP Sync] Concluído. Inseridos: ${inseridos} | Atualizados: ${atualizados}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error('[CFOP Sync] Erro:', err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await dbClose();
    } catch (_e) {}
  });
