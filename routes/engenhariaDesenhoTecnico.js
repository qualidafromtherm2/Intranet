// routes/engenhariaDesenhoTecnico.js — desenhos técnicos por produto (engenharia)
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const { uploadPublicFile } = require('../utils/storage');

const router = express.Router();

const STORAGE_BUCKET = 'Engenharia';
const PASTA_BASE = 'Desenho_tecnico';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

let schemaReady = false;

async function ensureDesenhoTecnicoSchema(pool) {
  if (schemaReady) return;
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS engenharia;
    CREATE TABLE IF NOT EXISTS engenharia.desenho_tecnico (
      id SERIAL PRIMARY KEY,
      nome_arquivo TEXT NOT NULL,
      versao INTEGER NOT NULL DEFAULT 1,
      codigo_omie TEXT NOT NULL,
      anexo TEXT,
      data TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'ativo'
    );
    CREATE INDEX IF NOT EXISTS idx_desenho_tecnico_codigo
      ON engenharia.desenho_tecnico (codigo_omie);
    CREATE INDEX IF NOT EXISTS idx_desenho_tecnico_status
      ON engenharia.desenho_tecnico (codigo_omie, status);
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
    console.warn('[desenho-tecnico] Falha ao resolver código do produto:', err.message);
  }

  return [...codigos].filter(Boolean);
}

async function resolverCodigoOmiePrincipal(pool, raw) {
  const codigos = await resolverCodigosBusca(pool, raw);
  const numerico = codigos.find((c) => /^\d+$/.test(c));
  return numerico || codigos[0] || String(raw || '').trim();
}

async function uploadAnexo(codigoOmie, file) {
  if (!file?.buffer?.length) return null;
  const cod = sanitizeCodigo(codigoOmie);
  if (!cod) throw new Error('Código OMIE inválido para upload.');

  const ext = mime.extension(file.mimetype)
    || String(file.originalname || '').split('.').pop()
    || 'bin';
  const nome = `${uuidv4()}.${String(ext).replace(/[^a-zA-Z0-9]/g, '')}`;
  const pathKey = `${PASTA_BASE}/${cod}/arquivo/${nome}`;

  const { url } = await uploadPublicFile(STORAGE_BUCKET, pathKey, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false,
  });
  return url;
}

function mapRow(row) {
  return {
    id: row.id,
    nome_arquivo: row.nome_arquivo,
    versao: row.versao,
    codigo_omie: row.codigo_omie,
    anexo: row.anexo,
    data: row.data,
    status: row.status,
    codigo_interno: row.codigo_interno || null,
  };
}

module.exports = (pool) => {
  router.get('/todos', async (_req, res) => {
    try {
      await ensureDesenhoTecnicoSchema(pool);
      const { rows } = await pool.query(
        `SELECT d.id, d.nome_arquivo, d.versao, d.codigo_omie, d.anexo, d.data::text AS data, d.status,
                p.codigo AS codigo_interno
           FROM engenharia.desenho_tecnico d
           LEFT JOIN public.produtos_omie p
             ON p.codigo_produto::text = d.codigo_omie
          ORDER BY d.data DESC, d.id DESC`
      );
      res.json({ ok: true, desenhos: rows.map(mapRow) });
    } catch (e) {
      console.error('[GET /api/engenharia/desenho-tecnico/todos] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.get('/:codigoOmie', async (req, res) => {
    try {
      await ensureDesenhoTecnicoSchema(pool);
      const codigos = await resolverCodigosBusca(pool, req.params.codigoOmie);
      if (!codigos.length) {
        return res.status(400).json({ error: 'Código do produto inválido.' });
      }

      const { rows } = await pool.query(
        `SELECT id, nome_arquivo, versao, codigo_omie, anexo, data::text AS data, status
           FROM engenharia.desenho_tecnico
          WHERE codigo_omie = ANY($1::text[])
          ORDER BY status DESC, versao DESC, data DESC, id DESC`,
        [codigos]
      );
      res.json({ ok: true, desenhos: rows.map(mapRow) });
    } catch (e) {
      console.error('[GET /api/engenharia/desenho-tecnico/:codigoOmie] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post(
    '/',
    upload.single('anexo'),
    async (req, res) => {
      const client = await pool.connect();
      try {
        await ensureDesenhoTecnicoSchema(pool);

        const codigoOmie = await resolverCodigoOmiePrincipal(pool, req.body?.codigo_omie);
        if (!codigoOmie) {
          return res.status(400).json({ error: 'Informe o código OMIE do produto.' });
        }

        const nomeArquivo = String(req.body?.nome_arquivo || '').trim();
        if (!nomeArquivo) {
          return res.status(400).json({ error: 'Informe o nome do arquivo.' });
        }

        if (!req.file?.buffer?.length) {
          return res.status(400).json({ error: 'Anexe o arquivo do desenho técnico.' });
        }

        const substituirId = parseInt(req.body?.substituir_id, 10) || null;
        const anexoUrl = await uploadAnexo(codigoOmie, req.file);

        await client.query('BEGIN');

        let versao = 1;
        if (substituirId) {
          const { rows: antigos } = await client.query(
            `SELECT id, versao, status, codigo_omie
               FROM engenharia.desenho_tecnico
              WHERE id = $1`,
            [substituirId]
          );
          if (!antigos.length) {
            throw new Error('Registro para substituir não encontrado.');
          }
          const antigo = antigos[0];
          if (String(antigo.status).toLowerCase() !== 'ativo') {
            throw new Error('Somente desenhos ativos podem ser substituídos.');
          }
          if (!codigosIncluemOmie(await resolverCodigosBusca(pool, codigoOmie), antigo.codigo_omie)) {
            throw new Error('O desenho selecionado não pertence a este produto.');
          }

          await client.query(
            `UPDATE engenharia.desenho_tecnico SET status = 'inativo' WHERE id = $1`,
            [substituirId]
          );
          versao = Number(antigo.versao || 1) + 1;
        }

        const { rows } = await client.query(
          `INSERT INTO engenharia.desenho_tecnico
             (nome_arquivo, versao, codigo_omie, anexo, status)
           VALUES ($1, $2, $3, $4, 'ativo')
           RETURNING id, nome_arquivo, versao, codigo_omie, anexo, data::text AS data, status`,
          [nomeArquivo, versao, codigoOmie, anexoUrl]
        );

        await client.query('COMMIT');
        res.json({ ok: true, desenho: mapRow(rows[0]) });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[POST /api/engenharia/desenho-tecnico] erro:', e);
        res.status(500).json({ error: e.message || String(e) });
      } finally {
        client.release();
      }
    }
  );

  router.put(
    '/:id',
    upload.single('anexo'),
    async (req, res) => {
      try {
        await ensureDesenhoTecnicoSchema(pool);

        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: 'ID inválido.' });

        const { rows: existentes } = await pool.query(
          `SELECT id, codigo_omie, anexo FROM engenharia.desenho_tecnico WHERE id = $1`,
          [id]
        );
        if (!existentes.length) {
          return res.status(404).json({ error: 'Desenho técnico não encontrado.' });
        }

        const atual = existentes[0];
        const nomeArquivo = String(req.body?.nome_arquivo ?? '').trim() || null;
        let anexoUrl;
        if (req.file?.buffer?.length) {
          anexoUrl = await uploadAnexo(atual.codigo_omie, req.file);
        }

        const { rows } = await pool.query(
          `UPDATE engenharia.desenho_tecnico
              SET nome_arquivo = COALESCE($1, nome_arquivo),
                  anexo = COALESCE($2, anexo)
            WHERE id = $3
            RETURNING id, nome_arquivo, versao, codigo_omie, anexo, data::text AS data, status`,
          [nomeArquivo, anexoUrl ?? null, id]
        );

        res.json({ ok: true, desenho: mapRow(rows[0]) });
      } catch (e) {
        console.error('[PUT /api/engenharia/desenho-tecnico/:id] erro:', e);
        res.status(500).json({ error: e.message || String(e) });
      }
    }
  );

  return router;
};

function codigosIncluemOmie(codigos, codigoOmie) {
  const alvo = String(codigoOmie || '').trim();
  return codigos.some((c) => String(c).trim() === alvo);
}
