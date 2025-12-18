const express = require('express');
const router = express.Router();

const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');

const { dbQuery } = require('../src/db');
const { registrarModificacao } = require('../utils/auditoria');
const supabase = require('../utils/supabase');

const BUCKET = process.env.SUPABASE_BUCKET || 'produtos';

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on', 'sim'].includes(String(value || '').toLowerCase());
}

function parseVisibility(body) {
  const hasProd = Object.prototype.hasOwnProperty.call(body, 'visivel_producao');
  const hasAssist = Object.prototype.hasOwnProperty.call(body, 'visivel_assistencia_tecnica');
  const payload = {};
  if (hasProd) payload.visivel_producao = isTruthy(body.visivel_producao);
  if (hasAssist) payload.visivel_assistencia_tecnica = isTruthy(body.visivel_assistencia_tecnica);
  return payload;
}

// Reaproveita a lógica de produtosFotos: aceita código Omie textual e busca o código numérico.
async function resolveCodigoProduto(codigoParam) {
  const raw = String(codigoParam || '').trim();
  if (/^\d+$/.test(raw)) return Number(raw);

  const sql = `
    SELECT codigo_produto
      FROM public.produtos_omie
     WHERE codigo = $1
     LIMIT 1
  `;
  const { rows } = await dbQuery(sql, [raw]);
  if (!rows.length) {
    const e = new Error('Produto não encontrado para o código informado.');
    e.status = 404;
    throw e;
  }
  return Number(rows[0].codigo_produto);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function sanitizeFileName(rawName, fallbackExt) {
  const base = String(rawName || '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  const safe = base || `anexo.${fallbackExt}`;
  return safe.includes('.') ? safe : `${safe}.${fallbackExt}`;
}

router.get('/:codigo/anexos', async (req, res) => {
  try {
    const codigoNum = await resolveCodigoProduto(req.params.codigo);
    const includeInactive = isTruthy(req.query.include_inactive);
    const { rows } = await dbQuery(
      `SELECT id, codigo_produto, nome_anexo, descricao_anexo, url_anexo, tamanho_bytes,
              content_type, visivel_producao, visivel_assistencia_tecnica, ativo, criado_em
         FROM public.produtos_omie_anexos
        WHERE codigo_produto = $1
          AND ($2::boolean OR ativo = TRUE)
        ORDER BY ativo DESC, criado_em DESC`,
      [codigoNum, includeInactive]
    );
    res.json({ ok: true, codigo: codigoNum, anexos: rows });
  } catch (err) {
    console.error('[listar anexos produto]', err);
    res.status(err.status || 500).json({ error: 'Falha ao listar anexos' });
  }
});

router.post('/:codigo/anexos', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Envie o arquivo no campo "arquivo".' });
    }

    const codigoNum = await resolveCodigoProduto(req.params.codigo);
    const nome = String(req.body?.nome_anexo || '').trim();
    const descricao = String(req.body?.descricao_anexo || '').trim();

    if (!nome || !descricao) {
      return res.status(400).json({ error: 'Informe nome_anexo e descricao_anexo.' });
    }

  const mimeExt = mime.extension(req.file.mimetype);
  const originalExt = (req.file.originalname || '').split('.').pop();
  const ext = (mimeExt || originalExt || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';

  const safeOriginal = sanitizeFileName(req.file.originalname, ext);
  const pathKey = `${codigoNum}/${uuidv4()}-${safeOriginal}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(pathKey, req.file.buffer, {
        contentType: req.file.mimetype || 'application/octet-stream',
        upsert: false,
      });
    if (upErr) throw upErr;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathKey);
    const publicUrl = data.publicUrl;

    const insert = await dbQuery(
      `INSERT INTO public.produtos_omie_anexos
        (codigo_produto, nome_anexo, descricao_anexo, url_anexo, path_key,
         tamanho_bytes, content_type, visivel_producao, visivel_assistencia_tecnica, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, TRUE, TRUE)
       RETURNING id, codigo_produto, nome_anexo, descricao_anexo, url_anexo,
              tamanho_bytes, content_type, visivel_producao, visivel_assistencia_tecnica, ativo, criado_em`,
      [
        codigoNum,
        nome,
        descricao,
        publicUrl,
        pathKey,
        Number(req.file.size) || null,
        req.file.mimetype || null,
      ]
    );

    // Auditoria: anexo adicionado
    try {
      const usuarioAudit = (req.session?.user?.fullName || req.session?.user?.username || String(req.headers['x-user'] || '').trim() || 'sistema');
      let codigoTexto = null;
      try {
        const r = await dbQuery(`SELECT codigo FROM public.produtos_omie WHERE codigo_produto = $1 LIMIT 1`, [codigoNum]);
        codigoTexto = r.rows?.[0]?.codigo || null;
      } catch {}
      await registrarModificacao({
        codigo_omie: codigoTexto || String(codigoNum),
        codigo_texto: codigoTexto || null,
        codigo_produto: codigoNum,
        tipo_acao: 'PRODUTO_ANEXO_ADD',
        usuario: usuarioAudit,
        origem: 'API',
        detalhes: `nome=${nome}; path=${pathKey}; size=${Number(req.file.size) || 0}`
      });
    } catch (e) {
      console.warn('[auditoria][produtos/anexos:add] falhou ao registrar:', e?.message || e);
    }

    res.json({ ok: true, codigo: codigoNum, anexo: insert.rows[0] });
  } catch (err) {
    console.error('[upload anexo produto]', err);
    res.status(err.status || 500).json({ error: 'Falha no upload do anexo', detail: String(err.message || err) });
  }
});

router.delete('/:codigo/anexos/:id', async (req, res) => {
  try {
    const codigoNum = await resolveCodigoProduto(req.params.codigo);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Identificador inválido.' });
    }

    const softDelete = await dbQuery(
      `UPDATE public.produtos_omie_anexos
          SET ativo = FALSE
        WHERE codigo_produto = $1
          AND id = $2
          AND ativo = TRUE
        RETURNING id, path_key, url_anexo, nome_anexo, descricao_anexo, ativo`,
      [codigoNum, id]
    );

    if (!softDelete.rows.length) {
      return res.status(404).json({ error: 'Anexo não encontrado ou já desativado.' });
    }

    const pathKey = softDelete.rows[0].path_key;

    // Auditoria: anexo removido
    try {
      const usuarioAudit = (req.session?.user?.fullName || req.session?.user?.username || String(req.headers['x-user'] || '').trim() || 'sistema');
      let codigoTexto = null;
      try {
        const r = await dbQuery(`SELECT codigo FROM public.produtos_omie WHERE codigo_produto = $1 LIMIT 1`, [codigoNum]);
        codigoTexto = r.rows?.[0]?.codigo || null;
      } catch {}
      await registrarModificacao({
        codigo_omie: codigoTexto || String(codigoNum),
        codigo_texto: codigoTexto || null,
        codigo_produto: codigoNum,
        tipo_acao: 'PRODUTO_ANEXO_REMOVE',
        usuario: usuarioAudit,
        origem: 'API',
        detalhes: `id=${id}; path=${pathKey || ''}; ativo=false`
      });
    } catch (e) {
      console.warn('[auditoria][produtos/anexos:del] falhou ao registrar:', e?.message || e);
    }

    res.json({ ok: true, codigo: codigoNum, id, ativo: false });
  } catch (err) {
    console.error('[delete anexo produto]', err);
    res.status(err.status || 500).json({ error: 'Falha ao excluir anexo', detail: String(err.message || err) });
  }
});

router.patch('/:codigo/anexos/:id/visibilidade', async (req, res) => {
  try {
    const codigoNum = await resolveCodigoProduto(req.params.codigo);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Identificador inválido.' });
    }

    const visibility = parseVisibility(req.body || {});
    if (!Object.keys(visibility).length) {
      return res.status(400).json({ error: 'Informe visivel_producao e/ou visivel_assistencia_tecnica.' });
    }

    const fields = [];
    const values = [codigoNum, id];
    let idx = values.length;
    if (Object.prototype.hasOwnProperty.call(visibility, 'visivel_producao')) {
      idx += 1;
      fields.push(`visivel_producao = $${idx}`);
      values.push(visibility.visivel_producao);
    }
    if (Object.prototype.hasOwnProperty.call(visibility, 'visivel_assistencia_tecnica')) {
      idx += 1;
      fields.push(`visivel_assistencia_tecnica = $${idx}`);
      values.push(visibility.visivel_assistencia_tecnica);
    }

    const sql = `UPDATE public.produtos_omie_anexos
                    SET ${fields.join(', ')}
                  WHERE codigo_produto = $1
                    AND id = $2
                  RETURNING id, codigo_produto, nome_anexo, descricao_anexo, url_anexo, tamanho_bytes,
                            content_type, visivel_producao, visivel_assistencia_tecnica, ativo, criado_em`;
    const upd = await dbQuery(sql, values);

    if (!upd.rows.length) {
      return res.status(404).json({ error: 'Anexo não encontrado.' });
    }

    // Auditoria opcional
    try {
      const usuarioAudit = (req.session?.user?.fullName || req.session?.user?.username || String(req.headers['x-user'] || '').trim() || 'sistema');
      let codigoTexto = null;
      try {
        const r = await dbQuery(`SELECT codigo FROM public.produtos_omie WHERE codigo_produto = $1 LIMIT 1`, [codigoNum]);
        codigoTexto = r.rows?.[0]?.codigo || null;
      } catch {}
      await registrarModificacao({
        codigo_omie: codigoTexto || String(codigoNum),
        codigo_texto: codigoTexto || null,
        codigo_produto: codigoNum,
        tipo_acao: 'PRODUTO_ANEXO_VISIBILIDADE',
        usuario: usuarioAudit,
        origem: 'API',
        detalhes: `id=${id}; visivel_producao=${visibility.visivel_producao ?? 'unchanged'}; visivel_assistencia_tecnica=${visibility.visivel_assistencia_tecnica ?? 'unchanged'}`
      });
    } catch (e) {
      console.warn('[auditoria][produtos/anexos:visibilidade] falhou ao registrar:', e?.message || e);
    }

    res.json({ ok: true, codigo: codigoNum, anexo: upd.rows[0] });
  } catch (err) {
    console.error('[visibilidade anexo produto]', err);
    res.status(err.status || 500).json({ error: 'Falha ao atualizar visibilidade do anexo', detail: String(err.message || err) });
  }
});

module.exports = router;
