// scripts/import_prep_to_pg.js
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const KANBAN_PREP_PATH = path.join(__dirname, '..', 'data', 'kanban_preparacao.json');

// conecta no Postgres do Render
if (!process.env.DATABASE_URL) {
  console.error('Faltou DATABASE_URL no ambiente. Abortei.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// util: separa "Status,OP,(carimbos...)" → { status, op }
function parseLocalEntry(s) {
  const m = String(s).match(/^([^,]+)\s*,\s*([^,]+)(?:,.*)?$/);
  return m ? { status: m[1].trim(), op: m[2].trim() } : { status: '', op: '' };
}

(async () => {
  try {
    // 1) lê o JSON local
    const raw = fs.readFileSync(KANBAN_PREP_PATH, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('JSON inválido (esperado array).');

    // 2) prepara UPSERT
    const upsertSQL = `
      INSERT INTO public.op_status (op, produto_codigo, status)
      VALUES ($1,$2,$3)
      ON CONFLICT (op) DO UPDATE
        SET status         = EXCLUDED.status,
            updated_at     = now(),
            produto_codigo = COALESCE(op_status.produto_codigo, EXCLUDED.produto_codigo)
    `;

    let totalLidas = 0;
    let totalUpserts = 0;

    for (const item of arr) {
      const produto = String(item?.codigo || 'DESCONHECIDO').trim();
      const locais  = Array.isArray(item?.local) ? item.local : [];
      for (const s of locais) {
        const { status, op } = parseLocalEntry(s);
        if (!status || !op) continue;
        totalLidas++;

        // valida status (só migra os 3 usados)
        if (!['Fila de produção', 'Em produção', 'No estoque'].includes(status)) continue;

        await pool.query(upsertSQL, [op, produto, status]);
        totalUpserts++;
      }
    }

    console.log(`OK. Linhas lidas: ${totalLidas}. OPs upsertadas: ${totalUpserts}.`);
  } catch (err) {
    console.error('Falha na importação:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
