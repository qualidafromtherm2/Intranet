/**
 * Importa registros da aba "Atendimentos Gerais" (gid=1804958693) para sac.at
 *
 * Colunas disponíveis nessa aba (subconjunto da aba principal):
 *   PROTC., DATA, TIPO, CONTATO WPP, CLIENTE, UF, REVENDA,
 *   IDENTIFICAÇÃO, RECLAMAÇÃO, TAG DO PROBLEMA, AÇÃO CORRETIVA,
 *   PLATAFORMA DO ATENDIMENTO
 *
 * Uso:
 *   node scripts/importar_at_geral.js            (executa importação)
 *   node scripts/importar_at_geral.js --dry-run  (só conta, não insere)
 */

require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');
const { parse } = require('csv-parse/sync');

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI/export?format=csv&gid=1804958693';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 500;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baixarCSV(url) {
  return new Promise((resolve, reject) => {
    const go = (u) => {
      https.get(u, { headers: { 'User-Agent': 'nodejs-import' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
          return go(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      }).on('error', reject);
    };
    go(url);
  });
}

function limpar(v) {
  return (v || '').trim() || null;
}

function parseData(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}T00:00:00`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('⬇  Baixando planilha Atendimentos Gerais…');
  const csvText = await baixarCSV(SHEET_URL);

  const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`   ${rows.length} linhas encontradas`);

  // PROTC. já existentes no banco
  const { rows: existentes } = await pool.query(
    `SELECT atendimento_inicial FROM sac.at WHERE atendimento_inicial IS NOT NULL`
  );
  const jaExistem = new Set(existentes.map(r => String(r.atendimento_inicial).trim()));
  console.log(`   ${jaExistem.size} PROTC. já existem no banco (serão pulados)\n`);

  if (DRY_RUN) console.log('⚠  Modo DRY-RUN — nenhuma inserção será feita.\n');

  // Prepara registros a inserir
  const registros = [];
  let pulados = 0;

  for (const row of rows) {
    const protc = (row['PROTC.'] || '').trim();
    if (!protc) { pulados++; continue; }
    if (jaExistem.has(protc)) { pulados++; continue; }

    registros.push({
      data:                    parseData(row['DATA']) || new Date(),
      tipo:                    limpar(row['TIPO']),
      nome_revenda_cliente:    limpar(row['CLIENTE']),
      numero_telefone:         limpar(row['CONTATO WPP']),
      estado:                  limpar(row['UF']),
      descreva_reclamacao:     limpar(row['RECLAMAÇÃO']),
      tag_problema:            limpar(row['TAG DO PROBLEMA']),
      motivo_solicitacao:      limpar(row['TAG DO PROBLEMA']),
      plataforma_atendimento:  limpar(row['PLATAFORMA DO ATENDIMENTO']),
      modelo:                  limpar(row['IDENTIFICAÇÃO']),
      atendimento_inicial:     protc,
    });
  }

  console.log(`📊 A inserir : ${registros.length}`);
  console.log(`   Pulados   : ${pulados} (já existiam ou sem PROTC.)`);

  if (DRY_RUN) {
    if (registros.length > 0) {
      console.log('\nAmostra (primeiros 3):');
      registros.slice(0,3).forEach(r =>
        console.log(`  PROTC.=${r.atendimento_inicial} tipo=${r.tipo} cliente=${r.nome_revenda_cliente}`)
      );
    }
    console.log('\n──────────────────────────────');
    console.log(`✅ Seriam inseridos: ${registros.length}`);
    console.log('(Dry-run: nada gravado)');
    console.log('──────────────────────────────');
    await pool.end();
    return;
  }

  // Inserção em lotes via unnest
  let inseridos = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (let i = 0; i < registros.length; i += BATCH_SIZE) {
      const lote = registros.slice(i, i + BATCH_SIZE);

      const datas   = lote.map(r => r.data);
      const tipos   = lote.map(r => r.tipo);
      const clientes= lote.map(r => r.nome_revenda_cliente);
      const tels    = lote.map(r => r.numero_telefone);
      const estados = lote.map(r => r.estado);
      const reclam  = lote.map(r => r.descreva_reclamacao);
      const tags    = lote.map(r => r.tag_problema);
      const motivos = lote.map(r => r.motivo_solicitacao);
      const plataf  = lote.map(r => r.plataforma_atendimento);
      const modelos = lote.map(r => r.modelo);
      const protcs  = lote.map(r => r.atendimento_inicial);

      await client.query(`
        INSERT INTO sac.at
          (data, tipo, nome_revenda_cliente, numero_telefone, estado,
           descreva_reclamacao, tag_problema, motivo_solicitacao,
           plataforma_atendimento, modelo, atendimento_inicial)
        SELECT
          unnest($1::TIMESTAMP[]),
          unnest($2::TEXT[]),
          unnest($3::TEXT[]),
          unnest($4::TEXT[]),
          unnest($5::TEXT[]),
          unnest($6::TEXT[]),
          unnest($7::TEXT[]),
          unnest($8::TEXT[]),
          unnest($9::TEXT[]),
          unnest($10::TEXT[]),
          unnest($11::TEXT[])
        ON CONFLICT DO NOTHING
      `, [datas, tipos, clientes, tels, estados, reclam, tags, motivos, plataf, modelos, protcs]);

      inseridos += lote.length;
      process.stdout.write(`\r   Processados: ${inseridos}/${registros.length}`);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('\n');
  console.log('──────────────────────────────');
  console.log(`✅ Inseridos : ${inseridos}`);
  console.log(`⏭  Pulados   : ${pulados}`);
  console.log('──────────────────────────────');

  await pool.end();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
