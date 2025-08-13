// scripts/import_events_log_to_pg.js
// Lê data/kanban.log (linhas de texto) e grava em public.op_event

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL antes de rodar este script.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const LOG_PATH = path.join(__dirname, '..', 'data', 'kanban.log');

// tenta entender vários formatos de data comuns
function parseTimestamp(ts) {
  ts = ts.trim();

  // ISO ou "YYYY-MM-DD HH:MM:SS"
  if (/^\d{4}-\d{2}-\d{2}/.test(ts)) {
    return new Date(ts.replace(' ', 'T'));
  }

  // "DD/MM/YYYY HH:MM:SS"
  const m = ts.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, dd, mm, yyyy, HH='00', MM='00', SS='00'] = m;
    return new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}`);
  }

  // fallback: deixa o Date tentar
  return new Date(ts);
}

// Ex.: [2025-08-13 09:42:10] Em produção – Pedido: P101084, Código: 04.PP.N.51004, Qtd: 1
const LINE_RE = /^\[(?<ts>[^\]]+)\]\s*(?<etapa>[^–-]+?)\s*[–-]\s*Pedido:\s*(?<pedido>[^,]+),\s*Código:\s*(?<codigo>[^,]+),\s*Qtd:\s*(?<qtd>\d+)/;

(async () => {
  const client = await pool.connect();
  try {
    const raw = fs.readFileSync(LOG_PATH, 'utf8');
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    await client.query('BEGIN');

    // garante tabela e índice
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.op_event (
        id       bigserial PRIMARY KEY,
        op       text NOT NULL,
        tipo     text NOT NULL,
        momento  timestamptz NOT NULL DEFAULT now(),
        data     jsonb
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_triplet
      ON public.op_event (op, momento, tipo);
    `);

    let parsed = 0, inserted = 0, ignored = 0;

    for (const line of lines) {
      const m = line.match(LINE_RE);
      if (!m) { ignored++; continue; }

      parsed++;

      const ts = parseTimestamp(m.groups.ts);
      if (isNaN(ts.getTime())) { ignored++; continue; }

      const payload = {
        etapa: m.groups.etapa.trim(),
        pedido: m.groups.pedido.trim().toUpperCase(),
        codigo: m.groups.codigo.trim(),
        quantidade: Number(m.groups.qtd),
        raw: line
      };

      // tipo genérico para esse log de arrasto/movimentação
      const tipo = 'arrasto';
      const op   = payload.pedido;

      try {
        await client.query(
          `INSERT INTO public.op_event (op, tipo, momento, data)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT ON CONSTRAINT uniq_event_triplet DO NOTHING`,
          [op, tipo, ts, payload]
        );
        // se caiu no DO NOTHING, rowCount=0
        inserted += (client._queryable && client._lastRowCount) ? client._lastRowCount : 1;
      } catch (e) {
        // se o índice único ainda não existe como constraint, tenta pelo nome
        try {
          await client.query(
            `INSERT INTO public.op_event (op, tipo, momento, data)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT DO NOTHING`,
            [op, tipo, ts, payload]
          );
          // sem como saber rowCount com DO NOTHING genérico; não conta
        } catch {
          ignored++;
        }
      }
    }

    await client.query('COMMIT');
    console.log(`OK. Linhas lidas: ${lines.length}. Válidas: ${parsed}. Inseridas (aprox.): ${inserted}. Ignoradas: ${ignored}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Falha na importação:', err);
  } finally {
    client.release();
    await pool.end();
  }
})();
