/**
 * Importação de sac.at_busca_selecionada a partir do Google Sheets
 *
 * Fontes:
 *   1. AT Sheet      – mesma do passo anterior (PROTC., N.S., EQUIPAMENTO, CLIENTE, DATA)
 *   2. Pedidos Sheet – busca N.S. em PEDIDO → retorna ORDEM DE PRODUCAO, NOTA FISCAL, DATA ENTREGA
 *   3. Gas-T Sheet   – busca ORDEM DE PRODUCAO em coluna F → retorna coluna T (tipo de gás)
 *   4. Gas-Y Sheet   – fallback: mesma busca → retorna coluna Y (tipo de gás)
 *
 * Uso:
 *   node scripts/importar_at_busca_selecionada.js            (executa importação)
 *   node scripts/importar_at_busca_selecionada.js --dry-run  (só conta, não insere)
 */

require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');
const { parse } = require('csv-parse/sync');

const DRY_RUN = process.argv.includes('--dry-run');

const SHEETS = {
  at:
    'https://docs.google.com/spreadsheets/d/1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI/export?format=csv&gid=661685335',
  pedidos:
    'https://docs.google.com/spreadsheets/d/14cmU3eOVH8ZscU-nZqxPb1Do5wTnl0SdQCU1caee6qk/export?format=csv&gid=1642140396',
  gasT:
    'https://docs.google.com/spreadsheets/d/1Kzg7LngaUig6t2CLabS1fhZ-iD5idrmv1ZesIUVOy1M/export?format=csv&gid=1333359070',
  gasY:
    'https://docs.google.com/spreadsheets/d/1Kzg7LngaUig6t2CLabS1fhZ-iD5idrmv1ZesIUVOy1M/export?format=csv&gid=2061903610',
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baixarCSV(url) {
  return new Promise((resolve, reject) => {
    const seguirRedirect = (u) => {
      https.get(u, { headers: { 'User-Agent': 'nodejs-import' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return seguirRedirect(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} em ${u}`));
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      }).on('error', reject);
    };
    seguirRedirect(url);
  });
}

function limpar(v) {
  return (v || '').trim() || null;
}

/** Converte "29/11/2024" ou "29/11/2024 00:00:00" → Date ou null */
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
  // 1. Baixar todas as planilhas
  console.log('⬇  Baixando planilhas…');
  const [csvAt, csvPedidos, csvGasT, csvGasY] = await Promise.all([
    baixarCSV(SHEETS.at).then(t => { console.log('   ✓ AT sheet'); return t; }),
    baixarCSV(SHEETS.pedidos).then(t => { console.log('   ✓ Pedidos sheet'); return t; }),
    baixarCSV(SHEETS.gasT).then(t => { console.log('   ✓ Gas-T sheet'); return t; }),
    baixarCSV(SHEETS.gasY).then(t => { console.log('   ✓ Gas-Y sheet'); return t; }),
  ]);

  // 2. Parsear AT
  const rowsAt = parse(csvAt, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`\n📋 AT: ${rowsAt.length} linhas`);

  // 3. Indexar Pedidos: PEDIDO → { op, nf, data_entrega }
  const rowsPedidos = parse(csvPedidos, { columns: true, skip_empty_lines: true, trim: true });
  const mapPedidos = new Map();
  for (const row of rowsPedidos) {
    const key = (row['PEDIDO'] || '').trim();
    if (key && !mapPedidos.has(key)) {
      mapPedidos.set(key, {
        op:           limpar(row['ORDEM DE PRODUCAO']),
        nf:           limpar(row['NOTA FISCAL']),
        data_entrega: limpar(row['DATA ENTREGA']),
      });
    }
  }
  console.log(`📋 Pedidos indexados: ${mapPedidos.size}`);

  // 4. Indexar Gas-T: ORDEM DE PRODUCAO (col F = idx 5) → TIPO GÁS (col T = idx 19)
  const rowsGasT = parse(csvGasT, { skip_empty_lines: true, trim: true });
  const mapGasT = new Map();
  for (let i = 1; i < rowsGasT.length; i++) {
    const row = rowsGasT[i];
    const op  = (row[5] || '').trim();
    const gas = (row[19] || '').trim();
    if (op && !mapGasT.has(op)) mapGasT.set(op, gas || null);
  }
  console.log(`📋 Gas-T indexados: ${mapGasT.size}`);

  // 5. Indexar Gas-Y: ORDEM DE PRODUCAO (col F = idx 5) → TIPO GÁS (col Y = idx 24)
  const rowsGasY = parse(csvGasY, { skip_empty_lines: true, trim: true });
  const mapGasY = new Map();
  for (let i = 1; i < rowsGasY.length; i++) {
    const row = rowsGasY[i];
    const op  = (row[5] || '').trim();
    const gas = (row[24] || '').trim();
    if (op && !mapGasY.has(op)) mapGasY.set(op, gas || null);
  }
  console.log(`📋 Gas-Y indexados: ${mapGasY.size}`);

  // 6. Buscar mapa PROTC. → id_at no banco
  console.log('\n🔍 Buscando id_at por atendimento_inicial no banco…');
  const { rows: atRows } = await pool.query(
    `SELECT id, atendimento_inicial FROM sac.at WHERE atendimento_inicial IS NOT NULL`
  );
  const mapProtcIdAt = new Map();
  for (const r of atRows) mapProtcIdAt.set(String(r.atendimento_inicial).trim(), r.id);
  console.log(`   ${mapProtcIdAt.size} registros com PROTC. no banco`);

  // 7. Buscar at_busca_selecionada já existentes por id_at para evitar duplicatas
  const { rows: existentes } = await pool.query(
    `SELECT DISTINCT id_at FROM sac.at_busca_selecionada`
  );
  const jaExistem = new Set(existentes.map(r => Number(r.id_at)));
  console.log(`   ${jaExistem.size} id_at já têm registro em at_busca_selecionada (serão pulados)`);

  if (DRY_RUN) console.log('\n⚠  Modo DRY-RUN — nenhuma inserção será feita.\n');

  // 8. Processar cada linha do AT sheet
  let inseridos = 0, pulados = 0, semIdAt = 0, erros = 0;
  const errosDetalhe = [];

  const client = await pool.connect();
  try {
    if (!DRY_RUN) await client.query('BEGIN');

    for (const row of rowsAt) {
      const protc = (row['PROTC.'] || '').trim();
      if (!protc) { pulados++; continue; }

      const idAt = mapProtcIdAt.get(protc);
      if (!idAt) { semIdAt++; continue; }

      if (jaExistem.has(Number(idAt))) { pulados++; continue; }

      // Dados diretos da AT sheet
      const ns      = limpar(row['N.S.']);
      const modelo  = limpar(row['EQUIPAMENTO']);
      const cliente = limpar(row['CLIENTE']);
      const dataAt  = parseData(row['DATA']);

      // Lookup na planilha de pedidos pelo N.S.
      const pedidoData = ns ? mapPedidos.get(ns) : null;
      const op           = pedidoData?.op           || null;
      const nf           = pedidoData?.nf           || null;
      const dataEntrega  = pedidoData ? parseData(pedidoData.data_entrega) : null;

      // Lookup do tipo de gás pelo OP
      let tipoGas = null;
      if (op) {
        if (mapGasT.has(op))      tipoGas = mapGasT.get(op);
        else if (mapGasY.has(op)) tipoGas = mapGasY.get(op);
      }

      if (DRY_RUN) { inseridos++; continue; }

      try {
        await client.query(
          `INSERT INTO sac.at_busca_selecionada
             (id_at, pedido, ordem_producao, modelo, cliente, nota_fiscal, data_entrega, teste_tipo_gas, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [idAt, ns, op, modelo, cliente, nf, dataEntrega, tipoGas, dataAt || new Date()]
        );
        inseridos++;
      } catch (err) {
        erros++;
        errosDetalhe.push({ protc, erro: err.message });
      }
    }

    if (!DRY_RUN) await client.query('COMMIT');
  } catch (err) {
    if (!DRY_RUN) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('\n──────────────────────────────');
  console.log(`✅ Inseridos        : ${inseridos}`);
  console.log(`⏭  Pulados          : ${pulados}  (já existiam)`);
  console.log(`⚠  Sem id_at        : ${semIdAt}  (PROTC. não encontrado no banco)`);
  if (erros > 0) {
    console.log(`❌ Erros            : ${erros}`);
    errosDetalhe.slice(0, 10).forEach(e => console.log(`   PROTC.${e.protc}: ${e.erro}`));
  }
  if (DRY_RUN) console.log('\n(Dry-run: nada foi gravado no banco)');
  console.log('──────────────────────────────');
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('FATAL:', err.message); process.exit(1); });
