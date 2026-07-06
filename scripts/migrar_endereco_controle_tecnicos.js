#!/usr/bin/env node
/**
 * Cria colunas numero/bairro/complemento em sac.controle_tecnicos
 * e distribui dados do campo endereco legado.
 *
 * Uso: node scripts/migrar_endereco_controle_tecnicos.js
 */
require('dotenv').config();
const { pool } = require('../src/db');
const { parseEnderecoTecnicoLegado } = require('../utils/tecnicoEndereco');

async function garantirColunas() {
  await pool.query(`
    DO $controle$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'controle_tecnicos'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'sac' AND table_name = 'controle_tecnicos'
      ) THEN
        ALTER TABLE public.controle_tecnicos SET SCHEMA sac;
      END IF;
    END $controle$;

    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS numero TEXT;
    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS bairro TEXT;
    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS complemento TEXT;
  `);
}

async function listarColunas() {
  const { rows } = await pool.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'sac' AND table_name = 'controle_tecnicos'
      ORDER BY ordinal_position`
  );
  return rows;
}

async function migrarDados() {
  const { rows } = await pool.query(
    `SELECT id, endereco, numero, bairro, complemento
       FROM sac.controle_tecnicos
      WHERE endereco IS NOT NULL
        AND BTRIM(endereco) <> ''
        AND BTRIM(COALESCE(numero, '')) = ''
        AND BTRIM(COALESCE(bairro, '')) = ''
        AND BTRIM(COALESCE(complemento, '')) = ''
        AND (
          endereco LIKE '%,%'
          OR endereco LIKE '% - %'
          OR endereco ~ '\\([^)]+\\)\\s*$'
        )`
  );

  let migrated = 0;
  for (const row of rows) {
    const parsed = parseEnderecoTecnicoLegado(row.endereco);
    await pool.query(
      `UPDATE sac.controle_tecnicos
          SET endereco = $1, numero = $2, bairro = $3, complemento = $4
        WHERE id = $5`,
      [
        parsed.endereco || row.endereco,
        parsed.numero || null,
        parsed.bairro || null,
        parsed.complemento || null,
        row.id,
      ]
    );
    migrated += 1;
  }
  return migrated;
}

async function main() {
  if (!pool) {
    console.error('DATABASE_URL não configurada. Defina no .env ou no ambiente.');
    process.exit(1);
  }

  console.log('Garantindo colunas numero, bairro, complemento...');
  await garantirColunas();

  const cols = await listarColunas();
  const nomes = cols.map((c) => c.column_name);
  console.log('Colunas em sac.controle_tecnicos:', nomes.join(', '));

  const faltando = ['numero', 'bairro', 'complemento'].filter((c) => !nomes.includes(c));
  if (faltando.length) {
    console.error('Falha: colunas não criadas:', faltando.join(', '));
    process.exit(1);
  }

  const migrated = await migrarDados();
  console.log(`Migração concluída. Registros atualizados: ${migrated}`);

  const { rows: amostra } = await pool.query(
    `SELECT id, nome, endereco, numero, bairro, complemento
       FROM sac.controle_tecnicos
      WHERE BTRIM(COALESCE(numero, '')) <> '' OR BTRIM(COALESCE(complemento, '')) <> ''
      ORDER BY id DESC
      LIMIT 5`
  );
  if (amostra.length) {
    console.log('\nAmostra:');
    amostra.forEach((r) => {
      console.log(`  #${r.id} ${r.nome}`);
      console.log(`    rua: ${r.endereco}`);
      console.log(`    nº: ${r.numero || '-'} | bairro: ${r.bairro || '-'} | compl: ${r.complemento || '-'}`);
    });
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* ignore */ }
  process.exit(1);
});
