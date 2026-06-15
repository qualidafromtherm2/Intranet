#!/usr/bin/env node
/**
 * Atualiza URLs gravadas no Postgres: Supabase → R2 (ou novo STORAGE_PUBLIC_BASE_URL).
 *
 * Requisitos: DATABASE_URL + R2_PUBLIC_BASE_URL
 *
 * Uso:
 *   DRY_RUN=1 node scripts/atualizar_urls_storage_no_banco.js   # só mostra contagens
 *   node scripts/atualizar_urls_storage_no_banco.js               # aplica
 */
require('dotenv').config();
const { dbQuery, isDbEnabled } = require('../src/db');
const { R2_PUBLIC_BASE_URL, isR2Configured } = require('../utils/storage');

const DRY_RUN = ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN || '').toLowerCase());

const SUPABASE_HOST = (() => {
  try {
    return new URL(process.env.SUPABASE_URL || 'https://placeholder.supabase.co').host;
  } catch {
    return 'supabase.co';
  }
})();

const OLD_PREFIX = `https://${SUPABASE_HOST}/storage/v1/object/public/`;
const NEW_PREFIX = String(R2_PUBLIC_BASE_URL || process.env.STORAGE_PUBLIC_BASE_URL || '').replace(/\/$/, '') + '/';
const LIKE = `%${SUPABASE_HOST}%`;

const UPDATES = [
  { label: 'fotos produto', table: 'public.produtos_omie_imagens', column: 'url_imagem' },
  { label: 'anexos produto', table: 'public.produtos_omie_anexos', column: 'url_anexo' },
  { label: 'foto perfil', table: 'public.auth_user', column: 'foto_perfil_url' },
  { label: 'anexos AT', table: 'sac.at_anexos', column: 'url_publica' },
  { label: 'NFe fechamento', table: 'sac.fechamento', column: 'nfe_url' },
  { label: 'foto RI', table: 'qualidade.ri', column: 'foto_url' },
  { label: 'foto PIR', table: 'qualidade.pir', column: 'foto_url' },
];

async function main() {
  if (!isDbEnabled) {
    console.error('DATABASE_URL não configurada.');
    process.exit(1);
  }
  if (!NEW_PREFIX || NEW_PREFIX === '/') {
    console.error('Configure R2_PUBLIC_BASE_URL antes de rodar.');
    process.exit(1);
  }

  console.log(`[urls] ${DRY_RUN ? 'DRY_RUN' : 'APLICAR'}`);
  console.log(`[urls] De: ${OLD_PREFIX}`);
  console.log(`[urls] Para: ${NEW_PREFIX}`);

  for (const { label, table, column } of UPDATES) {
    const countRes = await dbQuery(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} LIKE $1`,
      [LIKE]
    );
    const n = countRes.rows[0]?.n || 0;
    console.log(`  ${label}: ${n} registro(s)`);
    if (!DRY_RUN && n > 0) {
      await dbQuery(
        `UPDATE ${table} SET ${column} = REPLACE(${column}, $1, $2) WHERE ${column} LIKE $3`,
        [OLD_PREFIX, NEW_PREFIX, LIKE]
      );
      console.log('    → atualizado');
    }
  }

  console.log('[urls] Concluído.');
}

main().catch((err) => {
  console.error('[urls] Erro:', err);
  process.exit(1);
});
