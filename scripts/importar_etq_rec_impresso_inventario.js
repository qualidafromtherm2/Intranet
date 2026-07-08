/**
 * scripts/importar_etq_rec_impresso_inventario.js
 *
 * Zera etiqueta."ETQ_rec_impresso" e repopula somente com o CSV de inventário
 * (produtos × endereços). Campos ausentes no CSV seguem a lógica da migração
 * endereco_pp: unidade UN, data_emissao hoje, complemento = apartamento, etc.
 * qtd fica NULL (vazio).
 *
 * Uso:
 *   node scripts/importar_etq_rec_impresso_inventario.js
 *   node scripts/importar_etq_rec_impresso_inventario.js "/caminho/arquivo.csv"
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { Pool } = require('pg');

const { resolveInventarioCsv } = require('../utils/etqRecImpressoBackfill');

const CSV_PATH = resolveInventarioCsv(process.argv[2]);

const BATCH_SIZE = 150;
const COLS = 7; // por linha no INSERT (qtd fica NULL fixo no SQL)

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_INTERNAL_URL,
  ssl: { rejectUnauthorized: false },
});

async function lerCsv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`CSV não encontrado: ${filePath || '(nenhum caminho)'}`);
  }
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        relax_quotes: true,
      }))
      .on('data', (row) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve(rows));
  });
}

function mapRow(row) {
  const codigoProduto = row.codigo_produto != null && String(row.codigo_produto).trim() !== ''
    ? String(row.codigo_produto).trim()
    : null;
  const descricao = row.descricao != null ? String(row.descricao).trim() : '';
  const completo = row.completo != null ? String(row.completo).trim() : '';
  const apartamento = row.apartamento != null ? String(row.apartamento).trim() : '';

  if (!codigoProduto || !completo) return null;

  return {
    endereco: completo,
    codigo_produto: codigoProduto,
    descricao_produto: descricao || null,
    complemento: apartamento || null,
  };
}

async function inserirLote(client, lote) {
  if (!lote.length) return 0;
  const valuePlaceholders = lote
    .map((_, i) => {
      const b = i * COLS;
      return `($${b + 1}::text,$${b + 2}::text,$${b + 3}::text,$${b + 4}::text,$${b + 5}::text,$${b + 6}::text,$${b + 7}::text)`;
    })
    .join(',');
  const flatValues = lote.flatMap((r) => [
    r.endereco,
    r.codigo_produto,
    r.descricao_produto,
    r.complemento,
    'UN',
    '',   // conteudo_zpl
    'importacao_inventario_fromtherm',
  ]);
  await client.query(
    `INSERT INTO etiqueta."ETQ_rec_impresso"
       (endereco, codigo_produto, descricao_produto, complemento,
        unidade, qtd, conteudo_zpl, usuario_criacao,
        origem_id, data_emissao, fonte)
     SELECT v.endereco, v.codigo_produto, v.descricao_produto, v.complemento,
            v.unidade, NULL::numeric, v.conteudo_zpl, v.usuario_criacao,
            NULL,
            to_char(CURRENT_DATE, 'DD/MM/YYYY'),
            'inventario_fromtherm'
       FROM (VALUES ${valuePlaceholders}) AS v(
         endereco, codigo_produto, descricao_produto, complemento,
         unidade, conteudo_zpl, usuario_criacao
       )`,
    flatValues
  );
  return lote.length;
}

async function main() {
  if (!CSV_PATH) {
    throw new Error('CSV de inventário não encontrado. Informe o caminho ou versione produtos/inventario_produtos_enderecos.csv');
  }
  console.log(`CSV: ${CSV_PATH}`);
  const raw = await lerCsv(CSV_PATH);
  console.log(`Linhas lidas no CSV: ${raw.length}`);

  const records = raw.map(mapRow).filter(Boolean);
  const ignoradas = raw.length - records.length;
  if (ignoradas > 0) {
    console.warn(`Linhas ignoradas (sem codigo_produto ou endereço): ${ignoradas}`);
  }
  if (!records.length) {
    throw new Error('Nenhum registro válido para importar.');
  }

  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE etiqueta."ETQ_rec_impresso" ADD COLUMN IF NOT EXISTS codigo_produto TEXT`);
    await client.query(`ALTER TABLE etiqueta."ETQ_rec_impresso" ADD COLUMN IF NOT EXISTS descricao_produto TEXT`);
    await client.query(`ALTER TABLE etiqueta."ETQ_rec_impresso" ADD COLUMN IF NOT EXISTS fonte TEXT DEFAULT 'recebimento'`);
    await client.query(`ALTER TABLE etiqueta."ETQ_rec_impresso" ADD COLUMN IF NOT EXISTS endereco TEXT`);
    await client.query(`ALTER TABLE etiqueta."ETQ_rec_impresso" ADD COLUMN IF NOT EXISTS complemento TEXT`);

    await client.query('BEGIN');

    const del = await client.query('DELETE FROM etiqueta."ETQ_rec_impresso"');
    console.log(`Registros removidos: ${del.rowCount}`);

    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('etiqueta."ETQ_rec_impresso"', 'id'),
        1,
        false
      )
    `).catch(() => {});

    let inseridos = 0;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const lote = records.slice(i, i + BATCH_SIZE);
      inseridos += await inserirLote(client, lote);
      process.stdout.write(`\rInseridos: ${inseridos}/${records.length}`);
    }
    console.log('');

    await client.query(`
      INSERT INTO etiqueta."_meta" (chave, valor)
      VALUES ('etq_rec_impresso_inventario_v1', 'done')
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor
    `);

    const { rows: chk } = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE qtd IS NULL)::int AS qtd_nula,
              COUNT(DISTINCT endereco)::int AS enderecos,
              COUNT(*) FILTER (WHERE codigo_produto IS NULL OR TRIM(codigo_produto) = '')::int AS sem_codigo,
              COUNT(*) FILTER (WHERE descricao_produto IS NULL OR TRIM(descricao_produto) = '')::int AS sem_descricao
         FROM etiqueta."ETQ_rec_impresso"`
    );
    console.log('Verificação:', chk[0]);
    if (chk[0].sem_codigo > 0) {
      throw new Error(
        `Importação inconsistente: ${chk[0].sem_codigo} registro(s) sem codigo_produto. ` +
        'Execute node scripts/backfill_etq_rec_impresso_produto.js'
      );
    }

    await client.query('COMMIT');
    console.log(`Concluído: ${inseridos} registro(s) em etiqueta."ETQ_rec_impresso".`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
