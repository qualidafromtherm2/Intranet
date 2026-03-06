#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');

if (!globalThis.fetch) {
  globalThis.fetch = require('node-fetch');
}

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/recebimentonfe/';
const OMIE_DELAY_MS = 350; // 3 req/s

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = { limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const token = String(argv[i] || '');
    if (token === '--limit' && argv[i + 1]) {
      args.limit = Math.max(0, Number(argv[i + 1]) || 0);
      i++;
    }
  }
  return args;
}

async function consultarRecebimentoOmie(nIdReceb) {
  const resp = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarRecebimento',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [{ nIdReceb: Number(nIdReceb) }]
    })
  });

  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = null;
  }

  if (!resp.ok) {
    const msg = (json && (json.faultstring || json.error)) || text || `HTTP ${resp.status}`;
    throw new Error(`nIdReceb=${nIdReceb} -> ${msg}`);
  }

  return json || {};
}

async function run() {
  const { limit } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL ausente no ambiente');
  }
  if (!process.env.OMIE_APP_KEY || !process.env.OMIE_APP_SECRET) {
    throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET ausentes no ambiente');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  let total = 0;
  let atualizados = 0;
  let semChave = 0;
  let erros = 0;

  try {
    const limitSql = limit > 0 ? `LIMIT ${Math.floor(limit)}` : '';
    const { rows } = await pool.query(`
      SELECT n_id_receb
      FROM logistica.notas_entrada_omie
      WHERE c_chave_nfe IS NULL OR BTRIM(c_chave_nfe) = ''
      ORDER BY updated_at DESC NULLS LAST, n_id_receb DESC
      ${limitSql}
    `);

    total = rows.length;
    console.log(`[backfill-chave-nfe] Registros alvo: ${total}`);
    if (!total) return;

    for (let i = 0; i < rows.length; i++) {
      const nIdReceb = Number(rows[i].n_id_receb);
      try {
        const receb = await consultarRecebimentoOmie(nIdReceb);
        const chave = String(receb?.cabec?.cChaveNFe || receb?.cabec?.cChaveNfe || '').trim();

        if (!chave) {
          semChave++;
        } else {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(`
              UPDATE logistica.recebimentos_nfe_omie
              SET c_chave_nfe = $2,
                  updated_at = NOW()
              WHERE n_id_receb = $1
                AND (c_chave_nfe IS NULL OR BTRIM(c_chave_nfe) = '')
            `, [nIdReceb, chave]);

            await client.query(`
              UPDATE logistica.notas_entrada_omie
              SET c_chave_nfe = $2,
                  c_ultimo_topico = 'backfill.chave_nfe',
                  updated_at = NOW()
              WHERE n_id_receb = $1
                AND (c_chave_nfe IS NULL OR BTRIM(c_chave_nfe) = '')
            `, [nIdReceb, chave]);

            await client.query(`
              INSERT INTO logistica.notas_entrada_omie_eventos (
                n_id_receb, c_chave_nfe, topic, c_status, origem_evento,
                payload, recebido_em, processado_em, processado_com_sucesso
              )
              VALUES ($1, $2, 'backfill.chave_nfe', 'Alterada', 'omie_sync',
                      $3::jsonb, NOW(), NOW(), TRUE)
            `, [nIdReceb, chave, JSON.stringify({ n_id_receb: nIdReceb, c_chave_nfe: chave })]);

            await client.query('COMMIT');
            atualizados++;
          } catch (e) {
            await client.query('ROLLBACK');
            throw e;
          } finally {
            client.release();
          }
        }

        if ((i + 1) % 20 === 0 || i + 1 === rows.length) {
          console.log(`[backfill-chave-nfe] Progresso ${i + 1}/${total} | atualizados=${atualizados} | sem_chave=${semChave} | erros=${erros}`);
        }
      } catch (err) {
        erros++;
        console.error(`[backfill-chave-nfe] Erro no nIdReceb=${nIdReceb}: ${err.message || err}`);
      }

      await sleep(OMIE_DELAY_MS);
    }
  } finally {
    await pool.end();
  }

  console.log('[backfill-chave-nfe] Concluído:', { total, atualizados, semChave, erros });
}

run().catch(err => {
  console.error('[backfill-chave-nfe] Falha geral:', err.message || err);
  process.exit(1);
});
