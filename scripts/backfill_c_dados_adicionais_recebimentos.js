#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');

const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_INTERNAL_URL;

if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
  console.error('OMIE_APP_KEY/OMIE_APP_SECRET não configurados.');
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error('DATABASE_URL não configurada.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const processAll = args.has('--all');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const rowLimit = limitArg ? Number(limitArg.split('=')[1]) : null;
const dryRun = args.has('--dry-run');

const MIN_INTERVAL_MS = 350;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function consultarRecebimentoOmie(nIdReceb) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await fetch('https://app.omie.com.br/api/v1/produtos/recebimentonfe/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call: 'ConsultarRecebimento',
          app_key: OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param: [{ nIdReceb: Number(nIdReceb) }],
        }),
      });

      const text = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }

      if (!response.ok) {
        const msg = String(payload?.faultstring || text || `HTTP ${response.status}`);
        const isRedundant = /consumo redundante|aguarde\s*3\s*segundos/i.test(msg);
        if (isRedundant && attempt < MAX_RETRIES) {
          await sleep(3000);
          continue;
        }
        return { ok: false, error: `HTTP ${response.status} - ${msg}` };
      }

      if (payload?.faultstring) {
        const msg = String(payload.faultstring);
        const isRedundant = /consumo redundante|aguarde\s*3\s*segundos/i.test(msg);
        if (isRedundant && attempt < MAX_RETRIES) {
          await sleep(3000);
          continue;
        }
        return { ok: false, error: msg };
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_INTERVAL_MS) {
        await sleep(MIN_INTERVAL_MS - elapsed);
      }

      return { ok: true, data: payload };
    } catch (err) {
      if (attempt >= MAX_RETRIES) {
        return { ok: false, error: String(err?.message || err) };
      }
      await sleep(1000);
    }
  }

  return { ok: false, error: 'Falha desconhecida ao consultar Omie.' };
}

async function main() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE logistica.recebimentos_nfe_omie
      ADD COLUMN IF NOT EXISTS c_dados_adicionais TEXT;
    `);

    const whereClause = processAll
      ? `WHERE n_id_receb IS NOT NULL`
      : `WHERE n_id_receb IS NOT NULL
           AND (
             c_dados_adicionais IS NULL OR btrim(c_dados_adicionais) = ''
             OR c_chave_nfe IS NULL OR btrim(c_chave_nfe) = ''
             OR n_valor_nfe IS NULL
           )`;

    const limitSql = Number.isFinite(rowLimit) && rowLimit > 0 ? `LIMIT ${Math.floor(rowLimit)}` : '';

    const { rows } = await client.query(`
      SELECT n_id_receb
      FROM logistica.recebimentos_nfe_omie
      ${whereClause}
      ORDER BY updated_at DESC NULLS LAST, n_id_receb DESC
      ${limitSql}
    `);

    const total = rows.length;
    console.log(`[backfill] Registros alvo: ${total} (modo=${processAll ? 'all' : 'missing'}, dryRun=${dryRun})`);

    let okCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let failCount = 0;

    for (let index = 0; index < rows.length; index++) {
      const nIdReceb = rows[index].n_id_receb;
      const result = await consultarRecebimentoOmie(nIdReceb);

      if (!result.ok) {
        failCount += 1;
        console.warn(`[backfill] ${index + 1}/${total} nIdReceb=${nIdReceb} ERRO: ${result.error}`);
        await sleep(MIN_INTERVAL_MS);
        continue;
      }

      okCount += 1;

      const cabec = result.data?.cabec || result.data?.cabecalho || {};
      const cDadosAdicionais = cabec.cDadosAdicionais || cabec.c_dados_adicionais || cabec.cObsNFe || null;
      const cChaveNFe = cabec.cChaveNFe || cabec.cChaveNfe || cabec.c_chave_nfe || null;
      const nValorNFe = cabec.nValorNFe ?? cabec.nValorNF ?? null;

      if (dryRun) {
        console.log(`[backfill] ${index + 1}/${total} nIdReceb=${nIdReceb} dados=${cDadosAdicionais ? 'SIM' : 'NÃO'} chave=${cChaveNFe ? 'SIM' : 'NÃO'} valor=${nValorNFe !== null && nValorNFe !== undefined ? 'SIM' : 'NÃO'}`);
        continue;
      }

      const updateRes = await client.query(
        `UPDATE logistica.recebimentos_nfe_omie
            SET c_dados_adicionais = COALESCE($2::text, c_dados_adicionais),
                c_chave_nfe = COALESCE($3::text, c_chave_nfe),
                n_valor_nfe = COALESCE($4::numeric, n_valor_nfe),
                updated_at = NOW()
          WHERE n_id_receb = $1
            AND (
              ($2::text IS NOT NULL AND c_dados_adicionais IS DISTINCT FROM $2::text)
              OR ($3::text IS NOT NULL AND c_chave_nfe IS DISTINCT FROM $3::text)
              OR ($4::numeric IS NOT NULL AND n_valor_nfe IS DISTINCT FROM $4::numeric)
            )`,
        [nIdReceb, cDadosAdicionais, cChaveNFe, nValorNFe]
      );

      if (updateRes.rowCount > 0) {
        updatedCount += updateRes.rowCount;
      } else {
        unchangedCount += 1;
      }

      if ((index + 1) % 50 === 0 || index + 1 === total) {
        console.log(`[backfill] progresso ${index + 1}/${total} | ok=${okCount} updated=${updatedCount} unchanged=${unchangedCount} fail=${failCount}`);
      }

      await sleep(MIN_INTERVAL_MS);
    }

    console.log(`[backfill] Finalizado | ok=${okCount} updated=${updatedCount} unchanged=${unchangedCount} fail=${failCount}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[backfill] Erro fatal:', err);
  process.exit(1);
});
