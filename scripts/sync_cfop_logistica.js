#!/usr/bin/env node

const fetch = require('node-fetch');
const { dbGetClient, dbClose, isDbEnabled } = require('../src/db');

const OMIE_CFOP_URL = 'https://app.omie.com.br/api/v1/produtos/cfop/';
const OMIE_APP_KEY = process.env.OMIE_APP_KEY || '';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '';
const DELAY_MS = 350; // ~3 req/s

function normalizarTexto(valor, fallback = '') {
  const texto = String(valor ?? '').trim();
  return texto || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      const cCodigo = normalizarTexto(item?.nCodigo);
      if (!cCodigo) continue;

      itens.push({
        cCodigo,
        cDescricao: normalizarTexto(item?.cDescricao, '-'),
        cObservacao: normalizarTexto(item?.cObservacao, normalizarTexto(item?.cDescricao, '-')),
        cTipo: normalizarTexto(item?.cTipo, '-')
      });
    }

    pagina += 1;
    if (pagina <= totalPaginas) {
      await sleep(DELAY_MS);
    }
  }

  const unicos = new Map();
  for (const item of itens) {
    if (!unicos.has(item.cCodigo)) {
      unicos.set(item.cCodigo, item);
    }
  }

  return Array.from(unicos.values()).sort((a, b) => {
    const aDig = a.cCodigo.replace(/\D/g, '');
    const bDig = b.cCodigo.replace(/\D/g, '');
    return aDig.localeCompare(bDig);
  });
}

async function garantirEstruturaCfop(client) {
  await client.query('CREATE SCHEMA IF NOT EXISTS logistica');
  await client.query(`
    CREATE TABLE IF NOT EXISTS logistica.cfop (
      id BIGSERIAL PRIMARY KEY,
      "cCodigo" VARCHAR(20) NOT NULL,
      "cDescricao" TEXT NOT NULL,
      "cObservacao" TEXT NULL,
      "cTipo" VARCHAR(20) NULL,
      fonte_url TEXT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT logistica_cfop_ccodigo_unico UNIQUE ("cCodigo")
    )
  `);

  await client.query('CREATE INDEX IF NOT EXISTS idx_logistica_cfop_ccodigo ON logistica.cfop ("cCodigo")');
  await client.query('CREATE INDEX IF NOT EXISTS idx_logistica_cfop_ativo ON logistica.cfop (ativo)');
}

async function main() {
  if (!isDbEnabled) {
    throw new Error('DATABASE_URL não configurada. Rode em modo Postgres (--env pg).');
  }

  console.log('[CFOP Logistica Sync] Baixando CFOP da API Omie (ListarCFOP) com limite de 3 req/s...');
  const cfops = await listarCfopOmiePaginado();
  if (!cfops.length) {
    throw new Error('Nenhum CFOP retornado pela API Omie');
  }

  console.log(`[CFOP Logistica Sync] CFOPs encontrados: ${cfops.length}`);

  const client = await dbGetClient();
  let inseridos = 0;
  let atualizados = 0;

  try {
    await client.query('BEGIN');
    await garantirEstruturaCfop(client);

    for (const item of cfops) {
      const result = await client.query(
        `INSERT INTO logistica.cfop ("cCodigo", "cDescricao", "cObservacao", "cTipo", fonte_url, ativo, atualizado_em, updated_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
         ON CONFLICT ("cCodigo") DO UPDATE
           SET "cDescricao" = EXCLUDED."cDescricao",
               "cObservacao" = EXCLUDED."cObservacao",
               "cTipo" = EXCLUDED."cTipo",
               fonte_url = EXCLUDED.fonte_url,
               ativo = TRUE,
               atualizado_em = NOW(),
               updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [item.cCodigo, item.cDescricao, item.cObservacao, item.cTipo, OMIE_CFOP_URL]
      );

      const inserted = result.rows?.[0]?.inserted === true;
      if (inserted) inseridos += 1;
      else atualizados += 1;
    }

    await client.query('COMMIT');
    console.log(`[CFOP Logistica Sync] Concluído. Inseridos: ${inseridos} | Atualizados: ${atualizados}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error('[CFOP Logistica Sync] Erro:', err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await dbClose();
    } catch (_e) {}
  });
