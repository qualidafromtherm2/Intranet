/**
 * Preenche envios.solicitacoes.valor_envio a partir do VIPP (ValorDaPostagem)
 * para registros que já têm código de rastreio (identificacao) e ainda não têm valor.
 *
 * Uso: node scripts/backfill_valor_envio_vipp.js
 *      node scripts/backfill_valor_envio_vipp.js --limit 30
 */

require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const VIPP_USUARIO = process.env.VIPP_USUARIO || 'onbiws';
const VIPP_TOKEN = String(process.env.VIPP_TOKEN || '').trim();
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Math.max(1, parseInt(process.argv[i + 1], 10) || 50) : 80;
})();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_CONNECTION,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

async function buscarValor(ect) {
  const resp = await axios({
    method: 'get',
    url: 'http://vpsrv.visualset.com.br/api/v1/conhecimento/GetSituacaoPostagem',
    params: {
      usuario: VIPP_USUARIO,
      senha: VIPP_TOKEN,
      StDadosCompletos: 1,
      BuscarPor: 'EtiquetaPostagem',
    },
    data: [ect],
    headers: { 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  const s = (resp.data?.SituacaoPostagem || [])[0] || {};
  const post = s.PostagensRastreio || {};
  const raw = s.ValorDaPostagem ?? post.ValorPostagem ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

async function main() {
  if (!VIPP_TOKEN) throw new Error('VIPP_TOKEN ausente no .env');
  await pool.query(`ALTER TABLE envios.solicitacoes ADD COLUMN IF NOT EXISTS valor_envio NUMERIC(12,2)`);

  const { rows } = await pool.query(
    `SELECT id, identificacao
       FROM envios.solicitacoes
      WHERE valor_envio IS NULL
        AND NULLIF(TRIM(identificacao), '') IS NOT NULL
      ORDER BY id DESC
      LIMIT $1`,
    [LIMIT]
  );
  console.log(`[backfill valor_envio] candidatos: ${rows.length}`);

  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    const ect = String(r.identificacao || '').trim().replace(/\s+/g, '');
    try {
      const valor = await buscarValor(ect);
      if (valor == null) {
        console.log(`  #${r.id} ${ect} → sem valor`);
        fail += 1;
        continue;
      }
      await pool.query(
        `UPDATE envios.solicitacoes SET valor_envio = $1 WHERE id = $2 AND valor_envio IS NULL`,
        [valor, r.id]
      );
      console.log(`  #${r.id} ${ect} → R$ ${valor.toFixed(2)}`);
      ok += 1;
    } catch (e) {
      console.warn(`  #${r.id} ${ect} ERRO:`, e.message);
      fail += 1;
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  console.log(`[backfill valor_envio] ok=${ok} falha/sem=${fail}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
