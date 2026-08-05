'use strict';
/**
 * Preenche a coluna cfop em "Vendas".notas_fiscais_omie.
 *
 * 1) Extrai do payload_ultimo (det[].prod.CFOP) — sem Omie
 * 2) Para as restantes, ConsultarNF com delay (rate-limit)
 *
 * Uso:
 *   node scripts/backfill_cfop_notas_fiscais_vendas.js
 *   node scripts/backfill_cfop_notas_fiscais_vendas.js --somente-payload
 *   node scripts/backfill_cfop_notas_fiscais_vendas.js --limite=100
 *   node scripts/backfill_cfop_notas_fiscais_vendas.js --delay-ms=500
 *
 * Env: DATABASE_URL, OMIE_APP_KEY, OMIE_APP_SECRET
 */

require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;
const OMIE_NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';

const args = process.argv.slice(2);
const SOMENTE_PAYLOAD = args.includes('--somente-payload');
const limArg = args.find((a) => a.startsWith('--limite='));
const LIMITE = limArg ? Math.max(1, Number(limArg.split('=')[1]) || 0) : null;
const delayArg = args.find((a) => a.startsWith('--delay-ms='));
const DELAY_MS = delayArg ? Math.max(200, Number(delayArg.split('=')[1]) || 500) : 500;

if (!DATABASE_URL) {
  console.error('Erro: DATABASE_URL obrigatório.');
  process.exit(1);
}
if (!SOMENTE_PAYLOAD && (!OMIE_APP_KEY || !OMIE_APP_SECRET)) {
  console.error('Erro: OMIE_APP_KEY e OMIE_APP_SECRET obrigatórios (ou use --somente-payload).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractCfopsFromNf(nf = {}) {
  const dets = Array.isArray(nf?.det) ? nf.det : [];
  const set = new Set();
  for (const d of dets) {
    const cfop = String(d?.prod?.CFOP || d?.prod?.cfop || '').trim();
    if (cfop) set.add(cfop);
  }
  return set.size ? [...set].join(',') : null;
}

async function ensureCfopColumn(client) {
  await client.query(`
    ALTER TABLE "Vendas".notas_fiscais_omie
      ADD COLUMN IF NOT EXISTS cfop VARCHAR(40);
  `);
}

async function fillFromPayload(client) {
  // Bulk: CFOP do 1º item (cobre a grande maioria das notas)
  const r1 = await client.query(`
    UPDATE "Vendas".notas_fiscais_omie
       SET cfop = NULLIF(TRIM(payload_ultimo #>> '{det,0,prod,CFOP}'), ''),
           updated_at = NOW()
     WHERE COALESCE(TRIM(cfop), '') = ''
       AND COALESCE(TRIM(payload_ultimo #>> '{det,0,prod,CFOP}'), '') <> ''
  `);

  // Ajuste leve: se houver 2º item com CFOP diferente, junta com vírgula
  const r2 = await client.query(`
    UPDATE "Vendas".notas_fiscais_omie
       SET cfop = TRIM(BOTH ',' FROM (
             COALESCE(NULLIF(TRIM(payload_ultimo #>> '{det,0,prod,CFOP}'), ''), '')
             || CASE
                  WHEN COALESCE(NULLIF(TRIM(payload_ultimo #>> '{det,1,prod,CFOP}'), ''), '') <> ''
                   AND COALESCE(NULLIF(TRIM(payload_ultimo #>> '{det,1,prod,CFOP}'), ''), '')
                       <> COALESCE(NULLIF(TRIM(payload_ultimo #>> '{det,0,prod,CFOP}'), ''), '')
                  THEN ',' || NULLIF(TRIM(payload_ultimo #>> '{det,1,prod,CFOP}'), '')
                  ELSE ''
                END
           )),
           updated_at = NOW()
     WHERE payload_ultimo->'det' IS NOT NULL
       AND jsonb_array_length(COALESCE(payload_ultimo->'det', '[]'::jsonb)) > 1
       AND COALESCE(NULLIF(TRIM(payload_ultimo #>> '{det,1,prod,CFOP}'), ''), '') <> ''
       AND COALESCE(NULLIF(TRIM(payload_ultimo #>> '{det,1,prod,CFOP}'), ''), '')
           <> COALESCE(NULLIF(TRIM(payload_ultimo #>> '{det,0,prod,CFOP}'), ''), '')
       AND (
         COALESCE(TRIM(cfop), '') = ''
         OR cfop = NULLIF(TRIM(payload_ultimo #>> '{det,0,prod,CFOP}'), '')
       )
  `);

  return { preenchidos: r1.rowCount || 0, multi_ajustados: r2.rowCount || 0 };
}

async function omieConsultarNF(param, tentativa = 1) {
  const res = await fetch(OMIE_NF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarNF',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [param],
    }),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}

  if (!res.ok) {
    const fault = String(json?.faultstring || text || '');
    const wait = fault.match(/Aguarde\s+(\d+)\s+segundos?/i);
    if (wait && tentativa <= 8) {
      const s = Number(wait[1]) + 3;
      console.warn(`  ⏳ rate-limit Omie — aguardando ${s}s...`);
      await sleep(s * 1000);
      return omieConsultarNF(param, tentativa + 1);
    }
    throw new Error(fault.slice(0, 280) || `HTTP ${res.status}`);
  }
  return json || {};
}

async function fillFromOmie(client) {
  let sql = `
    SELECT id, identidade, chave_nfe, id_nf_omie, numero_nota
      FROM "Vendas".notas_fiscais_omie
     WHERE COALESCE(TRIM(cfop), '') = ''
       AND tipo_documento = 'NFe'
       AND (
         COALESCE(TRIM(chave_nfe), '') <> ''
         OR id_nf_omie IS NOT NULL
         OR COALESCE(TRIM(numero_nota), '') <> ''
       )
     ORDER BY id
  `;
  const params = [];
  if (LIMITE) {
    params.push(LIMITE);
    sql += ` LIMIT $${params.length}`;
  }

  const { rows } = await client.query(sql, params);
  console.log(`Omie: ${rows.length} notas sem CFOP (delay ${DELAY_MS}ms)...`);

  const stats = { ok: 0, sem_cfop: 0, erro: 0 };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const param = {};
    const chave = String(row.chave_nfe || '').replace(/\D/g, '');
    if (chave) param.cChaveNFe = chave;
    else if (row.id_nf_omie) param.nIdNF = Number(row.id_nf_omie);
    else param.nNF = String(row.numero_nota).trim();

    try {
      await sleep(DELAY_MS);
      const nf = await omieConsultarNF(param);
      const cfop = extractCfopsFromNf(nf);
      if (!cfop) {
        stats.sem_cfop += 1;
        console.log(`  [${i + 1}/${rows.length}] sem CFOP id=${row.id} nota=${row.numero_nota}`);
        continue;
      }
      await client.query(
        `UPDATE "Vendas".notas_fiscais_omie
            SET cfop = $1, updated_at = NOW()
          WHERE id = $2
            AND COALESCE(TRIM(cfop), '') = ''`,
        [cfop, row.id]
      );
      stats.ok += 1;
      if ((i + 1) % 25 === 0 || i === 0 || i === rows.length - 1) {
        console.log(`  progresso ${i + 1}/${rows.length} | ok=${stats.ok} sem=${stats.sem_cfop} err=${stats.erro}`);
      }
    } catch (err) {
      stats.erro += 1;
      console.error(`  ERRO id=${row.id}:`, String(err.message || err).slice(0, 200));
    }
  }
  return stats;
}

async function main() {
  const host = (() => {
    try { return new URL(DATABASE_URL).hostname; } catch (_) { return '?'; }
  })();
  if (/localhost|127\.0\.0\.1/i.test(host)) {
    console.error('ABORT: não use banco local para este backfill.');
    process.exit(1);
  }
  console.log('DB:', host);

  const client = await pool.connect();
  try {
    await ensureCfopColumn(client);
    console.log('Coluna cfop garantida.');

    console.log('Passo 1/2: extraindo CFOP do payload local...');
    const fromPayload = await fillFromPayload(client);
    console.log(`  payload: preenchidos=${fromPayload.preenchidos} multi_ajustados=${fromPayload.multi_ajustados}`);

    if (SOMENTE_PAYLOAD) {
      console.log('Modo --somente-payload: fim.');
    } else {
      console.log('Passo 2/2: ConsultarNF na Omie para as restantes...');
      const fromOmie = await fillFromOmie(client);
      console.log('  omie:', fromOmie);
    }

    const { rows: resumo } = await client.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE COALESCE(TRIM(cfop),'') <> '')::int AS com_cfop,
             COUNT(*) FILTER (WHERE COALESCE(TRIM(cfop),'') = '')::int AS sem_cfop
        FROM "Vendas".notas_fiscais_omie
    `);
    console.log('Resumo final:', resumo[0]);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
