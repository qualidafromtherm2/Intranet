#!/usr/bin/env node
'use strict';

/**
 * Preenche vendedor em NFs que estão "(sem vendedor)" buscando o pedido na Omie.
 * Ritmo lento + para imediatamente se a API bloquear.
 *
 * Uso:
 *   node scripts/sync_vendedores_nf_faltantes.js
 *   node scripts/sync_vendedores_nf_faltantes.js --limite=50 --delay-ms=2000
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const {
  BACKFILL_CODIGO_VENDEDOR_SQL,
  PROPAGA_VENDEDOR_PEDIDO_PARA_NF_SQL,
} = require('../utils/nfCodigoVendedor');

const ROOT = path.resolve(__dirname, '..');

function isLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return !h || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local');
}

function hostOf(urlStr) {
  try { return new URL(urlStr).hostname; } catch (_) { return ''; }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath));
}

function pickRemoteUrl() {
  dotenv.config({ path: path.join(ROOT, '.env'), override: false });
  for (const url of [
    process.env.DATABASE_URL_PROD,
    process.env.POSTGRES_URL_PROD,
    process.env.DATABASE_URL,
  ].filter(Boolean)) {
    if (!isLocalHost(hostOf(url))) return url;
  }
  const arquivos = fs.readdirSync(ROOT)
    .filter((f) => f.startsWith('.env.render') || f === '.env.production' || f === '.env.prod')
    .sort()
    .reverse();
  for (const nome of arquivos) {
    const parsed = loadEnvFile(path.join(ROOT, nome));
    const url = parsed.DATABASE_URL_PROD || parsed.DATABASE_URL || parsed.POSTGRES_URL;
    if (url && !isLocalHost(hostOf(url))) return url;
  }
  return null;
}

function parseArgs(argv) {
  const out = { limite: 60, delayMs: 2000, desde: '2025-09-01', waitUnlock: true };
  for (const a of argv) {
    if (a.startsWith('--limite=')) out.limite = Math.max(1, Number(a.slice(9)) || 60);
    else if (a.startsWith('--delay-ms=')) out.delayMs = Math.max(800, Number(a.slice(11)) || 2000);
    else if (a.startsWith('--desde=')) out.desde = String(a.slice(8) || '2025-09-01');
    else if (a === '--no-wait') out.waitUnlock = false;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadOmieKeys() {
  const local = loadEnvFile(path.join(ROOT, '.env'));
  return {
    key: process.env.OMIE_APP_KEY || local.OMIE_APP_KEY || '',
    secret: process.env.OMIE_APP_SECRET || local.OMIE_APP_SECRET || '',
  };
}

async function omieConsultarPedido(codigo, key, secret) {
  const res = await fetch('https://app.omie.com.br/api/v1/produtos/pedido/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarPedido',
      app_key: key,
      app_secret: secret,
      param: [{ codigo_pedido: Number(codigo) }],
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(j.faultstring || `HTTP ${res.status}`);
    err.fault = j;
    throw err;
  }
  return j;
}

function segundosBloqueio(msg) {
  const m = String(msg || '').match(/(\d+)\s*segundos?/i);
  return m ? Number(m[1]) : null;
}

function isBloqueio(msg) {
  return /bloquead|consumo indevido|Aguarde\s+\d+/i.test(String(msg || ''));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dbUrl = pickRemoteUrl();
  if (!dbUrl) throw new Error('Sem DATABASE_URL de produção.');
  const { key, secret } = loadOmieKeys();
  if (!key || !secret) throw new Error('OMIE_APP_KEY/SECRET ausentes.');

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

  try {
    await pool.query(`ALTER TABLE vendas.notas_fiscais_omie ADD COLUMN IF NOT EXISTS codigo_vendedor TEXT`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.pedidos_omie_inexistentes (
        codigo_pedido BIGINT PRIMARY KEY,
        motivo TEXT,
        marcado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const bf = await pool.query(BACKFILL_CODIGO_VENDEDOR_SQL);
    const prop = await pool.query(PROPAGA_VENDEDOR_PEDIDO_PARA_NF_SQL);
    log(`local: backfill títulos=${bf.rowCount || 0} propagado pedido→NF=${prop.rowCount || 0}`);

    // Só IDs cujo pedido AINDA NÃO está local — evita reconsultar os que a Omie
    // já devolveu sem codVend (vendedor realmente em branco no ERP).
    const { rows: sem } = await pool.query(
      `
      SELECT DISTINCT nf.id_pedido_omie::bigint AS codigo_pedido
        FROM vendas.notas_fiscais_omie nf
       WHERE nf.ativa IS DISTINCT FROM FALSE
         AND COALESCE(nf.payload_ultimo->'ide'->>'tpNF', '1') <> '0'
         AND nf.data_emissao_dt >= $1::date
         AND nf.id_pedido_omie IS NOT NULL
         AND nf.id_pedido_omie::text NOT IN ('0', '')
         AND COALESCE(TRIM(nf.codigo_vendedor), '') = ''
         AND NOT EXISTS (
           SELECT 1 FROM vendas.pedidos_venda p
            WHERE p.codigo_pedido = nf.id_pedido_omie
         )
         AND NOT EXISTS (
           SELECT 1 FROM vendas.pedidos_omie_inexistentes x
            WHERE x.codigo_pedido = nf.id_pedido_omie
         )
       ORDER BY 1 DESC
      `,
      [opts.desde]
    );

    const ids = sem.map((r) => Number(r.codigo_pedido)).filter(Boolean);
    log(`pendentes com id_pedido: ${ids.length} (vai processar até ${opts.limite}, delay ${opts.delayMs}ms)`);

    if (!ids.length) {
      log('nada a fazer');
      return;
    }

    // Espera desbloqueio Omie se necessário
    if (opts.waitUnlock) {
      for (let tentativa = 1; tentativa <= 40; tentativa++) {
        try {
          await omieConsultarPedido(ids[0], key, secret);
          log('Omie liberada');
          await sleep(opts.delayMs);
          break;
        } catch (e) {
          const msg = String(e.message || e);
          if (!isBloqueio(msg)) {
            // primeiro id pode não existir — tenta o próximo como probe
            if (/não cadastrado|nao cadastrado/i.test(msg) && ids.length > 1) {
              try {
                await omieConsultarPedido(ids[1], key, secret);
                log('Omie liberada (probe 2)');
                await sleep(opts.delayMs);
                break;
              } catch (e2) {
                if (!isBloqueio(String(e2.message || e2))) throw e2;
                const s = segundosBloqueio(e2.message) || 60;
                log(`Omie bloqueada — aguardando ${s}s (tentativa ${tentativa})`);
                await sleep((s + 5) * 1000);
                continue;
              }
            }
            throw e;
          }
          const s = segundosBloqueio(msg) || 60;
          log(`Omie bloqueada — aguardando ${s}s (tentativa ${tentativa})`);
          await sleep((s + 5) * 1000);
        }
      }
    }

    let ok = 0;
    let skip = 0;
    let err = 0;
    const max = Math.min(ids.length, opts.limite);

    for (let i = 0; i < max; i++) {
      const codigo = ids[i];
      try {
        const data = await omieConsultarPedido(codigo, key, secret);
        await sleep(opts.delayMs);
        const ped = Array.isArray(data.pedido_venda_produto)
          ? data.pedido_venda_produto
          : (data.pedido_venda_produto ? [data.pedido_venda_produto] : []);
        if (!ped.length) {
          skip++;
          process.stdout.write('x');
          continue;
        }
        for (const pedido of ped) {
          await pool.query('SELECT vendas.pedido_upsert_from_payload($1::jsonb)', [pedido]);
        }
        await pool.query(PROPAGA_VENDEDOR_PEDIDO_PARA_NF_SQL);
        ok++;
        process.stdout.write('.');
      } catch (e) {
        const msg = String(e.message || e);
        if (isBloqueio(msg)) {
          console.log('');
          log(`BLOQUEIO Omie no pedido ${codigo}: ${msg.slice(0, 140)}`);
          log(`parei com ok=${ok} skip=${skip} err=${err}. Rode de novo depois.`);
          break;
        }
        if (/não cadastrado|nao cadastrado/i.test(msg)) {
          skip++;
          process.stdout.write('!');
          await sleep(Math.min(1000, opts.delayMs));
          continue;
        }
        err++;
        console.log('');
        log(`erro ${codigo}: ${msg.slice(0, 140)}`);
        await sleep(opts.delayMs);
      }
    }

    console.log('');
    const { rows: after } = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE COALESCE(
                  NULLIF(TRIM(p.informacoes_adicionais->>'codVend'), ''),
                  NULLIF(TRIM(nf.codigo_vendedor), ''),
                  ''
                ) = ''
            AND nf.id_pedido_omie IS NOT NULL
            AND nf.id_pedido_omie::text NOT IN ('0', '')
        )::int AS ainda_sem_com_id,
        COUNT(*) FILTER (
          WHERE COALESCE(
                  NULLIF(TRIM(p.informacoes_adicionais->>'codVend'), ''),
                  NULLIF(TRIM(nf.codigo_vendedor), ''),
                  ''
                ) = ''
            AND (nf.id_pedido_omie IS NULL OR nf.id_pedido_omie::text IN ('0', ''))
        )::int AS sem_id_pedido
      FROM vendas.notas_fiscais_omie nf
      LEFT JOIN vendas.pedidos_venda p ON p.codigo_pedido = nf.id_pedido_omie
      WHERE nf.ativa IS DISTINCT FROM FALSE
        AND COALESCE(nf.payload_ultimo->'ide'->>'tpNF', '1') <> '0'
        AND nf.data_emissao_dt >= $1::date
      `,
      [opts.desde]
    );

    log(`resultado: ok=${ok} skip=${skip} err=${err}`);
    log(`restante desde ${opts.desde}: ${JSON.stringify(after[0])}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
