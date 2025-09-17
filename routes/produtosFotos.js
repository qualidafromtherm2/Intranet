// routes/produtosFotos.js
const express = require('express');
const router  = express.Router();

const { Pool } = require('pg');
const pool = new Pool({
  host:     process.env.PGHOST || 'localhost',
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port:     Number(process.env.PGPORT || 5432),
  // Se seu Postgres exigir SSL (ex.: Render), defina PGSSLMODE=require no .env
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
});

const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime  = require('mime-types');

const supabase = require('../utils/supabase');
const BUCKET   = process.env.SUPABASE_BUCKET || 'produtos';

// -----------------------------------------------------------------------------
// Helper: converte "04.PP.N.51005" -> 10408353557, ou retorna Number se já vier numérico
async function resolveCodigoProduto(codigoParam) {
  const raw = String(codigoParam || '').trim();
  if (/^\d+$/.test(raw)) return Number(raw);

  const sql = `
    SELECT codigo_produto
      FROM public.produtos_omie
     WHERE codigo = $1
     LIMIT 1
  `;
  const { rows } = await pool.query(sql, [raw]);
  if (!rows.length) {
    const e = new Error('Produto não encontrado para o código informado.');
    e.status = 404;
    throw e;
  }
  return Number(rows[0].codigo_produto);
}

// Upload em memória (até 12MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

// -----------------------------------------------------------------------------
// Healthchecks
router.get('/ping',     (_req, res) => res.json({ ok: true, where: 'produtosFotos' }));
router.get('/db-ping',  async (_req, res) => {
  try {
    const r = await pool.query('select 1 as ok');
    res.json({ db: 'up', row: r.rows[0] });
  } catch (e) {
    res.status(500).json({ db: 'down', error: String(e.message || e) });
  }
});

// -----------------------------------------------------------------------------
// POST /api/produtos/:codigo/fotos  (campo form: "foto"; ?pos=0..5)
router.post('/:codigo/fotos', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie a foto no campo "foto"' });

    const codigoNum = await resolveCodigoProduto(req.params.codigo);
    const pos       = Number(req.query.pos ?? 0);

    const ext      = mime.extension(req.file.mimetype) || 'bin';
    const fileName = `${uuidv4()}.${ext}`;
    const pathKey  = `${codigoNum}/${fileName}`; // sempre usa pasta do código numérico

    // Envia para Supabase
    const { error: upErr } = await supabase
      .storage
      .from(BUCKET)
      .upload(pathKey, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });
    if (upErr) throw upErr;

    // URL pública
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathKey);
    const publicUrl = data.publicUrl;

    // Upsert no Postgres
    await pool.query(
      `INSERT INTO public.produtos_omie_imagens (codigo_produto, pos, url_imagem, path_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (codigo_produto, pos)
       DO UPDATE SET url_imagem = EXCLUDED.url_imagem,
                     path_key   = EXCLUDED.path_key`,
      [codigoNum, pos, publicUrl, pathKey]
    );

    res.json({ ok: true, codigo: codigoNum, pos, pathKey, url: publicUrl });
  } catch (err) {
    console.error('[upload foto]', err);
    res.status(err.status || 500).json({ error: 'Falha no upload', detail: String(err.message || err) });
  }
});

// -----------------------------------------------------------------------------
// DELETE /api/produtos/:codigo/fotos/:pos?  (pos padrão = 0)
router.delete('/:codigo/fotos/:pos?', async (req, res) => {
  try {
    const codigoNum = await resolveCodigoProduto(req.params.codigo);
    const pos       = Number(req.params.pos ?? 0);

    // Busca o path_key para tentar remover do storage
    const r = await pool.query(
      `SELECT path_key
         FROM public.produtos_omie_imagens
        WHERE codigo_produto = $1 AND pos = $2`,
      [codigoNum, pos]
    );
    const pathKey = r.rows?.[0]?.path_key || null;

    // Remove no Supabase se houver path_key
    if (pathKey) {
      const { error: delErr } = await supabase.storage.from(BUCKET).remove([pathKey]);
      if (delErr) throw delErr;
    }

    // Remove a linha do banco (mesmo que não tenha path_key)
    await pool.query(
      `DELETE FROM public.produtos_omie_imagens
        WHERE codigo_produto = $1 AND pos = $2`,
      [codigoNum, pos]
    );

    res.json({ ok: true, codigo: codigoNum, pos, removed: pathKey });
  } catch (err) {
    console.error('[delete foto]', err);
    res.status(err.status || 500).json({ error: 'Falha ao excluir', detail: String(err.message || err) });
  }
});

// -----------------------------------------------------------------------------
// GET /api/produtos/:codigo/fotos  -> { ok, codigo, fotos:[{pos,url_imagem,path_key}] }
router.get('/:codigo/fotos', async (req, res) => {
  try {
    const codigoNum = await resolveCodigoProduto(req.params.codigo);

    const q = await pool.query(
      `SELECT pos, url_imagem, path_key
         FROM public.produtos_omie_imagens
        WHERE codigo_produto = $1
        ORDER BY pos`,
      [codigoNum]
    );

    res.json({ ok: true, codigo: codigoNum, fotos: q.rows });
  } catch (err) {
    console.error('[listar fotos]', err);
    res.status(err.status || 500).json({ error: 'Falha ao listar', detail: String(err.message || err) });
  }
});

module.exports = router;
