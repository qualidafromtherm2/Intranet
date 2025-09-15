// routes/produtosFotos.js
const express = require('express');
const router = express.Router();

// ⚠️ Use as MESMAS variáveis do seu .env (PGHOST, PGUSER, etc.)
const { Pool } = require('pg');
const pool = new Pool({
  host:     process.env.PGHOST || 'localhost',
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port:     Number(process.env.PGPORT || 5432),
  // Se seu banco for no Render e exigir SSL, exporte PGSSLMODE=require no .env:
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
});


const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');

const supabase = require('../utils/supabase');
const BUCKET = process.env.SUPABASE_BUCKET || 'produtos';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB
});
router.get('/ping', (req, res) => res.json({ ok: true, where: 'produtosFotos' }));

// POST /api/produtos/:codigo/fotos  (form field: "foto")
router.post('/:codigo/fotos', upload.single('foto'), async (req, res) => {
  try {
    const { codigo } = req.params;
    if (!codigo) return res.status(400).json({ error: 'Código não informado' });
    if (!req.file) return res.status(400).json({ error: 'Envie a foto no campo "foto"' });

    const ext = mime.extension(req.file.mimetype) || 'bin';
    const fileName = `${uuidv4()}.${ext}`;
    const pathKey = `${codigo}/${fileName}`;

    const { error: upErr } = await supabase
      .storage
      .from(BUCKET)
      .upload(pathKey, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });
    if (upErr) throw upErr;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathKey);

    const publicUrl = data.publicUrl;

// por enquanto vamos gravar como foto principal: pos = 1
const pos = 1;

// DEBUG temporário: veja nos logs
console.log('[foto:upsert]', { codigo, pos, publicUrl, pathKey });

await pool.query(
  `INSERT INTO public.produtos_omie_imagens (codigo_produto, pos, url_imagem, path_key)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (codigo_produto, pos)
   DO UPDATE SET url_imagem = EXCLUDED.url_imagem,
                 path_key   = EXCLUDED.path_key`,
  [Number(codigo), pos, publicUrl, pathKey]
);

// (opcional) inclua pos na resposta para conferirmos já no curl
return res.json({ ok: true, codigo, pos, pathKey, url: publicUrl });


  } catch (err) {
    console.error('[upload teste]', err);
    res.status(500).json({ error: 'Falha no upload', detail: String(err.message || err) });
  }
});

module.exports = router;
