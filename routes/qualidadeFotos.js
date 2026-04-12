// routes/qualidadeFotos.js
const express = require('express');
const router = express.Router();
const { dbQuery } = require('../src/db');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const supabase = require('../utils/supabase');

const BUCKET = process.env.SUPABASE_BUCKET || 'produtos';
const MANUAIS_BUCKET = process.env.QUALIDADE_MANUAIS_BUCKET || 'Manuais';
const MANUAIS_PREFIX = process.env.QUALIDADE_MANUAIS_PREFIX || 'Manuais principais';
const MANUAIS_META = [
  { order: 1, code: 'FT-M01-MSGQ', title: 'Manual do Sistema de Gestão da Qualidade' },
  { order: 2, code: 'FT-M02-MGPMBC', title: 'Manual de Garantia do Processo de Montagem das Bombas de Calor' },
  { order: 3, code: 'FT-M03-MFP', title: 'Manual de Fornecedores de Produtos' },
  { order: 4, code: 'FT-M04-MSASC', title: 'Manual de Serviço de Atendimento e Satisfação do Consumidor' },
  { order: 5, code: 'FT-M05-MAE', title: 'Manual de Auditoria Escalonada' },
  { order: 6, code: 'FT-M06-MER', title: 'Manual de Expedição e Recebimento' },
  { order: 7, code: 'FT-M07-MPTNC', title: 'Manual do Processo de Tratativa de Não-Conformidades' },
  { order: 99, code: 'FT-M04-ITSAT', title: 'FT-M04-ITSAT' }
];

// Upload em memória (até 12MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

function normalizarManualCode(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function resolverMetaManual(fileName) {
  const normalizedName = normalizarManualCode(fileName);
  return MANUAIS_META.find((item) => normalizedName.includes(normalizarManualCode(item.code))) || null;
}

router.get('/manuais-principais', async (_req, res) => {
  try {
    const { data, error } = await supabase.storage.from(MANUAIS_BUCKET).list(MANUAIS_PREFIX, {
      limit: 100,
      sortBy: { column: 'name', order: 'asc' }
    });

    if (error) throw error;

    const itens = (Array.isArray(data) ? data : [])
      .filter((item) => item && item.name && !String(item.name).endsWith('/'))
      .map((item) => {
        const meta = resolverMetaManual(item.name);
        const pathKey = `${MANUAIS_PREFIX}/${item.name}`;
        const { data: publicData } = supabase.storage.from(MANUAIS_BUCKET).getPublicUrl(pathKey);
        const publicUrl = String(publicData?.publicUrl || '').trim();
        const codigo = meta?.code || String(item.name || '').replace(/\.[^.]+$/, '').trim();
        const titulo = meta?.title || codigo;
        return {
          codigo,
          titulo,
          nome_arquivo: String(item.name || '').trim(),
          nome_exibicao: titulo && titulo !== codigo ? `${codigo} - ${titulo}` : codigo,
          path_key: pathKey,
          mime_type: String(item?.metadata?.mimetype || item?.metadata?.contentType || '').trim(),
          tamanho_bytes: Number(item?.metadata?.size || 0),
          public_url: publicUrl,
          ordem: Number(meta?.order || 9999)
        };
      })
      .sort((a, b) => {
        if (a.ordem !== b.ordem) return a.ordem - b.ordem;
        return String(a.nome_arquivo || '').localeCompare(String(b.nome_arquivo || ''), 'pt-BR');
      });

    return res.json({
      ok: true,
      bucket: MANUAIS_BUCKET,
      pasta: MANUAIS_PREFIX,
      itens
    });
  } catch (error) {
    console.error('Erro ao listar manuais principais da Qualidade:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao listar os manuais principais.' });
  }
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
