/**
 * utils/etqRecImpressoBackfill.js
 * Garante catálogo Endereço_pp (inventário) e preenche codigo/descricao em ETQ_rec_impresso.
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

async function garantirEnderecoPp(conn, csvPath) {
  await conn.query('CREATE SCHEMA IF NOT EXISTS logistica');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS logistica."Endereço_pp" (
      id            SERIAL PRIMARY KEY,
      codigo_produto BIGINT,
      codigo        TEXT,
      descricao     TEXT,
      completo      TEXT,
      rua           TEXT,
      andar         TEXT,
      edificio      TEXT,
      apartamento   TEXT
    )
  `);

  const { rows: cnt } = await conn.query(`SELECT COUNT(*)::int AS n FROM logistica."Endereço_pp"`);
  if (cnt[0].n > 0) return 0;

  const resolved = resolveInventarioCsv(csvPath);
  if (!resolved) {
    console.warn('[etiqueta] CSV inventário não encontrado — Endereço_pp vazio.');
    return 0;
  }

  const records = await new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(resolved)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }))
      .on('data', (row) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve(rows));
  });

  const BATCH = 150;
  const COLS = 8;
  let inseridos = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const lote = records.slice(i, i + BATCH);
    const ph = lote.map((_, idx) => {
      const b = idx * COLS;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
    }).join(',');
    const flat = lote.flatMap((row) => [
      row.codigo_produto ? String(row.codigo_produto).trim() : null,
      row.codigo || null,
      row.descricao || null,
      row.completo || null,
      row.rua || null,
      row.andar || null,
      row.edificio || null,
      row.apartamento || null,
    ]);
    await conn.query(
      `INSERT INTO logistica."Endereço_pp"
         (codigo_produto, codigo, descricao, completo, rua, andar, edificio, apartamento)
       VALUES ${ph}`,
      flat
    );
    inseridos += lote.length;
  }
  console.log(`[etiqueta] Endereço_pp carregado de ${path.basename(resolved)}: ${inseridos} registro(s)`);
  return inseridos;
}

async function backfillEtqRecImpresso(conn) {
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

  const ep = await conn.query(`
    UPDATE etiqueta."ETQ_rec_impresso" i
       SET codigo_produto = COALESCE(NULLIF(TRIM(i.codigo_produto), ''), ep.codigo_produto::text),
           descricao_produto = COALESCE(
             NULLIF(TRIM(i.descricao_produto), ''),
             NULLIF(TRIM(ep.descricao), '')
           )
      FROM logistica."Endereço_pp" ep
     WHERE TRIM(COALESCE(i.endereco, '')) = TRIM(ep.completo)
       AND ep.codigo_produto IS NOT NULL
       AND (
         NULLIF(TRIM(i.codigo_produto), '') IS NULL
         OR NULLIF(TRIM(i.descricao_produto), '') IS NULL
       )
  `).catch(() => ({ rowCount: 0 }));
  total += ep.rowCount || 0;

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
  garantirEnderecoPp,
  backfillEtqRecImpresso,
};
