const { dbQuery } = require('../src/db');
const { dispararNotificacaoRegistroTempo } = require('./riCheckWhatsappNotificacao');

let schemaCriado = false;
let schemaMigrado = false;

const TZ = 'America/Sao_Paulo';

async function garantirSchemaTempoProducao() {
  if (!schemaCriado) {
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS "Tempo_Producao"`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS "Tempo_Producao"."Turno_padrao" (
      id                  BIGSERIAL PRIMARY KEY,
      usuario             TEXT NOT NULL,
      nome                TEXT NOT NULL DEFAULT 'Padrão',
      inicio_turno        TIME NOT NULL,
      cafe_inicio         TIME,
      cafe_fim            TIME,
      refeicao_inicio     TIME,
      refeicao_fim        TIME,
      fim_turno           TIME NOT NULL,
      observacao          TEXT,
      trabalho_fim_semana BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "Tempo_Producao"."Turno_dia" (
      id                  BIGSERIAL PRIMARY KEY,
      usuario             TEXT NOT NULL,
      nome_turno          TEXT NOT NULL DEFAULT 'Padrão',
      data_referencia     DATE NOT NULL,
      inicio_turno        TIME NOT NULL,
      cafe_inicio         TIME,
      cafe_fim            TIME,
      refeicao_inicio     TIME,
      refeicao_fim        TIME,
      fim_turno           TIME NOT NULL,
      observacao          TEXT,
      trabalho_fim_semana BOOLEAN NOT NULL DEFAULT FALSE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_turno_dia_data
      ON "Tempo_Producao"."Turno_dia" (data_referencia);

    CREATE TABLE IF NOT EXISTS "Tempo_Producao"."Registro_tempo" (
      id                      BIGSERIAL PRIMARY KEY,
      kanban_programacao_id   BIGINT,
      op_producao_id          BIGINT,
      numero_op               TEXT,
      posto_origem            TEXT NOT NULL,
      tipo_registro           TEXT NOT NULL,
      operacao                TEXT,
      ri_check_id             BIGINT,
      inicio                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fim                     TIMESTAMPTZ,
      usuario_inicio          TEXT,
      usuario_fim             TEXT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_reg_tempo_op
      ON "Tempo_Producao"."Registro_tempo" (op_producao_id, fim);
    CREATE INDEX IF NOT EXISTS idx_reg_tempo_numero_op
      ON "Tempo_Producao"."Registro_tempo" (numero_op, fim);
    CREATE INDEX IF NOT EXISTS idx_reg_tempo_kanban
      ON "Tempo_Producao"."Registro_tempo" (kanban_programacao_id, fim);
    CREATE INDEX IF NOT EXISTS idx_reg_tempo_aberto
      ON "Tempo_Producao"."Registro_tempo" (fim) WHERE fim IS NULL;
  `);
    schemaCriado = true;
  }

  if (!schemaMigrado) {
  await dbQuery(`ALTER TABLE "Tempo_Producao"."Turno_padrao" ADD COLUMN IF NOT EXISTS nome TEXT`);
  await dbQuery(`UPDATE "Tempo_Producao"."Turno_padrao" SET nome = 'Padrão' WHERE nome IS NULL OR TRIM(nome) = ''`);
  await dbQuery(`ALTER TABLE "Tempo_Producao"."Turno_padrao" ALTER COLUMN nome SET DEFAULT 'Padrão'`);
  await dbQuery(`ALTER TABLE "Tempo_Producao"."Turno_dia" ADD COLUMN IF NOT EXISTS nome_turno TEXT`);
  await dbQuery(`UPDATE "Tempo_Producao"."Turno_dia" SET nome_turno = 'Padrão' WHERE nome_turno IS NULL OR TRIM(nome_turno) = ''`);
  await dbQuery(`ALTER TABLE "Tempo_Producao"."Turno_dia" ALTER COLUMN nome_turno SET DEFAULT 'Padrão'`);
  await dbQuery(`ALTER TABLE "Tempo_Producao"."Turno_padrao" DROP CONSTRAINT IF EXISTS "Turno_padrao_usuario_key"`);
  await dbQuery(`ALTER TABLE "Tempo_Producao"."Turno_padrao" DROP CONSTRAINT IF EXISTS turno_padrao_usuario_key`);
  await dbQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_turno_padrao_usuario_nome
      ON "Tempo_Producao"."Turno_padrao" (usuario, LOWER(TRIM(nome)));
  `);
  await dbQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_turno_dia_data_usuario_nome
      ON "Tempo_Producao"."Turno_dia" (data_referencia, usuario, LOWER(TRIM(nome_turno)));
  `);
  await dbQuery(`DROP INDEX IF EXISTS "Tempo_Producao".idx_turno_dia_data_nome`);
    schemaMigrado = true;
  }
}

function normalizarNomeTurno(nome) {
  const n = String(nome || '').trim();
  return n || 'Padrão';
}

function parseTimeToMinutes(t) {
  if (!t) return null;
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function dateKeyInTz(d, tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}

function partsInTz(d, tz = TZ) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type) => Number(parts.find(p => p.type === type)?.value || 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function tsFromDateAndMinutes(dateKey, minutes) {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const iso = `${dateKey}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-03:00`;
  return new Date(iso);
}

function addDaysToDateKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function isWeekendDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

function turnoToWindows(turno, dateKey) {
  const ini = parseTimeToMinutes(turno.inicio_turno);
  const fim = parseTimeToMinutes(turno.fim_turno);
  if (ini == null || fim == null || fim <= ini) return { work: [], breaks: [] };

  const workStart = tsFromDateAndMinutes(dateKey, ini);
  const workEnd = tsFromDateAndMinutes(dateKey, fim);
  const breaks = [];

  const cafeIni = parseTimeToMinutes(turno.cafe_inicio);
  const cafeFim = parseTimeToMinutes(turno.cafe_fim);
  if (cafeIni != null && cafeFim != null && cafeFim > cafeIni) {
    breaks.push([
      tsFromDateAndMinutes(dateKey, cafeIni),
      tsFromDateAndMinutes(dateKey, cafeFim),
    ]);
  }

  const refIni = parseTimeToMinutes(turno.refeicao_inicio);
  let refFim = parseTimeToMinutes(turno.refeicao_fim);
  if (refIni != null) {
    if (refFim == null || refFim <= refIni) refFim = refIni + 60;
    breaks.push([
      tsFromDateAndMinutes(dateKey, refIni),
      tsFromDateAndMinutes(dateKey, refFim),
    ]);
  }

  return { work: [[workStart, workEnd]], breaks };
}

function overlapMs(a0, a1, b0, b1) {
  const start = Math.max(a0.getTime(), b0.getTime());
  const end = Math.min(a1.getTime(), b1.getTime());
  return Math.max(0, end - start);
}

function mergeWindows(windows) {
  if (!windows.length) return [];
  const sorted = [...windows].sort((a, b) => a[0] - b[0]);
  const out = [[new Date(sorted[0][0]), new Date(sorted[0][1])]];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    const last = out[out.length - 1];
    if (s <= last[1].getTime()) {
      if (e > last[1].getTime()) last[1] = new Date(e);
    } else {
      out.push([new Date(s), new Date(e)]);
    }
  }
  return out;
}

function calcularTempoUtilMs(inicio, fim, turnosLista) {
  if (!inicio || !fim) return 0;
  const t0 = new Date(inicio).getTime();
  const t1 = new Date(fim).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0;

  const turnosPorDia = new Map();
  for (const t of (turnosLista || [])) {
    const dk = String(t.data_referencia || '').slice(0, 10);
    if (!dk) continue;
    if (!turnosPorDia.has(dk)) turnosPorDia.set(dk, []);
    turnosPorDia.get(dk).push(t);
  }

  let total = 0;
  let dk = dateKeyInTz(new Date(t0));
  const endDk = dateKeyInTz(new Date(t1));

  while (dk <= endDk) {
    const turnosDia = turnosPorDia.get(dk) || [];
    const weekend = isWeekendDateKey(dk);
    const turnosValidos = turnosDia.filter(t => !weekend || t.trabalho_fim_semana);

    if (turnosValidos.length) {
      let workWindows = [];
      let breakWindows = [];
      for (const turno of turnosValidos) {
        const { work, breaks } = turnoToWindows(turno, dk);
        workWindows.push(...work.map(([a, b]) => [a.getTime(), b.getTime()]));
        breakWindows.push(...breaks.map(([a, b]) => [a.getTime(), b.getTime()]));
      }
      workWindows = mergeWindows(workWindows);

      const periodStart = new Date(t0);
      const periodEnd = new Date(t1);

      for (const [ws, we] of workWindows) {
        const segStart = new Date(Math.max(periodStart.getTime(), ws));
        const segEnd = new Date(Math.min(periodEnd.getTime(), we));
        if (segEnd <= segStart) continue;

        let segMs = segEnd.getTime() - segStart.getTime();
        for (const [bs, be] of breakWindows) {
          segMs -= overlapMs(segStart, segEnd, new Date(bs), new Date(be));
        }
        total += Math.max(0, segMs);
      }
    }
    dk = addDaysToDateKey(dk, 1);
  }
  return total;
}

async function buscarTurnosNoPeriodo(inicio, fim) {
  await garantirSchemaTempoProducao();
  const dkIni = dateKeyInTz(new Date(inicio));
  const dkFim = dateKeyInTz(new Date(fim));
  const { rows } = await dbQuery(
    `SELECT id, usuario, nome_turno, data_referencia::text AS data_referencia,
            inicio_turno::text AS inicio_turno,
            cafe_inicio::text AS cafe_inicio,
            cafe_fim::text AS cafe_fim,
            refeicao_inicio::text AS refeicao_inicio,
            refeicao_fim::text AS refeicao_fim,
            fim_turno::text AS fim_turno,
            observacao, trabalho_fim_semana, created_at::text AS created_at
       FROM "Tempo_Producao"."Turno_dia"
      WHERE data_referencia >= $1::date AND data_referencia <= $2::date
      ORDER BY data_referencia, inicio_turno`,
    [dkIni, dkFim]
  );
  return rows;
}

function formatarDuracao(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

async function encerrarRegistrosAbertos({
  kanbanProgramacaoId = null,
  opProducaoId = 0,
  numeroOp = '',
  postoOrigem = null,
  tipos = null,
  usuario = '',
}) {
  await garantirSchemaTempoProducao();
  const params = [opProducaoId || 0, numeroOp || '', kanbanProgramacaoId || null];
  let where = `fim IS NULL AND (
    ($1::bigint > 0 AND op_producao_id = $1)
    OR ($2::text <> '' AND UPPER(TRIM(COALESCE(numero_op, ''))) = UPPER(TRIM($2)))
    OR ($3::bigint IS NOT NULL AND kanban_programacao_id = $3)
  )`;
  if (postoOrigem) {
    params.push(postoOrigem);
    where += ` AND posto_origem = $${params.length}`;
  }
  if (Array.isArray(tipos) && tipos.length) {
    params.push(tipos);
    where += ` AND tipo_registro = ANY($${params.length}::text[])`;
  }
  params.push(usuario || null);
  const { rows } = await dbQuery(
    `UPDATE "Tempo_Producao"."Registro_tempo"
        SET fim = NOW(), usuario_fim = COALESCE($${params.length}, usuario_fim)
      WHERE ${where}
      RETURNING id, tipo_registro, posto_origem, numero_op,
                inicio::text AS inicio, fim::text AS fim, usuario_fim`,
    params
  );
  for (const row of rows) {
    if (String(row.tipo_registro || '').trim() === 'posto') {
      dispararNotificacaoRegistroTempo(row.id);
    }
  }
  return rows;
}

async function iniciarRegistroTempo({
  kanbanProgramacaoId = null,
  opProducaoId = 0,
  numeroOp = '',
  postoOrigem = '',
  tipoRegistro = 'posto',
  operacao = null,
  riCheckId = null,
  usuario = '',
}) {
  await garantirSchemaTempoProducao();
  const posto = String(postoOrigem || '').trim();
  const tipo = String(tipoRegistro || 'posto').trim();
  if (!posto) return null;

  await encerrarRegistrosAbertos({
    kanbanProgramacaoId,
    opProducaoId,
    numeroOp,
    postoOrigem: posto,
    tipos: [tipo],
    usuario,
  });

  const { rows } = await dbQuery(
    `INSERT INTO "Tempo_Producao"."Registro_tempo"
       (kanban_programacao_id, op_producao_id, numero_op, posto_origem,
        tipo_registro, operacao, ri_check_id, usuario_inicio)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, tipo_registro, posto_origem, numero_op,
               inicio::text AS inicio, fim::text AS fim, usuario_fim`,
    [
      kanbanProgramacaoId || null,
      opProducaoId > 0 ? opProducaoId : null,
      String(numeroOp || '').trim() || null,
      posto,
      tipo,
      operacao || null,
      riCheckId || null,
      String(usuario || '').trim() || null,
    ]
  );
  const reg = rows[0] || null;
  if (reg && tipo === 'posto') {
    dispararNotificacaoRegistroTempo(reg.id);
  }
  return reg;
}

/** Entrada no posto (após Programado): inicia tempo total do posto + fase RI. */
async function iniciarCicloPosto(opts) {
  const base = { ...opts, tipoRegistro: 'posto', operacao: opts.operacao || 'Tempo no posto' };
  const ri = { ...opts, tipoRegistro: 'ri', operacao: opts.operacao || 'Aguardando RI' };
  const posto = await iniciarRegistroTempo(base);
  const riReg = await iniciarRegistroTempo(ri);
  return { posto, ri: riReg };
}

/** RI registrada: encerra fase RI e inicia trabalho no posto. */
async function registrarRiConcluida(opts) {
  const { riCheckId, ...rest } = opts;
  await encerrarRegistrosAbertos({ ...rest, tipos: ['ri'] });
  return iniciarRegistroTempo({
    ...rest,
    tipoRegistro: 'trabalho',
    operacao: rest.operacao || 'Trabalho no posto',
    riCheckId,
  });
}

/** Finalizar operação: encerra todos os registros abertos do posto atual. */
async function encerrarCicloPosto(opts) {
  return encerrarRegistrosAbertos({
    ...opts,
    tipos: ['posto', 'ri', 'trabalho'],
  });
}

async function buscarRegistroPostoAberto({ opProducaoId = 0, numeroOp = '', kanbanProgramacaoId = null }) {
  await garantirSchemaTempoProducao();
  const { rows } = await dbQuery(
    `SELECT id, kanban_programacao_id, op_producao_id, numero_op, posto_origem,
            tipo_registro, operacao, ri_check_id,
            inicio::text AS inicio, fim::text AS fim
       FROM "Tempo_Producao"."Registro_tempo"
      WHERE fim IS NULL AND tipo_registro = 'posto'
        AND (
          ($1::bigint > 0 AND op_producao_id = $1)
          OR ($2::text <> '' AND UPPER(TRIM(COALESCE(numero_op, ''))) = UPPER(TRIM($2)))
          OR ($3::bigint IS NOT NULL AND kanban_programacao_id = $3)
        )
      ORDER BY inicio DESC
      LIMIT 1`,
    [opProducaoId || 0, numeroOp || '', kanbanProgramacaoId || null]
  );
  return rows[0] || null;
}

async function buscarRegistrosPostoOp({ opProducaoId = 0, numeroOp = '', kanbanProgramacaoId = null }) {
  await garantirSchemaTempoProducao();
  const { rows } = await dbQuery(
    `SELECT id, posto_origem, inicio::text AS inicio, fim::text AS fim
       FROM "Tempo_Producao"."Registro_tempo"
      WHERE tipo_registro = 'posto'
        AND (
          ($1::bigint > 0 AND op_producao_id = $1)
          OR ($2::text <> '' AND UPPER(TRIM(COALESCE(numero_op, ''))) = UPPER(TRIM($2)))
          OR ($3::bigint IS NOT NULL AND kanban_programacao_id = $3)
        )
      ORDER BY inicio ASC`,
    [opProducaoId || 0, numeroOp || '', kanbanProgramacaoId || null]
  );
  return rows;
}

async function calcularTempoTotalOpUtil(opRefs) {
  const regs = await buscarRegistrosPostoOp(opRefs);
  if (!regs.length) return { tempo_ms: 0, tempo_formatado: '—' };
  const agora = new Date();
  const inicioGeral = regs[0].inicio;
  const fimGeral = regs[regs.length - 1].fim || agora.toISOString();
  const turnos = await buscarTurnosNoPeriodo(inicioGeral, fimGeral);
  let totalMs = 0;
  for (const reg of regs) {
    const fim = reg.fim || agora.toISOString();
    totalMs += calcularTempoUtilMs(reg.inicio, fim, turnos);
  }
  return { tempo_ms: totalMs, tempo_formatado: formatarDuracao(totalMs) };
}

async function calcularTempoPostoUtil(opRefs) {
  const reg = await buscarRegistroPostoAberto(opRefs);
  const total = await calcularTempoTotalOpUtil(opRefs);
  if (!reg) {
    return {
      registro: null,
      tempo_ms: 0,
      tempo_formatado: '—',
      tempo_total_ms: total.tempo_ms,
      tempo_total_formatado: total.tempo_formatado,
      posto_origem: null,
      inicio: null,
    };
  }
  const fim = new Date();
  const turnos = await buscarTurnosNoPeriodo(reg.inicio, fim);
  const ms = calcularTempoUtilMs(reg.inicio, fim, turnos);
  return {
    registro: reg,
    tempo_ms: ms,
    tempo_formatado: formatarDuracao(ms),
    tempo_total_ms: total.tempo_ms,
    tempo_total_formatado: total.tempo_formatado,
    posto_origem: reg.posto_origem,
    inicio: reg.inicio,
  };
}

async function calcularTemposPostoPorOps(ops) {
  const lista = Array.isArray(ops) ? ops : [];
  const resultado = {};
  await Promise.all(lista.map(async (op) => {
    const opProducaoId = Number(op.op_producao_id) || Number(op.id) || 0;
    const numeroOp = String(op.numero_op || op.identificacao || '').trim();
    const kanbanProgramacaoId = Number(op.kanban_programacao_id) || null;
    const key = opProducaoId > 0 ? `id:${opProducaoId}` : (numeroOp ? `op:${numeroOp.toUpperCase()}` : null);
    if (!key) return;
    const tempo = await calcularTempoPostoUtil({ opProducaoId, numeroOp, kanbanProgramacaoId });
    resultado[key] = tempo;
  }));
  return resultado;
}

function normalizarTurnoPayload(body = {}) {
  return {
    inicio_turno: String(body.inicio_turno || '').trim(),
    cafe_inicio: body.cafe_inicio ? String(body.cafe_inicio).trim() : null,
    cafe_fim: body.cafe_fim ? String(body.cafe_fim).trim() : null,
    refeicao_inicio: body.refeicao_inicio ? String(body.refeicao_inicio).trim() : null,
    refeicao_fim: body.refeicao_fim ? String(body.refeicao_fim).trim() : null,
    fim_turno: String(body.fim_turno || '').trim(),
    observacao: String(body.observacao || '').trim() || null,
    trabalho_fim_semana: body.trabalho_fim_semana === true,
  };
}

const TURNO_SELECT_PADRAO = `
  id, usuario, nome,
  inicio_turno::text AS inicio_turno,
  cafe_inicio::text AS cafe_inicio,
  cafe_fim::text AS cafe_fim,
  refeicao_inicio::text AS refeicao_inicio,
  refeicao_fim::text AS refeicao_fim,
  fim_turno::text AS fim_turno,
  observacao, trabalho_fim_semana,
  updated_at::text AS updated_at
`;

const TURNO_SELECT_DIA = `
  id, usuario, nome_turno, data_referencia::text AS data_referencia,
  inicio_turno::text AS inicio_turno,
  cafe_inicio::text AS cafe_inicio,
  cafe_fim::text AS cafe_fim,
  refeicao_inicio::text AS refeicao_inicio,
  refeicao_fim::text AS refeicao_fim,
  fim_turno::text AS fim_turno,
  observacao, trabalho_fim_semana,
  created_at::text AS created_at
`;

async function listarTurnosPadrao(usuario) {
  await garantirSchemaTempoProducao();
  const { rows } = await dbQuery(
    `SELECT ${TURNO_SELECT_PADRAO}
       FROM "Tempo_Producao"."Turno_padrao"
      WHERE usuario = $1
      ORDER BY nome`,
    [usuario]
  );
  return rows;
}

async function buscarTurnoPadrao(usuario, nome) {
  await garantirSchemaTempoProducao();
  const nomeNorm = normalizarNomeTurno(nome);
  const { rows } = await dbQuery(
    `SELECT ${TURNO_SELECT_PADRAO}
       FROM "Tempo_Producao"."Turno_padrao"
      WHERE usuario = $1 AND LOWER(TRIM(nome)) = LOWER(TRIM($2))`,
    [usuario, nomeNorm]
  );
  return rows[0] || null;
}

async function salvarTurnoPadrao(usuario, body) {
  await garantirSchemaTempoProducao();
  const t = normalizarTurnoPayload(body);
  const nome = normalizarNomeTurno(body.nome);
  if (!t.inicio_turno || !t.fim_turno) throw new Error('Informe início e fim do turno.');
  const existente = await buscarTurnoPadrao(usuario, nome);
  if (existente?.id) {
    const { rows } = await dbQuery(
      `UPDATE "Tempo_Producao"."Turno_padrao"
          SET inicio_turno = $3, cafe_inicio = $4, cafe_fim = $5,
              refeicao_inicio = $6, refeicao_fim = $7, fim_turno = $8,
              observacao = $9, trabalho_fim_semana = $10, updated_at = NOW()
        WHERE id = $1 AND usuario = $2
        RETURNING ${TURNO_SELECT_PADRAO}`,
      [existente.id, usuario, t.inicio_turno, t.cafe_inicio, t.cafe_fim,
        t.refeicao_inicio, t.refeicao_fim, t.fim_turno, t.observacao, t.trabalho_fim_semana]
    );
    return rows[0];
  }
  const { rows } = await dbQuery(
    `INSERT INTO "Tempo_Producao"."Turno_padrao"
       (usuario, nome, inicio_turno, cafe_inicio, cafe_fim, refeicao_inicio, refeicao_fim,
        fim_turno, observacao, trabalho_fim_semana, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     RETURNING ${TURNO_SELECT_PADRAO}`,
    [usuario, nome, t.inicio_turno, t.cafe_inicio, t.cafe_fim, t.refeicao_inicio, t.refeicao_fim,
      t.fim_turno, t.observacao, t.trabalho_fim_semana]
  );
  return rows[0];
}

async function buscarTurnoDia(dataRef, nomeTurno, usuario) {
  await garantirSchemaTempoProducao();
  const dk = String(dataRef || dateKeyInTz(new Date())).slice(0, 10);
  const nome = normalizarNomeTurno(nomeTurno);
  const usr = String(usuario || '').trim();
  const { rows } = await dbQuery(
    `SELECT ${TURNO_SELECT_DIA}
       FROM "Tempo_Producao"."Turno_dia"
      WHERE data_referencia = $1::date
        AND LOWER(TRIM(nome_turno)) = LOWER(TRIM($2))
        AND ($3::text = '' OR usuario = $3)`,
    [dk, nome, usr]
  );
  return rows[0] || null;
}

async function registrarTurnoDia(usuario, body) {
  await garantirSchemaTempoProducao();
  const t = normalizarTurnoPayload(body);
  const nomeTurno = normalizarNomeTurno(body.nome_turno || body.nome);
  if (!t.inicio_turno || !t.fim_turno) throw new Error('Informe início e fim do turno.');
  const dataRef = String(body.data_referencia || dateKeyInTz(new Date())).slice(0, 10);
  const existente = await buscarTurnoDia(dataRef, nomeTurno, usuario);
  if (existente?.id) {
    const { rows } = await dbQuery(
      `UPDATE "Tempo_Producao"."Turno_dia"
          SET usuario = $2, inicio_turno = $3, cafe_inicio = $4, cafe_fim = $5,
              refeicao_inicio = $6, refeicao_fim = $7, fim_turno = $8,
              observacao = $9, trabalho_fim_semana = $10
        WHERE id = $1
        RETURNING ${TURNO_SELECT_DIA}`,
      [existente.id, usuario, t.inicio_turno, t.cafe_inicio, t.cafe_fim,
        t.refeicao_inicio, t.refeicao_fim, t.fim_turno, t.observacao, t.trabalho_fim_semana]
    );
    return rows[0];
  }
  const { rows } = await dbQuery(
    `INSERT INTO "Tempo_Producao"."Turno_dia"
       (usuario, nome_turno, data_referencia, inicio_turno, cafe_inicio, cafe_fim,
        refeicao_inicio, refeicao_fim, fim_turno, observacao, trabalho_fim_semana)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${TURNO_SELECT_DIA}`,
    [usuario, nomeTurno, dataRef, t.inicio_turno, t.cafe_inicio, t.cafe_fim,
      t.refeicao_inicio, t.refeicao_fim, t.fim_turno, t.observacao, t.trabalho_fim_semana]
  );
  return rows[0];
}

async function listarTurnosDia(dataRef) {
  await garantirSchemaTempoProducao();
  const dk = String(dataRef || dateKeyInTz(new Date())).slice(0, 10);
  const { rows } = await dbQuery(
    `SELECT ${TURNO_SELECT_DIA}
       FROM "Tempo_Producao"."Turno_dia"
      WHERE data_referencia = $1::date
      ORDER BY inicio_turno, id`,
    [dk]
  );
  return rows;
}

async function registrarTurnosDiaAutomatico(dataRef) {
  await garantirSchemaTempoProducao();
  const dk = String(dataRef || dateKeyInTz(new Date())).slice(0, 10);
  const { rows: padroes } = await dbQuery(
    `SELECT ${TURNO_SELECT_PADRAO}
       FROM "Tempo_Producao"."Turno_padrao"
      ORDER BY usuario, nome`
  );
  let total = 0;
  for (const p of padroes) {
    await registrarTurnoDia(p.usuario, {
      nome_turno: p.nome,
      data_referencia: dk,
      inicio_turno: p.inicio_turno,
      cafe_inicio: p.cafe_inicio,
      cafe_fim: p.cafe_fim,
      refeicao_inicio: p.refeicao_inicio,
      refeicao_fim: p.refeicao_fim,
      fim_turno: p.fim_turno,
      observacao: p.observacao,
      trabalho_fim_semana: p.trabalho_fim_semana,
    });
    total += 1;
  }
  return { data: dk, total };
}

module.exports = {
  garantirSchemaTempoProducao,
  iniciarCicloPosto,
  registrarRiConcluida,
  encerrarCicloPosto,
  iniciarRegistroTempo,
  encerrarRegistrosAbertos,
  calcularTempoUtilMs,
  calcularTempoPostoUtil,
  calcularTempoTotalOpUtil,
  calcularTemposPostoPorOps,
  buscarTurnosNoPeriodo,
  formatarDuracao,
  salvarTurnoPadrao,
  buscarTurnoPadrao,
  listarTurnosPadrao,
  buscarTurnoDia,
  registrarTurnoDia,
  registrarTurnosDiaAutomatico,
  listarTurnosDia,
  dateKeyInTz,
  normalizarNomeTurno,
};
