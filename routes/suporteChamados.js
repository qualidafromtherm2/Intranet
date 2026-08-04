'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');

const { dbQuery } = require('../src/db');
const { uploadPublicFile } = require('../utils/storage');

const BUCKET = process.env.STORAGE_BUCKET || process.env.SUPABASE_BUCKET || 'produtos';
const STORAGE_PREFIX = 'suporte_chamados';

const CRITICIDADES = new Set(['urgente', 'normal', 'baixa']);
const STATUS_VALIDOS = new Set(['aberto', 'em_andamento', 'aguardando_aprovacao', 'fechado']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

let schemaReady = false;

function requireAuth(req, res, next) {
  if (!req.session?.user?.username && !req.session?.user?.id) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  next();
}

function isAdmin(req) {
  const raw = req.session?.user?.roles ?? [];
  const roles = Array.isArray(raw)
    ? raw
    : String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  return roles.some((r) => String(r || '').trim().toLowerCase() === 'admin');
}

function getUsuario(req) {
  return String(req.session?.user?.username || req.session?.user?.id || '').trim();
}

function getNomeUsuario(req) {
  const u = req.session?.user || {};
  return String(u.nome || u.name || u.displayName || u.username || u.id || '').trim();
}

function textoUtf8(value) {
  return String(value ?? '').normalize('NFC').trim();
}

/** Status canônico: minúsculo + espaços → underline (ex.: "em andamento" → "em_andamento"). */
function normalizarStatusChamado(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function sanitizePathPart(str) {
  return String(str || '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'arquivo';
}

function inferTipoAnexo(file) {
  const mt = String(file?.mimetype || '').toLowerCase();
  if (mt.startsWith('image/')) return 'foto';
  if (mt.startsWith('video/')) return 'video';
  const name = String(file?.originalname || '').toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(name)) return 'foto';
  if (/\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(name)) return 'video';
  return 'arquivo';
}

async function ensureSchema() {
  if (schemaReady) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS "Suporte_tecnico"`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS "Suporte_tecnico"."Chamado" (
      id                BIGSERIAL PRIMARY KEY,
      descricao         TEXT NOT NULL,
      criticidade       TEXT NOT NULL DEFAULT 'normal',
      status            TEXT NOT NULL DEFAULT 'aberto',
      prazo             TIMESTAMPTZ,
      anexos            JSONB NOT NULL DEFAULT '[]'::jsonb,
      criado_por        TEXT NOT NULL,
      criado_por_nome   TEXT,
      criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fechado_em        TIMESTAMPTZ,
      fechado_por       TEXT,
      fechado_por_nome  TEXT,
      observacao_admin  TEXT
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_suporte_chamado_criado_por
      ON "Suporte_tecnico"."Chamado" (criado_por)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_suporte_chamado_status
      ON "Suporte_tecnico"."Chamado" (status)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_suporte_chamado_criado_em
      ON "Suporte_tecnico"."Chamado" (criado_em DESC)
  `);
  await dbQuery(`
    ALTER TABLE "Suporte_tecnico"."Chamado"
      ADD COLUMN IF NOT EXISTS motivo_reprovacao TEXT,
      ADD COLUMN IF NOT EXISTS anexos_reprovacao JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS reprovado_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reprovado_por TEXT,
      ADD COLUMN IF NOT EXISTS reprovado_por_nome TEXT
  `);
  // Corrige status legado com espaço ("em andamento" → "em_andamento")
  await dbQuery(`
    UPDATE "Suporte_tecnico"."Chamado"
       SET status = REPLACE(TRIM(status), ' ', '_'),
           atualizado_em = NOW()
     WHERE status LIKE '% %'
  `);
  schemaReady = true;
}

const CHAMADO_COLS = `
  id, descricao, criticidade,
  LOWER(REPLACE(TRIM(status), ' ', '_')) AS status,
  prazo, anexos,
  criado_por, criado_por_nome, criado_em, atualizado_em,
  fechado_em, fechado_por, fechado_por_nome, observacao_admin,
  motivo_reprovacao, anexos_reprovacao,
  reprovado_em, reprovado_por, reprovado_por_nome
`;

async function uploadAnexo(file, chamadoTempId) {
  const tipo = inferTipoAnexo(file);
  const mimeExt = mime.extension(file.mimetype) || '';
  const originalExt = (file.originalname || '').split('.').pop();
  const ext = (mimeExt || originalExt || 'bin')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase() || 'bin';
  const safeOriginal = sanitizePathPart(file.originalname || `${tipo}.${ext}`);
  const pathKey = `${STORAGE_PREFIX}/${chamadoTempId}/${uuidv4()}-${safeOriginal}`;

  const { url } = await uploadPublicFile(BUCKET, pathKey, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false,
  });

  return {
    tipo,
    url,
    path: pathKey,
    nome: file.originalname || safeOriginal,
    mime: file.mimetype || null,
    tamanho: file.size || null,
  };
}

// GET /api/suporte/chamados
router.get('/chamados', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const admin = isAdmin(req);
    const usuario = getUsuario(req);
    const statusFiltro = String(req.query.status || '').trim().toLowerCase();
    const somenteMeus = ['1', 'true', 'sim'].includes(String(req.query.meus || '').trim().toLowerCase());

    const params = [];
    const where = [];

    // Não-admin só vê os próprios; admin em "Meus chamados" também filtra por autor
    if (!admin || somenteMeus) {
      params.push(usuario);
      where.push(`criado_por = $${params.length}`);
    }

    if (statusFiltro === 'aberto') {
      where.push(`LOWER(REPLACE(TRIM(status), ' ', '_')) IN ('aberto', 'em_andamento')`);
    } else if (statusFiltro && STATUS_VALIDOS.has(normalizarStatusChamado(statusFiltro))) {
      params.push(normalizarStatusChamado(statusFiltro));
      where.push(`LOWER(REPLACE(TRIM(status), ' ', '_')) = $${params.length}`);
    }

    const sql = `
      SELECT ${CHAMADO_COLS}
        FROM "Suporte_tecnico"."Chamado"
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY
         CASE LOWER(REPLACE(TRIM(status), ' ', '_'))
           WHEN 'aberto' THEN 0
           WHEN 'em_andamento' THEN 1
           WHEN 'aguardando_aprovacao' THEN 2
           ELSE 3
         END,
         CASE criticidade WHEN 'urgente' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
         criado_em DESC
       LIMIT 200
    `;

    const { rows } = await dbQuery(sql, params);
    res.json({ ok: true, admin, usuario, chamados: rows });
  } catch (err) {
    console.error('[suporte/chamados] listar:', err);
    res.status(500).json({ error: err.message || 'Falha ao listar chamados' });
  }
});

// GET /api/suporte/chamados/:id
router.get('/chamados/:id', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const { rows } = await dbQuery(
      `SELECT ${CHAMADO_COLS}
         FROM "Suporte_tecnico"."Chamado"
        WHERE id = $1`,
      [id]
    );

    const chamado = rows[0];
    if (!chamado) return res.status(404).json({ error: 'Chamado não encontrado.' });

    const admin = isAdmin(req);
    if (!admin && chamado.criado_por !== getUsuario(req)) {
      return res.status(403).json({ error: 'Sem permissão para ver este chamado.' });
    }

    res.json({ ok: true, admin, chamado });
  } catch (err) {
    console.error('[suporte/chamados] detalhe:', err);
    res.status(500).json({ error: err.message || 'Falha ao carregar chamado' });
  }
});

// POST /api/suporte/chamados
router.post(
  '/chamados',
  requireAuth,
  upload.fields([
    { name: 'foto', maxCount: 10 },
    { name: 'video', maxCount: 5 },
    { name: 'anexo', maxCount: 5 },
  ]),
  async (req, res) => {
    try {
      await ensureSchema();

      const descricao = textoUtf8(req.body?.descricao);
      let criticidade = String(req.body?.criticidade || 'normal').trim().toLowerCase();
      if (!CRITICIDADES.has(criticidade)) criticidade = 'normal';

      if (!descricao) {
        return res.status(400).json({ error: 'Descreva o chamado.' });
      }

      const files = [
        ...(req.files?.foto || []),
        ...(req.files?.video || []),
        ...(req.files?.anexo || []),
      ];

      const tempId = `tmp-${Date.now()}-${uuidv4().slice(0, 8)}`;
      const anexos = [];
      for (const file of files) {
        try {
          anexos.push(await uploadAnexo(file, tempId));
        } catch (upErr) {
          console.error('[suporte/chamados] upload:', upErr);
          return res.status(500).json({
            error: 'Falha ao enviar anexo: ' + (upErr.message || upErr),
          });
        }
      }

      const { rows } = await dbQuery(
        `INSERT INTO "Suporte_tecnico"."Chamado"
           (descricao, criticidade, status, anexos, criado_por, criado_por_nome)
         VALUES ($1, $2, 'aberto', $3::jsonb, $4, $5)
         RETURNING ${CHAMADO_COLS}`,
        [
          descricao,
          criticidade,
          JSON.stringify(anexos),
          getUsuario(req),
          getNomeUsuario(req),
        ]
      );

      res.json({ ok: true, chamado: rows[0] });
    } catch (err) {
      console.error('[suporte/chamados] criar:', err);
      res.status(500).json({ error: err.message || 'Falha ao abrir chamado' });
    }
  }
);

// PATCH /api/suporte/chamados/:id
// - admin: prazo, status (incl. enviar p/ aguardando_aprovacao), observação
// - autor: aprovar (fecha) quando status = aguardando_aprovacao
router.patch('/chamados/:id', requireAuth, async (req, res) => {
  try {
    await ensureSchema();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const { rows: existingRows } = await dbQuery(
      `SELECT id, status, criado_por FROM "Suporte_tecnico"."Chamado" WHERE id = $1`,
      [id]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Chamado não encontrado.' });

    const body = req.body || {};
    const admin = isAdmin(req);
    const usuario = getUsuario(req);
    const isAuthor = String(existing.criado_por || '') === usuario;
    const querAprovar = body.aprovar === true || body.aprovar === 'true';

    // Solicitante aprova o fechamento
    if (querAprovar) {
      if (!isAuthor) {
        return res.status(403).json({ error: 'Somente quem abriu o chamado pode aprovar.' });
      }
      if (normalizarStatusChamado(existing.status) !== 'aguardando_aprovacao') {
        return res.status(400).json({ error: 'Chamado não está aguardando aprovação.' });
      }

      const { rows } = await dbQuery(
        `UPDATE "Suporte_tecnico"."Chamado"
            SET status = 'fechado',
                fechado_por = $1,
                fechado_por_nome = $2,
                fechado_em = NOW(),
                atualizado_em = NOW()
          WHERE id = $3
          RETURNING ${CHAMADO_COLS}`,
        [usuario, getNomeUsuario(req), id]
      );
      return res.json({ ok: true, chamado: rows[0] });
    }

    if (!admin) {
      return res.status(403).json({ error: 'Apenas admin pode alterar chamado.' });
    }

    const sets = ['atualizado_em = NOW()'];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(body, 'prazo')) {
      const prazoRaw = body.prazo;
      if (prazoRaw === null || prazoRaw === '') {
        sets.push('prazo = NULL');
      } else {
        const d = new Date(prazoRaw);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ error: 'Prazo inválido.' });
        }
        params.push(d.toISOString());
        sets.push(`prazo = $${params.length}`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'observacao_admin')) {
      params.push(String(body.observacao_admin || '').trim() || null);
      sets.push(`observacao_admin = $${params.length}`);
    }

    let status = body.status != null ? normalizarStatusChamado(body.status) : null;
    if (body.fechar === true || body.fechar === 'true') {
      status = 'fechado';
    }
    if (body.enviar_aprovacao === true || body.enviar_aprovacao === 'true') {
      status = 'aguardando_aprovacao';
    }
    if (status) {
      if (!STATUS_VALIDOS.has(status)) {
        return res.status(400).json({ error: 'Status inválido.' });
      }
      params.push(status);
      sets.push(`status = $${params.length}`);
      if (status === 'fechado') {
        params.push(usuario);
        sets.push(`fechado_por = $${params.length}`);
        params.push(getNomeUsuario(req));
        sets.push(`fechado_por_nome = $${params.length}`);
        sets.push('fechado_em = NOW()');
      }
    }

    params.push(id);
    const { rows } = await dbQuery(
      `UPDATE "Suporte_tecnico"."Chamado"
          SET ${sets.join(', ')}
        WHERE id = $${params.length}
        RETURNING ${CHAMADO_COLS}`,
      params
    );

    res.json({ ok: true, chamado: rows[0] });
  } catch (err) {
    console.error('[suporte/chamados] atualizar:', err);
    res.status(500).json({ error: err.message || 'Falha ao atualizar chamado' });
  }
});

// POST /api/suporte/chamados/:id/reprovar
// Solicitante reprova o fechamento → volta para aberto com motivo + anexos
router.post(
  '/chamados/:id/reprovar',
  requireAuth,
  upload.fields([
    { name: 'foto', maxCount: 10 },
    { name: 'video', maxCount: 5 },
    { name: 'anexo', maxCount: 5 },
  ]),
  async (req, res) => {
    try {
      await ensureSchema();

      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'ID inválido.' });
      }

      const motivo = textoUtf8(req.body?.motivo || req.body?.motivo_reprovacao);
      if (!motivo) {
        return res.status(400).json({ error: 'Informe o motivo da reprovação.' });
      }

      const { rows: existingRows } = await dbQuery(
        `SELECT id, status, criado_por, anexos_reprovacao
           FROM "Suporte_tecnico"."Chamado" WHERE id = $1`,
        [id]
      );
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Chamado não encontrado.' });

      const usuario = getUsuario(req);
      if (String(existing.criado_por || '') !== usuario) {
        return res.status(403).json({ error: 'Somente quem abriu o chamado pode reprovar.' });
      }
      if (normalizarStatusChamado(existing.status) !== 'aguardando_aprovacao') {
        return res.status(400).json({ error: 'Chamado não está aguardando aprovação.' });
      }

      const files = [
        ...(req.files?.foto || []),
        ...(req.files?.video || []),
        ...(req.files?.anexo || []),
      ];

      const anexosNovos = [];
      for (const file of files) {
        try {
          anexosNovos.push(await uploadAnexo(file, `reprovar-${id}`));
        } catch (upErr) {
          console.error('[suporte/chamados] upload reprovação:', upErr);
          return res.status(500).json({
            error: 'Falha ao enviar anexo: ' + (upErr.message || upErr),
          });
        }
      }

      let anexosAnteriores = existing.anexos_reprovacao;
      if (typeof anexosAnteriores === 'string') {
        try {
          anexosAnteriores = JSON.parse(anexosAnteriores);
        } catch (_e) {
          anexosAnteriores = [];
        }
      }
      if (!Array.isArray(anexosAnteriores)) anexosAnteriores = [];
      const anexosReprovacao = [...anexosAnteriores, ...anexosNovos];

      const { rows } = await dbQuery(
        `UPDATE "Suporte_tecnico"."Chamado"
            SET status = 'aberto',
                motivo_reprovacao = $1,
                anexos_reprovacao = $2::jsonb,
                reprovado_em = NOW(),
                reprovado_por = $3,
                reprovado_por_nome = $4,
                atualizado_em = NOW()
          WHERE id = $5
          RETURNING ${CHAMADO_COLS}`,
        [
          motivo,
          JSON.stringify(anexosReprovacao),
          usuario,
          getNomeUsuario(req),
          id,
        ]
      );

      res.json({ ok: true, chamado: rows[0] });
    } catch (err) {
      console.error('[suporte/chamados] reprovar:', err);
      res.status(500).json({ error: err.message || 'Falha ao reprovar chamado' });
    }
  }
);

module.exports = router;
