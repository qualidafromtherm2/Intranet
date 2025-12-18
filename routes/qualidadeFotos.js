// routes/qualidadeFotos.js
const express = require('express');
const router = express.Router();
const { dbQuery } = require('../src/db');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const supabase = require('../utils/supabase');

const BUCKET = process.env.SUPABASE_BUCKET || 'produtos';

// Upload em memória (até 12MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

// Upload foto RI
router.post('/ri/:id/foto', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Envie a foto no campo "foto"' });
    }

    const { id } = req.params;

    // Buscar item RI para pegar o código
    const itemResult = await dbQuery(
      'SELECT codigo FROM qualidade.ri WHERE id = $1',
      [id]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item RI não encontrado' });
    }

    const codigo = itemResult.rows[0].codigo;
    const ext = mime.extension(req.file.mimetype) || 'bin';
    const fileName = `${uuidv4()}.${ext}`;
    const pathKey = `RI/${codigo}/${fileName}`;

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

    // Atualiza a URL da foto no item RI
    await dbQuery(
      'UPDATE qualidade.ri SET foto_url = $1, atualizado_em = NOW() WHERE id = $2',
      [publicUrl, id]
    );

    res.json({
      ok: true,
      foto_url: publicUrl,
      path_key: pathKey
    });
  } catch (error) {
    console.error('Erro ao fazer upload da foto RI:', error);
    res.status(500).json({ error: 'Erro ao fazer upload da foto' });
  }
});

// Upload foto PIR
router.post('/pir/:id/foto', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Envie a foto no campo "foto"' });
    }

    const { id } = req.params;

    // Buscar item PIR para pegar o código
    const itemResult = await dbQuery(
      'SELECT codigo FROM qualidade.pir WHERE id = $1',
      [id]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item PIR não encontrado' });
    }

    const codigo = itemResult.rows[0].codigo;
    const ext = mime.extension(req.file.mimetype) || 'bin';
    const fileName = `${uuidv4()}.${ext}`;
    const pathKey = `PIR/${codigo}/${fileName}`;

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

    // Atualiza a URL da foto no item PIR
    await dbQuery(
      'UPDATE qualidade.pir SET foto_url = $1, atualizado_em = NOW() WHERE id = $2',
      [publicUrl, id]
    );

    res.json({
      ok: true,
      foto_url: publicUrl,
      path_key: pathKey
    });
  } catch (error) {
    console.error('Erro ao fazer upload da foto PIR:', error);
    res.status(500).json({ error: 'Erro ao fazer upload da foto' });
  }
});

module.exports = router;
