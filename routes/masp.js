/**
 * MASP (Metodologia de Análise e Solução de Problemas) — Relatório Gerencial AT
 * Schema: masp.*
 */
const express = require('express');
const { pool } = require('../src/db');

const router = express.Router();

const DISCIPLINAS_ACAO = new Set(['D5', 'D6', 'D7']);
const ISHI_CATS = new Set(['metodo', 'maquina', 'material', 'mao_obra', 'meio_ambiente', 'medicao']);

let _ensureMaspPromise = null;

async function ensureMaspSchema() {
  if (_ensureMaspPromise) return _ensureMaspPromise;
  _ensureMaspPromise = pool.query(`
    CREATE SCHEMA IF NOT EXISTS masp;

    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS tipo_falha TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS validado BOOLEAN DEFAULT TRUE;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS comentario_tecnico TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS fechamento_at TEXT;
    ALTER TABLE sac.at ALTER COLUMN validado SET DEFAULT TRUE;

    CREATE TABLE IF NOT EXISTS masp._schema_flags (
      flag TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    DO $migValidado$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM masp._schema_flags WHERE flag = 'validado_default_true') THEN
        UPDATE sac.at SET validado = TRUE WHERE COALESCE(validado, FALSE) = FALSE;
        INSERT INTO masp._schema_flags (flag) VALUES ('validado_default_true');
      END IF;
    END
    $migValidado$;


    CREATE TABLE IF NOT EXISTS sac.tipo_falha (
      id         BIGSERIAL PRIMARY KEY,
      nome       TEXT NOT NULL UNIQUE,
      criado_em  TIMESTAMP NOT NULL DEFAULT NOW()
    );
    INSERT INTO sac.tipo_falha (nome)
    SELECT v FROM (VALUES ('Produção'), ('Engenharia'), ('Cliente'), ('Comercial')) AS t(v)
    WHERE NOT EXISTS (SELECT 1 FROM sac.tipo_falha LIMIT 1);

    CREATE TABLE IF NOT EXISTS masp.analise (
      id BIGSERIAL PRIMARY KEY,
      tag_problema TEXT NOT NULL,
      modo TEXT NOT NULL DEFAULT '3m',
      tipo_at TEXT NOT NULL DEFAULT 'Qualidade',
      periodo_inicio DATE,
      periodo_fim_exclusive DATE,
      periodo_label TEXT,
      resumo TEXT,
      d3_contencao TEXT,
      d4_ishikawa JSONB NOT NULL DEFAULT '{}'::jsonb,
      d4_5porques JSONB NOT NULL DEFAULT '[]'::jsonb,
      d8_reconhecimento TEXT,
      status TEXT NOT NULL DEFAULT 'em_andamento',
      criado_por TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_por TEXT,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS masp_analise_tag_idx ON masp.analise (tag_problema);
    CREATE INDEX IF NOT EXISTS masp_analise_periodo_idx
      ON masp.analise (modo, tipo_at, periodo_inicio, periodo_fim_exclusive);

    CREATE TABLE IF NOT EXISTS masp.analise_equipe (
      id BIGSERIAL PRIMARY KEY,
      analise_id BIGINT NOT NULL REFERENCES masp.analise(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL,
      username TEXT,
      nome TEXT,
      sector_id BIGINT,
      sector_name TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (analise_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS masp.analise_acao (
      id BIGSERIAL PRIMARY KEY,
      analise_id BIGINT NOT NULL REFERENCES masp.analise(id) ON DELETE CASCADE,
      disciplina TEXT NOT NULL,
      descricao TEXT,
      responsavel_user_id BIGINT,
      responsavel_nome TEXT,
      prazo DATE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS masp_analise_acao_disc_idx
      ON masp.analise_acao (analise_id, disciplina);

    CREATE TABLE IF NOT EXISTS masp.ishikawa_causa (
      id BIGSERIAL PRIMARY KEY,
      analise_id BIGINT NOT NULL REFERENCES masp.analise(id) ON DELETE CASCADE,
      categoria TEXT NOT NULL,
      texto TEXT NOT NULL DEFAULT '',
      comentario TEXT,
      validado BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INT NOT NULL DEFAULT 0,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS masp_ishikawa_causa_analise_idx
      ON masp.ishikawa_causa (analise_id, categoria, sort_order);

    CREATE TABLE IF NOT EXISTS masp.causa_porque (
      id BIGSERIAL PRIMARY KEY,
      causa_id BIGINT NOT NULL REFERENCES masp.ishikawa_causa(id) ON DELETE CASCADE,
      n INT NOT NULL DEFAULT 1,
      pergunta TEXT,
      resposta TEXT,
      sort_order INT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS masp_causa_porque_causa_idx
      ON masp.causa_porque (causa_id, sort_order);

    ALTER TABLE masp.analise_acao ADD COLUMN IF NOT EXISTS causa_id BIGINT;
    ALTER TABLE masp.analise_acao ADD COLUMN IF NOT EXISTS ultimo_porque TEXT;
  `).then(() => undefined).catch((err) => {
    _ensureMaspPromise = null;
    throw err;
  });
  return _ensureMaspPromise;
}

function mesAtualReferencia(refDate = new Date()) {
  const ano = refDate.getFullYear();
  const mesNum = refDate.getMonth() + 1;
  const pad = (n) => String(n).padStart(2, '0');
  return { ano, mesNum, mesRaw: `${ano}-${pad(mesNum)}` };
}

/** Mesmo critério de período do Relatório Gerencial AT. */
function calcPeriodoMasp(modoRaw, refDate = new Date()) {
  const modosValidos = new Set(['mes', 'mes_anterior', '3m', '6m', 'anual']);
  const modo = modosValidos.has(modoRaw) ? modoRaw : '3m';
  const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const { ano, mesNum, mesRaw } = mesAtualReferencia(refDate);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtYmd = (y, m, d = 1) => `${y}-${pad(m)}-${pad(d)}`;
  const mesLabel = (y, m) => (m >= 1 && m <= 12 ? `${nomesMes[m - 1]}/${y}` : `${y}-${pad(m)}`);

  if (modo === 'mes' || modo === 'mes_anterior') {
    const y = modo === 'mes_anterior' ? (mesNum === 1 ? ano - 1 : ano) : ano;
    const m = modo === 'mes_anterior' ? (mesNum === 1 ? 12 : mesNum - 1) : mesNum;
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    return {
      modo,
      inicio: fmtYmd(y, m),
      fimExclusive: fmtYmd(nextY, nextM),
      label: mesLabel(y, m),
      mesRef: `${y}-${pad(m)}`,
    };
  }

  const qtd = modo === '3m' ? 3 : (modo === '6m' ? 6 : 12);
  const inicioDate = new Date(ano, mesNum - 1 - qtd, 1);
  const fimY = mesNum === 1 ? ano - 1 : ano;
  const fimM = mesNum === 1 ? 12 : mesNum - 1;

  return {
    modo,
    inicio: fmtYmd(inicioDate.getFullYear(), inicioDate.getMonth() + 1),
    fimExclusive: fmtYmd(ano, mesNum),
    label: `${mesLabel(inicioDate.getFullYear(), inicioDate.getMonth() + 1)} a ${mesLabel(fimY, fimM)}`,
    mesRef: mesRaw,
  };
}

function buildTipoSql(tipoRaw) {
  const tipo = String(tipoRaw || '').trim();
  if (!tipo) return '';
  const safe = tipo.replace(/'/g, "''");
  return ` AND LOWER(TRIM(REGEXP_REPLACE(COALESCE(a.tipo, ''), '[_]+', ' ', 'g'))) = LOWER(TRIM('${safe}'))`;
}

function usuarioLogado(req) {
  return req.session?.user?.fullName
    || req.session?.user?.nome_completo
    || req.session?.user?.username
    || req.session?.user?.login
    || 'sistema';
}

function formatAcao(a) {
  let prazo = a.prazo || null;
  if (prazo instanceof Date) prazo = prazo.toISOString().slice(0, 10);
  else if (prazo) prazo = String(prazo).slice(0, 10);
  return {
    id: a.id,
    disciplina: a.disciplina,
    descricao: a.descricao || '',
    responsavel_user_id: a.responsavel_user_id,
    responsavel_nome: a.responsavel_nome || '',
    prazo,
    causa_id: a.causa_id || null,
    ultimo_porque: a.ultimo_porque || '',
    criado_em: a.criado_em,
  };
}

async function carregarAnaliseCompleta(analiseId) {
  const { rows } = await pool.query(`SELECT * FROM masp.analise WHERE id = $1`, [analiseId]);
  const analise = rows[0];
  if (!analise) return null;

  const [equipe, acoes, causas] = await Promise.all([
    pool.query(
      `SELECT id, user_id, username, nome, sector_id, sector_name, criado_em
         FROM masp.analise_equipe WHERE analise_id = $1 ORDER BY criado_em, id`,
      [analiseId]
    ),
    pool.query(
      `SELECT id, disciplina, descricao, responsavel_user_id, responsavel_nome, prazo,
              causa_id, ultimo_porque, criado_em
         FROM masp.analise_acao WHERE analise_id = $1 ORDER BY disciplina, id`,
      [analiseId]
    ),
    pool.query(
      `SELECT id, categoria, texto, comentario, validado, sort_order
         FROM masp.ishikawa_causa WHERE analise_id = $1
         ORDER BY sort_order, id`,
      [analiseId]
    ),
  ]);

  const causaIds = (causas.rows || []).map((c) => c.id);
  let porques = [];
  if (causaIds.length) {
    const rPq = await pool.query(
      `SELECT id, causa_id, n, pergunta, resposta, sort_order
         FROM masp.causa_porque
        WHERE causa_id = ANY($1::bigint[])
        ORDER BY causa_id, sort_order, n, id`,
      [causaIds]
    );
    porques = rPq.rows || [];
  }

  const causasOut = (causas.rows || []).map((c) => ({
    id: c.id,
    categoria: c.categoria,
    texto: c.texto || '',
    comentario: c.comentario || '',
    validado: !!c.validado,
    sort_order: c.sort_order || 0,
    porques: porques
      .filter((p) => Number(p.causa_id) === Number(c.id))
      .map((p) => ({
        id: p.id,
        n: p.n,
        pergunta: p.pergunta || '',
        resposta: p.resposta || '',
        sort_order: p.sort_order || 0,
      })),
  }));

  return {
    id: analise.id,
    tag_problema: analise.tag_problema,
    modo: analise.modo,
    tipo_at: analise.tipo_at,
    periodo_inicio: analise.periodo_inicio,
    periodo_fim_exclusive: analise.periodo_fim_exclusive,
    periodo_label: analise.periodo_label,
    resumo: analise.resumo || '',
    d3_contencao: analise.d3_contencao || '',
    d8_reconhecimento: analise.d8_reconhecimento || '',
    status: analise.status,
    criado_por: analise.criado_por,
    criado_em: analise.criado_em,
    atualizado_por: analise.atualizado_por,
    atualizado_em: analise.atualizado_em,
    equipe: equipe.rows || [],
    causas: causasOut,
    acoes: {
      D5: (acoes.rows || []).filter((a) => a.disciplina === 'D5').map(formatAcao),
      D6: (acoes.rows || []).filter((a) => a.disciplina === 'D6').map(formatAcao),
      D7: (acoes.rows || []).filter((a) => a.disciplina === 'D7').map(formatAcao),
    },
  };
}

/** Mesma base da Análise de Lote (INNER JOIN at_busca_selecionada). */
function sqlLoteOsPorTag() {
  return `
    WITH lote_base AS (
      SELECT DISTINCT ON (a.id)
        a.id,
        a.data AS data_os,
        COALESCE(NULLIF(TRIM(a.estado), ''), 'N/D') AS estado,
        COALESCE(NULLIF(TRIM(a.status), ''), '') AS status_os,
        COALESCE(NULLIF(TRIM(a.tag_problema), ''), '(sem tag)') AS tag,
        COALESCE(NULLIF(TRIM(a.descreva_reclamacao), ''), '') AS reclamacao,
        COALESCE(NULLIF(TRIM(a.motivo_solicitacao), ''), '') AS motivo,
        COALESCE(NULLIF(TRIM(a.nome_revenda_cliente), ''), '') AS revenda_cliente,
        TRIM(COALESCE(s.modelo, a.modelo, '')) AS modelo,
        TRIM(regexp_replace(TRIM(COALESCE(s.pedido, '')), '^.* /\\s*', '')) AS pedido,
        TRIM(COALESCE(s.ordem_producao, '')) AS ordem_producao,
        TRIM(COALESCE(s.cliente, '')) AS cliente,
        TRIM(COALESCE(s.nota_fiscal, '')) AS nota_fiscal,
        TRIM(COALESCE(a.tipo_falha, '')) AS tipo_falha,
        COALESCE(a.validado, TRUE) AS validado,
        COALESCE(a.comentario_tecnico, '') AS comentario_tecnico
      FROM sac.at a
      INNER JOIN sac.at_busca_selecionada s ON s.id_at = a.id
      WHERE a.data >= $1::date
        AND a.data < $2::date
        AND COALESCE(NULLIF(TRIM(a.tag_problema), ''), '(sem tag)') = $3
        __TIPO__
      ORDER BY a.id, s.id DESC
    )
    SELECT * FROM lote_base
    ORDER BY data_os ASC, id ASC
  `;
}

// GET /at/relatorio-gerencial/masp/setores
router.get('/at/relatorio-gerencial/masp/setores', async (req, res) => {
  try {
    await ensureMaspSchema();
    const { rows } = await pool.query(
      `SELECT id, name FROM public.auth_sector
        WHERE COALESCE(active, TRUE) = TRUE ORDER BY name`
    );
    return res.json({ ok: true, setores: rows });
  } catch (err) {
    console.error('[MASP] setores:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/relatorio-gerencial/masp/users?sector_id=
router.get('/at/relatorio-gerencial/masp/users', async (req, res) => {
  try {
    await ensureMaspSchema();
    const sectorId = Number(req.query.sector_id);
    if (!Number.isInteger(sectorId) || sectorId <= 0) {
      return res.status(400).json({ ok: false, error: 'sector_id inválido.' });
    }
    const { rows } = await pool.query(
      `SELECT u.id, u.username,
              COALESCE(NULLIF(TRIM(u.nome_completo), ''), u.username::text) AS nome,
              s.id AS sector_id, s.name AS sector_name
         FROM public.auth_user u
         INNER JOIN public.auth_user_profile up ON up.user_id = u.id
         INNER JOIN public.auth_sector s ON s.id = up.sector_id
        WHERE up.sector_id = $1 AND COALESCE(u.is_active, TRUE) = TRUE
        ORDER BY nome, u.username`,
      [sectorId]
    );
    return res.json({ ok: true, users: rows });
  } catch (err) {
    console.error('[MASP] users:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/relatorio-gerencial/masp/os — O.S. da mesma base da Análise de Lote
router.get('/at/relatorio-gerencial/masp/os', async (req, res) => {
  try {
    await ensureMaspSchema();
    const tag = String(req.query.tag || '').trim();
    if (!tag) return res.status(400).json({ ok: false, error: 'Informe a tag (defeito).' });

    const modoRaw = String(req.query.modo || '3m').trim().toLowerCase();
    const tipoFiltro = req.query.tipo === undefined || req.query.tipo === null
      ? 'Qualidade'
      : String(req.query.tipo).trim();
    const periodo = calcPeriodoMasp(modoRaw);
    const tipoSql = buildTipoSql(tipoFiltro);
    const sql = sqlLoteOsPorTag().replace('__TIPO__', tipoSql);

    const { rows } = await pool.query(sql, [periodo.inicio, periodo.fimExclusive, tag]);

    return res.json({
      ok: true,
      tag,
      periodo: periodo.label,
      modo: periodo.modo,
      tipo: tipoFiltro || 'Todos',
      total: rows.length,
      rows,
    });
  } catch (err) {
    console.error('[MASP] os:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /at/relatorio-gerencial/masp/os/:id
router.patch('/at/relatorio-gerencial/masp/os/:id', async (req, res) => {
  try {
    await ensureMaspSchema();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'ID inválido.' });
    }

    const hasTipo = Object.prototype.hasOwnProperty.call(req.body || {}, 'tipo_falha');
    const hasValidado = Object.prototype.hasOwnProperty.call(req.body || {}, 'validado');
    const hasComentario = Object.prototype.hasOwnProperty.call(req.body || {}, 'comentario_tecnico');
    if (!hasTipo && !hasValidado && !hasComentario) {
      return res.status(400).json({ ok: false, error: 'Informe tipo_falha, validado e/ou comentario_tecnico.' });
    }

    const sets = [];
    const params = [];
    if (hasTipo) {
      const tipo = String(req.body.tipo_falha || '').trim().slice(0, 120) || null;
      params.push(tipo);
      sets.push(`tipo_falha = $${params.length}`);
    }
    if (hasValidado) {
      params.push(!!req.body.validado);
      sets.push(`validado = $${params.length}`);
    }
    if (hasComentario) {
      params.push(String(req.body.comentario_tecnico || '').trim().slice(0, 4000) || null);
      sets.push(`comentario_tecnico = $${params.length}`);
    }
    params.push(id);

    const { rows } = await pool.query(
      `UPDATE sac.at SET ${sets.join(', ')}
        WHERE id = $${params.length}
        RETURNING id, tipo_falha, validado, comentario_tecnico`,
      params
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: 'O.S. não encontrada.' });
    return res.json({
      ok: true,
      id: rows[0].id,
      tipo_falha: rows[0].tipo_falha || '',
      validado: !!rows[0].validado,
      comentario_tecnico: rows[0].comentario_tecnico || '',
    });
  } catch (err) {
    console.error('[MASP] patch os:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/relatorio-gerencial/masp
router.get('/at/relatorio-gerencial/masp', async (req, res) => {
  try {
    await ensureMaspSchema();
    const tag = String(req.query.tag || '').trim();
    if (!tag) return res.status(400).json({ ok: false, error: 'Informe a tag (defeito).' });

    const modoRaw = String(req.query.modo || '3m').trim().toLowerCase();
    const tipoFiltro = req.query.tipo === undefined || req.query.tipo === null
      ? 'Qualidade'
      : String(req.query.tipo).trim();
    const periodo = calcPeriodoMasp(modoRaw);

    const { rows } = await pool.query(
      `SELECT id FROM masp.analise
        WHERE tag_problema = $1 AND modo = $2 AND tipo_at = $3
          AND periodo_inicio = $4::date AND periodo_fim_exclusive = $5::date
        ORDER BY atualizado_em DESC, id DESC LIMIT 1`,
      [tag, periodo.modo, tipoFiltro || 'Todos', periodo.inicio, periodo.fimExclusive]
    );

    if (rows[0]) {
      const data = await carregarAnaliseCompleta(rows[0].id);
      return res.json({ ok: true, existe: true, periodo: periodo.label, analise: data });
    }

    return res.json({
      ok: true,
      existe: false,
      periodo: periodo.label,
      analise: {
        id: null,
        tag_problema: tag,
        modo: periodo.modo,
        tipo_at: tipoFiltro || 'Todos',
        periodo_inicio: periodo.inicio,
        periodo_fim_exclusive: periodo.fimExclusive,
        periodo_label: periodo.label,
        resumo: '',
        d3_contencao: '',
        d8_reconhecimento: '',
        status: 'em_andamento',
        equipe: [],
        causas: [],
        acoes: { D5: [], D6: [], D7: [] },
      },
    });
  } catch (err) {
    console.error('[MASP] get:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /at/relatorio-gerencial/masp
router.put('/at/relatorio-gerencial/masp', async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureMaspSchema();
    const body = req.body || {};
    const tag = String(body.tag_problema || body.tag || '').trim();
    if (!tag) {
      client.release();
      return res.status(400).json({ ok: false, error: 'tag_problema obrigatório.' });
    }

    const modoRaw = String(body.modo || '3m').trim().toLowerCase();
    const tipoFiltro = body.tipo_at !== undefined
      ? String(body.tipo_at || '').trim()
      : (body.tipo !== undefined ? String(body.tipo || '').trim() : 'Qualidade');
    const periodo = calcPeriodoMasp(modoRaw);
    const usuario = usuarioLogado(req);

    const resumo = String(body.resumo || '').trim().slice(0, 8000);
    const d3 = String(body.d3_contencao || '').trim().slice(0, 8000);
    const d8 = String(body.d8_reconhecimento || '').trim().slice(0, 8000);
    const status = String(body.status || 'em_andamento').trim().slice(0, 40) || 'em_andamento';
    const equipeIn = Array.isArray(body.equipe) ? body.equipe : [];
    const causasIn = Array.isArray(body.causas) ? body.causas : [];
    const acoesIn = Array.isArray(body.acoes) ? body.acoes : [];

    await client.query('BEGIN');

    let analiseId = Number(body.id) || null;
    if (analiseId) {
      const chk = await client.query(`SELECT id FROM masp.analise WHERE id = $1`, [analiseId]);
      if (!chk.rows[0]) analiseId = null;
    }
    if (!analiseId) {
      const found = await client.query(
        `SELECT id FROM masp.analise
          WHERE tag_problema = $1 AND modo = $2 AND tipo_at = $3
            AND periodo_inicio = $4::date AND periodo_fim_exclusive = $5::date
          ORDER BY id DESC LIMIT 1`,
        [tag, periodo.modo, tipoFiltro || 'Todos', periodo.inicio, periodo.fimExclusive]
      );
      analiseId = found.rows[0]?.id || null;
    }

    if (analiseId) {
      await client.query(
        `UPDATE masp.analise SET
           tag_problema=$2, modo=$3, tipo_at=$4,
           periodo_inicio=$5::date, periodo_fim_exclusive=$6::date, periodo_label=$7,
           resumo=$8, d3_contencao=$9, d8_reconhecimento=$10, status=$11,
           atualizado_por=$12, atualizado_em=NOW()
         WHERE id=$1`,
        [
          analiseId, tag, periodo.modo, tipoFiltro || 'Todos',
          periodo.inicio, periodo.fimExclusive, periodo.label,
          resumo || null, d3 || null, d8 || null, status, usuario,
        ]
      );
    } else {
      const ins = await client.query(
        `INSERT INTO masp.analise (
           tag_problema, modo, tipo_at, periodo_inicio, periodo_fim_exclusive, periodo_label,
           resumo, d3_contencao, d8_reconhecimento, status, criado_por, atualizado_por
         ) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,$10,$11,$11)
         RETURNING id`,
        [
          tag, periodo.modo, tipoFiltro || 'Todos',
          periodo.inicio, periodo.fimExclusive, periodo.label,
          resumo || null, d3 || null, d8 || null, status, usuario,
        ]
      );
      analiseId = ins.rows[0].id;
    }

    await client.query(`DELETE FROM masp.analise_equipe WHERE analise_id = $1`, [analiseId]);
    for (const m of equipeIn) {
      const userId = Number(m.user_id || m.id);
      if (!Number.isInteger(userId) || userId <= 0) continue;
      await client.query(
        `INSERT INTO masp.analise_equipe
           (analise_id, user_id, username, nome, sector_id, sector_name)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (analise_id, user_id) DO NOTHING`,
        [
          analiseId, userId,
          String(m.username || '').trim().slice(0, 120) || null,
          String(m.nome || '').trim().slice(0, 200) || null,
          Number(m.sector_id) || null,
          String(m.sector_name || '').trim().slice(0, 120) || null,
        ]
      );
    }

    // Ishikawa: recria causas + porquês
    await client.query(`DELETE FROM masp.ishikawa_causa WHERE analise_id = $1`, [analiseId]);
    const tempToId = new Map();
    let sortCausa = 0;
    for (const c of causasIn) {
      const cat = String(c.categoria || '').trim();
      if (!ISHI_CATS.has(cat)) continue;
      const texto = String(c.texto || '').trim().slice(0, 2000);
      if (!texto && !c.validado) continue;
      const insC = await client.query(
        `INSERT INTO masp.ishikawa_causa
           (analise_id, categoria, texto, comentario, validado, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          analiseId, cat, texto || '(sem texto)',
          String(c.comentario || '').trim().slice(0, 4000) || null,
          !!c.validado, sortCausa++,
        ]
      );
      const newId = insC.rows[0].id;
      const tempKey = String(c.temp_id || c.id || '');
      if (tempKey) tempToId.set(tempKey, newId);
      tempToId.set(String(newId), newId);

      const porques = Array.isArray(c.porques) ? c.porques : [];
      let sortPq = 0;
      for (const p of porques) {
        const pergunta = String(p.pergunta || p.porque || '').trim().slice(0, 1000);
        const resposta = String(p.resposta || '').trim().slice(0, 2000);
        if (!pergunta && !resposta) continue;
        await client.query(
          `INSERT INTO masp.causa_porque (causa_id, n, pergunta, resposta, sort_order)
           VALUES ($1,$2,$3,$4,$5)`,
          [newId, Number(p.n) || (sortPq + 1), pergunta || null, resposta || null, sortPq++]
        );
      }
    }

    await client.query(`DELETE FROM masp.analise_acao WHERE analise_id = $1`, [analiseId]);
    for (const a of acoesIn) {
      const disc = String(a.disciplina || '').trim().toUpperCase();
      if (!DISCIPLINAS_ACAO.has(disc)) continue;
      const desc = String(a.descricao || '').trim().slice(0, 4000);
      let prazo = null;
      if (a.prazo && /^\d{4}-\d{2}-\d{2}$/.test(String(a.prazo).trim())) prazo = String(a.prazo).trim();
      let causaId = null;
      if (a.causa_id != null || a.causa_temp_id != null) {
        const key = String(a.causa_temp_id || a.causa_id);
        causaId = tempToId.get(key) || (Number(a.causa_id) || null);
      }
      if (!desc && !a.responsavel_user_id && !prazo && !causaId) continue;
      await client.query(
        `INSERT INTO masp.analise_acao
           (analise_id, disciplina, descricao, responsavel_user_id, responsavel_nome, prazo, causa_id, ultimo_porque)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8)`,
        [
          analiseId, disc, desc || null,
          Number(a.responsavel_user_id) || null,
          String(a.responsavel_nome || '').trim().slice(0, 200) || null,
          prazo,
          causaId,
          String(a.ultimo_porque || '').trim().slice(0, 2000) || null,
        ]
      );
    }

    await client.query('COMMIT');
    const data = await carregarAnaliseCompleta(analiseId);
    return res.json({ ok: true, analise: data });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('[MASP] put:', err);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
ensureMaspSchema().catch((err) => {
  console.warn('[MASP] ensureSchema inicial:', err?.message || err);
});
