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

module.exports = {
  garantirSchemaParadas,
  listarMotivos,
  registrarMotivo,
  registrarParada,
};
