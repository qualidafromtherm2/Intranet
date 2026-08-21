// routes/qualidadeRiCheck.js — RI Registro de Inspeção (kanban produção)
'use strict';

const { registrarRiConcluida, iniciarCicloPosto } = require('../utils/tempoProducao');
const {
  dispararNotificacaoRiCheck,
  dispararNotificacaoOcorrencia,
  obterConfigNotificacaoUsuario,
  salvarConfigNotificacaoUsuario,
} = require('../utils/riCheckWhatsappNotificacao');

const express = require('express');
const router = express.Router();
const multer = require('multer');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');
const { dbQuery } = require('../src/db');
const { uploadPublicFile, removePublicFiles } = require('../utils/storage');
const omieCall = require('../utils/omieCall');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.server');
const { anexarHoraObs } = require('../utils/anexarHoraObs');

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
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS producao`);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade."RI_Check" (
      id                      BIGSERIAL PRIMARY KEY,
      id_kanban_programacao   BIGINT,
      codigo_produto          TEXT,
      codigo                  TEXT,
      descricao               TEXT,
      op_iapp_id              BIGINT NOT NULL,
      status                  TEXT NOT NULL DEFAULT 'Em andamento',
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`ALTER TABLE qualidade."RI_Check" DROP COLUMN IF EXISTS usuario`);
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

  // codigo_produto = produto.produtos_omie.codigo_produto (id Omie numérico)
  await dbQuery(`
    UPDATE qualidade."RI_Check" c
       SET codigo_produto = po.codigo_produto::text
      FROM produto.produtos_omie po
     WHERE c.codigo_produto IS NOT NULL
       AND TRIM(c.codigo_produto) <> ''
       AND c.codigo_produto !~ '^[0-9]+$'
       AND UPPER(TRIM(po.codigo)) = UPPER(TRIM(COALESCE(c.codigo, c.codigo_produto)))
  `).catch(() => {});
  await dbQuery(`
    UPDATE qualidade."RI_Verificacoes" v
       SET codigo_produto = po.codigo_produto::text
      FROM produto.produtos_omie po
     WHERE v.codigo_produto IS NOT NULL
       AND TRIM(v.codigo_produto) <> ''
       AND v.codigo_produto !~ '^[0-9]+$'
       AND EXISTS (
         SELECT 1 FROM qualidade."RI_Check" c
          WHERE c.id = v.ri_check_id
            AND UPPER(TRIM(po.codigo)) = UPPER(TRIM(COALESCE(c.codigo, v.codigo_produto)))
       )
  `).catch(() => {});

  await dbQuery(`ALTER TABLE producao."Kanban_programacao" ADD COLUMN IF NOT EXISTS status TEXT`);

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
  await dbQuery(`ALTER TABLE qualidade."RI_NIQ" ADD COLUMN IF NOT EXISTS corrigido BOOLEAN NOT NULL DEFAULT false`);
  await dbQuery(`ALTER TABLE qualidade."RI_NIQ" ADD COLUMN IF NOT EXISTS corrigido_por TEXT`);
  await dbQuery(`ALTER TABLE qualidade."RI_NIQ" ADD COLUMN IF NOT EXISTS corrigido_em TIMESTAMPTZ`);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_niq_aberta
      ON qualidade."RI_NIQ" (op_iapp_id)
      WHERE COALESCE(corrigido, false) = false
  `);

  // Vários arquivos por verificação / ocorrência (foto, vídeo, documento)
  await dbQuery(`ALTER TABLE qualidade.ri ADD COLUMN IF NOT EXISTS anexos JSONB DEFAULT '[]'::jsonb`);
  await dbQuery(`ALTER TABLE qualidade."RI_Verificacoes" ADD COLUMN IF NOT EXISTS anexos JSONB DEFAULT '[]'::jsonb`);
  await dbQuery(`ALTER TABLE qualidade."RI_NIQ" ADD COLUMN IF NOT EXISTS anexos JSONB DEFAULT '[]'::jsonb`);

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

  // Migração única: OPs que estavam pendentes de RI (lógica antiga) → checkbox ri=true
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade."_schema_migrations" (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const { rows: migRows } = await dbQuery(
    `SELECT 1 FROM qualidade."_schema_migrations" WHERE name = 'kanban_ri_checkbox_v1' LIMIT 1`
  );
  if (!migRows.length) {
    await garantirSchemaKanbanProgramacao();
    await dbQuery(`
      UPDATE producao."Kanban_programacao" kp
         SET ri = TRUE
        WHERE COALESCE(kp.ri, FALSE) = FALSE
          AND COALESCE(NULLIF(TRIM(kp.status), ''), '') <> ''
          AND LOWER(TRIM(kp.status)) NOT IN ('programado', 'pedidos', 'finalizado')
          AND NOT EXISTS (
            SELECT 1
              FROM (
                SELECT status,
                       COALESCE(NULLIF(op_producao_id, 0), op_iapp_id) AS op_id,
                       ROW_NUMBER() OVER (
                         PARTITION BY COALESCE(NULLIF(op_producao_id, 0), op_iapp_id)
                         ORDER BY id DESC
                       ) AS rn
                  FROM qualidade."RI_Check"
              ) c
             WHERE c.rn = 1
               AND c.op_id = COALESCE(NULLIF(kp.op_producao_id, 0), kp.op_iapp_id)
               AND LOWER(TRIM(COALESCE(c.status, ''))) = LOWER(TRIM(COALESCE(kp.status, '')))
          )
    `).catch((e) => console.warn('[ri] migração kanban_ri_checkbox:', e.message));
    await dbQuery(
      `INSERT INTO qualidade."_schema_migrations" (name) VALUES ('kanban_ri_checkbox_v1') ON CONFLICT DO NOTHING`
    );
  }

  schemaOk = true;
}

let kanbanProgSchemaOk = false;

async function garantirSchemaKanbanProgramacao() {
  if (kanbanProgSchemaOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS producao`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS producao."Kanban_programacao" (
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
  await dbQuery(`ALTER TABLE producao."Kanban_programacao" ADD COLUMN IF NOT EXISTS numero_op TEXT`);
  await dbQuery(`ALTER TABLE producao."Kanban_programacao" ADD COLUMN IF NOT EXISTS op_iapp_id BIGINT`);
  await dbQuery(`ALTER TABLE producao."Kanban_programacao" ADD COLUMN IF NOT EXISTS op_producao_id BIGINT`);
  await dbQuery(`ALTER TABLE producao."Kanban_programacao" ADD COLUMN IF NOT EXISTS status TEXT`);
  await dbQuery(`ALTER TABLE producao."Kanban_programacao" ADD COLUMN IF NOT EXISTS observacao TEXT`);
  await dbQuery(`ALTER TABLE producao."Kanban_programacao" ADD COLUMN IF NOT EXISTS postos TEXT`);
  await dbQuery(`ALTER TABLE producao."Kanban_programacao" ADD COLUMN IF NOT EXISTS ri BOOLEAN NOT NULL DEFAULT FALSE`);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_kanban_prog_op_iapp
      ON producao."Kanban_programacao" (op_iapp_id)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_kanban_prog_op_producao
      ON producao."Kanban_programacao" (op_producao_id)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_kanban_prog_numero_op
      ON producao."Kanban_programacao" (numero_op)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_kanban_prog_ri
      ON producao."Kanban_programacao" (ri)
      WHERE ri = TRUE
  `);
  await dbQuery(`ALTER TABLE producao."Kanban_programacao" ADD COLUMN IF NOT EXISTS estoque_maq_entrada_em TIMESTAMPTZ`);
  await dbQuery(
    `UPDATE producao."Kanban_programacao"
        SET status = 'Inspeção final',
            ri = TRUE
      WHERE LOWER(TRIM(COALESCE(status, ''))) = 'embalagem'`
  );
  kanbanProgSchemaOk = true;
}

async function buscarKanbanProgId(opRefId, numeroOpHint = '') {
  const numeroOp = String(numeroOpHint || '').trim();
  const { rows } = await dbQuery(
    `SELECT id FROM producao."Kanban_programacao"
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
      `SELECT numero_op FROM producao."Kanban_programacao" WHERE id = $1 LIMIT 1`,
      [check.id_kanban_programacao]
    );
    const n = String(rows[0]?.numero_op || '').trim();
    if (n) return n;
  }

  const { rows: kpRows } = await dbQuery(
    `SELECT numero_op FROM producao."Kanban_programacao"
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
       FROM produto.produtos_omie
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
         FROM producao."Kanban_programacao"
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
      `SELECT codigo, descricao FROM produto.produtos_omie WHERE codigo_produto = $1 LIMIT 1`,
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
       FROM producao."OP_producao" op
       LEFT JOIN produto.produtos_omie po ON po.codigo_produto = op.codigo_produto
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
       FROM producao.op_iapp o
       LEFT JOIN producao.op_iapp_produto p ON p.produto_id = o.produto_id
       LEFT JOIN produto.produtos_omie po
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
       (ri_check_id, codigo_produto, check_nome, descricao_check, foto, local, anexos)
     SELECT $1, $2, t.item_verificado, t.o_que_verificar, t.foto_url,
            COALESCE(NULLIF($3, ''), NULLIF(TRIM(t.local_verificacao), ''), NULL),
            COALESCE(t.anexos, '[]'::jsonb)
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
  const n = normKanbanStatusLabel(s);
  return n === 'inspecao final' || n === 'teste final' || n === 'teste ok';
}

function isKanbanEmbalagem(s) {
  return normKanbanStatusLabel(s) === 'embalagem';
}

const COD_ESTOQUE_MAQUINAS = '10408747829';
const NOME_ESTOQUE_MAQUINAS = '4. ESTOQUE MAQUINAS';

function formatarDataBROmie(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getFullYear()}`;
}

function deveEntrarEstoqueMaquinas(statusRi) {
  return isKanbanInspecaoFinal(statusRi) || isKanbanEmbalagem(statusRi);
}

function proximoPostoAposRi(statusRi) {
  const n = normKanbanStatusLabel(statusRi);
  if (n === 'montagem hermetica') return 'Montagem eletrica';
  if (n === 'montagem eletrica') return 'Teste';
  if (n === 'teste') return 'Inspeção final';
  return '';
}

async function incluirEntradaEstoqueMaquinasOmie({
  opRefId,
  numeroOp,
  usuario,
  check,
  kanbanProgId,
}) {
  const { rows: kpRows } = kanbanProgId
    ? await dbQuery(
        `SELECT id, estoque_maq_entrada_em, quantidade, codigo, codigo_produto, descricao
           FROM producao."Kanban_programacao"
          WHERE id = $1
          LIMIT 1`,
        [kanbanProgId]
      )
    : { rows: [] };
  if (kpRows[0]?.estoque_maq_entrada_em) {
    return { skipped: true, ja_lancado: true };
  }

  const { rows: opRows } = await dbQuery(
    `SELECT id, n_op, codigo, codigo_produto
       FROM producao."OP_producao"
      WHERE id = $1
      LIMIT 1`,
    [opRefId]
  );
  const op = opRows[0] || {};
  const codigo = String(check?.codigo || op.codigo || kpRows[0]?.codigo || '').trim();
  const idProd = Number(check?.codigo_produto || op.codigo_produto || kpRows[0]?.codigo_produto) || 0;
  const qtdKp = Number(kpRows[0]?.quantidade);
  const qtd = (Number.isFinite(qtdKp) && qtdKp > 0) ? qtdKp : 1;

  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    const err = new Error('Credenciais da Omie ausentes. Não foi possível lançar o estoque de máquinas.');
    err.status = 500;
    throw err;
  }
  if (!idProd && !codigo) {
    const err = new Error('Produto da OP sem código Omie. Não foi possível lançar no armazém 4. ESTOQUE MAQUINAS.');
    err.status = 400;
    throw err;
  }

  const { rows: prodRows } = await dbQuery(
    `SELECT p.codigo_produto AS id_prod,
            p.codigo,
            COALESCE(p.descricao, '') AS descricao,
            COALESCE(
              NULLIF(e.cmc, 0),
              NULLIF(e.preco_unitario, 0),
              NULLIF(p.valor_unitario, 0),
              0.01
            ) AS valor_unit
       FROM produto.produtos_omie p
       LEFT JOIN logistica.estoque_atual e
         ON TRIM(e.codigo) = TRIM(p.codigo) AND e.local_codigo = $2
      WHERE ($1::bigint > 0 AND p.codigo_produto = $1)
         OR ($3 <> '' AND TRIM(p.codigo) = TRIM($3))
      LIMIT 1`,
    [idProd || 0, COD_ESTOQUE_MAQUINAS, codigo]
  );
  const idOmie = Number(prodRows[0]?.id_prod || idProd) || 0;
  const codigoProd = String(prodRows[0]?.codigo || codigo).trim();
  const descricao = String(prodRows[0]?.descricao || check?.descricao || kpRows[0]?.descricao || '').trim();
  const valorUnit = parseFloat(prodRows[0]?.valor_unit) || 0.01;
  if (!idOmie) {
    const err = new Error(`Produto ${codigoProd || codigo || opRefId} não encontrado no cadastro Omie.`);
    err.status = 400;
    throw err;
  }

  const nOp = String(numeroOp || op.n_op || '').trim();
  const obsOmie = anexarHoraObs(
    `Entrada produção (RI Inspeção final). OP ${nOp || opRefId}`
      + (usuario ? ` | Por: ${usuario}` : '')
  );
  const payload = {
    call: 'IncluirAjusteEstoque',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      codigo_local_estoque: Number(COD_ESTOQUE_MAQUINAS) || COD_ESTOQUE_MAQUINAS,
      id_prod: idOmie,
      data: formatarDataBROmie(new Date()),
      tipo: 'ENT',
      quan: String(qtd),
      valor: valorUnit,
      obs: obsOmie,
      origem: 'AJU',
      motivo: 'INV',
    }],
  };

  let omieResp;
  try {
    omieResp = await omieCall('https://app.omie.com.br/api/v1/estoque/ajuste/', payload);
  } catch (omieErr) {
    const fault = omieErr?.faultstring || omieErr?.message || String(omieErr);
    const err = new Error(`Omie recusou a entrada no armazém 4. ESTOQUE MAQUINAS: ${fault}`);
    err.status = 502;
    throw err;
  }
  if (omieResp?.faultstring) {
    const err = new Error(`Omie recusou a entrada: ${omieResp.faultstring}`);
    err.status = 502;
    throw err;
  }
  if (omieResp?.codigo_status != null && String(omieResp.codigo_status) !== '0') {
    const err = new Error(String(omieResp.descricao_status || 'Omie rejeitou a entrada de estoque.'));
    err.status = 502;
    throw err;
  }

  const omieCodigo = String(
    omieResp?.codigo_lancamento_omie
    || omieResp?.nCodAjuste
    || omieResp?.codigo_ajuste
    || omieResp?.id_ajuste
    || ''
  ).trim() || null;

  try {
    await dbQuery(
      `INSERT INTO logistica.estoque_atual
         (local_codigo, local_nome, omie_prod_id, codigo, descricao, saldo, fisico, origem, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, 'ri-inspecao-final', NOW())
       ON CONFLICT ON CONSTRAINT uq_estoque_atual_prod_local
       DO UPDATE SET
         saldo = COALESCE(logistica.estoque_atual.saldo, 0) + EXCLUDED.saldo,
         fisico = COALESCE(logistica.estoque_atual.fisico, 0) + EXCLUDED.fisico,
         omie_prod_id = COALESCE(EXCLUDED.omie_prod_id, logistica.estoque_atual.omie_prod_id),
         descricao = COALESCE(NULLIF(EXCLUDED.descricao, ''), logistica.estoque_atual.descricao),
         origem = EXCLUDED.origem,
         updated_at = NOW()`,
      [COD_ESTOQUE_MAQUINAS, NOME_ESTOQUE_MAQUINAS, idOmie, codigoProd, descricao || null, qtd]
    );
  } catch (estErr) {
    console.warn('[qualidade/ri-check] estoque_atual local não atualizado:', estErr.message);
  }

  if (kanbanProgId) {
    await dbQuery(
      `UPDATE producao."Kanban_programacao"
          SET estoque_maq_entrada_em = COALESCE(estoque_maq_entrada_em, NOW())
        WHERE id = $1`,
      [kanbanProgId]
    );
  }

  return {
    skipped: false,
    qtd,
    codigo: codigoProd,
    codigo_produto: idOmie,
    omie_codigo: omieCodigo,
    local: { codigo: COD_ESTOQUE_MAQUINAS, nome: `##MAQ ${COD_ESTOQUE_MAQUINAS} — ${NOME_ESTOQUE_MAQUINAS}` },
  };
}

function colKeyFromPostoKanban(posto) {
  const n = normKanbanStatusLabel(posto);
  if (n === 'montagem hermetica') return 'solicitado';
  if (n === 'montagem eletrica') return 'produzindo';
  if (n === 'teste') return 'teste';
  if (n === 'inspecao final' || n === 'teste ok' || n === 'teste final' || n === 'embalagem') return 'inspecao_final';
  return '';
}

function postoAtualKanbanFromStatuses(statuses) {
  const norms = (statuses || []).map(s => normKanbanStatusLabel(s)).filter(Boolean);
  if (norms.includes('finalizado')) return null;
  if (norms.includes('inspecao final') || norms.includes('teste ok') || norms.includes('teste final') || norms.includes('embalagem')) {
    return 'Inspeção final';
  }
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
    `SELECT t.id,
            t.item_verificado AS check_nome,
            t.o_que_verificar AS descricao_check,
            t.foto_url AS foto,
            NULL::text AS video,
            COALESCE(NULLIF(TRIM(t.local_verificacao), ''), NULL) AS local,
            COALESCE(t.anexos, '[]'::jsonb) AS anexos,
            TRUE AS template_mestre
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
       FROM producao."Kanban_programacao" kp
       LEFT JOIN producao."OP_producao" op ON op.id = $1
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
    `SELECT id FROM producao."OP_producao" WHERE id = $1 LIMIT 1`,
    [opRefId]
  );
  const opProducaoId = opProdRows[0]?.id || null;

  if (kanbanIds.length) {
    const upd = await dbQuery(
      `UPDATE producao."Kanban_programacao"
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
    `INSERT INTO producao."Kanban_programacao"
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
       FROM producao."Kanban_programacao"
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

function tipoArquivoRi(file) {
  const mt = String(file?.mimetype || '').toLowerCase();
  if (mt.startsWith('image/')) return 'foto';
  if (mt.startsWith('video/')) return 'video';
  return 'documento';
}

function coletarArquivosUpload(req) {
  const out = [];
  const files = req.files;
  if (!files) return out;
  if (Array.isArray(files)) return files.filter(Boolean);
  for (const key of Object.keys(files)) {
    for (const f of files[key] || []) {
      if (f) out.push(f);
    }
  }
  return out;
}

async function uploadRiMidia(codigoPasta, tipo, file) {
  if (!file?.buffer?.length) return null;
  const cod = sanitizePathPart(codigoPasta);
  const pasta = tipo === 'video' ? 'videos' : (tipo === 'documento' ? 'docs' : 'fotos');
  const ext = mime.extension(file.mimetype) || (file.originalname || '').split('.').pop() || 'bin';
  const nome = `${uuidv4()}.${String(ext).replace(/[^a-zA-Z0-9]/g, '')}`;
  const pathKey = `RI/${cod}/${pasta}/${nome}`;
  const { url } = await uploadPublicFile('produtos', pathKey, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false,
  });
  return url;
}

/** Cloudflare: produtos/RI/{codigo}/RI_deteccao/{OP}/foto|video|docs/ */
async function uploadRiNiqMidia(codigoPasta, numeroOp, tipo, file) {
  if (!file?.buffer?.length) return null;
  const cod = sanitizePathPart(codigoPasta);
  const op = sanitizePathPart(numeroOp);
  const pasta = tipo === 'video' ? 'video' : (tipo === 'documento' ? 'docs' : 'foto');
  const ext = mime.extension(file.mimetype) || (file.originalname || '').split('.').pop() || 'bin';
  const nome = `${uuidv4()}.${String(ext).replace(/[^a-zA-Z0-9]/g, '')}`;
  const pathKey = `RI/${cod}/RI_deteccao/${op}/${pasta}/${nome}`;
  const { url } = await uploadPublicFile('produtos', pathKey, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false,
  });
  return url;
}

async function uploadRiArquivosLista(codigoPasta, files, opts = {}) {
  const anexos = [];
  let fotoUrl = null;
  let videoUrl = null;
  for (const file of files || []) {
    const tipo = tipoArquivoRi(file);
    const url = opts.niq
      ? await uploadRiNiqMidia(codigoPasta, opts.numeroOp, tipo, file)
      : await uploadRiMidia(codigoPasta, tipo, file);
    if (!url) continue;
    anexos.push({
      url,
      tipo,
      nome: String(file.originalname || '').trim() || url.split('/').pop(),
    });
    if (tipo === 'foto' && !fotoUrl) fotoUrl = url;
    if (tipo === 'video' && !videoUrl) videoUrl = url;
  }
  return { anexos, fotoUrl, videoUrl };
}

/** Extrai path relativo (RI/...) a partir da URL pública do bucket produtos. */
function pathKeyFromRiPublicUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean).map((p) => {
      try { return decodeURIComponent(p); } catch (_) { return p; }
    });
    const idx = parts.findIndex((p) => p === 'produtos');
    if (idx >= 0 && parts[idx + 1] === 'RI') {
      return parts.slice(idx + 1).join('/');
    }
    const idxRi = parts.findIndex((p) => p === 'RI');
    if (idxRi >= 0) return parts.slice(idxRi).join('/');
  } catch (_) { /* ignore */ }
  const m = raw.match(/(?:^|\/)(RI\/[^?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function coletarUrlsAnexosRi(row) {
  const urls = new Set();
  if (row?.foto_url) urls.add(String(row.foto_url).trim());
  let anexos = row?.anexos;
  if (typeof anexos === 'string') {
    try { anexos = JSON.parse(anexos || '[]'); } catch (_) { anexos = []; }
  }
  if (Array.isArray(anexos)) {
    for (const a of anexos) {
      if (a?.url) urls.add(String(a.url).trim());
    }
  }
  return [...urls].filter(Boolean);
}

async function urlAindaReferenciadaNoRi(url, excluirId) {
  const { rows } = await dbQuery(
    `SELECT 1
       FROM qualidade.ri t
      WHERE t.id <> $2
        AND (
          COALESCE(t.foto_url, '') = $1
          OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements(COALESCE(t.anexos, '[]'::jsonb)) a
             WHERE COALESCE(a->>'url', '') = $1
          )
        )
      LIMIT 1`,
    [url, excluirId]
  );
  if (rows.length) return true;
  const { rows: rowsV } = await dbQuery(
    `SELECT 1
       FROM qualidade."RI_Verificacoes" v
      WHERE COALESCE(v.foto, '') = $1
         OR COALESCE(v.video, '') = $1
         OR EXISTS (
           SELECT 1
             FROM jsonb_array_elements(COALESCE(v.anexos, '[]'::jsonb)) a
            WHERE COALESCE(a->>'url', '') = $1
         )
      LIMIT 1`,
    [url]
  );
  return rowsV.length > 0;
}

const NIQ_SELECT = `id, codigo_produto, op_iapp_id, numero_op, falha_detectada, foto, video,
            COALESCE(anexos, '[]'::jsonb) AS anexos,
            usuario, created_at::text AS created_at,
            COALESCE(corrigido, false) AS corrigido,
            corrigido_por,
            corrigido_em::text AS corrigido_em`;

async function listarNiqPorOp(opIappId) {
  const { rows } = await dbQuery(
    `SELECT ${NIQ_SELECT}
       FROM qualidade."RI_NIQ"
      WHERE op_iapp_id = $1
      ORDER BY created_at DESC, id DESC`,
    [opIappId]
  );
  return rows;
}

function dispararNotifOcorrenciaRegistrada(row, codigo) {
  if (!row) return;
  dispararNotificacaoOcorrencia({
    tipo: 'registrada',
    numeroOp: row.numero_op,
    opId: row.op_iapp_id,
    codigo: codigo || '',
    falha: row.falha_detectada,
    usuario: row.usuario,
    dataHora: row.created_at,
  });
}

// POST /api/qualidade/ri-check/status-por-ops — flag RI (checkbox) por OP (montagem)
router.post('/status-por-ops', requireAuth, express.json(), async (req, res) => {
  try {
    await garantirSchemaRi();
    await garantirSchemaKanbanProgramacao();
    const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
    const ids = [...new Set(
      ops.map(o => Number(o.op_producao_id || o.op_id || 0)).filter(n => n > 0)
    )];
    if (!ids.length) {
      return res.json({ ok: true, status_por_op: {}, ri_por_op: {} });
    }

    const { rows } = await dbQuery(
      `SELECT COALESCE(NULLIF(op_producao_id, 0), op_iapp_id) AS op_id,
              BOOL_OR(COALESCE(ri, FALSE)) AS ri
         FROM producao."Kanban_programacao"
        WHERE op_producao_id = ANY($1::bigint[])
           OR op_iapp_id = ANY($1::bigint[])
        GROUP BY COALESCE(NULLIF(op_producao_id, 0), op_iapp_id)`,
      [ids]
    );

    const riPorOp = {};
    const statusPorOp = {};
    for (const row of rows) {
      const key = Number(row.op_id);
      if (key > 0) {
        const riAtivo = !!row.ri;
        riPorOp[String(key)] = riAtivo;
        // Compat: status_por_op true/pendente quando checkbox ativo
        statusPorOp[String(key)] = riAtivo ? 'pendente' : '';
      }
    }
    return res.json({ ok: true, status_por_op: statusPorOp, ri_por_op: riPorOp });
  } catch (err) {
    console.error('[qualidade/ri-check/status-por-ops]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao consultar status RI.' });
  }
});

// POST /api/qualidade/ri-check/ocorrencias-por-ops — ocorrências abertas por OP (kanban)
router.post('/ocorrencias-por-ops', requireAuth, express.json(), async (req, res) => {
  try {
    await garantirSchemaRi();
    const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
    const ids = [...new Set(
      ops.map(o => Number(o.op_producao_id || o.op_id || o.op_iapp_id || 0)).filter(n => n > 0)
    )];
    if (!ids.length) {
      return res.json({ ok: true, por_op: {}, ocorrencias: [] });
    }

    const { rows } = await dbQuery(
      `SELECT ${NIQ_SELECT}
         FROM qualidade."RI_NIQ"
        WHERE op_iapp_id = ANY($1::bigint[])
          AND COALESCE(corrigido, false) = false
        ORDER BY created_at DESC, id DESC`,
      [ids]
    );

    const porOp = {};
    for (const row of rows) {
      const key = Number(row.op_iapp_id);
      if (key > 0) porOp[String(key)] = true;
    }
    return res.json({ ok: true, por_op: porOp, ocorrencias: rows });
  } catch (err) {
    console.error('[qualidade/ri-check/ocorrencias-por-ops]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao consultar ocorrências.' });
  }
});

// GET /api/qualidade/ri-check/ocorrencias — todas as falhas detectadas (mais nova → mais antiga)
router.get('/ocorrencias', requireAuth, async (req, res) => {
  try {
    await garantirSchemaRi();
    const q = String(req.query?.q || '').trim();
    const status = String(req.query?.status || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.query?.limit) || 400, 1), 1000);
    const offset = Math.max(Number(req.query?.offset) || 0, 0);

    const params = [];
    const whereBusca = [];
    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      whereBusca.push(`(
        COALESCE(falha_detectada, '') ILIKE $${i}
        OR COALESCE(numero_op, '') ILIKE $${i}
        OR COALESCE(codigo_produto, '') ILIKE $${i}
        OR COALESCE(usuario, '') ILIKE $${i}
      )`);
    }
    const whereBuscaSql = whereBusca.length ? `WHERE ${whereBusca.join(' AND ')}` : '';

    const whereLista = [...whereBusca];
    if (status === 'aberta') whereLista.push(`COALESCE(corrigido, false) = false`);
    if (status === 'corrigida') whereLista.push(`COALESCE(corrigido, false) = true`);
    const whereListaSql = whereLista.length ? `WHERE ${whereLista.join(' AND ')}` : '';

    const { rows: countRows } = await dbQuery(
      `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE COALESCE(corrigido, false) = false)::int AS aberta,
          COUNT(*) FILTER (WHERE COALESCE(corrigido, false) = true)::int AS corrigida
         FROM qualidade."RI_NIQ"
        ${whereBuscaSql}`,
      params
    );

    const listParams = params.slice();
    listParams.push(limit, offset);
    const { rows } = await dbQuery(
      `SELECT ${NIQ_SELECT}
         FROM qualidade."RI_NIQ"
        ${whereListaSql}
        ORDER BY created_at DESC, id DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const contagens = countRows[0] || { total: 0, aberta: 0, corrigida: 0 };
    return res.json({ ok: true, ocorrencias: rows, contagens, limit, offset });
  } catch (err) {
    console.error('[qualidade/ri-check/ocorrencias GET]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao listar ocorrências.' });
  }
});

// GET /api/qualidade/ri-check/pendentes — OPs com checkbox RI ativo em Kanban_programacao
router.get('/pendentes', requireAuth, async (_req, res) => {
  try {
    await garantirSchemaRi();
    await garantirSchemaKanbanProgramacao();

    const [kpResult, riResult] = await Promise.all([
      dbQuery(
        `SELECT id, op_producao_id, op_iapp_id, numero_op, status, codigo, observacao, postos, COALESCE(ri, FALSE) AS ri
           FROM producao."Kanban_programacao"
          WHERE COALESCE(ri, FALSE) = TRUE
            AND COALESCE(NULLIF(TRIM(status), ''), '') <> ''
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
         FROM producao."OP_producao" op
         LEFT JOIN produto.produtos_omie po ON po.codigo_produto = op.codigo_produto
        WHERE op.id = ANY($1::bigint[])`,
      [opIds]
    );
    const opMap = new Map(opRows.map(r => [Number(r.id), r]));

    const pendentes = [];
    for (const [opId, regs] of kpByOp) {
      const postoAtual = postoAtualKanbanFromStatuses(regs.map(r => r.status));
      if (!postoAtual) continue;

      const op = opMap.get(Number(opId));
      if (!op) continue;

      const colKey = colKeyFromPostoKanban(postoAtual);
      if (!colKey) continue;

      const riStatus = riByOp.get(opId) || '';
      pendentes.push({
        op_producao_id: opId,
        numero_op: op.n_op,
        posto: postoAtual,
        col_key: colKey,
        ri: true,
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
      `SELECT id, n_op, codigo_produto, codigo FROM producao."OP_producao" WHERE id = $1 LIMIT 1`,
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
          `SELECT descricao FROM produto.produtos_omie WHERE codigo_produto = $1 LIMIT 1`,
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

    let riAtivo = false;
    if (kanbanProgId) {
      const { rows: riRows } = await dbQuery(
        `SELECT COALESCE(ri, FALSE) AS ri FROM producao."Kanban_programacao" WHERE id = $1`,
        [kanbanProgId]
      );
      riAtivo = !!riRows[0]?.ri;
    } else {
      const { rows: riRows } = await dbQuery(
        `SELECT BOOL_OR(COALESCE(ri, FALSE)) AS ri
           FROM producao."Kanban_programacao"
          WHERE op_producao_id = $1 OR op_iapp_id = $1`,
        [opRefId]
      );
      riAtivo = !!riRows[0]?.ri;
    }

    if (checkExistente) {
      const dados = await carregarCheckCompleto(checkExistente.id, kanbanLocal || null, { incluirNiq: true });
      return res.json({
        ok: true,
        kanban_local: kanbanLocal || null,
        template_apenas: false,
        ja_registrado: !riAtivo,
        ri_ativo: riAtivo,
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
      ja_registrado: !riAtivo,
      ri_ativo: riAtivo,
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
    const codigoProdutoBody = Number(req.body?.codigo_produto) || null;

    const [opProdResult, kanbanProgIdFromBody] = await Promise.all([
      dbQuery(
        `SELECT id, n_op, codigo_produto, codigo FROM producao."OP_producao" WHERE id = $1 LIMIT 1`,
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
          `SELECT descricao FROM produto.produtos_omie WHERE codigo_produto = $1 LIMIT 1`,
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
          WHERE ${opWhere} AND status IN ('Inspeção final', 'Teste OK', 'Teste final')
          ORDER BY id DESC LIMIT 1`,
        [opRefId]
      );
    } else {
      existente = await dbQuery(
        `SELECT id FROM qualidade."RI_Check"
          WHERE ${opWhere}
            AND COALESCE(status, '') NOT IN (
              'Montagem eletrica', 'Liberado', 'Teste', 'Inspeção final', 'Teste OK', 'Teste final', 'Embalagem', 'Finalizado'
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
                updated_at = NOW()
          WHERE id = $1`,
        [checkId, codigoProdutoGravar, codigoGravar, descricaoGravar, kanbanProgId, opProducaoId]
      );
      dispararNotificacaoRiCheck(checkId);
    } else {
      const ins = await dbQuery(
        `INSERT INTO qualidade."RI_Check"
           (id_kanban_programacao, codigo_produto, codigo, descricao, op_iapp_id, op_producao_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'Em andamento')
         RETURNING id`,
        [kanbanProgId, codigoProdutoGravar, codigoGravar, descricaoGravar, opRefId, opProducaoId]
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

// GET /api/qualidade/ri-check/template-verificacao/produtos — máquinas com verificações (agrupado)
// Query opcional: q, local (posto/linha: Montagem hermetica, Teste, …)
router.get('/template-verificacao/produtos', requireAuth, async (req, res) => {
  try {
    await garantirSchemaRi();
    const q = String(req.query?.q || '').trim();
    const localFiltro = String(req.query?.local || req.query?.local_verificacao || '').trim();
    const limit = Math.min(Math.max(Number(req.query?.limit) || 300, 1), 500);
    const params = [];
    const whereParts = [];
    if (q) {
      params.push(`%${q}%`);
      whereParts.push(`(
        COALESCE(t.codigo, '') ILIKE $${params.length}
        OR CAST(t.id_omie AS TEXT) ILIKE $${params.length}
        OR COALESCE(t.item_verificado, '') ILIKE $${params.length}
      )`);
    }
    if (localFiltro) {
      params.push(localFiltro);
      whereParts.push(`TRIM(COALESCE(t.local_verificacao, '')) = $${params.length}`);
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await dbQuery(
      `SELECT g.id_omie,
              g.codigo,
              g.qtd_verificacoes,
              COALESCE(NULLIF(TRIM(po.descricao), ''), '') AS descricao,
              NULLIF(TRIM(img.url_imagem), '') AS foto_url
         FROM (
           SELECT t.id_omie,
                  COALESCE(NULLIF(TRIM(MAX(t.codigo)), ''), CAST(t.id_omie AS TEXT)) AS codigo,
                  COUNT(*)::int AS qtd_verificacoes
             FROM qualidade.ri t
             ${where}
            GROUP BY t.id_omie
            ORDER BY COALESCE(NULLIF(TRIM(MAX(t.codigo)), ''), CAST(t.id_omie AS TEXT)) ASC
            LIMIT $${params.length}
         ) g
         LEFT JOIN produto.produtos_omie po
           ON po.codigo_produto = g.id_omie
         LEFT JOIN LATERAL (
           SELECT i.url_imagem
             FROM produto.produtos_omie_imagens i
            WHERE COALESCE(i.ativo, TRUE) = TRUE
              AND NULLIF(TRIM(i.url_imagem), '') IS NOT NULL
              AND (
                i.codigo_produto = g.id_omie
                OR (
                  NULLIF(TRIM(g.codigo), '') IS NOT NULL
                  AND i.url_imagem ILIKE '%' || TRIM(g.codigo) || '%'
                )
              )
            ORDER BY
              CASE WHEN i.codigo_produto = g.id_omie THEN 0 ELSE 1 END,
              i.pos NULLS LAST,
              i.id DESC
            LIMIT 1
         ) img ON TRUE
        ORDER BY g.codigo ASC`,
      params
    );
    return res.json({ ok: true, items: rows, total: rows.length });
  } catch (err) {
    console.error('[qualidade/ri-check/template-verificacao/produtos GET]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao listar produtos.' });
  }
});

// GET /api/qualidade/ri-check/template-verificacao — lista cadastros mestre (para copiar)
// Query opcional: q, id_omie, codigo, local (posto/linha)
router.get('/template-verificacao', requireAuth, async (req, res) => {
  try {
    await garantirSchemaRi();
    const q = String(req.query?.q || '').trim();
    const idOmieFiltro = Number(req.query?.id_omie || req.query?.codigo_produto) || 0;
    const codigoFiltro = String(req.query?.codigo || '').trim();
    const localFiltro = String(req.query?.local || req.query?.local_verificacao || '').trim();
    const limit = Math.min(Math.max(Number(req.query?.limit) || 300, 1), 500);
    const params = [];
    const whereParts = [];
    if (idOmieFiltro) {
      params.push(idOmieFiltro);
      whereParts.push(`t.id_omie = $${params.length}`);
    }
    if (codigoFiltro) {
      params.push(codigoFiltro);
      whereParts.push(`COALESCE(NULLIF(TRIM(t.codigo), ''), CAST(t.id_omie AS TEXT)) = $${params.length}`);
    }
    if (localFiltro) {
      params.push(localFiltro);
      whereParts.push(`TRIM(COALESCE(t.local_verificacao, '')) = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      whereParts.push(`(
        COALESCE(t.codigo, '') ILIKE $${params.length}
        OR COALESCE(t.item_verificado, '') ILIKE $${params.length}
        OR COALESCE(t.o_que_verificar, '') ILIKE $${params.length}
        OR COALESCE(t.local_verificacao, '') ILIKE $${params.length}
        OR CAST(t.id_omie AS TEXT) ILIKE $${params.length}
      )`);
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await dbQuery(
      `SELECT t.id,
              t.id_omie,
              COALESCE(NULLIF(TRIM(t.codigo), ''), CAST(t.id_omie AS TEXT)) AS codigo,
              t.item_verificado AS check_nome,
              t.o_que_verificar AS descricao_check,
              COALESCE(NULLIF(TRIM(t.local_verificacao), ''), '') AS local,
              t.foto_url,
              COALESCE(t.anexos, '[]'::jsonb) AS anexos
         FROM qualidade.ri t
         ${where}
        ORDER BY COALESCE(NULLIF(TRIM(t.codigo), ''), CAST(t.id_omie AS TEXT)) ASC,
                 t.item_verificado ASC NULLS LAST,
                 t.id ASC
        LIMIT $${params.length}`,
      params
    );
    const items = rows.map((r) => {
      let anexos = Array.isArray(r.anexos) ? r.anexos : [];
      if (!Array.isArray(anexos)) anexos = [];
      anexos = anexos.filter((a) => a && a.url);
      if (!anexos.length && r.foto_url) {
        anexos = [{ url: r.foto_url, tipo: 'foto', nome: 'Foto' }];
      }
      return {
        id: r.id,
        id_omie: r.id_omie,
        codigo: r.codigo,
        check_nome: r.check_nome,
        descricao_check: r.descricao_check,
        local: r.local,
        foto_url: r.foto_url || null,
        anexos,
      };
    });
    return res.json({ ok: true, items, total: items.length });
  } catch (err) {
    console.error('[qualidade/ri-check/template-verificacao GET]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao listar verificações.' });
  }
});

// POST /api/qualidade/ri-check/template-verificacao — cadastro mestre (qualidade.ri) com vários arquivos
router.post('/template-verificacao', requireAuth, upload.fields([
  { name: 'arquivos', maxCount: 20 },
  { name: 'foto', maxCount: 10 },
  { name: 'video', maxCount: 10 },
]), async (req, res) => {
  try {
    await garantirSchemaRi();
    const idOmie = Number(req.body?.id_omie || req.body?.codigo_produto) || 0;
    const codigo = String(req.body?.codigo || '').trim();
    const checkNome = String(req.body?.check || req.body?.check_nome || req.body?.item_verificado || '').trim();
    const descricaoCheck = String(req.body?.descricao_check || req.body?.o_que_verificar || req.body?.descricao || '').trim();
    const local = String(req.body?.local || req.body?.local_verificacao || '').trim();
    if (!idOmie) return res.status(400).json({ ok: false, error: 'id_omie do produto é obrigatório.' });
    if (!checkNome) return res.status(400).json({ ok: false, error: 'Informe o nome do check.' });
    if (!descricaoCheck) return res.status(400).json({ ok: false, error: 'Informe a descrição do check.' });
    if (!local) return res.status(400).json({ ok: false, error: 'Informe o local (kanban).' });

    let anexosCopiar = [];
    try {
      const raw = req.body?.anexos_copiar || req.body?.anexos_manter;
      anexosCopiar = typeof raw === 'string' ? JSON.parse(raw || '[]') : (Array.isArray(raw) ? raw : []);
    } catch (_) { anexosCopiar = []; }
    if (!Array.isArray(anexosCopiar)) anexosCopiar = [];
    anexosCopiar = anexosCopiar
      .filter((a) => a && a.url)
      .map((a) => ({
        url: String(a.url),
        tipo: String(a.tipo || '').trim() || 'documento',
        nome: String(a.nome || '').trim() || String(a.url).split('/').pop() || 'Arquivo',
      }));

    const codigoPasta = codigo || String(idOmie);
    const files = coletarArquivosUpload(req);
    const { anexos: anexosNovos, fotoUrl: fotoNova } = await uploadRiArquivosLista(codigoPasta, files);
    const anexos = [...anexosCopiar, ...anexosNovos];
    const fotoUrl = fotoNova
      || anexos.find((a) => a.tipo === 'foto')?.url
      || null;

    const ins = await dbQuery(
      `INSERT INTO qualidade.ri
         (id_omie, codigo, item_verificado, o_que_verificar, local_verificacao, prioridade, foto_url, anexos)
       VALUES ($1, $2, $3, $4, $5, 'Primario', $6, $7::jsonb)
       RETURNING *`,
      [idOmie, codigoPasta, checkNome, descricaoCheck, local, fotoUrl, JSON.stringify(anexos)]
    );

    return res.status(201).json({ ok: true, item: ins.rows[0], anexos });
  } catch (err) {
    console.error('[qualidade/ri-check/template-verificacao]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao cadastrar verificação.' });
  }
});

// PUT /api/qualidade/ri-check/template-verificacao/:id — editar cadastro mestre + anexos
router.put('/template-verificacao/:id', requireAuth, upload.fields([
  { name: 'arquivos', maxCount: 20 },
  { name: 'foto', maxCount: 10 },
  { name: 'video', maxCount: 10 },
]), async (req, res) => {
  try {
    await garantirSchemaRi();
    const itemId = Number(req.params.id) || 0;
    if (!itemId) return res.status(400).json({ ok: false, error: 'ID inválido.' });

    const { rows: atuais } = await dbQuery(
      `SELECT * FROM qualidade.ri WHERE id = $1 LIMIT 1`,
      [itemId]
    );
    if (!atuais.length) return res.status(404).json({ ok: false, error: 'Verificação não encontrada.' });
    const atual = atuais[0];

    const checkNome = String(req.body?.check || req.body?.check_nome || req.body?.item_verificado || '').trim();
    const descricaoCheck = String(req.body?.descricao_check || req.body?.o_que_verificar || req.body?.descricao || '').trim();
    const local = String(req.body?.local || req.body?.local_verificacao || '').trim();
    if (!checkNome) return res.status(400).json({ ok: false, error: 'Informe o nome do check.' });
    if (!descricaoCheck) return res.status(400).json({ ok: false, error: 'Informe a descrição do check.' });
    if (!local) return res.status(400).json({ ok: false, error: 'Informe o local (kanban).' });

    let anexosManter = [];
    try {
      const raw = req.body?.anexos_manter;
      anexosManter = typeof raw === 'string' ? JSON.parse(raw || '[]') : (Array.isArray(raw) ? raw : []);
    } catch (_) { anexosManter = []; }
    if (!Array.isArray(anexosManter)) anexosManter = [];
    anexosManter = anexosManter.filter(a => a && a.url);

    const codigoPasta = String(atual.codigo || atual.id_omie || 'sem_codigo');
    const files = coletarArquivosUpload(req);
    const { anexos: novos, fotoUrl: fotoNova } = await uploadRiArquivosLista(codigoPasta, files);
    const anexosFinais = [...anexosManter, ...novos];
    const fotoUrl = fotoNova
      || anexosFinais.find(a => a.tipo === 'foto')?.url
      || null;

    const upd = await dbQuery(
      `UPDATE qualidade.ri
          SET item_verificado = $1,
              o_que_verificar = $2,
              local_verificacao = $3,
              foto_url = $4,
              anexos = $5::jsonb,
              atualizado_em = NOW()
        WHERE id = $6
        RETURNING *`,
      [checkNome, descricaoCheck, local, fotoUrl, JSON.stringify(anexosFinais), itemId]
    );

    return res.json({ ok: true, item: upd.rows[0], anexos: anexosFinais });
  } catch (err) {
    console.error('[qualidade/ri-check/template-verificacao PUT]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao editar verificação.' });
  }
});

// DELETE /api/qualidade/ri-check/template-verificacao/:id — exclui cadastro mestre + arquivos órfãos
router.delete('/template-verificacao/:id', requireAuth, async (req, res) => {
  try {
    await garantirSchemaRi();
    const itemId = Number(req.params.id) || 0;
    if (!itemId) return res.status(400).json({ ok: false, error: 'ID inválido.' });

    const { rows: atuais } = await dbQuery(
      `SELECT * FROM qualidade.ri WHERE id = $1 LIMIT 1`,
      [itemId]
    );
    if (!atuais.length) return res.status(404).json({ ok: false, error: 'Verificação não encontrada.' });
    const atual = atuais[0];
    const urls = coletarUrlsAnexosRi(atual);

    const del = await dbQuery(
      `DELETE FROM qualidade.ri WHERE id = $1 RETURNING id, codigo, id_omie, item_verificado`,
      [itemId]
    );
    if (!del.rows.length) {
      return res.status(404).json({ ok: false, error: 'Verificação não encontrada.' });
    }

    const removidosStorage = [];
    const mantidosStorage = [];
    for (const url of urls) {
      try {
        const aindaUsada = await urlAindaReferenciadaNoRi(url, itemId);
        if (aindaUsada) {
          mantidosStorage.push(url);
          continue;
        }
        const pathKey = pathKeyFromRiPublicUrl(url);
        if (!pathKey) {
          mantidosStorage.push(url);
          continue;
        }
        await removePublicFiles('produtos', [pathKey]);
        removidosStorage.push(pathKey);
      } catch (storageErr) {
        console.warn('[qualidade/ri-check/template-verificacao DELETE] storage:', storageErr.message || storageErr);
        mantidosStorage.push(url);
      }
    }

    return res.json({
      ok: true,
      item: del.rows[0],
      arquivos_removidos: removidosStorage.length,
      arquivos_mantidos_compartilhados: mantidosStorage.length,
    });
  } catch (err) {
    console.error('[qualidade/ri-check/template-verificacao DELETE]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao excluir verificação.' });
  }
});

// PUT /api/qualidade/ri-check/verificacoes/:id — editar verificação da inspeção
router.put('/verificacoes/:id', requireAuth, upload.fields([
  { name: 'arquivos', maxCount: 20 },
  { name: 'foto', maxCount: 10 },
  { name: 'video', maxCount: 10 },
]), async (req, res) => {
  try {
    await garantirSchemaRi();
    const verifId = Number(req.params.id) || 0;
    if (!verifId) return res.status(400).json({ ok: false, error: 'ID inválido.' });

    const { rows: atuais } = await dbQuery(
      `SELECT * FROM qualidade."RI_Verificacoes" WHERE id = $1 LIMIT 1`,
      [verifId]
    );
    if (!atuais.length) return res.status(404).json({ ok: false, error: 'Verificação não encontrada.' });
    const atual = atuais[0];

    const checkNome = String(req.body?.check || req.body?.check_nome || '').trim();
    const descricaoCheck = String(req.body?.descricao_check || req.body?.descricao || '').trim();
    const local = String(req.body?.local || '').trim();
    if (!checkNome) return res.status(400).json({ ok: false, error: 'Informe o nome do check.' });
    if (!local) return res.status(400).json({ ok: false, error: 'Informe o local (kanban).' });

    let anexosManter = [];
    try {
      const raw = req.body?.anexos_manter;
      anexosManter = typeof raw === 'string' ? JSON.parse(raw || '[]') : (Array.isArray(raw) ? raw : []);
    } catch (_) { anexosManter = []; }
    if (!Array.isArray(anexosManter)) anexosManter = [];
    anexosManter = anexosManter.filter(a => a && a.url);

    const dadosCheck = await carregarCheckCompleto(atual.ri_check_id);
    const camposProd = await resolverCamposProdutoOmie({
      codigoTexto: dadosCheck?.check?.codigo,
      codigoProdutoHint: atual.codigo_produto || dadosCheck?.check?.codigo_produto,
      opIappId: dadosCheck?.check?.op_iapp_id,
      kanbanProgId: dadosCheck?.check?.id_kanban_programacao,
    });
    const codigoPasta = camposProd.codigoTexto || dadosCheck?.check?.codigo || String(camposProd.idOmie || 'sem_codigo');

    const files = coletarArquivosUpload(req);
    const { anexos: novos, fotoUrl: fotoNova, videoUrl: videoNovo } = await uploadRiArquivosLista(codigoPasta, files);
    const anexosFinais = [...anexosManter, ...novos];
    const fotoUrl = fotoNova || anexosFinais.find(a => a.tipo === 'foto')?.url || null;
    const videoUrl = videoNovo || anexosFinais.find(a => a.tipo === 'video')?.url || null;

    const upd = await dbQuery(
      `UPDATE qualidade."RI_Verificacoes"
          SET check_nome = $1,
              descricao_check = $2,
              local = $3,
              foto = $4,
              video = $5,
              anexos = $6::jsonb
        WHERE id = $7
        RETURNING *`,
      [checkNome, descricaoCheck || null, local, fotoUrl, videoUrl, JSON.stringify(anexosFinais), verifId]
    );

    if (atual.ri_check_id) {
      await dbQuery(`UPDATE qualidade."RI_Check" SET updated_at = NOW() WHERE id = $1`, [atual.ri_check_id]);
      dispararNotificacaoRiCheck(atual.ri_check_id);
    }

    return res.json({ ok: true, verificacao: upd.rows[0], anexos: anexosFinais });
  } catch (err) {
    console.error('[qualidade/ri-check/verificacoes PUT]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao editar verificação.' });
  }
});

// POST /api/qualidade/ri-check/niq — ocorrência por OP (sem exigir RI_Check gravado)
router.post('/niq', requireAuth, upload.fields([
  { name: 'arquivos', maxCount: 20 },
  { name: 'foto', maxCount: 10 },
  { name: 'video', maxCount: 10 },
]), async (req, res) => {
  try {
    await garantirSchemaRi();
    const opRefId = Number(req.body?.op_producao_id) || Number(req.body?.op_iapp_id) || 0;
    if (!opRefId) return res.status(400).json({ ok: false, error: 'op_producao_id é obrigatório.' });

    const falhaDetectada = String(req.body?.falha_detectada || '').trim();
    if (!falhaDetectada) {
      return res.status(400).json({ ok: false, error: 'Informe a falha detectada.' });
    }

    const codigo = String(req.body?.codigo || '').trim();
    const codigoProdutoBody = Number(req.body?.codigo_produto) || null;
    const camposProd = await resolverCamposProdutoOmie({
      codigoTexto: codigo,
      codigoProdutoHint: codigoProdutoBody,
      opIappId: opRefId,
    });
    const codigoProdutoGravar = codigoProdutoOmieParaGravar(camposProd.idOmie);
    const codigoPasta = camposProd.codigoTexto || codigo || String(camposProd.idOmie || 'sem_codigo');
    const opDados = await buscarDadosOpKanban(opRefId);
    const numeroOp = String(req.body?.numero_op || opDados?.numero_op || opRefId).trim();
    const usuario = getUsuario(req);

    const files = coletarArquivosUpload(req);
    const { anexos, fotoUrl, videoUrl } = await uploadRiArquivosLista(codigoPasta, files, {
      niq: true,
      numeroOp,
    });

    const ins = await dbQuery(
      `INSERT INTO qualidade."RI_NIQ"
         (codigo_produto, op_iapp_id, numero_op, falha_detectada, foto, video, anexos, usuario)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING ${NIQ_SELECT}`,
      [codigoProdutoGravar, opRefId, numeroOp, falhaDetectada, fotoUrl, videoUrl, JSON.stringify(anexos), usuario]
    );

    dispararNotifOcorrenciaRegistrada(ins.rows[0], codigo);

    return res.json({ ok: true, ocorrencia: ins.rows[0] });
  } catch (err) {
    console.error('[qualidade/ri-check/niq POST por OP]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao registrar ocorrência.' });
  }
});

// PATCH /api/qualidade/ri-check/niq/:id/corrigir — marca ocorrência como corrigida
router.patch('/niq/:id/corrigir', requireAuth, express.json(), async (req, res) => {
  try {
    await garantirSchemaRi();
    const id = Number(req.params.id) || 0;
    if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });

    const usuario = getUsuario(req);
    const { rows } = await dbQuery(
      `UPDATE qualidade."RI_NIQ"
          SET corrigido = true,
              corrigido_por = $2,
              corrigido_em = NOW()
        WHERE id = $1
          AND COALESCE(corrigido, false) = false
      RETURNING ${NIQ_SELECT}`,
      [id, usuario]
    );

    if (!rows.length) {
      const { rows: existing } = await dbQuery(
        `SELECT ${NIQ_SELECT} FROM qualidade."RI_NIQ" WHERE id = $1`,
        [id]
      );
      if (!existing.length) {
        return res.status(404).json({ ok: false, error: 'Ocorrência não encontrada.' });
      }
      return res.json({ ok: true, ocorrencia: existing[0], ja_corrigida: true });
    }

    const oc = rows[0];
    dispararNotificacaoOcorrencia({
      tipo: 'corrigida',
      numeroOp: oc.numero_op,
      opId: oc.op_iapp_id,
      falha: oc.falha_detectada,
      usuario: oc.corrigido_por || usuario,
      dataHora: oc.corrigido_em,
    });

    return res.json({ ok: true, ocorrencia: oc });
  } catch (err) {
    console.error('[qualidade/ri-check/niq PATCH corrigir]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao corrigir ocorrência.' });
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
  { name: 'arquivos', maxCount: 20 },
  { name: 'foto', maxCount: 10 },
  { name: 'video', maxCount: 10 },
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

    const files = coletarArquivosUpload(req);
    const { anexos, fotoUrl, videoUrl } = await uploadRiArquivosLista(codigoPasta, files);

    const ins = await dbQuery(
      `INSERT INTO qualidade."RI_Verificacoes"
         (ri_check_id, codigo_produto, check_nome, descricao_check, foto, video, local, anexos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING *`,
      [checkId, codigoProdutoGravar, checkNome, descricaoCheck || null, fotoUrl, videoUrl, local, JSON.stringify(anexos)]
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

// POST /api/qualidade/ri-check/:id/niq — registrar falha detectada (vários arquivos)
router.post('/:id/niq', requireAuth, upload.fields([
  { name: 'arquivos', maxCount: 20 },
  { name: 'foto', maxCount: 10 },
  { name: 'video', maxCount: 10 },
]), async (req, res) => {
  try {
    await garantirSchemaRi();
    const checkId = Number(req.params.id) || 0;
    const dados = await carregarCheckCompleto(checkId);
    if (!dados) return res.status(404).json({ ok: false, error: 'RI não encontrado.' });

    const check = dados.check;
    const opIappId = Number(check.op_iapp_id) || Number(check.op_producao_id) || 0;
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

    const files = coletarArquivosUpload(req);
    const { anexos, fotoUrl, videoUrl } = await uploadRiArquivosLista(codigoPasta, files, {
      niq: true,
      numeroOp,
    });

    const ins = await dbQuery(
      `INSERT INTO qualidade."RI_NIQ"
         (codigo_produto, op_iapp_id, numero_op, falha_detectada, foto, video, anexos, usuario)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING ${NIQ_SELECT}`,
      [codigoProdutoGravar, opIappId, numeroOp, falhaDetectada, fotoUrl, videoUrl, JSON.stringify(anexos), usuario]
    );

    await dbQuery(`UPDATE qualidade."RI_Check" SET updated_at = NOW() WHERE id = $1`, [checkId]);
    dispararNotificacaoRiCheck(checkId);
    dispararNotifOcorrenciaRegistrada(ins.rows[0], check.codigo);

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
    const avancarTeste = req.body?.avancar_teste === true;
    const localFiltro = String(req.body?.kanban_local || '').trim() || null;

    const dadosAtual = await carregarCheckCompleto(checkId);
    if (!dadosAtual) return res.status(404).json({ ok: false, error: 'RI não encontrado.' });

    const { rowCount } = await dbQuery(
      `UPDATE qualidade."RI_Check"
          SET updated_at = NOW()
        WHERE id = $1`,
      [checkId]
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
// Registra RI: grava status = nome do kanban/posto atual e desativa checkbox RI no Kanban_programacao.
// Body opcional: { kanban_origem: 'Montagem hermetica' | ... }
router.post('/:id/liberar', requireAuth, express.json(), async (req, res) => {
  try {
    await garantirSchemaRi();
    await garantirSchemaKanbanProgramacao();
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

    const kanbanProgId = Number(check.id_kanban_programacao) || null;
    const avancarParaEstoqueMaq = deveEntrarEstoqueMaquinas(statusRi);
    const proximoPosto = avancarParaEstoqueMaq ? '' : proximoPostoAposRi(statusRi);
    let estoqueMaq = null;
    if (avancarParaEstoqueMaq) {
      try {
        estoqueMaq = await incluirEntradaEstoqueMaquinasOmie({
          opRefId,
          numeroOp,
          usuario,
          check,
          kanbanProgId,
        });
      } catch (omieErr) {
        console.error('[qualidade/ri-check/liberar] entrada estoque MAQ:', omieErr.message);
        return res.status(omieErr.status || 502).json({
          ok: false,
          error: omieErr.message || 'Falha ao lançar o produto no armazém 4. ESTOQUE MAQUINAS.',
        });
      }
    }

    await dbQuery(
      `UPDATE qualidade."RI_Check"
          SET status = $2, updated_at = NOW()
        WHERE id = $1`,
      [checkId, statusRi]
    );
    dispararNotificacaoRiCheck(checkId);

    await dbQuery(
      `UPDATE producao."Kanban_programacao"
          SET ri = FALSE,
              status = CASE
                WHEN $4::boolean THEN 'Finalizado'
                WHEN $5::text <> '' THEN $5
                ELSE status
              END,
              estoque_maq_entrada_em = CASE
                WHEN $4::boolean THEN COALESCE(estoque_maq_entrada_em, NOW())
                ELSE estoque_maq_entrada_em
              END
        WHERE ($1::bigint IS NOT NULL AND id = $1)
           OR op_producao_id = $2
           OR op_iapp_id = $2
           OR ($3 <> '' AND UPPER(TRIM(COALESCE(numero_op, ''))) = UPPER(TRIM($3)))`,
      [kanbanProgId, opRefId, numeroOp || '', avancarParaEstoqueMaq, proximoPosto || '']
    );

    const opProdId = Number(check.op_producao_id) || Number(check.op_iapp_id) || opRefId;
    try {
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

    if (proximoPosto) {
      try {
        await iniciarCicloPosto({
          kanbanProgramacaoId: kanbanProgId,
          opProducaoId: opProdId,
          numeroOp: numeroOp || '',
          postoOrigem: proximoPosto,
          operacao: `Entrada em ${proximoPosto}`,
          usuario,
          skipNotificacao: true,
        });
      } catch (tempoErr) {
        console.error('[tempo_producao] Falha ao iniciar ciclo no próximo posto após RI:', tempoErr.message);
      }
    }

    const localFiltro = kanbanOrigem || statusRi || null;
    const atualizado = await carregarCheckCompleto(checkId, localFiltro);
    const opProducaoId = Number(check.op_producao_id) || 0;
    const kanbanStatusFinal = avancarParaEstoqueMaq ? 'Finalizado' : (proximoPosto || statusRi);
    return res.json({
      ok: true,
      ...atualizado,
      kanban_status: kanbanStatusFinal,
      ri_ativo: false,
      somente_ri: true,
      numero_op: numeroOp || null,
      op_producao_id: opProducaoId || opRefId,
      estoque_maq: estoqueMaq,
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
          'Teste', 'Inspeção final', 'Teste OK', 'Teste final', 'Embalagem', 'Finalizado'
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
      ]
    );
    dispararNotificacaoRiCheck(emAndamento[0].id);
    return { id: emAndamento[0].id, updated: true };
  }

  // Nasce 'Em andamento': o botão "Registrar RI" do modal é quem grava o posto.
  const ins = await dbQuery(
    `INSERT INTO qualidade."RI_Check"
       (id_kanban_programacao, codigo_produto, codigo, descricao, op_iapp_id, op_producao_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'Em andamento')
     RETURNING id`,
    [
      kanbanProgId,
      codigoProdutoGravar,
      codigo || null,
      descricao || null,
      opIappIdGravar,
      opProducaoIdGravar,
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
