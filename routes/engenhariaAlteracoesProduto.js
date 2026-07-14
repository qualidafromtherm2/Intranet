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

const CODIGO_OMIE_PLACEHOLDERS = new Set([
  'código do produto',
  'codigo do produto',
  'código omie',
  'codigo omie',
  'n/a',
  'na',
  'null',
  'undefined',
  '-',
  '—',
]);

function sanitizeCodigo(raw) {
  return String(raw || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

function isCodigoOmieInvalido(raw) {
  const entrada = String(raw || '').trim();
  if (!entrada) return true;
  if (CODIGO_OMIE_PLACEHOLDERS.has(entrada.toLowerCase())) return true;
  // Texto de UI / título de placeholder (ex.: span#productTitle)
  if (/^c[oó]digo(\s+do)?\s+produto$/i.test(entrada)) return true;
  return false;
}

async function resolverCodigosBusca(pool, raw) {
  const entrada = String(raw || '').trim();
  if (isCodigoOmieInvalido(entrada)) return [];

  const codigos = new Set([entrada]);
  const sanitizado = sanitizeCodigo(entrada);
  if (sanitizado && !isCodigoOmieInvalido(sanitizado)) codigos.add(sanitizado);

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

  return [...codigos].filter((c) => c && !isCodigoOmieInvalido(c));
}

/** Resolve para o codigo_produto numérico OMIE; null se não existir no cadastro. */
async function resolverCodigoOmiePrincipal(pool, raw) {
  if (isCodigoOmieInvalido(raw)) return null;

  try {
    const { rows } = await pool.query(
      `SELECT codigo_produto::text AS codigo_produto
         FROM public.produtos_omie
        WHERE codigo_produto::text = $1 OR codigo = $1
        ORDER BY CASE WHEN codigo_produto::text = $1 THEN 0 ELSE 1 END
        LIMIT 1`,
      [String(raw || '').trim()]
    );
    const omie = String(rows[0]?.codigo_produto || '').trim();
    if (omie && !isCodigoOmieInvalido(omie)) return omie;
  } catch (err) {
    console.warn('[alteracoes-produto] Falha ao resolver código OMIE principal:', err.message);
  }

  // Só aceita número puro se já existir como codigo_produto (validado acima).
  // Não grava texto livre (evita "Código do produto", modelo sem cadastro, etc.).
  return null;
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
                COALESCE(p.codigo, p2.codigo) AS codigo_interno
           FROM engenharia.alteracoes_produto a
           LEFT JOIN public.produtos_omie p
             ON p.codigo_produto::text = a.codigo_omie
           LEFT JOIN public.produtos_omie p2
             ON p2.codigo = a.codigo_omie
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
          return res.status(400).json({
            error: 'Código OMIE inválido ou produto não encontrado no cadastro. Abra o produto na lista (Ações) ou use Registrar alteração em massa com filtro.',
          });
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

  // Registra a mesma alteração em vários produtos (1 linha por código)
  router.post(
    '/em-massa',
    upload.fields([
      { name: 'foto_antes', maxCount: 1 },
      { name: 'foto_depois', maxCount: 1 },
      { name: 'video', maxCount: 1 },
      { name: 'arquivo', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        await ensureAlteracoesProdutoSchema(pool);

        let codigosRaw = req.body?.codigos_omie;
        if (typeof codigosRaw === 'string') {
          try {
            const parsed = JSON.parse(codigosRaw);
            codigosRaw = Array.isArray(parsed) ? parsed : [codigosRaw];
          } catch (_) {
            codigosRaw = String(codigosRaw)
              .split(/[\n,;]+/)
              .map((s) => s.trim())
              .filter(Boolean);
          }
        }
        if (!Array.isArray(codigosRaw)) codigosRaw = [];

        const codigosUnicos = [...new Set(
          codigosRaw.map((c) => String(c || '').trim()).filter(Boolean)
        )];
        if (!codigosUnicos.length) {
          return res.status(400).json({ error: 'Informe ao menos um código OMIE.' });
        }
        if (codigosUnicos.length > 500) {
          return res.status(400).json({ error: 'Limite de 500 produtos por alteração em massa.' });
        }

        const antes = String(req.body?.antes || '').trim() || null;
        const depois = String(req.body?.depois || '').trim() || null;
        const referencia = montarReferencia(req.body?.referencia_tipo, req.body?.referencia_valor);
        const criadoPor = req.session?.usuario?.username
          || req.session?.usuario?.nome
          || 'sistema';

        const files = req.files || {};

        // Resolve todos os códigos antes de anexar/inserir — rejeita placeholder e códigos inexistentes
        const resolvidos = [];
        const erros = [];
        for (const raw of codigosUnicos) {
          if (isCodigoOmieInvalido(raw)) {
            erros.push({ codigo: raw, error: 'Código inválido (placeholder/vazio)' });
            continue;
          }
          const codigoOmie = await resolverCodigoOmiePrincipal(pool, raw);
          if (!codigoOmie) {
            erros.push({ codigo: raw, error: 'Produto não encontrado no cadastro' });
            continue;
          }
          resolvidos.push({ raw, codigoOmie });
        }

        if (!resolvidos.length) {
          return res.status(400).json({
            error: 'Nenhum código OMIE válido nos produtos filtrados. Use o filtro da Lista de produtos e o botão "Registrar alteração em massa".',
            erros,
          });
        }

        const templateCodigo = resolvidos[0].codigoOmie;

        // Anexa uma vez e reutiliza as URLs em todos os registros
        const [fotoAntes, fotoDepois, video, arquivo] = await Promise.all([
          uploadArquivo(templateCodigo, 'foto', files.foto_antes?.[0]),
          uploadArquivo(templateCodigo, 'foto', files.foto_depois?.[0]),
          uploadArquivo(templateCodigo, 'video', files.video?.[0]),
          uploadArquivo(templateCodigo, 'arquivo', files.arquivo?.[0]),
        ]);

        const criados = [];
        for (const item of resolvidos) {
          try {
            const codigoOmie = item.codigoOmie;
            const { rows } = await pool.query(
              `INSERT INTO engenharia.alteracoes_produto
                 (codigo_omie, antes, depois, referencia, foto_antes, foto_depois, video, arquivo, criado_por)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING id, data::text AS data, codigo_omie`,
              [codigoOmie, antes, depois, referencia, fotoAntes, fotoDepois, video, arquivo, criadoPor]
            );
            if (rows[0]) criados.push(rows[0]);
          } catch (err) {
            erros.push({ codigo: item.raw, error: err.message || String(err) });
          }
        }

        if (!criados.length) {
          return res.status(500).json({
            error: 'Nenhuma alteração foi criada.',
            erros,
          });
        }

        res.json({
          ok: true,
          criados: criados.length,
          alteracoes: criados,
          erros,
        });
      } catch (e) {
        console.error('[POST /api/engenharia/alteracoes-produto/em-massa] erro:', e);
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
