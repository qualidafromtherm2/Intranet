const { dbQuery } = require('../src/db');

let schemaOk = false;

async function garantirSchemaParadas() {
  if (schemaOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS "Producao"`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS "Producao"."Motivo" (
      id           BIGSERIAL PRIMARY KEY,
      tipo_parada  TEXT NOT NULL,
      motivo       TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_producao_motivo_tipo
      ON "Producao"."Motivo" (tipo_parada);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_producao_motivo_tipo_motivo_uq
      ON "Producao"."Motivo" (LOWER(TRIM(tipo_parada)), LOWER(TRIM(motivo)));

    CREATE TABLE IF NOT EXISTS "Producao"."Paradas" (
      id                    BIGSERIAL PRIMARY KEY,
      kanban_programacao_id BIGINT,
      numero_op             TEXT,
      usuario               TEXT,
      operacao              TEXT,
      parada_inicio         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      parada_fim            TIMESTAMPTZ,
      tipo_parada           TEXT,
      motivo                TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_producao_paradas_kanban
      ON "Producao"."Paradas" (kanban_programacao_id);
    CREATE INDEX IF NOT EXISTS idx_producao_paradas_numero_op
      ON "Producao"."Paradas" (numero_op);
  `);
  schemaOk = true;
}

async function listarMotivos() {
  await garantirSchemaParadas();
  const { rows } = await dbQuery(
    `SELECT id, tipo_parada, motivo
       FROM "Producao"."Motivo"
      ORDER BY tipo_parada, motivo`
  );
  return rows;
}

async function registrarMotivo({ tipoParada = '', motivo = '' }) {
  await garantirSchemaParadas();
  const tipo = String(tipoParada || '').trim();
  const mot = String(motivo || '').trim();
  if (!tipo || !mot) {
    throw new Error('Tipo de parada e motivo são obrigatórios.');
  }
  const existente = await dbQuery(
    `SELECT id, tipo_parada, motivo
       FROM "Producao"."Motivo"
      WHERE LOWER(TRIM(tipo_parada)) = LOWER(TRIM($1))
        AND LOWER(TRIM(motivo)) = LOWER(TRIM($2))
      LIMIT 1`,
    [tipo, mot]
  );
  if (existente.rows[0]) return existente.rows[0];
  const { rows } = await dbQuery(
    `INSERT INTO "Producao"."Motivo" (tipo_parada, motivo)
     VALUES ($1, $2)
     RETURNING id, tipo_parada, motivo`,
    [tipo, mot]
  );
  return rows[0];
}

async function registrarParada({
  kanbanProgramacaoId = null,
  numeroOp = '',
  usuario = '',
  operacao = '',
  tipoParada = '',
  motivo = '',
  paradaFim = null,
}) {
  await garantirSchemaParadas();
  if (tipoParada && motivo) {
    await registrarMotivo({ tipoParada, motivo });
  }
  const { rows } = await dbQuery(
    `INSERT INTO "Producao"."Paradas"
       (kanban_programacao_id, numero_op, usuario, operacao, parada_inicio, parada_fim, tipo_parada, motivo)
     VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7)
     RETURNING *`,
    [
      kanbanProgramacaoId || null,
      String(numeroOp || '').trim() || null,
      String(usuario || '').trim() || null,
      String(operacao || '').trim() || null,
      paradaFim || null,
      String(tipoParada || '').trim() || null,
      String(motivo || '').trim() || null,
    ]
  );
  return rows[0];
}

async function buscarParadaAberta({ kanbanProgramacaoId = null, numeroOp = '' }) {
  await garantirSchemaParadas();
  const kpId = Number(kanbanProgramacaoId) || null;
  const nOp = String(numeroOp || '').trim();
  if (!kpId && !nOp) return null;

  const { rows } = await dbQuery(
    `SELECT id, kanban_programacao_id, numero_op, usuario, operacao,
            parada_inicio::text AS parada_inicio,
            parada_fim::text AS parada_fim,
            tipo_parada, motivo
       FROM "Producao"."Paradas"
      WHERE parada_fim IS NULL
        AND (
          ($1::bigint IS NOT NULL AND kanban_programacao_id = $1)
          OR ($2 <> '' AND UPPER(TRIM(COALESCE(numero_op, ''))) = UPPER(TRIM($2)))
        )
      ORDER BY parada_inicio DESC, id DESC
      LIMIT 1`,
    [kpId, nOp]
  );
  return rows[0] || null;
}

async function retomarParada(paradaId) {
  await garantirSchemaParadas();
  const id = Number(paradaId) || 0;
  if (!id) throw new Error('Parada inválida.');

  const { rows, rowCount } = await dbQuery(
    `UPDATE "Producao"."Paradas"
        SET parada_fim = NOW()
      WHERE id = $1
        AND parada_fim IS NULL
      RETURNING id, kanban_programacao_id, numero_op, usuario, operacao,
                parada_inicio::text AS parada_inicio,
                parada_fim::text AS parada_fim,
                tipo_parada, motivo`,
    [id]
  );
  if (!rowCount) throw new Error('Parada não encontrada ou já encerrada.');
  return rows[0];
}

async function listarParadasAbertasPorOps(opsRefs = []) {
  await garantirSchemaParadas();
  const refs = Array.isArray(opsRefs) ? opsRefs : [];
  const numeros = [...new Set(
    refs.map((o) => String(o.numero_op || '').trim()).filter(Boolean)
  )];
  const kpIds = [...new Set(
    refs.map((o) => Number(o.kanban_programacao_id) || 0).filter((n) => n > 0)
  )];
  if (!numeros.length && !kpIds.length) return {};

  const numerosNorm = numeros.map((n) => n.toUpperCase());
  const { rows } = await dbQuery(
    `SELECT id, kanban_programacao_id, numero_op, usuario, operacao,
            parada_inicio::text AS parada_inicio,
            parada_fim::text AS parada_fim,
            tipo_parada, motivo
       FROM "Producao"."Paradas"
      WHERE parada_fim IS NULL
        AND (
          (COALESCE(array_length($1::bigint[], 1), 0) > 0 AND kanban_programacao_id = ANY($1::bigint[]))
          OR (COALESCE(array_length($2::text[], 1), 0) > 0
              AND UPPER(TRIM(COALESCE(numero_op, ''))) = ANY($2::text[]))
        )
      ORDER BY parada_inicio DESC, id DESC`,
    [kpIds.length ? kpIds : null, numerosNorm.length ? numerosNorm : null]
  );

  const out = {};
  for (const op of refs) {
    const opId = Number(op.op_producao_id) || 0;
    if (!opId) continue;
    const nOp = String(op.numero_op || '').trim().toUpperCase();
    const kp = Number(op.kanban_programacao_id) || 0;
    const hit = rows.find((r) =>
      (kp > 0 && Number(r.kanban_programacao_id) === kp)
      || (nOp && String(r.numero_op || '').trim().toUpperCase() === nOp)
    );
    if (hit) out[String(opId)] = hit;
  }
  return out;
}

module.exports = {
  garantirSchemaParadas,
  listarMotivos,
  registrarMotivo,
  registrarParada,
  buscarParadaAberta,
  retomarParada,
  listarParadasAbertasPorOps,
};
