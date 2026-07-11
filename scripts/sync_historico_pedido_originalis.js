/**
 * Sincroniza public.historico_pedido_originalis a partir da planilha
 * [NOVUS ORIGINALIS] FT-M02-POPV — PEDIDOS (Google Sheets).
 *
 * Uso:
 *   node scripts/sync_historico_pedido_originalis.js
 *   node scripts/sync_historico_pedido_originalis.js --dry-run
 *   node scripts/sync_historico_pedido_originalis.js --csv "csv/arquivo.csv"
 */

require('dotenv').config();
const fs = require('fs');
const https = require('https');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/14cmU3eOVH8ZscU-nZqxPb1Do5wTnl0SdQCU1caee6qk/export?format=csv&gid=1642140396';

const DRY_RUN = process.argv.includes('--dry-run');
const CSV_LOCAL = (() => {
  const i = process.argv.indexOf('--csv');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const BATCH_SIZE = 400;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_CONNECTION,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

function baixarCSV(url) {
  return new Promise((resolve, reject) => {
    const go = (u) => {
      https.get(u, { headers: { 'User-Agent': 'nodejs-sync-historico-pedido' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return go(res.headers.location);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} ao baixar planilha`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }).on('error', reject);
    };
    go(url);
  });
}

function normHeader(h) {
  return String(h || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function buildGetter(row) {
  const map = new Map();
  for (const [k, v] of Object.entries(row)) {
    map.set(normHeader(k), v);
  }
  return (...aliases) => {
    for (const a of aliases) {
      const v = map.get(normHeader(a));
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
    return null;
  };
}

/** Converte "19/01/2026 08:52:31" ou "19/01/2026" → "2026-01-19 08:52:31" / "2026-01-19" */
function toIsoDateTime(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^(nao informado|n\/a|null|-)$/i.test(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3];
  if (m[4] != null) {
    const hh = m[4].padStart(2, '0');
    const mi = m[5].padStart(2, '0');
    const ss = (m[6] || '00').padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }
  return `${yyyy}-${mm}-${dd}`;
}

function mapRow(row) {
  const g = buildGetter(row);
  const pedido = g('PEDIDO');
  if (!pedido) return null;
  return {
    pedido,
    cliente: g('CLIENTE'),
    qty_em_estoque: g('QTY EM ESTOQUE'),
    ordem_de_producao: g('ORDEM DE PRODUCAO', 'ORDEM DE PRODUÇÃO'),
    modelo: g('MODELO'),
    control: g('CONTROL'),
    opcional: g('OPCIONAL'),
    esq_esf: g('ESQ ESF', 'ESQ\n ESF'),
    situacao: g('SITUACAO', 'SITUAÇÃO'),
    transportadora: g('TRANSPORTADORA'),
    redespacho: g('REDESPACHO', 'REDESPACHO'),
    nota_fiscal: g('NOTA FISCAL'),
    expedido_por: g('EXPEDIDO POR'),
    veiculo: g('VEICULO', 'VEÍCULO'),
    data_entrega: toIsoDateTime(g('DATA ENTREGA')),
    observacao: g('OBSERVACAO', 'OBSERVAÇÃO'),
    integrado_por: g('INTEGRADO POR'),
    aprovado_por: g('APROVADO POR'),
    finalizado_por: g('FINALIZADO POR'),
    data_integracao: toIsoDateTime(g('DATA INTEGRACAO', 'DATA INTEGRAÇÃO')),
    data_aprovacao: toIsoDateTime(g('DATA APROVACAO', 'DATA APROVAÇÃO')),
    data_finalizacao: toIsoDateTime(g('DATA FINALIZACAO', 'DATA FINALIZAÇÃO')),
    volumes: g('VOLUMES'),
    data_da_entrega_futura: toIsoDateTime(g('DATA DA ENTREGA FUTURA')),
    impressao_logistica: g('IMPRESSAO LOGISTICA', 'IMPRESSÃO LOGISTICA'),
    impressao_producao: g('IMPRESSAO PRODUCAO', 'IMPRESSÃO PRODUCAO'),
    glide_row_id: g('🔒 ROW ID', 'ROW ID'),
    qty: g('QTY', 'Qty'),
    estado: g('ESTADO'),
  };
}

const COLS = [
  'pedido', 'cliente', 'qty_em_estoque', 'ordem_de_producao', 'modelo', 'control',
  'opcional', 'esq_esf', 'situacao', 'transportadora', 'redespacho', 'nota_fiscal',
  'expedido_por', 'veiculo', 'data_entrega', 'observacao', 'integrado_por', 'aprovado_por',
  'finalizado_por', 'data_integracao', 'data_aprovacao', 'data_finalizacao', 'volumes',
  'data_da_entrega_futura', 'impressao_logistica', 'impressao_producao', 'glide_row_id',
  'qty', 'estado',
];

async function main() {
  console.log('[sync historico_pedido_originalis] fonte:', CSV_LOCAL || SHEET_URL);
  const raw = CSV_LOCAL
    ? fs.readFileSync(CSV_LOCAL, 'utf8')
    : await baixarCSV(SHEET_URL);

  const parsed = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
  });

  const mapped = [];
  for (const row of parsed) {
    const m = mapRow(row);
    if (m) mapped.push(m);
  }

  const comDi = mapped.filter((r) => r.data_integracao).length;
  console.log(`[sync] linhas planilha: ${parsed.length} | com pedido: ${mapped.length} | com data_integracao: ${comDi}`);

  if (!mapped.length) {
    throw new Error('Nenhuma linha válida na planilha.');
  }

  if (DRY_RUN) {
    console.log('[sync] dry-run — amostra:', mapped.slice(-3).map((r) => ({
      pedido: r.pedido,
      data_integracao: r.data_integracao,
      situacao: r.situacao,
    })));
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE public.historico_pedido_originalis');

    let inserted = 0;
    for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
      const batch = mapped.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;
      for (const row of batch) {
        const placeholders = [];
        for (const col of COLS) {
          params.push(row[col] ?? null);
          placeholders.push(`$${p++}`);
        }
        values.push(`(${placeholders.join(',')})`);
      }
      await client.query(
        `INSERT INTO public.historico_pedido_originalis (${COLS.join(',')}) VALUES ${values.join(',')}`,
        params
      );
      inserted += batch.length;
      process.stdout.write(`\r[sync] inseridos ${inserted}/${mapped.length}`);
    }
    process.stdout.write('\n');

    await client.query('COMMIT');

    const stats = await pool.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE NULLIF(TRIM(data_integracao), '') IS NOT NULL)::int AS com_di,
        MAX(data_integracao) AS max_di
      FROM public.historico_pedido_originalis
    `);
    const check = await pool.query(`
      SELECT pedido, data_integracao, situacao
      FROM public.historico_pedido_originalis
      WHERE TRIM(pedido) = '19933'
      LIMIT 1
    `);
    console.log('[sync] OK', stats.rows[0]);
    console.log('[sync] pedido 19933:', check.rows[0] || '(não encontrado)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[sync] ERRO:', err.message || err);
  process.exit(1);
});
