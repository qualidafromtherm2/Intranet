/**
 * Atualiza sac.fechamento.id_tecnico para registros onde está NULL,
 * buscando o técnico em sac.controle_tecnicos pelo nome do técnico
 * que foi gravado na planilha de fechamento (campo "NOME DA ASSIST. TÉCNICA").
 *
 * Usa a mesma lógica de fuzzy-match já usada no importar_fechamento.js,
 * porém agora buscando em sac.controle_tecnicos.nome em vez de omie.fornecedores.
 *
 * Uso:
 *   node scripts/atualizar_fechamento_id_tecnico.js            (executa)
 *   node scripts/atualizar_fechamento_id_tecnico.js --dry-run  (só conta)
 */

require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');
const { parse } = require('csv-parse/sync');

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI/export?format=csv&gid=1928151612';

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baixarCSV(url) {
  return new Promise((resolve, reject) => {
    const go = (u) => {
      https.get(u, { headers: { 'User-Agent': 'nodejs-update' } }, (res) => {
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

/** Fuzzy-match idêntico ao importar_fechamento.js */
function matchTecnico(nome, tecnicos) {
  if (!nome) return null;
  const n = nome.toLowerCase().trim();
  // 1. match exato
  let t = tecnicos.find(r => r.nome.toLowerCase() === n);
  if (t) return t.id;
  // 2. banco contém planilha
  t = tecnicos.find(r => r.nome.toLowerCase().includes(n));
  if (t) return t.id;
  // 3. planilha contém banco
  t = tecnicos.find(r => n.includes(r.nome.toLowerCase()));
  if (t) return t.id;
  // 4. primeiras 3 palavras
  const palavras = n.split(/\s+/).slice(0, 3).join(' ');
  t = tecnicos.find(r => r.nome.toLowerCase().includes(palavras));
  if (t) return t.id;
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('⬇  Baixando planilha de fechamento…');
  const csvText = await baixarCSV(SHEET_URL);
  const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`   ${rows.length} linhas na planilha`);

  // Carrega técnicos do banco
  console.log('\n🔍 Carregando sac.controle_tecnicos…');
  const { rows: tecnicos } = await pool.query(
    `SELECT id::BIGINT AS id, nome FROM sac.controle_tecnicos WHERE nome IS NOT NULL ORDER BY nome`
  );
  console.log(`   ${tecnicos.length} técnicos carregados`);

  // Carrega registros de fechamento SEM id_tecnico, com atendimento_inicial
  // via join com sac.at
  console.log('\n🔍 Carregando fechamentos sem id_tecnico…');
  const { rows: semTecnico } = await pool.query(`
    SELECT f.id, a.atendimento_inicial
    FROM sac.fechamento f
    JOIN sac.at a ON a.id = f.id_at
    WHERE f.id_tecnico IS NULL
      AND a.atendimento_inicial IS NOT NULL
  `);
  console.log(`   ${semTecnico.length} fechamentos sem id_tecnico`);

  if (!semTecnico.length) {
    console.log('\n✅ Nenhum registro para atualizar.');
    await pool.end();
    return;
  }

  // Monta mapa: atendimento_inicial → nome assistência técnica (da planilha)
  const mapNome = new Map();
  for (const r of rows) {
    const k = (r['N° O.S./SAC'] || '').trim();
    const nome = (r['NOME DA ASSIST. TÉCNICA'] || '').trim();
    if (k && nome) mapNome.set(k, nome);
  }
  console.log(`   ${mapNome.size} nomes de assistência mapeados na planilha`);

  // Para cada fechamento sem id_tecnico, tenta encontrar o técnico
  const aAtualizar = [];
  const semMatch = [];

  for (const fech of semTecnico) {
    const protc = String(fech.atendimento_inicial || '').trim();
    const nomeAssist = mapNome.get(protc);
    if (!nomeAssist) { semMatch.push({ protc, motivo: 'sem nome na planilha' }); continue; }
    const idTec = matchTecnico(nomeAssist, tecnicos);
    if (!idTec) { semMatch.push({ protc, motivo: `sem match para "${nomeAssist}"` }); continue; }
    aAtualizar.push({ id: fech.id, id_tecnico: idTec, nome: nomeAssist });
  }

  console.log(`\n📊 A atualizar : ${aAtualizar.length}`);
  console.log(`   Sem match   : ${semMatch.length}`);

  if (DRY_RUN) {
    console.log('\n⚠  Modo DRY-RUN — nenhuma alteração será feita.');
    if (aAtualizar.length) {
      console.log('\nAmostra (primeiros 5):');
      aAtualizar.slice(0, 5).forEach(r =>
        console.log(`  fechamento.id=${r.id} → id_tecnico=${r.id_tecnico} (${r.nome})`)
      );
    }
    if (semMatch.length) {
      console.log('\nSem match (primeiros 5):');
      semMatch.slice(0, 5).forEach(r => console.log(`  PROTC.=${r.protc} — ${r.motivo}`));
    }
    await pool.end();
    return;
  }

  if (!aAtualizar.length) {
    console.log('\n✅ Nenhum registro para atualizar.');
    await pool.end();
    return;
  }

  // UPDATE em lote — pula registros que causariam violação do unique constraint
  const client = await pool.connect();
  let atualizados = 0;
  let conflitos = 0;
  try {
    await client.query('BEGIN');
    for (const r of aAtualizar) {
      // Verifica se já existe outro fechamento com mesmo (id_at, id_tecnico)
      const { rows: conflict } = await client.query(
        `SELECT 1 FROM sac.fechamento
         WHERE id_tecnico = $1
           AND id_at = (SELECT id_at FROM sac.fechamento WHERE id = $2)
           AND id != $2
         LIMIT 1`,
        [r.id_tecnico, r.id]
      );
      if (conflict.length) { conflitos++; continue; }
      await client.query(
        `UPDATE sac.fechamento SET id_tecnico = $1 WHERE id = $2 AND id_tecnico IS NULL`,
        [r.id_tecnico, r.id]
      );
      atualizados++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('\n──────────────────────────────');
  console.log(`✅ Atualizados  : ${atualizados}`);
  console.log(`   Conflitos    : ${conflitos} (já havia outro registro igual)`);
  console.log(`   Sem match    : ${semMatch.length}`);
  console.log('──────────────────────────────');

  if (semMatch.length > 0) {
    console.log('\nRegistros sem match (verifique se os nomes existem em sac.controle_tecnicos):');
    semMatch.slice(0, 20).forEach(r => console.log(`  PROTC.=${r.protc} — ${r.motivo}`));
  }

  await pool.end();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
