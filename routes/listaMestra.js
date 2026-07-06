// routes/listaMestra.js — CRUD da Lista Mestra (schema qualidade) + arquivos R2
const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const multer = require('multer');
const mime = require('mime-types');
const router = express.Router();
const { dbQuery } = require('../src/db');
const { uploadPublicFile } = require('../utils/storage');

const LISTA_MESTRA_BUCKET = process.env.QUALIDADE_LISTA_MESTRA_BUCKET || 'Manuais';
const LISTA_MESTRA_PREFIX = process.env.QUALIDADE_LISTA_MESTRA_PREFIX || 'documentos internos';
const SETOR_QUALIDADE_ID = 2;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

let schemaReady = false;

async function ensureListaMestraSchema() {
  if (schemaReady) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS qualidade`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade.lista_mestra (
      id SERIAL PRIMARY KEY,
      numero_formulario TEXT NOT NULL,
      descricao TEXT,
      tipo_documento TEXT,
      formato TEXT,
      classificacao TEXT,
      autor TEXT,
      numero_revisao TEXT,
      data_criacao TEXT,
      revisado TEXT,
      revisado_por TEXT,
      proxima_revisao TEXT,
      responsavel_arquivar_eliminar TEXT,
      tempo_retencao TEXT,
      status TEXT,
      data_arquivamento TEXT,
      documento TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`ALTER TABLE qualidade.lista_mestra ADD COLUMN IF NOT EXISTS documento TEXT`);
  await dbQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_qualidade_lista_mestra_numero
      ON qualidade.lista_mestra (numero_formulario)
  `);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade.lista_mestra_historico (
      id SERIAL PRIMARY KEY,
      lista_mestra_id INTEGER NOT NULL REFERENCES qualidade.lista_mestra(id) ON DELETE CASCADE,
      numero_revisao TEXT NOT NULL,
      documento TEXT NOT NULL,
      documento_path TEXT,
      descricao_alteracao TEXT,
      inserido_por TEXT NOT NULL,
      inserido_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_lista_mestra_historico_doc
      ON qualidade.lista_mestra_historico (lista_mestra_id, inserido_em DESC)
  `);
  schemaReady = true;
}

const COLS = `
  id, numero_formulario, descricao, tipo_documento, formato, classificacao,
  autor, numero_revisao, data_criacao, revisado, revisado_por, proxima_revisao,
  responsavel_arquivar_eliminar, tempo_retencao, status, data_arquivamento,
  documento, criado_em, atualizado_em
`;

function mapRow(row) {
  return {
    id: row.id,
    numero_formulario: row.numero_formulario || '',
    descricao: row.descricao || '',
    tipo_documento: row.tipo_documento || '',
    formato: row.formato || '',
    classificacao: row.classificacao || '',
    autor: row.autor || '',
    numero_revisao: row.numero_revisao || '',
    data_criacao: row.data_criacao || '',
    revisado: row.revisado || '',
    revisado_por: row.revisado_por || '',
    proxima_revisao: row.proxima_revisao || '',
    responsavel_arquivar_eliminar: row.responsavel_arquivar_eliminar || '',
    tempo_retencao: row.tempo_retencao || '',
    status: row.status || '',
    data_arquivamento: row.data_arquivamento || '',
    documento: row.documento || '',
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em
  };
}

function mapHistorico(row) {
  return {
    id: row.id,
    lista_mestra_id: row.lista_mestra_id,
    numero_revisao: row.numero_revisao || '',
    documento: row.documento || '',
    documento_path: row.documento_path || '',
    descricao_alteracao: row.descricao_alteracao || '',
    inserido_por: row.inserido_por || '',
    inserido_em: row.inserido_em
  };
}

function usuarioLogado(req) {
  return req.session?.user?.fullName
    || req.session?.user?.username
    || req.session?.user?.login
    || 'sistema';
}

async function obterSectorIdUsuario(req) {
  if (req.session?.user?.sector_id != null && req.session.user.sector_id !== '') {
    return Number(req.session.user.sector_id);
  }
  const userId = req.session?.user?.id;
  if (!userId) return null;
  const result = await dbQuery(
    `SELECT sector_id FROM public.auth_user_profile WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  const sectorId = result.rows[0]?.sector_id;
  return sectorId != null ? Number(sectorId) : null;
}

async function usuarioEhSetorQualidade(req) {
  return (await obterSectorIdUsuario(req)) === SETOR_QUALIDADE_ID;
}

function sanitizarNumeroFormulario(valor) {
  return String(valor || '').trim().replace(/[\\/]+/g, '-');
}

function formatarRevisao(valor) {
  const digits = String(valor || '0').replace(/\D/g, '');
  const n = Number.parseInt(digits || '0', 10);
  return String(Number.isFinite(n) ? n : 0).padStart(2, '0');
}

function proximaRevisao(atual) {
  const digits = String(atual || '0').replace(/\D/g, '');
  const n = Number.parseInt(digits || '0', 10);
  return String((Number.isFinite(n) ? n : 0) + 1).padStart(2, '0');
}

function montarNomeArquivo(numeroFormulario, numeroRevisao, originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase() || '.pdf';
  const base = sanitizarNumeroFormulario(numeroFormulario);
  const rev = formatarRevisao(numeroRevisao);
  return `${base}_REV${rev}${ext}`;
}

function montarCaminhoArquivo(numeroFormulario, nomeArquivo) {
  return `${LISTA_MESTRA_PREFIX}/${sanitizarNumeroFormulario(numeroFormulario)}/${nomeArquivo}`;
}

async function buscarItemPorId(id) {
  const result = await dbQuery(
    `SELECT ${COLS} FROM qualidade.lista_mestra WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

function nomeArquivoDownload(item, url) {
  const ext = path.extname(String(url || '').split('?')[0]).toLowerCase() || '.bin';
  return montarNomeArquivo(item.numero_formulario, item.numero_revisao, `file${ext}`);
}

async function enviarArquivoUrl(res, url, { inline = false, filename } = {}) {
  const upstream = await fetch(url);
  if (!upstream.ok) {
    const err = new Error(`Arquivo indisponível (HTTP ${upstream.status})`);
    err.statusCode = upstream.status === 404 ? 404 : 502;
    throw err;
  }

  const ext = path.extname(String(url || '').split('?')[0]).toLowerCase();
  const contentType = upstream.headers.get('content-type')
    || mime.lookup(ext)
    || 'application/octet-stream';
  const safeName = String(filename || 'documento').replace(/["\r\n]/g, '_');

  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(safeName)}`
  );
  const len = upstream.headers.get('content-length');
  if (len) res.setHeader('Content-Length', len);

  if (!upstream.body) {
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
    return;
  }

  await pipeline(Readable.fromWeb(upstream.body), res);
}

router.get('/lista-mestra', async (_req, res) => {
  try {
    await ensureListaMestraSchema();
    const result = await dbQuery(
      `SELECT ${COLS} FROM qualidade.lista_mestra ORDER BY numero_formulario ASC`
    );
    return res.json({ ok: true, itens: result.rows.map(mapRow) });
  } catch (error) {
    console.error('[lista-mestra] GET erro:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao listar documentos.' });
  }
});

router.get('/lista-mestra/:id/download', async (req, res) => {
  try {
    await ensureListaMestraSchema();
    const item = await buscarItemPorId(req.params.id);
    if (!item) {
      return res.status(404).json({ ok: false, error: 'Documento não encontrado.' });
    }

    const historicoId = Number(req.query.historico_id || 0);
    let url = String(item.documento || '').trim();
    let filename = nomeArquivoDownload(item, url);

    if (historicoId) {
      const hist = await dbQuery(
        `SELECT numero_revisao, documento
           FROM qualidade.lista_mestra_historico
          WHERE id = $1 AND lista_mestra_id = $2`,
        [historicoId, item.id]
      );
      if (!hist.rows.length) {
        return res.status(404).json({ ok: false, error: 'Versão do histórico não encontrada.' });
      }
      url = String(hist.rows[0].documento || '').trim();
      filename = montarNomeArquivo(
        item.numero_formulario,
        hist.rows[0].numero_revisao,
        `file${path.extname(url.split('?')[0]) || '.bin'}`
      );
    }

    if (!url) {
      return res.status(404).json({ ok: false, error: 'Este documento ainda não possui arquivo.' });
    }

    const inline = String(req.query.preview || '') === '1';
    await enviarArquivoUrl(res, url, { inline, filename });
  } catch (error) {
    console.error('[lista-mestra] GET download erro:', error);
    if (!res.headersSent) {
      const status = error.statusCode || 500;
      return res.status(status).json({
        ok: false,
        error: status === 404 ? 'Arquivo não encontrado no armazenamento.' : 'Erro ao baixar o arquivo.'
      });
    }
  }
});

router.get('/lista-mestra/:id/arquivo', async (req, res) => {
  try {
    await ensureListaMestraSchema();
    const item = await buscarItemPorId(req.params.id);
    if (!item) {
      return res.status(404).json({ ok: false, error: 'Documento não encontrado.' });
    }
    const hist = await dbQuery(
      `SELECT id, lista_mestra_id, numero_revisao, documento, documento_path,
              descricao_alteracao, inserido_por, inserido_em
         FROM qualidade.lista_mestra_historico
        WHERE lista_mestra_id = $1
        ORDER BY inserido_em DESC, id DESC`,
      [req.params.id]
    );
    return res.json({
      ok: true,
      item: mapRow(item),
      historico: hist.rows.map(mapHistorico)
    });
  } catch (error) {
    console.error('[lista-mestra] GET arquivo erro:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar arquivo do documento.' });
  }
});

router.get('/lista-mestra/:id', async (req, res) => {
  try {
    await ensureListaMestraSchema();
    const item = await buscarItemPorId(req.params.id);
    if (!item) {
      return res.status(404).json({ ok: false, error: 'Documento não encontrado.' });
    }
    return res.json({ ok: true, item: mapRow(item) });
  } catch (error) {
    console.error('[lista-mestra] GET/:id erro:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar documento.' });
  }
});

router.post('/lista-mestra/:id/arquivo', upload.single('arquivo'), async (req, res) => {
  try {
    await ensureListaMestraSchema();
    if (!(await usuarioEhSetorQualidade(req))) {
      return res.status(403).json({
        ok: false,
        error: 'Atualização somente via setor da qualidade.'
      });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Envie o arquivo no campo "arquivo".' });
    }

    const item = await buscarItemPorId(req.params.id);
    if (!item) {
      return res.status(404).json({ ok: false, error: 'Documento não encontrado.' });
    }

    const descricaoAlteracao = String(req.body?.descricao_alteracao || '').trim();
    const jaTemArquivo = !!String(item.documento || '').trim();
    const numeroRevisao = jaTemArquivo
      ? proximaRevisao(item.numero_revisao)
      : formatarRevisao(item.numero_revisao);

    const nomeArquivo = montarNomeArquivo(item.numero_formulario, numeroRevisao, req.file.originalname);
    const caminho = montarCaminhoArquivo(item.numero_formulario, nomeArquivo);
    const contentType = req.file.mimetype || mime.lookup(nomeArquivo) || 'application/octet-stream';

    const { url, path: savedPath } = await uploadPublicFile(
      LISTA_MESTRA_BUCKET,
      caminho,
      req.file.buffer,
      { contentType, upsert: false }
    );

    const usuario = usuarioLogado(req);

    await dbQuery(
      `INSERT INTO qualidade.lista_mestra_historico
        (lista_mestra_id, numero_revisao, documento, documento_path, descricao_alteracao, inserido_por)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [item.id, numeroRevisao, url, savedPath, descricaoAlteracao || null, usuario]
    );

    const updated = await dbQuery(
      `UPDATE qualidade.lista_mestra SET
        numero_revisao = $1,
        documento = $2,
        atualizado_em = NOW()
       WHERE id = $3
       RETURNING ${COLS}`,
      [numeroRevisao, url, item.id]
    );

    const hist = await dbQuery(
      `SELECT id, lista_mestra_id, numero_revisao, documento, documento_path,
              descricao_alteracao, inserido_por, inserido_em
         FROM qualidade.lista_mestra_historico
        WHERE lista_mestra_id = $1
        ORDER BY inserido_em DESC, id DESC`,
      [item.id]
    );

    return res.json({
      ok: true,
      item: mapRow(updated.rows[0]),
      historico: hist.rows.map(mapHistorico)
    });
  } catch (error) {
    console.error('[lista-mestra] POST arquivo erro:', error);
    const msg = String(error?.message || error);
    if (msg.includes('already exists') || msg.includes('409')) {
      return res.status(409).json({ ok: false, error: 'Esta revisão já possui arquivo. Tente novamente.' });
    }
    return res.status(500).json({ ok: false, error: 'Erro ao enviar arquivo do documento.' });
  }
});

router.put('/lista-mestra/:id', express.json(), async (req, res) => {
  try {
    await ensureListaMestraSchema();
    const body = req.body || {};
    const result = await dbQuery(
      `UPDATE qualidade.lista_mestra SET
        numero_formulario = $1,
        descricao = $2,
        tipo_documento = $3,
        formato = $4,
        classificacao = $5,
        autor = $6,
        numero_revisao = $7,
        data_criacao = $8,
        revisado = $9,
        revisado_por = $10,
        proxima_revisao = $11,
        responsavel_arquivar_eliminar = $12,
        tempo_retencao = $13,
        status = $14,
        data_arquivamento = $15,
        atualizado_em = NOW()
       WHERE id = $16
       RETURNING ${COLS}`,
      [
        String(body.numero_formulario || '').trim(),
        String(body.descricao || '').trim() || null,
        String(body.tipo_documento || '').trim() || null,
        String(body.formato || '').trim() || null,
        String(body.classificacao || '').trim() || null,
        String(body.autor || '').trim() || null,
        String(body.numero_revisao || '').trim() || null,
        String(body.data_criacao || '').trim() || null,
        String(body.revisado || '').trim() || null,
        String(body.revisado_por || '').trim() || null,
        String(body.proxima_revisao || '').trim() || null,
        String(body.responsavel_arquivar_eliminar || '').trim() || null,
        String(body.tempo_retencao || '').trim() || null,
        String(body.status || '').trim() || null,
        String(body.data_arquivamento || '').trim() || null,
        req.params.id
      ]
    );
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'Documento não encontrado.' });
    }
    return res.json({ ok: true, item: mapRow(result.rows[0]) });
  } catch (error) {
    console.error('[lista-mestra] PUT erro:', error);
    if (String(error?.code) === '23505') {
      return res.status(409).json({ ok: false, error: 'Número de formulário já existe.' });
    }
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar documento.' });
  }
});

module.exports = router;
