#!/usr/bin/env node
/**
 * Revisa e corrige endereco/numero/bairro/complemento de todos os técnicos.
 * Uso: node scripts/corrigir_endereco_controle_tecnicos.js [--dry-run]
 */
require('dotenv').config();
const { pool } = require('../src/db');
const { corrigirCamposEnderecoTecnico } = require('../utils/tecnicoEndereco');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (!pool) {
    console.error('DATABASE_URL não configurada.');
    process.exit(1);
  }

  const { rows } = await pool.query(
    `SELECT id, nome, endereco, numero, bairro, complemento, cep, municipio, uf
       FROM sac.controle_tecnicos
      ORDER BY id`
  );

  let alterados = 0;
  for (const row of rows) {
    const corrigido = corrigirCamposEnderecoTecnico(row);
    const mudou =
      (row.endereco || '') !== (corrigido.endereco || '') ||
      (row.numero || '') !== (corrigido.numero || '') ||
      (row.bairro || '') !== (corrigido.bairro || '') ||
      (row.complemento || '') !== (corrigido.complemento || '');

    if (!mudou) continue;
    alterados += 1;

    console.log(`\n#${row.id} ${row.nome}`);
    console.log('  ANTES:', {
      endereco: row.endereco,
      numero: row.numero,
      bairro: row.bairro,
      complemento: row.complemento,
    });
    console.log('  DEPOIS:', corrigido);

    if (!dryRun) {
      await pool.query(
        `UPDATE sac.controle_tecnicos
            SET endereco = $1, numero = $2, bairro = $3, complemento = $4
          WHERE id = $5`,
        [
          corrigido.endereco,
          corrigido.numero,
          corrigido.bairro,
          corrigido.complemento,
          row.id,
        ]
      );
    }
  }

  console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Registros corrigidos: ${alterados} de ${rows.length}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) { /* ignore */ }
  process.exit(1);
});
