const { dbQuery } = require('../src/db');

let schemaOk = false;

async function garantirSchemaControleOperacoes() {
  if (schemaOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS "Producao"`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS "Producao"."Controle_operacoes" (
      id                    BIGSERIAL PRIMARY KEY,
      kanban_programacao_id BIGINT,
      numero_op             TEXT,
      usuario               TEXT,
      operacao              TEXT,
      inicio                TIMESTAMPTZ,
      fim                   TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_controle_op_kanban_prog
      ON "Producao"."Controle_operacoes" (kanban_programacao_id);
    CREATE INDEX IF NOT EXISTS idx_controle_op_numero_op
      ON "Producao"."Controle_operacoes" (numero_op);
  `);
  schemaOk = true;
}

async function buscarKanbanProgIdPorOp({ opProducaoId = 0, opIappId = 0, numeroOp = '' }) {
  const { rows } = await dbQuery(
    `SELECT id
       FROM "Producao"."Kanban_programacao"
      WHERE ($1::bigint > 0 AND op_producao_id = $1)
         OR ($2::bigint > 0 AND op_iapp_id = $2)
         OR ($3::text <> '' AND UPPER(TRIM(COALESCE(numero_op, ''))) = UPPER(TRIM($3)))
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [opProducaoId || 0, opIappId || 0, numeroOp || '']
  );
  return rows[0]?.id || null;
}

/** Registra início de operação (Imprimir OP, Finalizar operação, etc.). */
async function registrarControleOperacaoImpressaoOp({
  kanbanProgramacaoId = null,
  opProducaoId = 0,
  opIappId = 0,
  numeroOp = '',
  usuario = '',
  operacao = 'Imprimir OP',
}) {
  await garantirSchemaControleOperacoes();
  const kpId = kanbanProgramacaoId
    || await buscarKanbanProgIdPorOp({ opProducaoId, opIappId, numeroOp });
  const { rows } = await dbQuery(
    `INSERT INTO "Producao"."Controle_operacoes"
       (kanban_programacao_id, numero_op, usuario, operacao, inicio)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id`,
    [
      kpId,
      String(numeroOp || '').trim() || null,
      String(usuario || '').trim() || null,
      String(operacao || 'Imprimir OP').trim(),
    ]
  );
  return rows[0] || null;
}

module.exports = {
  garantirSchemaControleOperacoes,
  registrarControleOperacaoImpressaoOp,
};
