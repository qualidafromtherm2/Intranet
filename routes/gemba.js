// routes/gemba.js — ocorrências Gemba (chão de fábrica)
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const { dbQuery } = require('../src/db');
const { uploadPublicFile } = require('../utils/storage');

const router = express.Router();

const STORAGE_BUCKET = 'Producao';
const PASTA_BASE = 'Gemba';
const STATUS_VALIDOS = new Set(['aberta', 'em_andamento', 'resolvida', 'cancelada']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

const uploadCampos = upload.fields([
  { name: 'foto', maxCount: 1 },
  { name: 'video', maxCount: 1 },
  { name: 'foto_depois', maxCount: 1 },
]);

let schemaReady = false;

async function ensureGembaSchema() {
  if (schemaReady) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS producao`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS producao.gemba_ocorrencia (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      descricao TEXT,
      status TEXT NOT NULL DEFAULT 'aberta',
      foto_url TEXT,
      video_url TEXT,
      criado_por TEXT,
      atualizado_por TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolvido_em TIMESTAMPTZ,
      responsavel_acao TEXT,
      plano_acao TEXT,
      prazo DATE,
      data_conclusao DATE,
      foto_depois_url TEXT,
      CONSTRAINT gemba_ocorrencia_status_chk
        CHECK (status IN ('aberta', 'em_andamento', 'resolvida', 'cancelada'))
    )
  `);
  await dbQuery(`ALTER TABLE producao.gemba_ocorrencia ADD COLUMN IF NOT EXISTS responsavel_acao TEXT`);
  await dbQuery(`ALTER TABLE producao.gemba_ocorrencia ADD COLUMN IF NOT EXISTS plano_acao TEXT`);
  await dbQuery(`ALTER TABLE producao.gemba_ocorrencia ADD COLUMN IF NOT EXISTS prazo DATE`);
  await dbQuery(`ALTER TABLE producao.gemba_ocorrencia ADD COLUMN IF NOT EXISTS data_conclusao DATE`);
  await dbQuery(`ALTER TABLE producao.gemba_ocorrencia ADD COLUMN IF NOT EXISTS foto_depois_url TEXT`);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_gemba_ocorrencia_status
      ON producao.gemba_ocorrencia (status)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_gemba_ocorrencia_criado_em
      ON producao.gemba_ocorrencia (criado_em DESC)
  `);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS producao.gemba_ocorrencia_hist (
      id SERIAL PRIMARY KEY,
      ocorrencia_id INTEGER NOT NULL
        REFERENCES producao.gemba_ocorrencia(id) ON DELETE CASCADE,
      status_anterior TEXT,
      status_novo TEXT NOT NULL,
      comentario TEXT,
      alterado_por TEXT,
      alterado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_gemba_ocorrencia_hist_oc
      ON producao.gemba_ocorrencia_hist (ocorrencia_id, alterado_em DESC)
  `);
  schemaReady = true;
}

function usuarioLogado(req) {
  return req.session?.user?.fullName
    || req.session?.user?.username
    || req.session?.user?.login
    || 'sistema';
}

function extArquivo(file) {
  const byMime = mime.extension(file.mimetype);
  const byName = String(file.originalname || '').split('.').pop();
  return String(byMime || byName || 'bin').replace(/[^a-zA-Z0-9]/g, '');
}

async function uploadMidia(ocorrenciaId, tipo, file) {
  if (!file?.buffer?.length) return null;
  const nome = `${uuidv4()}.${extArquivo(file)}`;
  const pathKey = `${PASTA_BASE}/${ocorrenciaId}/${tipo}/${nome}`;
  const { url } = await uploadPublicFile(STORAGE_BUCKET, pathKey, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false,
  });
  return url;
}

async function registrarHistorico(ocorrenciaId, statusAnterior, statusNovo, comentario, alteradoPor) {
  if (!statusNovo || statusAnterior === statusNovo) return;
  await dbQuery(
    `INSERT INTO producao.gemba_ocorrencia_hist
       (ocorrencia_id, status_anterior, status_novo, comentario, alterado_por)
     VALUES ($1, $2, $3, $4, $5)`,
    [ocorrenciaId, statusAnterior || null, statusNovo, comentario || null, alteradoPor || null]
  );
}

const COLS = `
  id, titulo, descricao, status, foto_url, video_url,
  criado_por, atualizado_por, criado_em, atualizado_em, resolvido_em,
  responsavel_acao, plano_acao, prazo::text AS prazo,
  data_conclusao::text AS data_conclusao, foto_depois_url
`;

function handleMulter(req, res, next) {
  uploadCampos(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Arquivo muito grande. Limite: 80 MB.' });
    }
    return res.status(400).json({ error: err.message || 'Falha no envio do arquivo.' });
  });
}

router.get('/', async (req, res) => {
  try {
    await ensureGembaSchema();
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim();
    const conds = [];
    const params = [];

    if (status && STATUS_VALIDOS.has(status)) {
      params.push(status);
      conds.push(`status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conds.push(`(titulo ILIKE $${params.length} OR descricao ILIKE $${params.length} OR criado_por ILIKE $${params.length})`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await dbQuery(
      `SELECT ${COLS}
         FROM producao.gemba_ocorrencia
         ${where}
        ORDER BY
          CASE status
            WHEN 'aberta' THEN 0
            WHEN 'em_andamento' THEN 1
            WHEN 'resolvida' THEN 2
            ELSE 3
          END,
          criado_em DESC,
          id DESC`,
      params
    );

    const { rows: contagens } = await dbQuery(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'aberta')::int AS aberta,
        COUNT(*) FILTER (WHERE status = 'em_andamento')::int AS em_andamento,
        COUNT(*) FILTER (WHERE status = 'resolvida')::int AS resolvida,
        COUNT(*) FILTER (WHERE status = 'cancelada')::int AS cancelada
      FROM producao.gemba_ocorrencia
    `);

    res.json({ success: true, data: rows, contagens: contagens[0] || {} });
  } catch (err) {
    console.error('[GET /api/gemba]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    await ensureGembaSchema();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const { rows } = await dbQuery(
      `SELECT ${COLS} FROM producao.gemba_ocorrencia WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ocorrência não encontrada.' });

    const hist = await dbQuery(
      `SELECT id, status_anterior, status_novo, comentario, alterado_por, alterado_em
         FROM producao.gemba_ocorrencia_hist
        WHERE ocorrencia_id = $1
        ORDER BY alterado_em DESC, id DESC`,
      [id]
    );
    res.json({ success: true, data: rows[0], historico: hist.rows });
  } catch (err) {
    console.error('[GET /api/gemba/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', handleMulter, async (req, res) => {
  try {
    await ensureGembaSchema();
    const titulo = String(req.body?.titulo || '').trim();
    const descricao = String(req.body?.descricao || '').trim();
    if (!titulo) return res.status(400).json({ error: 'Informe o título da ocorrência.' });
    const responsavelAcao = String(req.body?.responsavel_acao || '').trim();
    const planoAcao = String(req.body?.plano_acao || '').trim();
    const prazo = String(req.body?.prazo || '').trim() || null;
    const dataConclusao = String(req.body?.data_conclusao || '').trim() || null;

    const autor = usuarioLogado(req);
    const inserted = await dbQuery(
      `INSERT INTO producao.gemba_ocorrencia
         (titulo, descricao, status, criado_por, atualizado_por,
          responsavel_acao, plano_acao, prazo, data_conclusao)
       VALUES ($1, $2, 'aberta', $3, $3, $4, $5, $6, $7)
       RETURNING id`,
      [titulo, descricao || null, autor, responsavelAcao || null, planoAcao || null, prazo, dataConclusao]
    );
    const id = inserted.rows[0].id;
    const files = req.files || {};

    let fotoUrl = null;
    let videoUrl = null;
    let fotoDepoisUrl = null;
    try {
      [fotoUrl, videoUrl, fotoDepoisUrl] = await Promise.all([
        uploadMidia(id, 'foto', files.foto?.[0]),
        uploadMidia(id, 'video', files.video?.[0]),
        uploadMidia(id, 'depois', files.foto_depois?.[0]),
      ]);
    } catch (upErr) {
      await dbQuery(`DELETE FROM producao.gemba_ocorrencia WHERE id = $1`, [id]);
      throw upErr;
    }

    const { rows } = await dbQuery(
      `UPDATE producao.gemba_ocorrencia
          SET foto_url = $2, video_url = $3, foto_depois_url = $4, atualizado_em = NOW()
        WHERE id = $1
        RETURNING ${COLS}`,
      [id, fotoUrl, videoUrl, fotoDepoisUrl]
    );
    await registrarHistorico(id, null, 'aberta', 'Ocorrência registrada no Gemba', autor);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[POST /api/gemba]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', handleMulter, async (req, res) => {
  try {
    await ensureGembaSchema();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const atual = await dbQuery(
      `SELECT ${COLS} FROM producao.gemba_ocorrencia WHERE id = $1`,
      [id]
    );
    if (!atual.rows.length) return res.status(404).json({ error: 'Ocorrência não encontrada.' });

    const titulo = String(req.body?.titulo || '').trim();
    if (!titulo) return res.status(400).json({ error: 'Informe o título da ocorrência.' });
    const descricao = String(req.body?.descricao || '').trim();
    const statusNovo = String(req.body?.status || atual.rows[0].status).trim();
    if (!STATUS_VALIDOS.has(statusNovo)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    const autor = usuarioLogado(req);
    const files = req.files || {};
    const [fotoNova, videoNovo, fotoDepoisNova] = await Promise.all([
      uploadMidia(id, 'foto', files.foto?.[0]),
      uploadMidia(id, 'video', files.video?.[0]),
      uploadMidia(id, 'depois', files.foto_depois?.[0]),
    ]);

    const statusAnterior = atual.rows[0].status;
    const resolvidoEm = statusNovo === 'resolvida'
      ? (atual.rows[0].resolvido_em || new Date())
      : null;
    const responsavelAcao = String(req.body?.responsavel_acao || '').trim();
    const planoAcao = String(req.body?.plano_acao || '').trim();
    const prazo = String(req.body?.prazo || '').trim() || null;
    const dataConclusao = String(req.body?.data_conclusao || '').trim() || null;

    const { rows } = await dbQuery(
      `UPDATE producao.gemba_ocorrencia
          SET titulo = $2,
              descricao = $3,
              status = $4,
              foto_url = COALESCE($5, foto_url),
              video_url = COALESCE($6, video_url),
              foto_depois_url = COALESCE($7, foto_depois_url),
              atualizado_por = $8,
              atualizado_em = NOW(),
              resolvido_em = $9,
              responsavel_acao = $10,
              plano_acao = $11,
              prazo = $12,
              data_conclusao = $13
        WHERE id = $1
        RETURNING ${COLS}`,
      [
        id, titulo, descricao || null, statusNovo,
        fotoNova, videoNovo, fotoDepoisNova, autor, resolvidoEm,
        responsavelAcao || null, planoAcao || null, prazo, dataConclusao,
      ]
    );

    const comentario = String(req.body?.comentario || '').trim();
    await registrarHistorico(id, statusAnterior, statusNovo, comentario, autor);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[PUT /api/gemba/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    await ensureGembaSchema();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const statusNovo = String(req.body?.status || '').trim();
    if (!STATUS_VALIDOS.has(statusNovo)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    const atual = await dbQuery(
      `SELECT id, status, resolvido_em FROM producao.gemba_ocorrencia WHERE id = $1`,
      [id]
    );
    if (!atual.rows.length) return res.status(404).json({ error: 'Ocorrência não encontrada.' });

    const autor = usuarioLogado(req);
    const statusAnterior = atual.rows[0].status;
    const resolvidoEm = statusNovo === 'resolvida'
      ? (atual.rows[0].resolvido_em || new Date())
      : null;

    const { rows } = await dbQuery(
      `UPDATE producao.gemba_ocorrencia
          SET status = $2,
              atualizado_por = $3,
              atualizado_em = NOW(),
              resolvido_em = $4
        WHERE id = $1
        RETURNING ${COLS}`,
      [id, statusNovo, autor, resolvidoEm]
    );
    const comentario = String(req.body?.comentario || '').trim();
    await registrarHistorico(id, statusAnterior, statusNovo, comentario, autor);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[PATCH /api/gemba/:id/status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
