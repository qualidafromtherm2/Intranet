/**
 * utils/etqRecImpressoBackfill.js
 * Preenche codigo/descricao em ETQ_rec_impresso (recebimento, ZPL, CSV inventário).
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');

const INVENTARIO_CSV_REL = path.join(__dirname, '..', 'produtos', 'inventario_produtos_enderecos.csv');

function resolveInventarioCsv(csvPath) {
  const candidates = [
    csvPath,
    process.env.ETQ_INVENTARIO_CSV,
    INVENTARIO_CSV_REL,
    path.join(process.env.HOME || '/home/leandro', 'Downloads', 'INVENTARIO FROMTHERM - produtos_enderecos (1).csv'),
    path.join(process.env.HOME || '/home/leandro', 'Downloads', 'INVENTARIO FROMTHERM - produtos_enderecos.csv'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function lerInventarioCsv(csvPath) {
  const resolved = resolveInventarioCsv(csvPath);
  if (!resolved) return { path: null, records: [] };
  const records = await new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(resolved)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }))
      .on('data', (row) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve(rows));
  });
  return { path: resolved, records };
}

/** Backfill ETQ_rec_impresso a partir do CSV de inventário (endereço → produto). */
async function backfillFromInventarioCsv(conn, csvPath) {
  const { path: resolved, records } = await lerInventarioCsv(csvPath);
  if (!records.length) {
    if (!resolved) {
      console.warn('[etiqueta] CSV inventário não encontrado — backfill por endereço ignorado.');
    }
    return 0;
  }

  const valid = records
    .map((row) => ({
      endereco: String(row.completo || '').trim(),
      codigo_produto: row.codigo_produto != null ? String(row.codigo_produto).trim() : '',
      descricao: String(row.descricao || '').trim(),
      complemento: String(row.apartamento || '').trim() || null,
    }))
    .filter((r) => r.endereco && r.codigo_produto);

  const BATCH = 150;
  const COLS = 4;
  let total = 0;

  for (let i = 0; i < valid.length; i += BATCH) {
    const lote = valid.slice(i, i + BATCH);
    const ph = lote.map((_, idx) => {
      const b = idx * COLS;
      return `($${b + 1}::text,$${b + 2}::text,$${b + 3}::text,$${b + 4}::text)`;
    }).join(',');
    const flat = lote.flatMap((r) => [
      r.endereco,
      r.codigo_produto,
      r.descricao || null,
      r.complemento,
    ]);
    const res = await conn.query(
      `UPDATE etiqueta."ETQ_rec_impresso" i
          SET codigo_produto = COALESCE(NULLIF(TRIM(i.codigo_produto), ''), v.codigo_produto),
              descricao_produto = COALESCE(
                NULLIF(TRIM(i.descricao_produto), ''),
                NULLIF(TRIM(v.descricao), '')
              ),
              complemento = COALESCE(
                NULLIF(TRIM(i.complemento), ''),
                NULLIF(TRIM(v.complemento), '')
              )
         FROM (VALUES ${ph}) AS v(endereco, codigo_produto, descricao, complemento)
        WHERE TRIM(COALESCE(i.endereco, '')) = TRIM(v.endereco)
          AND (
            NULLIF(TRIM(i.codigo_produto), '') IS NULL
            OR NULLIF(TRIM(i.descricao_produto), '') IS NULL
          )`,
      flat
    );
    total += res.rowCount || 0;
  }

  if (total > 0) {
    console.log(`[etiqueta] Backfill inventário (${path.basename(resolved)}): ${total} registro(s)`);
  }
  return total;
}

async function backfillEtqRecImpresso(conn, csvPath) {
  let total = 0;

  const rec = await conn.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = COALESCE(NULLIF(TRIM(i.codigo_produto), ''), p.codigo_produto::text),
           descricao_produto = COALESCE(
             NULLIF(TRIM(i.descricao_produto), ''),
             NULLIF(TRIM(p.descricao), ''),
             NULLIF(TRIM(r.descricao_produto), '')
           )
      FROM etiqueta."ETQ_recebimento" r
      JOIN public.produtos_omie p ON TRIM(p.codigo) = TRIM(r.codigo_produto)
     WHERE r.id = i.origem_id
       AND (
         NULLIF(TRIM(i.codigo_produto), '') IS NULL
         OR NULLIF(TRIM(i.descricao_produto), '') IS NULL
       )
  `);
  total += rec.rowCount || 0;

  const zpl = await conn.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = p.codigo_produto::text,
           descricao_produto = COALESCE(
             NULLIF(TRIM(i.descricao_produto), ''),
             NULLIF(TRIM(p.descricao), '')
           )
      FROM public.produtos_omie p
     WHERE (i.codigo_produto IS NULL OR TRIM(i.codigo_produto) = '')
       AND i.conteudo_zpl IS NOT NULL
       AND TRIM(i.conteudo_zpl) <> ''
       AND TRIM(SUBSTRING(i.conteudo_zpl FROM 'Cod\\. Produto: ([^\\^\\n\\r]+)')) <> ''
       AND TRIM(p.codigo) = TRIM(SUBSTRING(i.conteudo_zpl FROM 'Cod\\. Produto: ([^\\^\\n\\r]+)'))
       AND p.codigo_produto IS NOT NULL
  `);
  total += zpl.rowCount || 0;

  total += await backfillFromInventarioCsv(conn, csvPath);

  const fix = await conn.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = p.codigo_produto::text,
           descricao_produto = COALESCE(NULLIF(TRIM(i.descricao_produto), ''), NULLIF(TRIM(p.descricao), ''))
      FROM public.produtos_omie p
     WHERE TRIM(i.codigo_produto) = TRIM(p.codigo)
       AND p.codigo_produto IS NOT NULL
       AND TRIM(i.codigo_produto) <> TRIM(p.codigo_produto::text)
  `);
  total += fix.rowCount || 0;

  return total;
}

module.exports = {
  INVENTARIO_CSV_REL,
  resolveInventarioCsv,
  lerInventarioCsv,
  backfillFromInventarioCsv,
  backfillEtqRecImpresso,
};
