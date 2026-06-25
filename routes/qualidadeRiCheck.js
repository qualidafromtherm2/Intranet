// routes/qualidadeRiCheck.js — RI Registro de Inspeção (kanban produção)
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');
const { dbQuery } = require('../src/db');
const { uploadPublicFile } = require('../utils/storage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

let schemaOk = false;

function getUsuario(req) {
  return (
    req.session?.user?.fullName
    || req.session?.user?.username
    || req.session?.user?.login
    || String(req.headers['x-user'] || '').trim()
    || 'sistema'
  );
}

function requireAuth(req, res, next) {
  if (!req.session?.user?.username && !req.session?.user?.id) {
    return res.status(401).json({ ok: false, error: 'Não autenticado.' });
  }
  next();
}

function sanitizePathPart(str) {
  return String(str || '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'sem_codigo';
}

async function garantirSchemaRi() {
  if (schemaOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS qualidade`);
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS "Producao"`);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade."RI_Check" (
      id                      BIGSERIAL PRIMARY KEY,
      id_kanban_programacao   BIGINT,
      codigo_produto          TEXT,
      codigo                  TEXT,
      descricao               TEXT,
      op_iapp_id              BIGINT NOT NULL,
      usuario                 TEXT,
      status                  TEXT NOT NULL DEFAULT 'Em andamento',
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_check_op
      ON qualidade."RI_Check" (op_iapp_id)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_check_status
      ON qualidade."RI_Check" (status)
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade."RI_Verificacoes" (
      id                BIGSERIAL PRIMARY KEY,
      ri_check_id       BIGINT NOT NULL REFERENCES qualidade."RI_Check"(id) ON DELETE CASCADE,
      codigo_produto    TEXT,
      check_nome        TEXT,
      descricao_check   TEXT,
      foto              TEXT,
      video             TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_verif_check
      ON qualidade."RI_Verificacoes" (ri_check_id)
  `);
  await dbQuery(`ALTER TABLE qualidade."RI_Verificacoes" ADD COLUMN IF NOT EXISTS local TEXT`);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_verif_local
      ON qualidade."RI_Verificacoes" (local)
  `);

  await dbQuery(`ALTER TABLE "Producao"."Kanban_programacao" ADD COLUMN IF NOT EXISTS status TEXT`);
  schemaOk = true;
}

async function buscarKanbanProgId(opIappId) {
  const { rows } = await dbQuery(
    `SELECT id FROM "Producao"."Kanban_programacao"
      WHERE op_iapp_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [opIappId]
  );
  return rows[0]?.id || null;
}

async function carregarCheckCompleto(checkId, localFiltro = null) {
  const { rows: checks } = await dbQuery(
    `SELECT * FROM qualidade."RI_Check" WHERE id = $1`,
    [checkId]
  );
  if (!checks.length) return null;
  const params = [checkId];
  let sql = `SELECT * FROM qualidade."RI_Verificacoes" WHERE ri_check_id = $1`;
  const local = String(localFiltro || '').trim();
  if (local) {
    sql += ` AND TRIM(COALESCE(local, '')) = $2`;
    params.push(local);
  }
  sql += ` ORDER BY id ASC`;
  const { rows: verificacoes } = await dbQuery(sql, params);
  return { check: checks[0], verificacoes };
}

async function atualizarStatusKanbanOp(opIappId, statusKanban, check, checkStatusRi) {
  if (checkStatusRi) {
    await dbQuery(
      `UPDATE qualidade."RI_Check" SET status = $2, updated_at = NOW() WHERE id = $1`,
      [check.id, checkStatusRi]
    );
  }
  const upd = await dbQuery(
    `UPDATE "Producao"."Kanban_programacao" SET status = $2 WHERE op_iapp_id = $1`,
    [opIappId, statusKanban]
  );
  if (!upd.rowCount) {
    const codigo = String(check.codigo || '').trim();
    const codigoProduto = check.codigo_produto || null;
    await dbQuery(
      `INSERT INTO "Producao"."Kanban_programacao"
         (codigo_produto, codigo, descricao, codigo_pedido, quantidade, numero_op, op_iapp_id, status)
       VALUES ($1, $2, $3, 0, 1, $4, $5, $6)`,
      [
        codigoProduto,
        codigo || String(opIappId),
        check.descricao || null,
        codigo || String(opIappId),
        opIappId,
        statusKanban,
      ]
    );
  }
}

async function uploadRiMidia(codigoProduto, tipo, file) {
  if (!file?.buffer?.length) return null;
  const cod = sanitizePathPart(codigoProduto);
  const pasta = tipo === 'video' ? 'videos' : 'fotos';
  const ext = mime.extension(file.mimetype) || (file.originalname || '').split('.').pop() || 'bin';
  const nome = `${uuidv4()}.${String(ext).replace(/[^a-zA-Z0-9]/g, '')}`;
  const pathKey = `RI/${cod}/${pasta}/${nome}`;
  const { url } = await uploadPublicFile('produtos', pathKey, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false,
  });
  return url;
}

// GET /api/qualidade/ri-check/kanbans — nomes das colunas do kanban Registrar produção
router.get('/kanbans', requireAuth, (_req, res) => {
  return res.json({
    ok: true,
    kanbans: [
      'Pedidos',
      'Programado',
      'Montagem hermetica',
      'Montagem eletrica',
      'Teste',
    ],
  });
});

// POST /api/qualidade/ri-check/abrir
router.post('/abrir', requireAuth, express.json(), async (req, res) => {
  try {
    await garantirSchemaRi();
    const opIappId = Number(req.body?.op_iapp_id) || 0;
    if (!opIappId) return res.status(400).json({ ok: false, error: 'op_iapp_id é obrigatório.' });

    const codigo = String(req.body?.codigo || '').trim();
    const codigoProduto = String(req.body?.codigo_produto || codigo || '').trim();
    const descricao = String(req.body?.descricao || '').trim();
    const usuario = getUsuario(req);
    let kanbanProgId = Number(req.body?.id_kanban_programacao) || null;
    if (!kanbanProgId) kanbanProgId = await buscarKanbanProgId(opIappId);

    const kanbanLocal = String(req.body?.kanban_local || '').trim();

    let existente;
    if (kanbanLocal === 'Montagem eletrica') {
      existente = await dbQuery(
        `SELECT id FROM qualidade."RI_Check"
          WHERE op_iapp_id = $1 AND status = 'Liberado'
          ORDER BY id DESC LIMIT 1`,
        [opIappId]
      );
    } else {
      existente = await dbQuery(
        `SELECT id FROM qualidade."RI_Check"
          WHERE op_iapp_id = $1 AND COALESCE(status, '') NOT IN ('Liberado', 'Teste')
          ORDER BY id DESC LIMIT 1`,
        [opIappId]
      );
    }

    let checkId;
    if (existente.rows.length) {
      checkId = existente.rows[0].id;
      await dbQuery(
        `UPDATE qualidade."RI_Check"
            SET codigo_produto = COALESCE(NULLIF($2, ''), codigo_produto),
                codigo = COALESCE(NULLIF($3, ''), codigo),
                descricao = COALESCE(NULLIF($4, ''), descricao),
                id_kanban_programacao = COALESCE($5, id_kanban_programacao),
                usuario = $6,
                updated_at = NOW()
          WHERE id = $1`,
        [checkId, codigoProduto, codigo, descricao, kanbanProgId, usuario]
      );
    } else {
      const ins = await dbQuery(
        `INSERT INTO qualidade."RI_Check"
           (id_kanban_programacao, codigo_produto, codigo, descricao, op_iapp_id, usuario, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'Em andamento')
         RETURNING id`,
        [kanbanProgId, codigoProduto || null, codigo || null, descricao || null, opIappId, usuario]
      );
      checkId = ins.rows[0].id;
    }

    const dados = await carregarCheckCompleto(checkId, kanbanLocal || null);
    return res.json({ ok: true, kanban_local: kanbanLocal || null, ...dados });
  } catch (err) {
    console.error('[qualidade/ri-check/abrir]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao abrir RI.' });
  }
});

// GET /api/qualidade/ri-check/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    await garantirSchemaRi();
    const checkId = Number(req.params.id) || 0;
    const localFiltro = String(req.query?.local || '').trim() || null;
    const dados = await carregarCheckCompleto(checkId, localFiltro);
    if (!dados) return res.status(404).json({ ok: false, error: 'RI não encontrado.' });
    return res.json({ ok: true, kanban_local: localFiltro, ...dados });
  } catch (err) {
    console.error('[qualidade/ri-check/get]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/qualidade/ri-check/:id/verificacoes
router.post('/:id/verificacoes', requireAuth, upload.fields([
  { name: 'foto', maxCount: 1 },
  { name: 'video', maxCount: 1 },
]), async (req, res) => {
  try {
    await garantirSchemaRi();
    const checkId = Number(req.params.id) || 0;
    const dados = await carregarCheckCompleto(checkId);
    if (!dados) return res.status(404).json({ ok: false, error: 'RI não encontrado.' });

    const checkNome = String(req.body?.check || req.body?.check_nome || '').trim();
    const descricaoCheck = String(req.body?.descricao_check || req.body?.descricao || '').trim();
    if (!checkNome) return res.status(400).json({ ok: false, error: 'Informe o nome do check.' });

    const codigoProduto = String(
      req.body?.codigo_produto || dados.check.codigo_produto || dados.check.codigo || ''
    ).trim();

    const local = String(req.body?.local || '').trim();
    if (!local) return res.status(400).json({ ok: false, error: 'Informe o local (kanban).' });

    let fotoUrl = null;
    let videoUrl = null;
    if (req.files?.foto?.[0]) {
      fotoUrl = await uploadRiMidia(codigoProduto, 'foto', req.files.foto[0]);
    }
    if (req.files?.video?.[0]) {
      videoUrl = await uploadRiMidia(codigoProduto, 'video', req.files.video[0]);
    }

    const ins = await dbQuery(
      `INSERT INTO qualidade."RI_Verificacoes"
         (ri_check_id, codigo_produto, check_nome, descricao_check, foto, video, local)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [checkId, codigoProduto || null, checkNome, descricaoCheck || null, fotoUrl, videoUrl, local]
    );

    await dbQuery(`UPDATE qualidade."RI_Check" SET updated_at = NOW() WHERE id = $1`, [checkId]);

    return res.json({ ok: true, verificacao: ins.rows[0] });
  } catch (err) {
    console.error('[qualidade/ri-check/verificacoes]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao salvar verificação.' });
  }
});

// POST /api/qualidade/ri-check/:id/salvar
router.post('/:id/salvar', requireAuth, express.json(), async (req, res) => {
  try {
    await garantirSchemaRi();
    const checkId = Number(req.params.id) || 0;
    const usuario = getUsuario(req);
    const avancarTeste = req.body?.avancar_teste === true;
    const localFiltro = String(req.body?.kanban_local || '').trim() || null;

    const dadosAtual = await carregarCheckCompleto(checkId);
    if (!dadosAtual) return res.status(404).json({ ok: false, error: 'RI não encontrado.' });

    const { rowCount } = await dbQuery(
      `UPDATE qualidade."RI_Check"
          SET usuario = $2, updated_at = NOW()
        WHERE id = $1`,
      [checkId, usuario]
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'RI não encontrado.' });

    if (avancarTeste) {
      const opIappId = Number(dadosAtual.check.op_iapp_id) || 0;
      if (!opIappId) return res.status(400).json({ ok: false, error: 'OP inválida no RI.' });
      await atualizarStatusKanbanOp(opIappId, 'Teste', dadosAtual.check, 'Teste');
    }

    const dados = await carregarCheckCompleto(checkId, localFiltro);
    return res.json({
      ok: true,
      avancou_teste: avancarTeste,
      kanban_status: avancarTeste ? 'Teste' : undefined,
      ...dados,
    });
  } catch (err) {
    console.error('[qualidade/ri-check/salvar]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/qualidade/ri-check/:id/liberar
router.post('/:id/liberar', requireAuth, express.json(), async (req, res) => {
  try {
    await garantirSchemaRi();
    const checkId = Number(req.params.id) || 0;
    const dados = await carregarCheckCompleto(checkId);
    if (!dados) return res.status(404).json({ ok: false, error: 'RI não encontrado.' });

    const check = dados.check;
    const opIappId = Number(check.op_iapp_id) || 0;
    if (!opIappId) return res.status(400).json({ ok: false, error: 'OP inválida no RI.' });

    const usuario = getUsuario(req);
    const statusKanban = 'Montagem eletrica';

    await dbQuery(
      `UPDATE qualidade."RI_Check"
          SET status = 'Liberado', usuario = $2, updated_at = NOW()
        WHERE id = $1`,
      [checkId, usuario]
    );

    await atualizarStatusKanbanOp(opIappId, statusKanban, check, null);

    await dbQuery(
      `UPDATE "IAPP_API".op_iapp_os
          SET status_producao = 'Iniciado',
              data_status_producao = NOW()
        WHERE op_iapp_id = $1
          AND COALESCE(TRIM(status_producao), '') IN ('', 'Solicitado')`,
      [opIappId]
    );

    const atualizado = await carregarCheckCompleto(checkId);
    return res.json({
      ok: true,
      ...atualizado,
      kanban_status: statusKanban,
      op_iapp_id: opIappId,
    });
  } catch (err) {
    console.error('[qualidade/ri-check/liberar]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao liberar.' });
  }
});

module.exports = router;
