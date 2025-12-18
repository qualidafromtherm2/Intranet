// routes/produtosFotos.js
const express = require('express');
const router  = express.Router();

const { dbQuery, dbGetClient } = require('../src/db'); // usa DATABASE_URL com SSL quando em produção
const { registrarModificacao } = require('../utils/auditoria');

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
  const { rows } = await dbQuery(sql, [raw]);
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
    const r = await dbQuery('select 1 as ok');
    res.json({ db: 'up', row: r.rows[0] });
  } catch (e) {
    res.status(500).json({ db: 'down', error: String(e.message || e) });
  }
});

// -----------------------------------------------------------------------------
// POST /api/produtos/:codigo/fotos  (campo form: "foto")
router.post('/:codigo/fotos', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie a foto no campo "foto"' });

    const codigoNum = await resolveCodigoProduto(req.params.codigo);
    // mantém histórico na mesma posição: desativa somente a posição alterada
    const pos = Number(req.query.pos ?? 0);
    const nomeFoto      = String(req.body?.nome_foto ?? '').trim();
    const descricaoFoto = String(req.body?.descricao_foto ?? '').trim();

    if (!nomeFoto || !descricaoFoto) {
      return res.status(400).json({ error: 'Informe nome_foto e descricao_foto.' });
    }

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

    // Desativa o slot atual e insere um novo registro ativo (histórico preservado)
    await dbQuery(
      `UPDATE public.produtos_omie_imagens
          SET ativo = false
        WHERE codigo_produto = $1 AND pos = $2`,
      [codigoNum, pos]
    );

    await dbQuery(
      `INSERT INTO public.produtos_omie_imagens (codigo_produto, pos, url_imagem, path_key, nome_foto, descricao_foto, ativo, visivel_producao, visivel_assistencia_tecnica)
       VALUES ($1, $2, $3, $4, $5, $6, true, true, true)`,
      [codigoNum, pos, publicUrl, pathKey, nomeFoto, descricaoFoto]
    );

    // Auditoria: foto adicionada/atualizada
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
        tipo_acao: 'PRODUTO_FOTO_ADD',
        usuario: usuarioAudit,
        origem: 'API',
        detalhes: `pos=${pos}; nome=${nomeFoto}; path=${pathKey}`
      });
    } catch (e) {
      console.warn('[auditoria][produtos/fotos:add] falhou ao registrar:', e?.message || e);
    }

    res.json({
      ok: true,
      codigo: codigoNum,
      pos,
      pathKey,
      url: publicUrl,
      nome: nomeFoto,
      descricao: descricaoFoto
    });
  } catch (err) {
    console.error('[upload foto]', err);
    res.status(err.status || 500).json({ error: 'Falha no upload', detail: String(err.message || err) });
  }
});

// -----------------------------------------------------------------------------
// DELETE /api/produtos/:codigo/fotos/:pos?  (pos padrão = 0) -> apenas inativa
router.delete('/:codigo/fotos/:pos?', async (req, res) => {
  try {
    const codigoNum = await resolveCodigoProduto(req.params.codigo);
    const pos       = Number(req.params.pos ?? 0);

    // Inativa a imagem (não remove storage nem linha para manter histórico)
    const r = await dbQuery(
      `UPDATE public.produtos_omie_imagens
          SET ativo = false
        WHERE codigo_produto = $1 AND pos = $2
        RETURNING path_key`,
      [codigoNum, pos]
    );
    const pathKey = r.rows?.[0]?.path_key || null;

    // Auditoria: foto removida
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
        tipo_acao: 'PRODUTO_FOTO_INATIVA',
        usuario: usuarioAudit,
        origem: 'API',
        detalhes: `pos=${pos}; path=${pathKey || ''}`
      });
    } catch (e) {
      console.warn('[auditoria][produtos/fotos:del] falhou ao registrar:', e?.message || e);
    }

    res.json({ ok: true, codigo: codigoNum, pos, inativada: true });
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
    const includeAll = String(req.query.all || '').trim() === '1';

    const q = await dbQuery(
      `SELECT id, pos, url_imagem, path_key, nome_foto, descricao_foto, ativo,
              visivel_producao, visivel_assistencia_tecnica
         FROM public.produtos_omie_imagens
        WHERE codigo_produto = $1
          ${includeAll ? '' : 'AND ativo IS TRUE'}
        ORDER BY pos, id`,
      [codigoNum]
    );

    res.json({ ok: true, codigo: codigoNum, fotos: q.rows });
 } catch (err) {
   console.error('[listar fotos]', err);
   // Evita 500 na UI: devolve vazio
   res.status(200).json({ ok: true, codigo: null, fotos: [] });
 }
});

// PATCH /api/produtos/:codigo/fotos/:pos/ativar  body { id }
router.patch('/:codigo/fotos/:pos/ativar', async (req, res) => {
  try {
    const codigoNum = await resolveCodigoProduto(req.params.codigo);
    const pos = Number(req.params.pos ?? 0);
    const id = Number(req.body?.id);
    const client = await dbGetClient();
    try {
      await client.query('BEGIN');

      await client.query(
        `update public.produtos_omie_imagens
            set ativo = false
          where codigo_produto = $1 and pos = $2`,
        [codigoNum, pos]
      );

      const { rowCount } = await client.query(
        `update public.produtos_omie_imagens
            set ativo = true
          where codigo_produto = $1 and pos = $2 ${Number.isFinite(id) ? 'and id = $3' : ''}`,
        Number.isFinite(id) ? [codigoNum, pos, id] : [codigoNum, pos]
      );

      await client.query('COMMIT');

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Imagem não encontrada para ativar.' });
      }

      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[ativar foto]', err);
    res.status(err.status || 500).json({ error: 'Falha ao ativar', detail: String(err.message || err) });
  }
});

// PATCH /api/produtos/:codigo/fotos/:pos/inativar body { id }
router.patch('/:codigo/fotos/:pos/inativar', async (req, res) => {
  try {
    const codigoNum = await resolveCodigoProduto(req.params.codigo);
    const pos = Number(req.params.pos ?? 0);
    const id = Number(req.body?.id);
    const params = Number.isFinite(id) ? [codigoNum, pos, id] : [codigoNum, pos];
    const { rowCount } = await dbQuery(
      `update public.produtos_omie_imagens
          set ativo = false
        where codigo_produto = $1 and pos = $2 ${Number.isFinite(id) ? 'and id = $3' : ''}`,
      params
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Imagem não encontrada para inativar.' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[inativar foto]', err);
    res.status(err.status || 500).json({ error: 'Falha ao inativar', detail: String(err.message || err) });
  }
});

// PATCH /api/produtos/:codigo/fotos/:id/visibilidade
router.patch('/:codigo/fotos/:id/visibilidade', async (req, res) => {
  try {
    const codigoNum = await resolveCodigoProduto(req.params.codigo);
    const id = Number(req.params.id);
    const { visivel_producao, visivel_assistencia_tecnica } = req.body || {};

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Informe id da imagem.' });
    }

    const vp = typeof visivel_producao === 'boolean' ? visivel_producao : null;
    const vat = typeof visivel_assistencia_tecnica === 'boolean' ? visivel_assistencia_tecnica : null;
    if (vp === null && vat === null) {
      return res.status(400).json({ error: 'Nenhum valor para atualizar.' });
    }

    const sets = [];
    const params = [codigoNum, id];
    if (vp !== null) { sets.push(`visivel_producao = $${params.length + 1}`); params.push(vp); }
    if (vat !== null) { sets.push(`visivel_assistencia_tecnica = $${params.length + 1}`); params.push(vat); }

    const sql = `UPDATE public.produtos_omie_imagens
                   SET ${sets.join(', ')}
                 WHERE codigo_produto = $1 AND id = $2
                 RETURNING id`;

    const { rowCount } = await dbQuery(sql, params);
    if (!rowCount) {
      return res.status(404).json({ error: 'Imagem não encontrada.' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[visibilidade foto]', err);
    res.status(err.status || 500).json({ error: 'Falha ao atualizar visibilidade', detail: String(err.message || err) });
  }
});

module.exports = router;
