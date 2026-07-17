// routes/qualidadeRiCheck.js — RI Registro de Inspeção (kanban produção)
'use strict';

const { registrarRiConcluida } = require('../utils/tempoProducao');
const {
  dispararNotificacaoRiCheck,
  obterConfigNotificacaoUsuario,
  salvarConfigNotificacaoUsuario,
} = require('../utils/riCheckWhatsappNotificacao');

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

function getUserId(req) {
  return Number(req.session?.user?.id) || 0;
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
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_verif_codigo_produto
      ON qualidade."RI_Verificacoes" (codigo_produto)
  `);

  // codigo_produto = public.produtos_omie.codigo_produto (id Omie numérico)
  await dbQuery(`
    UPDATE qualidade."RI_Check" c
       SET codigo_produto = po.codigo_produto::text
      FROM public.produtos_omie po
     WHERE c.codigo_produto IS NOT NULL
       AND TRIM(c.codigo_produto) <> ''
       AND c.codigo_produto !~ '^[0-9]+$'
       AND UPPER(TRIM(po.codigo)) = UPPER(TRIM(COALESCE(c.codigo, c.codigo_produto)))
  `).catch(() => {});
  await dbQuery(`
    UPDATE qualidade."RI_Verificacoes" v
       SET codigo_produto = po.codigo_produto::text
      FROM public.produtos_omie po
     WHERE v.codigo_produto IS NOT NULL
       AND TRIM(v.codigo_produto) <> ''
       AND v.codigo_produto !~ '^[0-9]+$'
       AND EXISTS (
         SELECT 1 FROM qualidade."RI_Check" c
          WHERE c.id = v.ri_check_id
            AND UPPER(TRIM(po.codigo)) = UPPER(TRIM(COALESCE(c.codigo, v.codigo_produto)))
       )
  `).catch(() => {});

  await dbQuery(`ALTER TABLE "Producao"."Kanban_programacao" ADD COLUMN IF NOT EXISTS status TEXT`);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade."RI_NIQ" (
      id                BIGSERIAL PRIMARY KEY,
      codigo_produto    TEXT,
      op_iapp_id        BIGINT NOT NULL,
      numero_op         TEXT,
      falha_detectada   TEXT NOT NULL,
      foto              TEXT,
      video             TEXT,
      usuario           TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_niq_op
      ON qualidade."RI_NIQ" (op_iapp_id)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_niq_numero_op
      ON qualidade."RI_NIQ" (numero_op)
  `);

  await dbQuery(`ALTER TABLE qualidade."RI_Check" ADD COLUMN IF NOT EXISTS op_producao_id BIGINT`);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_check_op_producao
      ON qualidade."RI_Check" (op_producao_id)
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade."RI_Liberacao" (
      id          BIGSERIAL PRIMARY KEY,
      numero_op   TEXT NOT NULL,
      usuario     TEXT NOT NULL,
      status      TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_liberacao_numero_op
      ON qualidade."RI_Liberacao" (numero_op)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_liberacao_created
      ON qualidade."RI_Liberacao" (created_at DESC)
  `);

  schemaOk = true;
}

let kanbanProgSchemaOk = false;

async function garantirSchemaKanbanProgramacao() {
  if (kanbanProgSchemaOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS "Producao"`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS "Producao"."Kanban_programacao" (
      id              BIGSERIAL PRIMARY KEY,
      codigo_produto  BIGINT,
      codigo          TEXT NOT NULL,
      descricao       TEXT,
      codigo_pedido   BIGINT NOT NULL,
      numero_pedido   TEXT,
      quantidade      NUMERIC(18,4) NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`ALTER TABLE "Producao"."Kanban_programacao" ADD COLUMN IF NOT EXISTS numero_op TEXT`);
  await dbQuery(`ALTER TABLE "Producao"."Kanban_programacao" ADD COLUMN IF NOT EXISTS op_iapp_id BIGINT`);
  await dbQuery(`ALTER TABLE "Producao"."Kanban_programacao" ADD COLUMN IF NOT EXISTS op_producao_id BIGINT`);
  await dbQuery(`ALTER TABLE "Producao"."Kanban_programacao" ADD COLUMN IF NOT EXISTS status TEXT`);
  await dbQuery(`ALTER TABLE "Producao"."Kanban_programacao" ADD COLUMN IF NOT EXISTS observacao TEXT`);
  await dbQuery(`ALTER TABLE "Producao"."Kanban_programacao" ADD COLUMN IF NOT EXISTS postos TEXT`);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_kanban_prog_op_iapp
      ON "Producao"."Kanban_programacao" (op_iapp_id)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_kanban_prog_op_producao
      ON "Producao"."Kanban_programacao" (op_producao_id)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_kanban_prog_numero_op
      ON "Producao"."Kanban_programacao" (numero_op)
  `);
  kanbanProgSchemaOk = true;
}

async function buscarKanbanProgId(opRefId, numeroOpHint = '') {
  const numeroOp = String(numeroOpHint || '').trim();
  const { rows } = await dbQuery(
    `SELECT id FROM "Producao"."Kanban_programacao"
      WHERE op_producao_id = $1
         OR op_iapp_id = $1
         OR ($2 <> '' AND UPPER(TRIM(COALESCE(numero_op, ''))) = UPPER(TRIM($2)))
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [opRefId, numeroOp]
  );
  return rows[0]?.id || null;
}

function resolverOpRefId(checkOrId) {
  if (checkOrId && typeof checkOrId === 'object') {
    return Number(checkOrId.op_producao_id) || Number(checkOrId.op_iapp_id) || 0;
  }
  return Number(checkOrId) || 0;
}

async function resolverNumeroOpKanban(opRefId, check) {
  if (check?.id_kanban_programacao) {
    const { rows } = await dbQuery(
      `SELECT numero_op FROM "Producao"."Kanban_programacao" WHERE id = $1 LIMIT 1`,
      [check.id_kanban_programacao]
    );
    const n = String(rows[0]?.numero_op || '').trim();
    if (n) return n;
  }

  const { rows: kpRows } = await dbQuery(
    `SELECT numero_op FROM "Producao"."Kanban_programacao"
      WHERE op_producao_id = $1 OR op_iapp_id = $1
      ORDER BY id DESC NULLS LAST
      LIMIT 1`,
    [opRefId]
  );
  const viaKanban = String(kpRows[0]?.numero_op || '').trim();
  if (viaKanban) return viaKanban;

  const opDados = await buscarDadosOpKanban(opRefId);
  return String(opDados?.numero_op || '').trim();
}

async function registrarRiLiberacao(numeroOp, usuario, status) {
  const nOp = String(numeroOp || '').trim();
  if (!nOp) return null;
  const { rows } = await dbQuery(
    `INSERT INTO qualidade."RI_Liberacao" (numero_op, usuario, status)
     VALUES ($1, $2, $3)
     RETURNING id, numero_op, usuario, status, created_at::text AS created_at`,
    [nOp, usuario, status]
  );
  return rows[0] || null;
}

/** Resolve id Omie (BIGINT) a partir de código texto, id numérico ou integração. */
async function resolverCodigoProdutoOmieId(codigoOuId) {
  const raw = String(codigoOuId || '').trim();
  if (!raw) return null;
  // ID Omie típico (ex. 10409717177): usar direto se já for numérico longo
  if (/^\d{8,}$/.test(raw)) return Number(raw);
  const { rows } = await dbQuery(
    `SELECT codigo_produto
       FROM public.produtos_omie
      WHERE TRIM(codigo_produto::text) = TRIM($1)
         OR TRIM(codigo) = TRIM($1)
         OR TRIM(COALESCE(codigo_produto_integracao, '')) = TRIM($1)
      ORDER BY CASE
        WHEN TRIM(codigo_produto::text) = TRIM($1) THEN 0
        WHEN TRIM(codigo) = TRIM($1) THEN 1
        ELSE 2
      END
      LIMIT 1`,
    [raw]
  );
  return rows[0]?.codigo_produto ?? null;
}

async function resolverCamposProdutoOmie({ codigoTexto, codigoProdutoHint, opIappId, kanbanProgId }) {
  let codigo = String(codigoTexto || '').trim();
  let descricao = null;
  let idOmie = await resolverCodigoProdutoOmieId(codigoProdutoHint);

  if (!idOmie && kanbanProgId) {
    const { rows } = await dbQuery(
      `SELECT codigo_produto, codigo, descricao
         FROM "Producao"."Kanban_programacao"
        WHERE id = $1 LIMIT 1`,
      [kanbanProgId]
    );
    if (rows[0]) {
      if (rows[0].codigo_produto) idOmie = Number(rows[0].codigo_produto);
      if (!codigo) codigo = String(rows[0].codigo || '').trim();
      if (!descricao) descricao = rows[0].descricao || null;
    }
  }

  if (!idOmie && opIappId) {
    const opDados = await buscarDadosOpKanban(opIappId);
    if (!codigo) codigo = String(opDados?.codigo_produto_texto || '').trim();
    if (!descricao) descricao = opDados?.descricao_produto || null;
    if (!idOmie) idOmie = opDados?.codigo_produto_id || await resolverCodigoProdutoOmieId(codigo);
  }

  if (!idOmie && codigo) idOmie = await resolverCodigoProdutoOmieId(codigo);
  if (!codigo && idOmie) {
    const { rows } = await dbQuery(
      `SELECT codigo, descricao FROM public.produtos_omie WHERE codigo_produto = $1 LIMIT 1`,
      [idOmie]
    );
    if (rows[0]) {
      codigo = String(rows[0].codigo || '').trim();
      if (!descricao) descricao = rows[0].descricao || null;
    }
  }

  return {
    idOmie: idOmie != null ? Number(idOmie) : null,
    codigoTexto: codigo || null,
    descricao,
  };
}

function codigoProdutoOmieParaGravar(idOmie) {
  return idOmie != null && Number.isFinite(Number(idOmie)) ? String(Number(idOmie)) : null;
}

async function buscarDadosOpKanban(opRefId) {
  const { rows: opProducao } = await dbQuery(
    `SELECT op.n_op AS numero_op,
            op.codigo AS codigo_produto_texto,
            COALESCE(po.descricao, '') AS descricao_produto,
            op.codigo_produto AS codigo_produto_id
       FROM "Producao"."OP_producao" op
       LEFT JOIN public.produtos_omie po ON po.codigo_produto = op.codigo_produto
      WHERE op.id = $1
      LIMIT 1`,
    [opRefId]
  );
  if (opProducao.length) return opProducao[0];

  const { rows } = await dbQuery(
    `SELECT o.identificacao AS numero_op,
            p.identificacao AS codigo_produto_texto,
            p.descricao AS descricao_produto,
            po.codigo_produto AS codigo_produto_id
       FROM "IAPP_API".op_iapp o
       LEFT JOIN "IAPP_API".op_iapp_produto p ON p.produto_id = o.produto_id
       LEFT JOIN public.produtos_omie po
         ON UPPER(TRIM(po.codigo)) = UPPER(TRIM(p.identificacao))
      WHERE o.iapp_id = $1
      LIMIT 1`,
    [opRefId]
  );
  return rows[0] || null;
}

async function semearVerificacoesDoTemplate(checkId, idOmie, kanbanLocal) {
  if (!checkId || !idOmie) return 0;

  const idTxt = codigoProdutoOmieParaGravar(idOmie);
  if (!idTxt) return 0;

  const { rows: existentes } = await dbQuery(
    `SELECT 1 FROM qualidade."RI_Verificacoes" WHERE ri_check_id = $1 LIMIT 1`,
    [checkId]
  );
  if (existentes.length) return 0;

  const localKanban = String(kanbanLocal || '').trim();
  const { rowCount } = await dbQuery(
    `INSERT INTO qualidade."RI_Verificacoes"
       (ri_check_id, codigo_produto, check_nome, descricao_check, foto, local)
     SELECT $1, $2, t.item_verificado, t.o_que_verificar, t.foto_url,
            COALESCE(NULLIF($3, ''), NULLIF(TRIM(t.local_verificacao), ''), NULL)
       FROM qualidade.ri t
      WHERE t.id_omie = $4
      ORDER BY t.id ASC`,
    [checkId, idTxt, localKanban, idOmie]
  );
  return rowCount || 0;
}

/** Lista verificações do RI atual (por ri_check_id). */
async function carregarVerificacoesPorCheck(checkId, localFiltro = null) {
  if (!checkId) return [];
  const params = [checkId];
  let sql = `
    SELECT v.*
      FROM qualidade."RI_Verificacoes" v
     WHERE v.ri_check_id = $1`;
  const local = String(localFiltro || '').trim();
  if (local) {
    sql += ` AND TRIM(COALESCE(v.local, '')) = $2`;
    params.push(local);
  }
  sql += ` ORDER BY v.id ASC`;
  const { rows } = await dbQuery(sql, params);
  return rows;
}

async function carregarCheckCompleto(checkId, localFiltro = null, opts = {}) {
  const { rows: checks } = await dbQuery(
    `SELECT * FROM qualidade."RI_Check" WHERE id = $1`,
    [checkId]
  );
  if (!checks.length) return null;
  const check = checks[0];
  const verificacoes = await carregarVerificacoesPorCheck(checkId, localFiltro);
  const out = { check, verificacoes };
  if (opts.incluirNiq) {
    const opRefId = resolverOpRefId(check);
    out.ocorrencias = opRefId ? await listarNiqPorOp(opRefId) : [];
  }
  return out;
}

function normKanbanStatusLabel(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function isKanbanMontagemEletrica(s) {
  return normKanbanStatusLabel(s) === 'montagem eletrica';
}

function isKanbanTeste(s) {
  return normKanbanStatusLabel(s) === 'teste';
}

function isKanbanTesteOk(s) {
  return normKanbanStatusLabel(s) === 'teste ok';
}

function isKanbanInspecaoFinal(s) {
  return normKanbanStatusLabel(s) === 'inspecao final';
}

function colKeyFromPostoKanban(posto) {
  const n = normKanbanStatusLabel(posto);
  if (n === 'montagem hermetica') return 'solicitado';
  if (n === 'montagem eletrica') return 'produzindo';
  if (n === 'teste') return 'teste';
  if (n === 'inspecao final' || n === 'teste ok') return 'inspecao_final';
  return '';
}

function postoAtualKanbanFromStatuses(statuses) {
  const norms = (statuses || []).map(s => normKanbanStatusLabel(s)).filter(Boolean);
  if (norms.includes('finalizado')) return null;
  if (norms.includes('inspecao final') || norms.includes('teste ok')) return 'Inspeção final';
  if (norms.includes('teste')) return 'Teste';
  if (norms.includes('montagem eletrica')) return 'Montagem eletrica';
  if (norms.includes('montagem hermetica')) return 'Montagem hermetica';
  return null;
}

function riRegistradoNoPosto(riStatus, postoAtual) {
  if (!postoAtual) return true;
  const nr = normKanbanStatusLabel(riStatus);
  if (!nr) return false;
  return nr === normKanbanStatusLabel(postoAtual);
}

async function carregarVerificacoesTemplate(idOmie, kanbanLocal) {
  const idOmieNum = Number(idOmie) || 0;
  if (!idOmieNum) return [];

  const localKanban = String(kanbanLocal || '').trim();
  const { rows } = await dbQuery(
    `SELECT t.item_verificado AS check_nome,
            t.o_que_verificar AS descricao_check,
            t.foto_url AS foto,
            NULL::text AS video,
            COALESCE(NULLIF(TRIM(t.local_verificacao), ''), NULL) AS local
       FROM qualidade.ri t
      WHERE t.id_omie = $1
      ORDER BY t.id ASC`,
    [idOmieNum]
  );

  if (!localKanban) return rows;
  const localNorm = normKanbanStatusLabel(localKanban);
  return rows.filter((r) => {
    const loc = String(r.local || '').trim();
    return !loc || normKanbanStatusLabel(loc) === localNorm;
  });
}

async function buscarCheckRiOpNoPosto(opRefId, kanbanLocal) {
  const posto = String(kanbanLocal || '').trim();
  if (!posto) return null;

  const { rows } = await dbQuery(
    `SELECT *
       FROM qualidade."RI_Check"
      WHERE op_producao_id = $1 OR op_iapp_id = $1
      ORDER BY id DESC`,
    [opRefId]
  );

  for (const row of rows) {
    if (riRegistradoNoPosto(row.status, posto)) return row;
  }
  return null;
}

async function listarKanbanProgIdsPorOp(opRefId, check) {
  await garantirSchemaKanbanProgramacao();
  const numeroOp = await resolverNumeroOpKanban(opRefId, check);
  const kanbanProgId = Number(check?.id_kanban_programacao) || null;
  const codigo = String(check?.codigo || '').trim();

  const params = [opRefId, numeroOp, kanbanProgId || null, codigo];
  const { rows } = await dbQuery(
    `SELECT DISTINCT kp.id
       FROM "Producao"."Kanban_programacao" kp
       LEFT JOIN "Producao"."OP_producao" op ON op.id = $1
      WHERE kp.op_producao_id = $1
         OR kp.op_iapp_id = $1
         OR ($2 <> '' AND UPPER(TRIM(COALESCE(kp.numero_op, ''))) = UPPER(TRIM($2)))
         OR (op.n_op IS NOT NULL AND UPPER(TRIM(COALESCE(kp.numero_op, ''))) = UPPER(TRIM(op.n_op)))
         OR ($3::bigint IS NOT NULL AND kp.id = $3)
         OR ($4 <> '' AND UPPER(TRIM(COALESCE(kp.codigo, ''))) = UPPER(TRIM($4))
             AND (kp.op_producao_id = $1 OR kp.op_iapp_id = $1 OR $2 <> ''))`,
    params
  );
  return rows.map(r => r.id);
}

async function atualizarStatusKanbanOp(opRefId, statusKanban, check, checkStatusRi) {
  if (checkStatusRi && check?.id) {
    await dbQuery(
      `UPDATE qualidade."RI_Check" SET status = $2, updated_at = NOW() WHERE id = $1`,
      [check.id, checkStatusRi]
    );
    dispararNotificacaoRiCheck(check.id);
  }

  const statusFinal = String(statusKanban || '').trim();
  const kanbanIds = await listarKanbanProgIdsPorOp(opRefId, check);
  const { rows: opProdRows } = await dbQuery(
    `SELECT id FROM "Producao"."OP_producao" WHERE id = $1 LIMIT 1`,
    [opRefId]
  );
  const opProducaoId = opProdRows[0]?.id || null;

  if (kanbanIds.length) {
    const upd = await dbQuery(
      `UPDATE "Producao"."Kanban_programacao"
          SET status = $1,
              op_producao_id = COALESCE(op_producao_id, $3)
        WHERE id = ANY($2::bigint[])`,
      [statusFinal, kanbanIds, opProducaoId]
    );
    return upd.rowCount || kanbanIds.length;
  }

  const numeroOp = await resolverNumeroOpKanban(opRefId, check);
  const kanbanProgId = Number(check?.id_kanban_programacao) || null;
  const opDados = await buscarDadosOpKanban(opRefId);
  const campos = await resolverCamposProdutoOmie({
    codigoTexto: check?.codigo,
    codigoProdutoHint: check?.codigo_produto,
    opIappId: opRefId,
    kanbanProgId: kanbanProgId || null,
  });
  const numeroOpGravar = String(numeroOp || opDados?.numero_op || opRefId).trim();
  const codigoCol = campos.codigoTexto || check?.codigo || numeroOpGravar;

  await dbQuery(
    `INSERT INTO "Producao"."Kanban_programacao"
       (codigo_produto, codigo, descricao, codigo_pedido, quantidade, numero_op, op_iapp_id, op_producao_id, status)
     VALUES ($1, $2, $3, 0, 1, $4, $5, $6, $7)`,
    [
      campos.idOmie,
      codigoCol,
      check?.descricao || campos.descricao || opDados?.descricao_produto || null,
      numeroOpGravar,
      opProducaoId ? null : opRefId,
      opProducaoId,
      statusFinal,
    ]
  );
  return 1;
}

async function buscarStatusKanbanOp(opRefId, numeroOpHint = '', check = null) {
  const kanbanIds = await listarKanbanProgIdsPorOp(opRefId, check || {});
  if (!kanbanIds.length) return '';

  const { rows } = await dbQuery(
    `SELECT status
       FROM "Producao"."Kanban_programacao"
      WHERE id = ANY($1::bigint[])
      ORDER BY id DESC`,
    [kanbanIds]
  );

  const statuses = rows.map(r => String(r.status || '').trim()).filter(Boolean);
  if (statuses.some(s => normKanbanStatusLabel(s) === 'finalizado')) return 'Finalizado';
  if (statuses.some(isKanbanTesteOk)) return 'Teste OK';
  if (statuses.some(isKanbanTeste)) return 'Teste';
  if (statuses.some(isKanbanMontagemEletrica)) return 'Montagem eletrica';
  if (statuses.some(s => normKanbanStatusLabel(s) === 'montagem hermetica')) return 'Montagem hermetica';
  return statuses[0] || '';
}

async function uploadRiMidia(codigoPasta, tipo, file) {
  if (!file?.buffer?.length) return null;
  const cod = sanitizePathPart(codigoPasta);
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

/** Cloudflare: produtos/RI/{codigo}/RI_deteccao/{OP}/foto|video/ */
async function uploadRiNiqMidia(codigoPasta, numeroOp, tipo, file) {
  if (!file?.buffer?.length) return null;
  const cod = sanitizePathPart(codigoPasta);
  const op = sanitizePathPart(numeroOp);
  const pasta = tipo === 'video' ? 'video' : 'foto';
  const ext = mime.extension(file.mimetype) || (file.originalname || '').split('.').pop() || 'bin';
  const nome = `${uuidv4()}.${String(ext).replace(/[^a-zA-Z0-9]/g, '')}`;
  const pathKey = `RI/${cod}/RI_deteccao/${op}/${pasta}/${nome}`;
  const { url } = await uploadPublicFile('produtos', pathKey, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false,
  });
  return url;
}

async function listarNiqPorOp(opIappId) {
  const { rows } = await dbQuery(
    `SELECT id, codigo_produto, op_iapp_id, numero_op, falha_detectada, foto, video,
            usuario, created_at::text AS created_at
       FROM qualidade."RI_NIQ"
      WHERE op_iapp_id = $1
      ORDER BY created_at DESC, id DESC`,
    [opIappId]
  );
  return rows;
}

// POST /api/qualidade/ri-check/status-por-ops — status RI mais recente por OP (montagem)
router.post('/status-por-ops', requireAuth, express.json(), async (req, res) => {
  try {
    await garantirSchemaRi();
    const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
    const ids = [...new Set(
      ops.map(o => Number(o.op_producao_id || o.op_id || 0)).filter(n => n > 0)
    )];
    if (!ids.length) {
      return res.json({ ok: true, status_por_op: {} });
    }

    const { rows } = await dbQuery(
      `SELECT op_producao_id, op_iapp_id, status
         FROM (
           SELECT op_producao_id, op_iapp_id, status,
                  ROW_NUMBER() OVER (
                    PARTITION BY COALESCE(NULLIF(op_producao_id, 0), op_iapp_id)
                    ORDER BY id DESC
                  ) AS rn
             FROM qualidade."RI_Check"
            WHERE op_producao_id = ANY($1::bigint[])
               OR op_iapp_id = ANY($1::bigint[])
         ) t
        WHERE rn = 1`,
      [ids]
    );

    const statusPorOp = {};
    for (const row of rows) {
      const key = Number(row.op_producao_id) || Number(row.op_iapp_id);
      if (key > 0) statusPorOp[String(key)] = String(row.status || '').trim();
    }
    return res.json({ ok: true, status_por_op: statusPorOp });
  } catch (err) {
    console.error('[qualidade/ri-check/status-por-ops]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao consultar status RI.' });
  }
});

// GET /api/qualidade/ri-check/pendentes — OPs no posto atual sem RI registrada nesse posto
router.get('/pendentes', requireAuth, async (_req, res) => {
  try {
    await garantirSchemaRi();
    await garantirSchemaKanbanProgramacao();

    const [kpResult, riResult] = await Promise.all([
      dbQuery(
        `SELECT id, op_producao_id, op_iapp_id, numero_op, status, codigo, observacao, postos
           FROM "Producao"."Kanban_programacao"
          WHERE COALESCE(NULLIF(TRIM(status), ''), '') <> ''
            AND LOWER(TRIM(status)) NOT IN ('programado', 'pedidos')`
      ),
      dbQuery(
        `SELECT op_producao_id, op_iapp_id, status AS ri_status
           FROM (
             SELECT op_producao_id, op_iapp_id, status,
                    ROW_NUMBER() OVER (
                      PARTITION BY COALESCE(NULLIF(op_producao_id, 0), op_iapp_id)
                      ORDER BY id DESC
                    ) AS rn
               FROM qualidade."RI_Check"
           ) t
          WHERE rn = 1`
      ),
    ]);

    const kpByOp = new Map();
    for (const row of kpResult.rows) {
      const opId = Number(row.op_producao_id) || Number(row.op_iapp_id);
      if (!opId) continue;
      if (!kpByOp.has(opId)) kpByOp.set(opId, []);
      kpByOp.get(opId).push(row);
    }

    const riByOp = new Map();
    for (const row of riResult.rows) {
      const opId = Number(row.op_producao_id) || Number(row.op_iapp_id);
      if (opId) riByOp.set(opId, String(row.ri_status || '').trim());
    }

    const opIds = [...kpByOp.keys()];
    if (!opIds.length) {
      return res.json({ ok: true, pendentes: [], total: 0 });
    }

    const { rows: opRows } = await dbQuery(
      `SELECT op.id,
              op.n_op,
              '1'::text AS qtde,
              op.created_at::text AS data_abertura,
              op.codigo AS prod_codigo,
              COALESCE(po.descricao, '') AS prod_descricao,
              '04 - Produto Acabado' AS prod_tipo
         FROM "Producao"."OP_producao" op
         LEFT JOIN public.produtos_omie po ON po.codigo_produto = op.codigo_produto
        WHERE op.id = ANY($1::bigint[])`,
      [opIds]
    );
    const opMap = new Map(opRows.map(r => [Number(r.id), r]));

    const pendentes = [];
    for (const [opId, regs] of kpByOp) {
      const postoAtual = postoAtualKanbanFromStatuses(regs.map(r => r.status));
      if (!postoAtual) continue;

      const riStatus = riByOp.get(opId) || '';
      if (riRegistradoNoPosto(riStatus, postoAtual)) continue;

      const op = opMap.get(Number(opId));
      if (!op) continue;

      const colKey = colKeyFromPostoKanban(postoAtual);
      if (!colKey) continue;

      pendentes.push({
        op_producao_id: opId,
        numero_op: op.n_op,
        posto: postoAtual,
        col_key: colKey,
        ri_status: riStatus || null,
        qtde: op.qtde,
        obs: null,
        data_abertura: op.data_abertura,
        data_inicio: null,
        data_final: null,
        data_previsao_faturamento: null,
        data_previsao_entrega: null,
        produto: {
          identificacao: op.prod_codigo,
          descricao: op.prod_descricao,
          tipo: op.prod_tipo,
        },
      });
    }

    pendentes.sort((a, b) => String(a.numero_op || '').localeCompare(String(b.numero_op || ''), 'pt-BR', { numeric: true }));
    return res.json({ ok: true, pendentes, total: pendentes.length });
  } catch (err) {
    console.error('[qualidade/ri-check/pendentes]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao listar RI pendentes.' });
  }
});

// GET /api/qualidade/ri-check/kanbans — nomes das colunas do kanban Registrar produção
// GET /api/qualidade/ri-check/config/whatsapp — configuração do usuário logado
router.get('/config/whatsapp', requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'Usuário não identificado.' });

    const config = await obterConfigNotificacaoUsuario(userId);
    return res.json({
      ok: true,
      config: config || {
        telefone_contato: '',
        permissao_op: false,
        permissao_ri: false,
      },
    });
  } catch (err) {
    console.error('[qualidade/ri-check/config/whatsapp GET]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/qualidade/ri-check/config/whatsapp — salvar número do usuário logado
router.put('/config/whatsapp', requireAuth, express.json(), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'Usuário não identificado.' });

    const username = req.session?.user?.username || getUsuario(req);
    const body = req.body || {};
    const config = await salvarConfigNotificacaoUsuario({
      userId,
      username,
      telefoneContato: body.telefone_contato ?? body.telefone_whatsapp,
      permissaoRi: body.permissao_ri ?? body.ativo,
    });

    return res.json({ ok: true, config });
  } catch (err) {
    console.error('[qualidade/ri-check/config/whatsapp PUT]', err);
    return res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/kanbans', requireAuth, (_req, res) => {
  return res.json({
    ok: true,
    kanbans: [
      'Pedidos',
      'Programado',
      'Montagem hermetica',
      'Montagem eletrica',
      'Teste',
      'Inspeção final',
    ],
  });
});

// POST /api/qualidade/ri-check/preparar — consulta template/RI existente sem gravar RI_Check
router.post('/preparar', requireAuth, express.json(), async (req, res) => {
  try {
    await garantirSchemaRi();
    const opRefId = Number(req.body?.op_producao_id) || Number(req.body?.op_iapp_id) || 0;
    if (!opRefId) return res.status(400).json({ ok: false, error: 'op_producao_id é obrigatório.' });

    const codigo = String(req.body?.codigo || '').trim();
    const descricao = String(req.body?.descricao || '').trim();
    const kanbanLocal = String(req.body?.kanban_local || '').trim();
    const codigoProdutoBody = Number(req.body?.codigo_produto) || null;

    const { rows: opProdRows } = await dbQuery(
      `SELECT id, n_op, codigo_produto, codigo FROM "Producao"."OP_producao" WHERE id = $1 LIMIT 1`,
      [opRefId]
    );
    const opRow = opProdRows[0] || null;
    const kanbanProgId = await buscarKanbanProgId(opRefId, String(opRow?.n_op || req.body?.numero_op || '').trim());

    let camposProd;
    if (opRow?.codigo_produto && (codigo || opRow.codigo)) {
      camposProd = {
        idOmie: Number(opRow.codigo_produto),
        codigoTexto: codigo || opRow.codigo,
        descricao: descricao || null,
      };
      if (!camposProd.descricao && camposProd.idOmie) {
        const { rows: poRows } = await dbQuery(
          `SELECT descricao FROM public.produtos_omie WHERE codigo_produto = $1 LIMIT 1`,
          [camposProd.idOmie]
        );
        if (poRows[0]?.descricao) camposProd.descricao = poRows[0].descricao;
      }
    } else {
      camposProd = await resolverCamposProdutoOmie({
        codigoTexto: codigo || opRow?.codigo,
        codigoProdutoHint: codigoProdutoBody || opRow?.codigo_produto,
        opIappId: opRefId,
        kanbanProgId,
      });
    }

    const checkExistente = kanbanLocal
      ? await buscarCheckRiOpNoPosto(opRefId, kanbanLocal)
      : null;

    if (checkExistente) {
      const dados = await carregarCheckCompleto(checkExistente.id, kanbanLocal || null, { incluirNiq: true });
      return res.json({
        ok: true,
        kanban_local: kanbanLocal || null,
        template_apenas: false,
        ja_registrado: true,
        ...dados,
      });
    }

    const verificacoes = camposProd.idOmie
      ? await carregarVerificacoesTemplate(camposProd.idOmie, kanbanLocal)
      : [];

    const opRefIdNum = Number(opRefId);
    const ocorrencias = opRefIdNum ? await listarNiqPorOp(opRefIdNum) : [];

    return res.json({
      ok: true,
      kanban_local: kanbanLocal || null,
      template_apenas: true,
      ja_registrado: false,
      check: null,
      verificacoes,
      ocorrencias,
      produto: {
        codigo: camposProd.codigoTexto || codigo || opRow?.codigo || null,
        codigo_produto: codigoProdutoOmieParaGravar(camposProd.idOmie),
        descricao: descricao || camposProd.descricao || null,
        op_producao_id: opRow?.id || opRefId,
        numero_op: opRow?.n_op || req.body?.numero_op || null,
        id_kanban_programacao: kanbanProgId,
      },
    });
  } catch (err) {
    console.error('[qualidade/ri-check/preparar]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao preparar RI.' });
  }
});

// POST /api/qualidade/ri-check/abrir
router.post('/abrir', requireAuth, express.json(), async (req, res) => {
  try {
    await garantirSchemaRi();
    const opRefId = Number(req.body?.op_producao_id) || Number(req.body?.op_iapp_id) || 0;
    if (!opRefId) return res.status(400).json({ ok: false, error: 'op_producao_id é obrigatório.' });

    const codigo = String(req.body?.codigo || '').trim();
    const descricao = String(req.body?.descricao || '').trim();
    const usuario = getUsuario(req);
    const codigoProdutoBody = Number(req.body?.codigo_produto) || null;

    const [opProdResult, kanbanProgIdFromBody] = await Promise.all([
      dbQuery(
        `SELECT id, n_op, codigo_produto, codigo FROM "Producao"."OP_producao" WHERE id = $1 LIMIT 1`,
        [opRefId]
      ),
      Number(req.body?.id_kanban_programacao) || null,
    ]);

    const opProdRows = opProdResult.rows;
    const opProducaoId = opProdRows[0]?.id || null;
    const numeroOpHint = String(opProdRows[0]?.n_op || req.body?.numero_op || '').trim();

    let kanbanProgId = kanbanProgIdFromBody;
    if (!kanbanProgId) kanbanProgId = await buscarKanbanProgId(opRefId, numeroOpHint);

    const kanbanLocal = String(req.body?.kanban_local || '').trim();
    const opRow = opProdRows[0] || null;
    let camposProd;
    if (opRow?.codigo_produto && (codigo || opRow.codigo)) {
      camposProd = {
        idOmie: Number(opRow.codigo_produto),
        codigoTexto: codigo || opRow.codigo,
        descricao: descricao || null,
      };
      if (!camposProd.descricao && camposProd.idOmie) {
        const { rows: poRows } = await dbQuery(
          `SELECT descricao FROM public.produtos_omie WHERE codigo_produto = $1 LIMIT 1`,
          [camposProd.idOmie]
        );
        if (poRows[0]?.descricao) camposProd.descricao = poRows[0].descricao;
      }
    } else {
      camposProd = await resolverCamposProdutoOmie({
        codigoTexto: codigo || opRow?.codigo,
        codigoProdutoHint: codigoProdutoBody || opRow?.codigo_produto,
        opIappId: opRefId,
        kanbanProgId,
      });
    }
    const codigoGravar = camposProd.codigoTexto || codigo || null;
    const codigoProdutoGravar = codigoProdutoOmieParaGravar(camposProd.idOmie);
    const descricaoGravar = descricao || camposProd.descricao || null;

    const opWhere = `(op_producao_id = $1 OR op_iapp_id = $1)`;
    let existente;
    if (kanbanLocal === 'Montagem eletrica') {
      existente = await dbQuery(
        `SELECT id FROM qualidade."RI_Check"
          WHERE ${opWhere} AND status IN ('Montagem eletrica', 'Liberado')
          ORDER BY id DESC LIMIT 1`,
        [opRefId]
      );
    } else if (kanbanLocal === 'Teste') {
      existente = await dbQuery(
        `SELECT id FROM qualidade."RI_Check"
          WHERE ${opWhere} AND status = 'Teste'
          ORDER BY id DESC LIMIT 1`,
        [opRefId]
      );
    } else if (kanbanLocal === 'Inspeção final') {
      existente = await dbQuery(
        `SELECT id FROM qualidade."RI_Check"
          WHERE ${opWhere} AND status IN ('Inspeção final', 'Teste OK')
          ORDER BY id DESC LIMIT 1`,
        [opRefId]
      );
    } else {
      existente = await dbQuery(
        `SELECT id FROM qualidade."RI_Check"
          WHERE ${opWhere}
            AND COALESCE(status, '') NOT IN (
              'Montagem eletrica', 'Liberado', 'Teste', 'Inspeção final', 'Teste OK', 'Finalizado'
            )
          ORDER BY id DESC LIMIT 1`,
        [opRefId]
      );
    }

    let checkId;
    if (existente.rows.length) {
      checkId = existente.rows[0].id;
      await dbQuery(
        `UPDATE qualidade."RI_Check"
            SET codigo_produto = COALESCE($2, codigo_produto),
                codigo = COALESCE(NULLIF($3, ''), codigo),
                descricao = COALESCE(NULLIF($4, ''), descricao),
                id_kanban_programacao = COALESCE($5, id_kanban_programacao),
                op_producao_id = COALESCE($6, op_producao_id),
                usuario = $7,
                updated_at = NOW()
          WHERE id = $1`,
        [checkId, codigoProdutoGravar, codigoGravar, descricaoGravar, kanbanProgId, opProducaoId, usuario]
      );
      dispararNotificacaoRiCheck(checkId);
    } else {
      const ins = await dbQuery(
        `INSERT INTO qualidade."RI_Check"
           (id_kanban_programacao, codigo_produto, codigo, descricao, op_iapp_id, op_producao_id, usuario, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Em andamento')
         RETURNING id`,
        [kanbanProgId, codigoProdutoGravar, codigoGravar, descricaoGravar, opRefId, opProducaoId, usuario]
      );
      checkId = ins.rows[0].id;
      dispararNotificacaoRiCheck(checkId);
    }

    if (camposProd.idOmie) {
      await semearVerificacoesDoTemplate(checkId, camposProd.idOmie, kanbanLocal);
    }

    const dados = await carregarCheckCompleto(checkId, kanbanLocal || null, { incluirNiq: true });
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

    const camposProd = await resolverCamposProdutoOmie({
      codigoTexto: dados.check.codigo,
      codigoProdutoHint: req.body?.codigo_produto || dados.check.codigo_produto,
      opIappId: dados.check.op_iapp_id,
      kanbanProgId: dados.check.id_kanban_programacao,
    });
    const codigoProdutoGravar = codigoProdutoOmieParaGravar(camposProd.idOmie);
    const codigoPasta = camposProd.codigoTexto || dados.check.codigo || String(camposProd.idOmie || 'sem_codigo');

    const local = String(req.body?.local || '').trim();
    if (!local) return res.status(400).json({ ok: false, error: 'Informe o local (kanban).' });

    let fotoUrl = null;
    let videoUrl = null;
    if (req.files?.foto?.[0]) {
      fotoUrl = await uploadRiMidia(codigoPasta, 'foto', req.files.foto[0]);
    }
    if (req.files?.video?.[0]) {
      videoUrl = await uploadRiMidia(codigoPasta, 'video', req.files.video[0]);
    }

    const ins = await dbQuery(
      `INSERT INTO qualidade."RI_Verificacoes"
         (ri_check_id, codigo_produto, check_nome, descricao_check, foto, video, local)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [checkId, codigoProdutoGravar, checkNome, descricaoCheck || null, fotoUrl, videoUrl, local]
    );

    await dbQuery(`UPDATE qualidade."RI_Check" SET updated_at = NOW() WHERE id = $1`, [checkId]);
    dispararNotificacaoRiCheck(checkId);

    return res.json({ ok: true, verificacao: ins.rows[0] });
  } catch (err) {
    console.error('[qualidade/ri-check/verificacoes]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao salvar verificação.' });
  }
});

// GET /api/qualidade/ri-check/:id/niq — ocorrências (falhas) da OP do RI
router.get('/:id/niq', requireAuth, async (req, res) => {
  try {
    await garantirSchemaRi();
    const checkId = Number(req.params.id) || 0;
    const dados = await carregarCheckCompleto(checkId);
    if (!dados) return res.status(404).json({ ok: false, error: 'RI não encontrado.' });
    const opRefId = resolverOpRefId(dados.check);
    if (!opRefId) return res.status(400).json({ ok: false, error: 'OP inválida no RI.' });
    const ocorrencias = await listarNiqPorOp(opRefId);
    return res.json({ ok: true, ocorrencias });
  } catch (err) {
    console.error('[qualidade/ri-check/niq GET]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao listar ocorrências.' });
  }
});

// POST /api/qualidade/ri-check/:id/niq — registrar falha detectada (foto/vídeo no R2)
router.post('/:id/niq', requireAuth, upload.fields([
  { name: 'foto', maxCount: 1 },
  { name: 'video', maxCount: 1 },
]), async (req, res) => {
  try {
    await garantirSchemaRi();
    const checkId = Number(req.params.id) || 0;
    const dados = await carregarCheckCompleto(checkId);
    if (!dados) return res.status(404).json({ ok: false, error: 'RI não encontrado.' });

    const check = dados.check;
    const opIappId = Number(check.op_iapp_id) || 0;
    if (!opIappId) return res.status(400).json({ ok: false, error: 'OP inválida no RI.' });

    const falhaDetectada = String(req.body?.falha_detectada || '').trim();
    if (!falhaDetectada) {
      return res.status(400).json({ ok: false, error: 'Informe a falha detectada.' });
    }

    const camposProd = await resolverCamposProdutoOmie({
      codigoTexto: check.codigo,
      codigoProdutoHint: check.codigo_produto,
      opIappId,
      kanbanProgId: check.id_kanban_programacao,
    });
    const codigoProdutoGravar = codigoProdutoOmieParaGravar(camposProd.idOmie);
    const codigoPasta = camposProd.codigoTexto || check.codigo || String(camposProd.idOmie || 'sem_codigo');

    const opDados = await buscarDadosOpKanban(opIappId);
    const numeroOp = String(check.numero_op || opDados?.numero_op || opIappId).trim();
    const usuario = getUsuario(req);

    let fotoUrl = null;
    let videoUrl = null;
    if (req.files?.foto?.[0]) {
      fotoUrl = await uploadRiNiqMidia(codigoPasta, numeroOp, 'foto', req.files.foto[0]);
    }
    if (req.files?.video?.[0]) {
      videoUrl = await uploadRiNiqMidia(codigoPasta, numeroOp, 'video', req.files.video[0]);
    }

    const ins = await dbQuery(
      `INSERT INTO qualidade."RI_NIQ"
         (codigo_produto, op_iapp_id, numero_op, falha_detectada, foto, video, usuario)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, codigo_produto, op_iapp_id, numero_op, falha_detectada, foto, video,
                 usuario, created_at::text AS created_at`,
      [codigoProdutoGravar, opIappId, numeroOp, falhaDetectada, fotoUrl, videoUrl, usuario]
    );

    await dbQuery(`UPDATE qualidade."RI_Check" SET updated_at = NOW() WHERE id = $1`, [checkId]);
    dispararNotificacaoRiCheck(checkId);

    return res.json({ ok: true, ocorrencia: ins.rows[0] });
  } catch (err) {
    console.error('[qualidade/ri-check/niq POST]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao registrar ocorrência.' });
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
    dispararNotificacaoRiCheck(checkId);

    if (avancarTeste) {
      const opRefId = resolverOpRefId(dadosAtual.check);
      if (!opRefId) return res.status(400).json({ ok: false, error: 'OP inválida no RI.' });
      await atualizarStatusKanbanOp(opRefId, 'Teste', dadosAtual.check, 'Teste');
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
// Registra RI: grava status = nome do kanban/posto atual (sem mover a OP).
// Body opcional: { kanban_origem: 'Montagem hermetica' | ... }
router.post('/:id/liberar', requireAuth, express.json(), async (req, res) => {
  try {
    await garantirSchemaRi();
    const checkId = Number(req.params.id) || 0;
    const dados = await carregarCheckCompleto(checkId);
    if (!dados) return res.status(404).json({ ok: false, error: 'RI não encontrado.' });

    const check = dados.check;
    const opRefId = Number(req.body?.op_producao_id) || resolverOpRefId(check);
    if (!opRefId) return res.status(400).json({ ok: false, error: 'OP inválida no RI.' });

    const usuario = getUsuario(req);
    const kanbanOrigem = String(req.body?.kanban_origem || '').trim();
    const numeroOpBody = String(req.body?.numero_op || '').trim();
    const numeroOp = numeroOpBody || await resolverNumeroOpKanban(opRefId, check);
    const statusAtualKanban = await buscarStatusKanbanOp(opRefId, numeroOp, check);

    const statusRi = kanbanOrigem || statusAtualKanban;
    if (!statusRi) {
      return res.status(400).json({ ok: false, error: 'Posto/kanban atual da OP não identificado.' });
    }

    await dbQuery(
      `UPDATE qualidade."RI_Check"
          SET status = $2, usuario = $3, updated_at = NOW()
        WHERE id = $1`,
      [checkId, statusRi, usuario]
    );
    dispararNotificacaoRiCheck(checkId);

    try {
      const kanbanProgId = Number(check.id_kanban_programacao) || null;
      const opProdId = Number(check.op_producao_id) || Number(check.op_iapp_id) || opRefId;
      await registrarRiConcluida({
        kanbanProgramacaoId: kanbanProgId,
        opProducaoId: opProdId,
        numeroOp: numeroOp || '',
        postoOrigem: statusRi,
        riCheckId: checkId,
        usuario,
        operacao: `RI registrada — ${statusRi}`,
      });
    } catch (tempoErr) {
      console.error('[tempo_producao] Falha ao registrar RI concluída:', tempoErr.message);
    }

    const localFiltro = kanbanOrigem || statusRi || null;
    const atualizado = await carregarCheckCompleto(checkId, localFiltro);
    const opProducaoId = Number(check.op_producao_id) || 0;
    return res.json({
      ok: true,
      ...atualizado,
      kanban_status: statusRi,
      somente_ri: true,
      numero_op: numeroOp || null,
      op_producao_id: opProducaoId || opRefId,
    });
  } catch (err) {
    console.error('[qualidade/ri-check/liberar]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao liberar.' });
  }
});

/**
 * Cria/garante RI_Check ao imprimir OP (Programado → Montagem hermetica).
 * O registro nasce como 'Em andamento' — o status do posto só é gravado
 * quando o usuário clica em "Registrar RI" no modal (rota /:id/liberar).
 * Se já existir RI registrada no posto (statusRi), apenas atualiza os campos.
 */
async function registrarRiCheckImpressaoOp({
  opProducaoId = 0,
  opIappId = 0,
  numeroOp = '',
  codigo = '',
  codigoProduto = null,
  descricao = '',
  usuario = '',
  statusRi = 'Montagem hermetica',
}) {
  await garantirSchemaRi();
  const opRefId = Number(opProducaoId) || Number(opIappId) || 0;
  if (!opRefId) return null;

  const opProducaoIdGravar = opProducaoId > 0 ? opProducaoId : null;
  const opIappIdGravar = opIappId > 0 ? opIappId : opRefId;
  const kanbanProgId = await buscarKanbanProgId(opRefId, numeroOp);
  const codigoProdutoGravar = codigoProdutoOmieParaGravar(codigoProduto);
  const statusFinal = String(statusRi || 'Montagem hermetica').trim();
  const opWhere = `(op_producao_id = $1 OR op_iapp_id = $1)`;

  const { rows: existentes } = await dbQuery(
    `SELECT id FROM qualidade."RI_Check"
      WHERE ${opWhere}
        AND LOWER(TRIM(COALESCE(status, ''))) = LOWER(TRIM($2))
      ORDER BY id DESC LIMIT 1`,
    [opRefId, statusFinal]
  );

  if (existentes.length) {
    await dbQuery(
      `UPDATE qualidade."RI_Check"
          SET codigo_produto = COALESCE($2, codigo_produto),
              codigo = COALESCE(NULLIF($3, ''), codigo),
              descricao = COALESCE(NULLIF($4, ''), descricao),
              id_kanban_programacao = COALESCE($5, id_kanban_programacao),
              op_producao_id = COALESCE($6, op_producao_id),
              op_iapp_id = COALESCE($7, op_iapp_id),
              usuario = $8,
              updated_at = NOW()
        WHERE id = $1`,
      [
        existentes[0].id,
        codigoProdutoGravar,
        codigo || null,
        descricao || null,
        kanbanProgId,
        opProducaoIdGravar,
        opIappIdGravar,
        usuario,
      ]
    );
    dispararNotificacaoRiCheck(existentes[0].id);
    return { id: existentes[0].id, updated: true };
  }

  const { rows: emAndamento } = await dbQuery(
    `SELECT id FROM qualidade."RI_Check"
      WHERE ${opWhere}
        AND COALESCE(status, '') NOT IN (
          'Montagem hermetica', 'Montagem eletrica', 'Liberado',
          'Teste', 'Inspeção final', 'Teste OK', 'Finalizado'
        )
      ORDER BY id DESC LIMIT 1`,
    [opRefId]
  );

  if (emAndamento.length) {
    // Mantém o status atual (ex.: 'Em andamento') — registrar no posto é ação manual do usuário.
    await dbQuery(
      `UPDATE qualidade."RI_Check"
          SET codigo_produto = COALESCE($2, codigo_produto),
              codigo = COALESCE(NULLIF($3, ''), codigo),
              descricao = COALESCE(NULLIF($4, ''), descricao),
              id_kanban_programacao = COALESCE($5, id_kanban_programacao),
              op_producao_id = COALESCE($6, op_producao_id),
              op_iapp_id = COALESCE($7, op_iapp_id),
              usuario = $8,
              updated_at = NOW()
        WHERE id = $1`,
      [
        emAndamento[0].id,
        codigoProdutoGravar,
        codigo || null,
        descricao || null,
        kanbanProgId,
        opProducaoIdGravar,
        opIappIdGravar,
        usuario,
      ]
    );
    dispararNotificacaoRiCheck(emAndamento[0].id);
    return { id: emAndamento[0].id, updated: true };
  }

  // Nasce 'Em andamento': o botão "Registrar RI" do modal é quem grava o posto.
  const ins = await dbQuery(
    `INSERT INTO qualidade."RI_Check"
       (id_kanban_programacao, codigo_produto, codigo, descricao, op_iapp_id, op_producao_id, usuario, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Em andamento')
     RETURNING id`,
    [
      kanbanProgId,
      codigoProdutoGravar,
      codigo || null,
      descricao || null,
      opIappIdGravar,
      opProducaoIdGravar,
      usuario,
    ]
  );
  dispararNotificacaoRiCheck(ins.rows[0]?.id);
  return { id: ins.rows[0]?.id, created: true };
}

/** Desfaz registro de RI no posto (status volta para Em andamento). */
async function reverterRiCheckNoPosto(opRefId, postoKanban) {
  const opId = Number(opRefId) || 0;
  const posto = String(postoKanban || '').trim();
  if (!opId || !posto) return null;

  const row = await buscarCheckRiOpNoPosto(opId, posto);
  if (!row?.id) return null;

  await dbQuery(
    `UPDATE qualidade."RI_Check"
        SET status = 'Em andamento',
            updated_at = NOW()
      WHERE id = $1`,
    [row.id]
  );
  dispararNotificacaoRiCheck(row.id);
  return row.id;
}

router.registrarRiCheckImpressaoOp = registrarRiCheckImpressaoOp;
router.reverterRiCheckNoPosto = reverterRiCheckNoPosto;
module.exports = router;
