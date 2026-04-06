/**
 * Importa sac.fechamento a partir das planilhas do Google Sheets
 *
 * Fontes:
 *   1. Fechamento Sheet (gid=1928151612) — campos do serviço realizado
 *   2. AT Sheet (gid=661685335)           — Status → status_os
 *   3. banco: sac.at                      — id_at, tag_problema, created_at
 *   4. banco: omie.fornecedores           — id_tecnico via LIKE razao_social
 *
 * Uso:
 *   node scripts/importar_fechamento.js            (executa importação)
 *   node scripts/importar_fechamento.js --dry-run  (só conta, não insere)
 */

require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');
const { parse } = require('csv-parse/sync');

const SHEETS = {
  fechamento: 'https://docs.google.com/spreadsheets/d/1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI/export?format=csv&gid=1928151612',
  at:         'https://docs.google.com/spreadsheets/d/1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI/export?format=csv&gid=661685335',
};

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 200;

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

/** "R$ 1.200,00" → 1200.00 ou null */
function parseMoeda(v) {
  if (!v || !v.trim()) return null;
  const s = v.replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** "29/11/2024" → "2024-11-29" ou null */
function parseData(v) {
  if (!v || !v.trim()) return null;
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Busca id do fornecedor por similaridade de nome (case-insensitive, contains) */
function matchFornecedor(nome, fornecedores) {
  if (!nome) return null;
  const n = nome.toLowerCase().trim();
  // 1. match exato
  let f = fornecedores.find(r => r.razao_social.toLowerCase() === n);
  if (f) return f.id;
  // 2. banco contém planilha
  f = fornecedores.find(r => r.razao_social.toLowerCase().includes(n));
  if (f) return f.id;
  // 3. planilha contém banco
  f = fornecedores.find(r => n.includes(r.razao_social.toLowerCase()));
  if (f) return f.id;
  // 4. primeiras 3 palavras
  const palavras = n.split(/\s+/).slice(0, 3).join(' ');
  f = fornecedores.find(r => r.razao_social.toLowerCase().includes(palavras));
  if (f) return f.id;
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('⬇  Baixando planilhas…');
  const [csvFech, csvAt] = await Promise.all([
    baixarCSV(SHEETS.fechamento).then(t => { console.log('   ✓ Fechamento sheet (gid=1928151612)'); return t; }),
    baixarCSV(SHEETS.at).then(t => { console.log('   ✓ AT sheet (gid=661685335)'); return t; }),
  ]);

  // Parse planilha AT → mapa PROTC. → status
  const rowsAt = parse(csvAt, { columns: true, skip_empty_lines: true, trim: true });
  const mapAtStatus = new Map();
  for (const r of rowsAt) {
    const k = (r['PROTC.'] || '').trim();
    if (k) mapAtStatus.set(k, limpar(r['Status']));
  }
  console.log(`   ${mapAtStatus.size} status mapeados do AT sheet`);

  // Parse planilha Fechamento
  const rowsFech = parse(csvFech, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`\n📋 Fechamento sheet: ${rowsFech.length} linhas`);

  // Busca fornecedores do banco
  console.log('\n🔍 Carregando fornecedores do banco…');
  const { rows: fornecedores } = await pool.query(
    `SELECT id, razao_social FROM omie.fornecedores WHERE razao_social IS NOT NULL ORDER BY razao_social`
  );
  console.log(`   ${fornecedores.length} fornecedores carregados`);

  // Busca sac.at → mapa atendimento_inicial → { id, tag_problema, data }
  console.log('🔍 Carregando sac.at do banco…');
  const { rows: atRows } = await pool.query(
    `SELECT id, atendimento_inicial, tag_problema, data FROM sac.at WHERE atendimento_inicial IS NOT NULL`
  );
  const mapAt = new Map();
  for (const r of atRows) {
    mapAt.set(String(r.atendimento_inicial).trim(), {
      id:           r.id,
      tag_problema: r.tag_problema,
      data:         r.data,
    });
  }
  console.log(`   ${mapAt.size} registros em sac.at`);

  // Busca id_at que já têm fechamento para evitar duplicatas
  const { rows: existentes } = await pool.query(
    `SELECT DISTINCT id_at FROM sac.fechamento`
  );
  const jaExistem = new Set(existentes.map(r => Number(r.id_at)));
  console.log(`   ${jaExistem.size} id_at já têm fechamento (serão pulados)`);

  if (DRY_RUN) console.log('\n⚠  Modo DRY-RUN — nenhuma inserção.\n');

  // Cache de match fornecedor para log
  const fornCache = new Map();
  const semForn = [];

  // Monta registros a inserir
  const registros = [];
  let semIdAt = 0;

  for (const row of rowsFech) {
    const osNum = (row['N° O.S./SAC'] || '').trim();
    if (!osNum) continue;

    const atInfo = mapAt.get(osNum);
    if (!atInfo) { semIdAt++; continue; }
    if (jaExistem.has(Number(atInfo.id))) continue;

    const nomeTec = limpar(row['NOME DA ASSIST. TÉCNICA '] || row['NOME DA ASSIST. TÉCNICA']);
    let idTecnico = null;
    if (nomeTec) {
      if (!fornCache.has(nomeTec)) {
        const fid = matchFornecedor(nomeTec, fornecedores);
        fornCache.set(nomeTec, fid);
        if (!fid) semForn.push(nomeTec);
      }
      idTecnico = fornCache.get(nomeTec);
    }

    registros.push({
      id_at:                     atInfo.id,
      tag_problema:               atInfo.tag_problema,
      descricao_servico_realizado: limpar(row['DESCRIÇÃO DO SERVIÇO REALIZADO']),
      valor_total_mao_obra:        parseMoeda(row['VALOR TOTAL - MÃO DE OBRA']),
      valor_gasto_pecas:           parseMoeda(row['VALOR GASTO COM PEÇAS']),
      pecas_reposicao:             limpar(row['PEÇAS DE REPOSIÇÃO']),
      data_conclusao_servico:      parseData(row['DATA DE CONCLUSÃO DO SERVIÇO']),
      observacoes:                 limpar(row['OBSERVAÇÕES']),
      midias_servico:              limpar(row['VÍDEOS, FOTOS E DADOS DO SERVIÇO REALIZADO']),
      created_at:                  atInfo.data || new Date(),
      id_tecnico:                  idTecnico,
      status_os:                   mapAtStatus.get(osNum) || null,
    });
  }

  console.log(`\n📊 Registros a inserir  : ${registros.length}`);
  console.log(`   Sem id_at (no banco) : ${semIdAt}`);
  console.log(`   Já existiam           : ${jaExistem.size}`);
  console.log(`   Nomes sem fornecedor  : ${[...new Set(semForn)].length}`);
  if (semForn.length > 0) {
    console.log('   (primeiros 5 sem match):');
    [...new Set(semForn)].slice(0,5).forEach(n => console.log(`     "${n}"`));
  }

  if (DRY_RUN) {
    if (registros.length > 0) {
      console.log('\nAmostra (primeiros 3):');
      registros.slice(0,3).forEach(r =>
        console.log(`  id_at=${r.id_at} status=${r.status_os} descr=${(r.descricao_servico_realizado||'').slice(0,40)} id_tec=${r.id_tecnico}`)
      );
    }
    console.log('\n──────────────────────────────');
    console.log(`✅ Seriam inseridos: ${registros.length}`);
    console.log('(Dry-run: nada gravado)');
    console.log('──────────────────────────────');
    await pool.end();
    return;
  }

  // Insere em lotes via unnest
  let inseridos = 0;
  for (let i = 0; i < registros.length; i += BATCH_SIZE) {
    const lote = registros.slice(i, i + BATCH_SIZE);

    const ids_at    = lote.map(r => r.id_at);
    const tags      = lote.map(r => r.tag_problema);
    const descrs    = lote.map(r => r.descricao_servico_realizado);
    const val_mos   = lote.map(r => r.valor_total_mao_obra);
    const val_pecs  = lote.map(r => r.valor_gasto_pecas);
    const pecas     = lote.map(r => r.pecas_reposicao);
    const datas_c   = lote.map(r => r.data_conclusao_servico);
    const obs       = lote.map(r => r.observacoes);
    const midias    = lote.map(r => r.midias_servico);
    const crt       = lote.map(r => r.created_at);
    const id_tecs   = lote.map(r => r.id_tecnico);
    const statuses  = lote.map(r => r.status_os);

    await pool.query(`
      INSERT INTO sac.fechamento
        (id_at, tag_problema, descricao_servico_realizado,
         valor_total_mao_obra, valor_gasto_pecas, pecas_reposicao,
         data_conclusao_servico, observacoes, midias_servico,
         created_at, id_tecnico, status_os)
      SELECT
        unnest($1::BIGINT[]),
        unnest($2::TEXT[]),
        unnest($3::TEXT[]),
        unnest($4::NUMERIC[]),
        unnest($5::NUMERIC[]),
        unnest($6::TEXT[]),
        unnest($7::TEXT[])::DATE,
        unnest($8::TEXT[]),
        unnest($9::TEXT[]),
        unnest($10::TIMESTAMP[]),
        unnest($11::BIGINT[]),
        unnest($12::TEXT[])
      ON CONFLICT (id_at, id_tecnico) WHERE id_tecnico IS NOT NULL DO NOTHING
    `, [ids_at, tags, descrs, val_mos, val_pecs, pecas, datas_c, obs, midias, crt, id_tecs, statuses]);

    inseridos += lote.length;
    process.stdout.write(`\r   Inseridos: ${inseridos}/${registros.length}`);
  }

  console.log('\n');
  console.log('──────────────────────────────');
  console.log(`✅ Inseridos : ${inseridos}`);
  console.log(`⏭  Sem id_at : ${semIdAt}`);
  console.log('──────────────────────────────');

  await pool.end();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
