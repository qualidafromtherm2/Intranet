// routes/engenhariaAlteracoesProduto.js — alterações de produto (engenharia)
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const { uploadPublicFile } = require('../utils/storage');

const router = express.Router();

const STORAGE_BUCKET = 'Engenharia';
const PASTA_BASE = 'Alteracoes_produto';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

let schemaReady = false;

async function ensureAlteracoesProdutoSchema(pool) {
  if (schemaReady) return;
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS engenharia;
    CREATE TABLE IF NOT EXISTS engenharia.alteracoes_produto (
      id SERIAL PRIMARY KEY,
      data TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      codigo_omie TEXT NOT NULL,
      antes TEXT,
      depois TEXT,
      referencia TEXT,
      foto_antes TEXT,
      foto_depois TEXT,
      video TEXT,
      arquivo TEXT,
      criado_por TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_alteracoes_produto_codigo
      ON engenharia.alteracoes_produto (codigo_omie);
  `);
  schemaReady = true;
}

function sanitizeCodigo(raw) {
  return String(raw || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

async function resolverCodigosBusca(pool, raw) {
  const entrada = String(raw || '').trim();
  if (!entrada) return [];

  const codigos = new Set([entrada]);
  const sanitizado = sanitizeCodigo(entrada);
  if (sanitizado) codigos.add(sanitizado);

  try {
    const { rows } = await pool.query(
      `SELECT codigo_produto::text AS codigo_produto, codigo::text AS codigo
         FROM public.produtos_omie
        WHERE codigo_produto::text = $1 OR codigo = $1
        LIMIT 1`,
      [entrada]
    );
    if (rows.length) {
      const omie = String(rows[0].codigo_produto || '').trim();
      const cod = String(rows[0].codigo || '').trim();
      if (omie) codigos.add(omie);
      if (cod) codigos.add(cod);
    }
  } catch (err) {
    console.warn('[alteracoes-produto] Falha ao resolver código do produto:', err.message);
  }

  return [...codigos].filter(Boolean);
}

async function resolverCodigoOmiePrincipal(pool, raw) {
  const codigos = await resolverCodigosBusca(pool, raw);
  const numerico = codigos.find((c) => /^\d+$/.test(c));
  return numerico || codigos[0] || String(raw || '').trim();
}

function montarReferencia(tipo, valor) {
  const t = String(tipo || '').trim();
  const v = String(valor || '').trim();
  if (!t || !v) return null;
  if (t === 'Lote') return `Lote: ${v}`;
  if (t === 'Data') return `Data: ${v}`;
  return `${t}: ${v}`;
}

function parseReferencia(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return { tipo: '', valor: '' };
  const match = raw.match(/^(Lote|Data):\s*(.+)$/i);
  if (match) return { tipo: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(), valor: match[2].trim() };
  return { tipo: '', valor: raw };
}

async function uploadArquivo(codigoOmie, subpasta, file) {
  if (!file?.buffer?.length) return null;
  const cod = sanitizeCodigo(codigoOmie);
  if (!cod) throw new Error('Código OMIE inválido para upload.');

  const ext = mime.extension(file.mimetype)
    || String(file.originalname || '').split('.').pop()
    || 'bin';
  const nome = `${uuidv4()}.${String(ext).replace(/[^a-zA-Z0-9]/g, '')}`;
  const pathKey = `${PASTA_BASE}/${cod}/${subpasta}/${nome}`;

  const { url } = await uploadPublicFile(STORAGE_BUCKET, pathKey, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false,
  });
  return url;
}

module.exports = (pool) => {
  router.get('/todos', async (_req, res) => {
    try {
      await ensureAlteracoesProdutoSchema(pool);
      const { rows } = await pool.query(
        `SELECT a.id, a.data::text AS data, a.codigo_omie, a.antes, a.depois, a.referencia,
                a.foto_antes, a.foto_depois, a.video, a.arquivo, a.criado_por,
                p.codigo AS codigo_interno
           FROM engenharia.alteracoes_produto a
           LEFT JOIN public.produtos_omie p
             ON p.codigo_produto::text = a.codigo_omie
          ORDER BY a.data DESC, a.id DESC`
      );
      res.json({ ok: true, alteracoes: rows });
    } catch (e) {
      console.error('[GET /api/engenharia/alteracoes-produto/todos] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.get('/:codigoOmie', async (req, res) => {
    try {
      await ensureAlteracoesProdutoSchema(pool);
      const codigos = await resolverCodigosBusca(pool, req.params.codigoOmie);
      if (!codigos.length) {
        return res.status(400).json({ error: 'Código OMIE inválido.' });
      }

      const { rows } = await pool.query(
        `SELECT id, data::text AS data, codigo_omie, antes, depois, referencia,
                foto_antes, foto_depois, video, arquivo, criado_por
           FROM engenharia.alteracoes_produto
          WHERE codigo_omie = ANY($1::text[])
          ORDER BY data DESC, id DESC`,
        [codigos]
      );
      res.json({ ok: true, alteracoes: rows, codigos_buscados: codigos });
    } catch (e) {
      console.error('[GET /api/engenharia/alteracoes-produto/:codigoOmie] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post(
    '/',
    upload.fields([
      { name: 'foto_antes', maxCount: 1 },
      { name: 'foto_depois', maxCount: 1 },
      { name: 'video', maxCount: 1 },
      { name: 'arquivo', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        await ensureAlteracoesProdutoSchema(pool);

        const codigoOmie = await resolverCodigoOmiePrincipal(pool, req.body?.codigo_omie);
        if (!codigoOmie) {
          return res.status(400).json({ error: 'Informe o código OMIE do produto.' });
        }

        const antes = String(req.body?.antes || '').trim() || null;
        const depois = String(req.body?.depois || '').trim() || null;
        const referencia = montarReferencia(req.body?.referencia_tipo, req.body?.referencia_valor);
        const criadoPor = req.session?.usuario?.username
          || req.session?.usuario?.nome
          || 'sistema';

        const files = req.files || {};
        const [fotoAntes, fotoDepois, video, arquivo] = await Promise.all([
          uploadArquivo(codigoOmie, 'foto', files.foto_antes?.[0]),
          uploadArquivo(codigoOmie, 'foto', files.foto_depois?.[0]),
          uploadArquivo(codigoOmie, 'video', files.video?.[0]),
          uploadArquivo(codigoOmie, 'arquivo', files.arquivo?.[0]),
        ]);

        const { rows } = await pool.query(
          `INSERT INTO engenharia.alteracoes_produto
             (codigo_omie, antes, depois, referencia, foto_antes, foto_depois, video, arquivo, criado_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, data::text AS data`,
          [codigoOmie, antes, depois, referencia, fotoAntes, fotoDepois, video, arquivo, criadoPor]
        );

        res.json({ ok: true, alteracao: rows[0] });
      } catch (e) {
        console.error('[POST /api/engenharia/alteracoes-produto] erro:', e);
        res.status(500).json({ error: e.message || String(e) });
      }
    }
  );

  router.put(
    '/:id',
    upload.fields([
      { name: 'foto_antes', maxCount: 1 },
      { name: 'foto_depois', maxCount: 1 },
      { name: 'video', maxCount: 1 },
      { name: 'arquivo', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        await ensureAlteracoesProdutoSchema(pool);

        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });

        const { rows: existentes } = await pool.query(
          `SELECT id, codigo_omie, foto_antes, foto_depois, video, arquivo
             FROM engenharia.alteracoes_produto
            WHERE id = $1`,
          [id]
        );
        if (!existentes.length) {
          return res.status(404).json({ error: 'Alteração não encontrada.' });
        }

        const atual = existentes[0];
        const antes = String(req.body?.antes ?? '').trim() || null;
        const depois = String(req.body?.depois ?? '').trim() || null;
        const referenciaTipo = String(req.body?.referencia_tipo || '').trim();
        const referenciaValor = String(req.body?.referencia_valor || '').trim();
        const referencia = referenciaTipo && referenciaValor
          ? montarReferencia(referenciaTipo, referenciaValor)
          : (String(req.body?.referencia || '').trim() || null);

        const files = req.files || {};
        const [fotoAntes, fotoDepois, video, arquivo] = await Promise.all([
          files.foto_antes?.[0]
            ? uploadArquivo(atual.codigo_omie, 'foto', files.foto_antes[0])
            : Promise.resolve(undefined),
          files.foto_depois?.[0]
            ? uploadArquivo(atual.codigo_omie, 'foto', files.foto_depois[0])
            : Promise.resolve(undefined),
          files.video?.[0]
            ? uploadArquivo(atual.codigo_omie, 'video', files.video[0])
            : Promise.resolve(undefined),
          files.arquivo?.[0]
            ? uploadArquivo(atual.codigo_omie, 'arquivo', files.arquivo[0])
            : Promise.resolve(undefined),
        ]);

        const { rows } = await pool.query(
          `UPDATE engenharia.alteracoes_produto
              SET antes = $1,
                  depois = $2,
                  referencia = $3,
                  foto_antes = COALESCE($4, foto_antes),
                  foto_depois = COALESCE($5, foto_depois),
                  video = COALESCE($6, video),
                  arquivo = COALESCE($7, arquivo)
            WHERE id = $8
            RETURNING id, data::text AS data, codigo_omie, antes, depois, referencia,
                      foto_antes, foto_depois, video, arquivo, criado_por`,
          [
            antes,
            depois,
            referencia,
            fotoAntes ?? null,
            fotoDepois ?? null,
            video ?? null,
            arquivo ?? null,
            id,
          ]
        );

        res.json({ ok: true, alteracao: rows[0] });
      } catch (e) {
        console.error('[PUT /api/engenharia/alteracoes-produto/:id] erro:', e);
        res.status(500).json({ error: e.message || String(e) });
      }
    }
  );

  return router;
};
