const { dbQuery } = require('../src/db');
const { dispararNotificacaoRegistroTempo, dispararNotificacaoTransicaoPosto } = require('./riCheckWhatsappNotificacao');

let schemaCriado = false;
let schemaMigrado = false;

const TZ = 'America/Sao_Paulo';

async function garantirSchemaTempoProducao() {
  if (!schemaCriado) {
  const { organizarSchemasMigracao, ensureSchemasCompatViews } = require('./organizarSchemasMigracao');
  const { pool } = require('../src/db');
  if (pool) await organizarSchemasMigracao(pool);
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS producao`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS producao."Turno_padrao" (
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

    CREATE TABLE IF NOT EXISTS producao."Turno_dia" (
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
      ON producao."Turno_dia" (data_referencia);

    CREATE TABLE IF NOT EXISTS producao."Registro_tempo" (
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
      ON producao."Registro_tempo" (op_producao_id, fim);
    CREATE INDEX IF NOT EXISTS idx_reg_tempo_numero_op
      ON producao."Registro_tempo" (numero_op, fim);
    CREATE INDEX IF NOT EXISTS idx_reg_tempo_kanban
      ON producao."Registro_tempo" (kanban_programacao_id, fim);
    CREATE INDEX IF NOT EXISTS idx_reg_tempo_aberto
      ON producao."Registro_tempo" (fim) WHERE fim IS NULL;

    CREATE TABLE IF NOT EXISTS producao.mao_obra_linha (
      id               BIGSERIAL PRIMARY KEY,
      data_referencia  DATE NOT NULL,
      posto_key        TEXT NOT NULL,
      posto_nome       TEXT NOT NULL,
      quantidade       INTEGER NOT NULL DEFAULT 1,
      operadores       JSONB NOT NULL DEFAULT '[]'::jsonb,
      usuario          TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mao_obra_linha_dia_posto
      ON producao.mao_obra_linha (data_referencia, posto_key);

    CREATE TABLE IF NOT EXISTS producao.mao_obra_linha_hist (
      id               BIGSERIAL PRIMARY KEY,
      data_referencia  DATE NOT NULL,
      posto_key        TEXT NOT NULL,
      posto_nome       TEXT NOT NULL,
      quantidade       INTEGER NOT NULL DEFAULT 1,
      operadores       JSONB NOT NULL DEFAULT '[]'::jsonb,
      inicio           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fim              TIMESTAMPTZ,
      usuario          TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_mao_obra_hist_dia_posto
      ON producao.mao_obra_linha_hist (data_referencia, posto_key, inicio);
  `);
    if (pool) await ensureSchemasCompatViews(pool);
    schemaCriado = true;
  }

  if (!schemaMigrado) {
  await dbQuery(`ALTER TABLE producao."Turno_padrao" ADD COLUMN IF NOT EXISTS nome TEXT`);
  await dbQuery(`UPDATE producao."Turno_padrao" SET nome = 'Padrão' WHERE nome IS NULL OR TRIM(nome) = ''`);
  await dbQuery(`ALTER TABLE producao."Turno_padrao" ALTER COLUMN nome SET DEFAULT 'Padrão'`);
  await dbQuery(`ALTER TABLE producao."Turno_dia" ADD COLUMN IF NOT EXISTS nome_turno TEXT`);
  await dbQuery(`UPDATE producao."Turno_dia" SET nome_turno = 'Padrão' WHERE nome_turno IS NULL OR TRIM(nome_turno) = ''`);
  await dbQuery(`ALTER TABLE producao."Turno_dia" ALTER COLUMN nome_turno SET DEFAULT 'Padrão'`);
  await dbQuery(`ALTER TABLE producao."Turno_padrao" DROP CONSTRAINT IF EXISTS "Turno_padrao_usuario_key"`);
  await dbQuery(`ALTER TABLE producao."Turno_padrao" DROP CONSTRAINT IF EXISTS turno_padrao_usuario_key`);
  await dbQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_turno_padrao_usuario_nome
      ON producao."Turno_padrao" (usuario, LOWER(TRIM(nome)));
  `);
  await dbQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_turno_dia_data_usuario_nome
      ON producao."Turno_dia" (data_referencia, usuario, LOWER(TRIM(nome_turno)));
  `);
  await dbQuery(`DROP INDEX IF EXISTS producao.idx_turno_dia_data_nome`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS producao.mao_obra_linha (
      id               BIGSERIAL PRIMARY KEY,
      data_referencia  DATE NOT NULL,
      posto_key        TEXT NOT NULL,
      posto_nome       TEXT NOT NULL,
      quantidade       INTEGER NOT NULL DEFAULT 1,
      usuario          TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await dbQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mao_obra_linha_dia_posto
      ON producao.mao_obra_linha (data_referencia, posto_key);
  `);
  await dbQuery(`ALTER TABLE producao.mao_obra_linha ADD COLUMN IF NOT EXISTS operadores JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS producao.mao_obra_linha_hist (
      id               BIGSERIAL PRIMARY KEY,
      data_referencia  DATE NOT NULL,
      posto_key        TEXT NOT NULL,
      posto_nome       TEXT NOT NULL,
      quantidade       INTEGER NOT NULL DEFAULT 1,
      operadores       JSONB NOT NULL DEFAULT '[]'::jsonb,
      inicio           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fim              TIMESTAMPTZ,
      usuario          TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_mao_obra_hist_dia_posto
      ON producao.mao_obra_linha_hist (data_referencia, posto_key, inicio);
  `);
  await dbQuery(`ALTER TABLE producao."Registro_tempo" ADD COLUMN IF NOT EXISTS operadores JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await dbQuery(`ALTER TABLE producao."Registro_tempo" ADD COLUMN IF NOT EXISTS tempo_util_ms BIGINT`);
  await dbQuery(`ALTER TABLE producao."Registro_tempo" ADD COLUMN IF NOT EXISTS tempo_parada_ms BIGINT`);
  await dbQuery(`ALTER TABLE producao."Registro_tempo" ADD COLUMN IF NOT EXISTS tempo_liquido_ms BIGINT`);
  await dbQuery(`ALTER TABLE producao."Registro_tempo" ADD COLUMN IF NOT EXISTS turno_snapshot JSONB`);
  await dbQuery(`ALTER TABLE producao."Registro_tempo" ADD COLUMN IF NOT EXISTS parada_parcial BOOLEAN NOT NULL DEFAULT FALSE`);
  await dbQuery(`ALTER TABLE producao."Registro_tempo" ADD COLUMN IF NOT EXISTS congelado_em TIMESTAMPTZ`);
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
       FROM producao."Turno_dia"
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
  skipNotificacao = false,
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
    `UPDATE producao."Registro_tempo"
        SET fim = NOW(), usuario_fim = COALESCE($${params.length}, usuario_fim)
      WHERE ${where}
      RETURNING id, tipo_registro, posto_origem, numero_op,
                inicio::text AS inicio, fim::text AS fim, usuario_fim`,
    params
  );
  for (const row of rows) {
    if (!skipNotificacao && String(row.tipo_registro || '').trim() === 'posto') {
      dispararNotificacaoRegistroTempo(row.id);
    }
    if (row.fim && row.id) {
      try {
        await congelarRegistroTempo(row.id);
      } catch (err) {
        console.error('[tempo_producao] Falha ao congelar registro', row.id, err.message);
      }
    }
  }
  return rows;
}

async function buscarOperadoresMoAtuais(postoNome, postoKey = '') {
  await garantirSchemaTempoProducao();
  const dk = dateKeyInTz(new Date());
  const nomeNorm = normalizarPostoMo(postoNome);
  const key = String(postoKey || '').trim();
  const { rows } = await dbQuery(
    `SELECT operadores, posto_key, posto_nome
       FROM producao.mao_obra_linha
      WHERE data_referencia = $1::date
        AND (
          ($2::text <> '' AND posto_key = $2)
          OR LOWER(TRIM(COALESCE(posto_nome, ''))) = LOWER(TRIM($3))
        )
      ORDER BY
        CASE WHEN $2::text <> '' AND posto_key = $2 THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 1`,
    [dk, key, String(postoNome || '').trim()]
  );
  if (rows[0]) return normalizarOperadoresMo(rows[0].operadores);
  if (nomeNorm) {
    const { rows: byNorm } = await dbQuery(
      `SELECT operadores, posto_nome
         FROM producao.mao_obra_linha
        WHERE data_referencia = $1::date`,
      [dk]
    );
    const hit = byNorm.find((r) => normalizarPostoMo(r.posto_nome) === nomeNorm);
    if (hit) return normalizarOperadoresMo(hit.operadores);
  }
  return [];
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
  skipNotificacao = false,
  operadores = null,
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
    skipNotificacao,
  });

  let opsSnap = normalizarOperadoresMo(operadores);
  if (tipo === 'posto' && !opsSnap.length) {
    try {
      opsSnap = await buscarOperadoresMoAtuais(posto);
    } catch (_) {
      opsSnap = [];
    }
  }

  const { rows } = await dbQuery(
    `INSERT INTO producao."Registro_tempo"
       (kanban_programacao_id, op_producao_id, numero_op, posto_origem,
        tipo_registro, operacao, ri_check_id, usuario_inicio, operadores)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING id, tipo_registro, posto_origem, numero_op,
               inicio::text AS inicio, fim::text AS fim, usuario_fim, operadores`,
    [
      kanbanProgramacaoId || null,
      opProducaoId > 0 ? opProducaoId : null,
      String(numeroOp || '').trim() || null,
      posto,
      tipo,
      operacao || null,
      riCheckId || null,
      String(usuario || '').trim() || null,
      JSON.stringify(opsSnap),
    ]
  );
  const reg = rows[0] || null;
  if (reg && tipo === 'posto' && !skipNotificacao) {
    dispararNotificacaoRegistroTempo(reg.id);
  }
  return reg;
}

/** Entrada no posto: inicia somente o registro de tempo do posto (RI abre depois, no finalizar). */
async function iniciarCicloPosto(opts) {
  const { skipNotificacao, ...rest } = opts || {};
  const posto = await iniciarRegistroTempo({
    ...rest,
    tipoRegistro: 'posto',
    operacao: rest.operacao || 'Tempo no posto',
    skipNotificacao,
  });
  return { posto, ri: null };
}

/** RI registrada: encerra e congela fase RI (não abre trabalho). */
async function registrarRiConcluida(opts) {
  const { riCheckId: _riCheckId, ...rest } = opts || {};
  return encerrarRegistrosAbertos({ ...rest, tipos: ['ri'] });
}

/** Finalizar operação: encerra posto/trabalho do posto atual (RI é aberta em seguida pela rota). */
async function encerrarCicloPosto(opts) {
  return encerrarRegistrosAbertos({
    ...opts,
    tipos: ['posto', 'trabalho'],
    skipNotificacao: opts?.skipNotificacao === true,
  });
}

/**
 * Congela tempos úteis de um Registro_tempo já fechado (bruto / parada / líquido + snapshot do turno).
 * Idempotente: se já tiver congelado_em, devolve o registro sem recalcular.
 */
async function congelarRegistroTempo(registroId) {
  await garantirSchemaTempoProducao();
  const id = Number(registroId) || 0;
  if (!id) return null;

  const { rows } = await dbQuery(
    `SELECT id, kanban_programacao_id, numero_op,
            inicio, fim, congelado_em,
            tempo_util_ms, tempo_parada_ms, tempo_liquido_ms,
            turno_snapshot, parada_parcial
       FROM producao."Registro_tempo"
      WHERE id = $1`,
    [id]
  );
  const reg = rows[0];
  if (!reg) return null;
  if (!reg.fim || reg.congelado_em) return reg;

  const inicio = new Date(reg.inicio);
  const fim = new Date(reg.fim);
  if (!Number.isFinite(inicio.getTime()) || !Number.isFinite(fim.getTime()) || fim <= inicio) {
    const { rows: updEmpty } = await dbQuery(
      `UPDATE producao."Registro_tempo"
          SET tempo_util_ms = 0,
              tempo_parada_ms = 0,
              tempo_liquido_ms = 0,
              turno_snapshot = '[]'::jsonb,
              parada_parcial = FALSE,
              congelado_em = NOW()
        WHERE id = $1
        RETURNING id, kanban_programacao_id, numero_op, inicio, fim, congelado_em,
                  tempo_util_ms, tempo_parada_ms, tempo_liquido_ms,
                  turno_snapshot, parada_parcial`,
      [id]
    );
    return updEmpty[0] || reg;
  }

  const turnos = await buscarTurnosNoPeriodo(inicio, fim);
  const bruto = calcularTempoUtilMs(inicio, fim, turnos);

  let paradaMs = 0;
  let paradaParcial = false;
  try {
    const { listarParadasParaOp, garantirSchemaParadas } = require('./paradasProducao');
    await garantirSchemaParadas();
    const paradas = await listarParadasParaOp({
      kanbanProgramacaoId: reg.kanban_programacao_id,
      numeroOp: reg.numero_op,
      inicio,
      fim,
    });
    const agora = new Date();
    for (const p of paradas || []) {
      const pIni = new Date(p.parada_inicio);
      let pFim;
      if (p.parada_fim == null || p.parada_fim === '') {
        pFim = agora;
        paradaParcial = true;
      } else {
        pFim = new Date(p.parada_fim);
      }
      if (!Number.isFinite(pIni.getTime()) || !Number.isFinite(pFim.getTime())) continue;
      const iStart = new Date(Math.max(inicio.getTime(), pIni.getTime()));
      const iEnd = new Date(Math.min(fim.getTime(), pFim.getTime()));
      if (iEnd <= iStart) continue;
      paradaMs += calcularTempoUtilMs(iStart, iEnd, turnos);
    }
  } catch (err) {
    console.error('[tempo_producao] Falha ao cruzar paradas no congelamento', id, err.message);
  }

  const liquido = Math.max(0, bruto - paradaMs);
  const { rows: upd } = await dbQuery(
    `UPDATE producao."Registro_tempo"
        SET tempo_util_ms = $2,
            tempo_parada_ms = $3,
            tempo_liquido_ms = $4,
            turno_snapshot = $5::jsonb,
            parada_parcial = $6,
            congelado_em = NOW()
      WHERE id = $1
      RETURNING id, kanban_programacao_id, numero_op, inicio, fim, congelado_em,
                tempo_util_ms, tempo_parada_ms, tempo_liquido_ms,
                turno_snapshot, parada_parcial`,
    [id, bruto, paradaMs, liquido, JSON.stringify(turnos || []), paradaParcial]
  );
  return upd[0] || reg;
}

async function congelarRegistrosTempo(ids = []) {
  const list = Array.isArray(ids) ? ids : [];
  const out = [];
  for (const rawId of list) {
    const id = Number(rawId) || 0;
    if (!id) continue;
    out.push(await congelarRegistroTempo(id));
  }
  return out;
}

async function buscarRegistroPostoAberto({ opProducaoId = 0, numeroOp = '', kanbanProgramacaoId = null }) {
  await garantirSchemaTempoProducao();
  const { rows } = await dbQuery(
    `SELECT id, kanban_programacao_id, op_producao_id, numero_op, posto_origem,
            tipo_registro, operacao, ri_check_id,
            inicio::text AS inicio, fim::text AS fim
       FROM producao."Registro_tempo"
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
    `SELECT id, posto_origem, inicio::text AS inicio, fim::text AS fim, operadores
       FROM producao."Registro_tempo"
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

/** Une operadores do snapshot do registro com os períodos de MO que cruzam o intervalo. */
function operadoresDoRegistroPosto(reg, moPeriodos) {
  const snap = normalizarOperadoresMo(reg?.operadores);
  const periodos = periodosMoDoPosto(moPeriodos, reg?.posto_origem);
  const t0 = new Date(reg?.inicio).getTime();
  const t1 = new Date(reg?.fim || Date.now()).getTime();
  const doHist = [];
  for (const p of periodos) {
    const a = new Date(p.inicio).getTime();
    const b = new Date(p.fim || Date.now()).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    if (b <= t0 || a >= t1) continue;
    doHist.push(...(p.operadores || []));
  }
  return normalizarOperadoresMo([...snap, ...doHist]);
}

/**
 * Se não houver MO na data pedida, devolve a última configuração salva (dia anterior ou mais antigo).
 * Assim o modal abre já com os colaboradores do último input.
 */
async function buscarUltimaMaoObraAntes(dataRef) {
  await garantirSchemaTempoProducao();
  const dk = String(dataRef || dateKeyInTz(new Date())).slice(0, 10);
  const { rows } = await dbQuery(
    `SELECT data_referencia::text AS data_referencia
       FROM producao.mao_obra_linha
      WHERE data_referencia < $1::date
      ORDER BY data_referencia DESC
      LIMIT 1`,
    [dk]
  );
  const ultima = String(rows[0]?.data_referencia || '').slice(0, 10);
  if (!ultima) return { data_origem: null, itens: [] };
  const itens = await buscarMaoObraPorData(ultima);
  return { data_origem: ultima, itens };
}

function normalizarPostoMo(nome) {
  return String(nome || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function quantidadeMoValida(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(99, v);
}

/** Tempo controlado: MO=1 não altera; MO=2 divide o tempo útil por 2. */
function aplicarProporcaoMo(ms, qtdMo) {
  const n = quantidadeMoValida(qtdMo);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  if (n <= 1) return Math.round(ms);
  return Math.round(ms / n);
}

function lookupMo(map, dia, postoNome, postoKey = '') {
  if (!map) return 1;
  const dk = String(dia || '').slice(0, 10);
  const byNome = map.get(`${dk}|nome:${normalizarPostoMo(postoNome)}`);
  if (byNome) return quantidadeMoValida(byNome);
  if (postoKey) {
    const byKey = map.get(`${dk}|key:${String(postoKey)}`);
    if (byKey) return quantidadeMoValida(byKey);
  }
  return 1;
}

function normalizarOperadoresMo(lista) {
  const arr = Array.isArray(lista) ? lista : [];
  const nomes = [];
  const visto = new Set();
  for (const item of arr) {
    const nome = String(
      item && typeof item === 'object'
        ? (item.username || item.nome || item.usuario || '')
        : item
    ).trim();
    if (!nome) continue;
    const key = nome.toLowerCase();
    if (visto.has(key)) continue;
    visto.add(key);
    nomes.push(nome);
  }
  return nomes;
}

const SQL_SETOR_PRODUCAO_NORM =
  `lower(translate(trim(s.name),
     'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
     'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')) = 'producao'`;

async function listarOperadoresSetorProducao() {
  const { rows } = await dbQuery(
    `SELECT u.username
       FROM public.auth_user u
       INNER JOIN public.auth_user_profile up ON up.user_id = u.id
       INNER JOIN public.auth_sector s ON s.id = up.sector_id
      WHERE COALESCE(u.is_active, TRUE) = TRUE
        AND ${SQL_SETOR_PRODUCAO_NORM}
      ORDER BY u.username ASC`
  );
  return normalizarOperadoresMo(rows.map((r) => r.username));
}

function operadoresMoIguais(a, b) {
  const aa = normalizarOperadoresMo(a);
  const bb = normalizarOperadoresMo(b);
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

function mapearPeriodoMo(r) {
  return {
    id: Number(r.id) || null,
    posto_key: String(r.posto_key || ''),
    posto_nome: String(r.posto_nome || ''),
    quantidade: quantidadeMoValida(r.quantidade),
    operadores: normalizarOperadoresMo(r.operadores),
    inicio: r.inicio || null,
    fim: r.fim || null,
    usuario: r.usuario || null,
    data_referencia: String(r.data_referencia || '').slice(0, 10),
  };
}

function periodosMoDoPosto(periodosMap, postoNome, postoKey = '') {
  if (!periodosMap) return [];
  const byNome = periodosMap.get(`nome:${normalizarPostoMo(postoNome)}`);
  if (Array.isArray(byNome) && byNome.length) return byNome;
  if (postoKey) {
    const byKey = periodosMap.get(`key:${String(postoKey)}`);
    if (Array.isArray(byKey) && byKey.length) return byKey;
  }
  return [];
}

function calcularTempoUtilComMo(inicio, fim, turnos, periodos, qtdFallback) {
  const t0 = new Date(inicio).getTime();
  const t1 = new Date(fim).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0;
  const lista = (periodos || [])
    .map((p) => ({
      ini: new Date(p.inicio).getTime(),
      fim: p.fim ? new Date(p.fim).getTime() : t1,
      qtd: quantidadeMoValida(p.quantidade),
    }))
    .filter((p) => Number.isFinite(p.ini) && Number.isFinite(p.fim) && p.fim > p.ini)
    .sort((a, b) => a.ini - b.ini);

  if (!lista.length) {
    return aplicarProporcaoMo(calcularTempoUtilMs(inicio, fim, turnos), qtdFallback);
  }

  let total = 0;
  let cursor = t0;
  for (const p of lista) {
    const a = Math.max(cursor, p.ini);
    const b = Math.min(t1, p.fim);
    if (b > a) {
      total += aplicarProporcaoMo(calcularTempoUtilMs(new Date(a), new Date(b), turnos), p.qtd);
      cursor = Math.max(cursor, b);
    }
  }
  if (cursor < t1) {
    total += aplicarProporcaoMo(calcularTempoUtilMs(new Date(cursor), new Date(t1), turnos), qtdFallback);
  }
  return total;
}

async function buscarPeriodosMoPorData(dataRef) {
  await garantirSchemaTempoProducao();
  const dk = String(dataRef || dateKeyInTz(new Date())).slice(0, 10);
  const { rows } = await dbQuery(
    `SELECT id, posto_key, posto_nome, quantidade, operadores, usuario,
            inicio, fim, data_referencia::text AS data_referencia
       FROM producao.mao_obra_linha_hist
      WHERE data_referencia = $1::date
      ORDER BY posto_key, inicio ASC, id ASC`,
    [dk]
  );
  return rows.map(mapearPeriodoMo);
}

async function buscarPeriodosMoPeriodo(inicio, fim) {
  await garantirSchemaTempoProducao();
  const dkIni = dateKeyInTz(new Date(inicio || Date.now()));
  const dkFim = dateKeyInTz(new Date(fim || Date.now()));
  const { rows } = await dbQuery(
    `SELECT id, posto_key, posto_nome, quantidade, operadores, usuario,
            inicio, fim, data_referencia::text AS data_referencia
       FROM producao.mao_obra_linha_hist
      WHERE data_referencia >= $1::date
        AND data_referencia <= $2::date
      ORDER BY inicio ASC, id ASC`,
    [dkIni, dkFim]
  );
  const map = new Map();
  for (const r of rows) {
    const periodo = mapearPeriodoMo(r);
    const kNome = `nome:${normalizarPostoMo(periodo.posto_nome)}`;
    const kKey = `key:${periodo.posto_key}`;
    if (!map.has(kNome)) map.set(kNome, []);
    if (!map.has(kKey)) map.set(kKey, []);
    map.get(kNome).push(periodo);
    if (periodo.posto_key) map.get(kKey).push(periodo);
  }
  return map;
}

async function buscarMaoObraPorData(dataRef) {
  await garantirSchemaTempoProducao();
  const dk = String(dataRef || dateKeyInTz(new Date())).slice(0, 10);
  const { rows } = await dbQuery(
    `SELECT posto_key, posto_nome, quantidade, operadores, usuario,
            data_referencia::text AS data_referencia
       FROM producao.mao_obra_linha
      WHERE data_referencia = $1::date
      ORDER BY id`,
    [dk]
  );
  const hist = await buscarPeriodosMoPorData(dk);
  const histPorKey = new Map();
  for (const p of hist) {
    const k = p.posto_key || normalizarPostoMo(p.posto_nome);
    if (!histPorKey.has(k)) histPorKey.set(k, []);
    histPorKey.get(k).push(p);
  }
  const itens = rows.map((r) => {
    const postoKey = String(r.posto_key || '');
    return {
      posto_key: postoKey,
      posto_nome: String(r.posto_nome || ''),
      quantidade: quantidadeMoValida(r.quantidade),
      operadores: normalizarOperadoresMo(r.operadores),
      usuario: r.usuario || null,
      data_referencia: String(r.data_referencia || dk).slice(0, 10),
      historico: histPorKey.get(postoKey) || histPorKey.get(normalizarPostoMo(r.posto_nome)) || [],
    };
  });
  return itens;
}

async function salvarMaoObraDia(dataRef, itens, usuario) {
  await garantirSchemaTempoProducao();
  const dk = String(dataRef || dateKeyInTz(new Date())).slice(0, 10);
  const lista = Array.isArray(itens) ? itens : [];
  const out = [];
  for (const item of lista) {
    const postoKey = String(item.posto_key || item.key || '').trim();
    const postoNome = String(item.posto_nome || item.nome || postoKey).trim();
    if (!postoKey || !postoNome) continue;
    const quantidade = quantidadeMoValida(item.quantidade);
    const operadores = normalizarOperadoresMo(item.operadores).slice(0, quantidade);
    const { rows: atualRows } = await dbQuery(
      `SELECT quantidade, operadores
         FROM producao.mao_obra_linha
        WHERE data_referencia = $1::date AND posto_key = $2
        LIMIT 1`,
      [dk, postoKey]
    );
    const atual = atualRows[0] || null;
    const mudou = !atual
      || quantidadeMoValida(atual.quantidade) !== quantidade
      || !operadoresMoIguais(atual.operadores, operadores);

    const { rows } = await dbQuery(
      `INSERT INTO producao.mao_obra_linha
         (data_referencia, posto_key, posto_nome, quantidade, operadores, usuario, updated_at)
       VALUES ($1::date, $2, $3, $4, $5::jsonb, $6, NOW())
       ON CONFLICT (data_referencia, posto_key) DO UPDATE SET
         posto_nome = EXCLUDED.posto_nome,
         quantidade = EXCLUDED.quantidade,
         operadores = EXCLUDED.operadores,
         usuario = EXCLUDED.usuario,
         updated_at = NOW()
       RETURNING posto_key, posto_nome, quantidade, operadores`,
      [dk, postoKey, postoNome, quantidade, JSON.stringify(operadores), usuario || null]
    );

    if (mudou) {
      await dbQuery(
        `UPDATE producao.mao_obra_linha_hist
            SET fim = NOW()
          WHERE data_referencia = $1::date
            AND posto_key = $2
            AND fim IS NULL`,
        [dk, postoKey]
      );
      await dbQuery(
        `INSERT INTO producao.mao_obra_linha_hist
           (data_referencia, posto_key, posto_nome, quantidade, operadores, inicio, usuario)
         VALUES ($1::date, $2, $3, $4, $5::jsonb, NOW(), $6)`,
        [dk, postoKey, postoNome, quantidade, JSON.stringify(operadores), usuario || null]
      );
      // Atualiza snapshot nos tempos abertos deste posto (máquinas em andamento).
      try {
        await dbQuery(
          `UPDATE producao."Registro_tempo"
              SET operadores = $1::jsonb
            WHERE fim IS NULL
              AND tipo_registro = 'posto'
              AND (
                LOWER(TRIM(COALESCE(posto_origem, ''))) = LOWER(TRIM($2))
                OR LOWER(TRIM(COALESCE(posto_origem, ''))) = LOWER(TRIM($3))
              )`,
          [JSON.stringify(operadores), postoNome, postoKey]
        );
      } catch (_) { /* coluna pode não existir em migração parcial */ }
    }

    if (rows[0]) {
      out.push({
        posto_key: rows[0].posto_key,
        posto_nome: rows[0].posto_nome,
        quantidade: quantidadeMoValida(rows[0].quantidade),
        operadores: normalizarOperadoresMo(rows[0].operadores),
      });
    }
  }
  return { data_referencia: dk, itens: out };
}

async function buscarMapaMoPeriodo(inicio, fim) {
  await garantirSchemaTempoProducao();
  const dkIni = dateKeyInTz(new Date(inicio || Date.now()));
  const dkFim = dateKeyInTz(new Date(fim || Date.now()));
  const { rows } = await dbQuery(
    `SELECT data_referencia::text AS data_referencia, posto_key, posto_nome, quantidade
       FROM producao.mao_obra_linha
      WHERE data_referencia >= $1::date
        AND data_referencia <= $2::date`,
    [dkIni, dkFim]
  );
  const map = new Map();
  for (const r of rows) {
    const dk = String(r.data_referencia || '').slice(0, 10);
    if (!dk) continue;
    map.set(`${dk}|nome:${normalizarPostoMo(r.posto_nome)}`, quantidadeMoValida(r.quantidade));
    map.set(`${dk}|key:${String(r.posto_key || '')}`, quantidadeMoValida(r.quantidade));
  }
  return map;
}

async function calcularTempoTotalOpUtil(opRefs) {
  const regs = await buscarRegistrosPostoOp(opRefs);
  if (!regs.length) return { tempo_ms: 0, tempo_formatado: '—' };
  const agora = new Date();
  const inicioGeral = regs[0].inicio;
  const fimGeral = regs[regs.length - 1].fim || agora.toISOString();
  const turnos = await buscarTurnosNoPeriodo(inicioGeral, fimGeral);
  const moMap = opRefs?.moMap || await buscarMapaMoPeriodo(inicioGeral, fimGeral);
  const moPeriodos = opRefs?.moPeriodos || await buscarPeriodosMoPeriodo(inicioGeral, fimGeral);
  let totalMs = 0;
  for (const reg of regs) {
    const fim = reg.fim || agora.toISOString();
    const dia = dateKeyInTz(new Date(reg.inicio));
    totalMs += calcularTempoUtilComMo(
      reg.inicio,
      fim,
      turnos,
      periodosMoDoPosto(moPeriodos, reg.posto_origem),
      lookupMo(moMap, dia, reg.posto_origem)
    );
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
      qtd_mo: 1,
    };
  }
  const fim = new Date();
  const turnos = await buscarTurnosNoPeriodo(reg.inicio, fim);
  const moMap = opRefs?.moMap || await buscarMapaMoPeriodo(reg.inicio, fim);
  const moPeriodos = opRefs?.moPeriodos || await buscarPeriodosMoPeriodo(reg.inicio, fim);
  const qtdMo = lookupMo(moMap, dateKeyInTz(new Date(reg.inicio)), reg.posto_origem);
  const ms = calcularTempoUtilComMo(
    reg.inicio,
    fim,
    turnos,
    periodosMoDoPosto(moPeriodos, reg.posto_origem),
    qtdMo
  );
  return {
    registro: reg,
    tempo_ms: ms,
    tempo_formatado: formatarDuracao(ms),
    tempo_total_ms: total.tempo_ms,
    tempo_total_formatado: total.tempo_formatado,
    posto_origem: reg.posto_origem,
    inicio: reg.inicio,
    qtd_mo: qtdMo,
  };
}

async function calcularTemposPostoPorOps(ops) {
  const lista = Array.isArray(ops) ? ops : [];
  const resultado = {};
  const agora = new Date();
  const moMap = await buscarMapaMoPeriodo(addDaysToDateKey(dateKeyInTz(agora), -45), agora);
  const moPeriodos = await buscarPeriodosMoPeriodo(addDaysToDateKey(dateKeyInTz(agora), -45), agora);
  await Promise.all(lista.map(async (op) => {
    const opProducaoId = Number(op.op_producao_id) || Number(op.id) || 0;
    const numeroOp = String(op.numero_op || op.identificacao || '').trim();
    const kanbanProgramacaoId = Number(op.kanban_programacao_id) || null;
    const key = opProducaoId > 0 ? `id:${opProducaoId}` : (numeroOp ? `op:${numeroOp.toUpperCase()}` : null);
    if (!key) return;
    const tempo = await calcularTempoPostoUtil({
      opProducaoId, numeroOp, kanbanProgramacaoId, moMap, moPeriodos,
    });
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
       FROM producao."Turno_padrao"
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
       FROM producao."Turno_padrao"
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
      `UPDATE producao."Turno_padrao"
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
    `INSERT INTO producao."Turno_padrao"
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
       FROM producao."Turno_dia"
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
      `UPDATE producao."Turno_dia"
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
    `INSERT INTO producao."Turno_dia"
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
       FROM producao."Turno_dia"
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
       FROM producao."Turno_padrao"
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

/**
 * Detalhe de uma máquina/OP: tempo útil por posto + colaboradores que passaram nela.
 */
async function detalheRegistroProducao(opRefs = {}) {
  await garantirSchemaTempoProducao();
  const regs = await buscarRegistrosPostoOp(opRefs);
  if (!regs.length) {
    return {
      postos: [],
      tempo_total_ms: 0,
      tempo_total_formatado: '—',
      colaboradores: [],
    };
  }
  const agora = new Date();
  const inicioGeral = regs[0].inicio;
  const fimGeral = regs[regs.length - 1].fim || agora.toISOString();
  const turnos = await buscarTurnosNoPeriodo(inicioGeral, fimGeral);
  const moMap = await buscarMapaMoPeriodo(inicioGeral, fimGeral);
  const moPeriodos = await buscarPeriodosMoPeriodo(inicioGeral, fimGeral);
  const postos = [];
  const todosOps = [];
  let totalMs = 0;
  for (const reg of regs) {
    const fim = reg.fim || agora.toISOString();
    const dia = dateKeyInTz(new Date(reg.inicio));
    const ms = calcularTempoUtilComMo(
      reg.inicio,
      fim,
      turnos,
      periodosMoDoPosto(moPeriodos, reg.posto_origem),
      lookupMo(moMap, dia, reg.posto_origem)
    );
    totalMs += ms;
    const operadores = operadoresDoRegistroPosto(reg, moPeriodos);
    todosOps.push(...operadores);
    postos.push({
      posto: String(reg.posto_origem || ''),
      inicio: reg.inicio,
      fim: reg.fim || null,
      aberto: !reg.fim,
      tempo_ms: ms,
      tempo_formatado: formatarDuracao(ms),
      operadores,
    });
  }
  return {
    postos,
    tempo_total_ms: totalMs,
    tempo_total_formatado: formatarDuracao(totalMs),
    colaboradores: normalizarOperadoresMo(todosOps),
  };
}

module.exports = {
  garantirSchemaTempoProducao,
  iniciarCicloPosto,
  registrarRiConcluida,
  encerrarCicloPosto,
  iniciarRegistroTempo,
  encerrarRegistrosAbertos,
  congelarRegistroTempo,
  congelarRegistrosTempo,
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
  normalizarPostoMo,
  quantidadeMoValida,
  aplicarProporcaoMo,
  lookupMo,
  buscarMaoObraPorData,
  buscarUltimaMaoObraAntes,
  salvarMaoObraDia,
  listarOperadoresSetorProducao,
  buscarMapaMoPeriodo,
  buscarPeriodosMoPeriodo,
  calcularTempoUtilComMo,
  periodosMoDoPosto,
  operadoresDoRegistroPosto,
  detalheRegistroProducao,
};
