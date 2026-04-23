// routes/primeiraPcOk.js
// Registros de 1ª peça OK — schema qualidade.pri_pc_ok
'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime    = require('mime-types');

const { dbQuery } = require('../src/db');
const supabase = require('../utils/supabase');

const BUCKET         = process.env.SUPABASE_BUCKET || 'produtos';
const STORAGE_PREFIX = 'primeira_pc_ok';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function requireAuth(req, res, next) {
  if (!req.session?.user?.username) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  next();
}

function sanitizePathPart(str) {
  return String(str || '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'sem_nome';
}

// POST /api/primeira-pc-ok
// Body (multipart/form-data):
//   codigo_produto  - obrigatório
//   o_que_verificar - obrigatório
//   especificacao   - opcional
//   arquivo         - opcional (file)
router.post('/', requireAuth, upload.single('arquivo'), async (req, res) => {
  try {
    const usuario       = req.session.user.username;
    const codigoProduto = String(req.body?.codigo_produto || '').trim();
    const oQueVerificar = String(req.body?.o_que_verificar || '').trim();
    const especificacao = String(req.body?.especificacao || '').trim();

    if (!codigoProduto) {
      return res.status(400).json({ error: 'codigo_produto é obrigatório.' });
    }
    if (!oQueVerificar) {
      return res.status(400).json({ error: 'o_que_verificar é obrigatório.' });
    }

    let arquivoUrl     = null;
    let arquivoPathKey = null;

    if (req.file) {
      const mimeExt     = mime.extension(req.file.mimetype) || '';
      const originalExt = (req.file.originalname || '').split('.').pop();
      const ext         = (mimeExt || originalExt || 'bin')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase() || 'bin';

      const safeCode     = sanitizePathPart(codigoProduto);
      const safeOriginal = sanitizePathPart(req.file.originalname || `arquivo.${ext}`);
      const pathKey      = `${STORAGE_PREFIX}/${safeCode}/${uuidv4()}-${safeOriginal}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(pathKey, req.file.buffer, {
          contentType: req.file.mimetype || 'application/octet-stream',
          upsert: false,
        });

      if (upErr) {
        console.error('[pri-pc-ok] Erro upload Supabase:', upErr);
        return res.status(500).json({ error: 'Falha ao enviar arquivo: ' + upErr.message });
      }

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathKey);
      arquivoUrl     = data.publicUrl;
      arquivoPathKey = pathKey;
    }

    const { rows } = await dbQuery(
      `INSERT INTO qualidade.pri_pc_ok
         (codigo_produto, usuario, o_que_verificar, especificacao, arquivo_url, arquivo_path_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [codigoProduto, usuario, oQueVerificar, especificacao || null, arquivoUrl, arquivoPathKey]
    );

    res.json({ ok: true, registro: rows[0] });
  } catch (err) {
    console.error('[pri-pc-ok] Erro:', err);
    res.status(500).json({ error: 'Falha ao salvar registro.' });
  }
});

// GET /api/primeira-pc-ok?codigo_produto=XXX
router.get('/', requireAuth, async (req, res) => {
  try {
    const codigoProduto = String(req.query?.codigo_produto || '').trim();
    if (!codigoProduto) {
      return res.status(400).json({ error: 'codigo_produto é obrigatório.' });
    }

    const { rows } = await dbQuery(
      `SELECT * FROM qualidade.pri_pc_ok
        WHERE codigo_produto = $1
        ORDER BY criado_em DESC`,
      [codigoProduto]
    );

    res.json({ ok: true, registros: rows });
  } catch (err) {
    console.error('[pri-pc-ok] Erro ao listar:', err);
    res.status(500).json({ error: 'Falha ao listar registros.' });
  }
});

// GET /api/primeira-pc-ok/buscar-por-codigo?codigo=09.MC.N.10106
// Busca pelo código texto do produto, retorna itens de pri_pc_ok
router.get('/buscar-por-codigo', requireAuth, async (req, res) => {
  try {
    const codigoTexto = String(req.query?.codigo || '').trim();
    if (!codigoTexto) {
      return res.status(400).json({ error: 'codigo é obrigatório.' });
    }

    // Localiza o produto pelo código texto para obter o codigo_produto (ID numérico Omie)
    const { rows: prodRows } = await dbQuery(
      `SELECT codigo_produto, descricao FROM public.produtos_omie WHERE codigo = $1 LIMIT 1`,
      [codigoTexto]
    );
    if (!prodRows.length) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }
    const { codigo_produto, descricao } = prodRows[0];

    const { rows } = await dbQuery(
      `SELECT * FROM qualidade.pri_pc_ok
        WHERE codigo_produto = $1
        ORDER BY criado_em ASC`,
      [String(codigo_produto)]
    );

    res.json({ ok: true, codigo_produto: String(codigo_produto), descricao, itens: rows });
  } catch (err) {
    console.error('[pri-pc-ok] Erro buscar-por-codigo:', err);
    res.status(500).json({ error: 'Falha ao buscar produto.' });
  }
});

// POST /api/primeira-pc-ok/registrar-verificacao
// Body JSON: { codigo_produto, itens: [{id, o_que_verificar, resultado}],
//              tem_nok, user_liberacao?, senha_liberacao?, resolucao? }
router.post('/registrar-verificacao', requireAuth, express.json(), async (req, res) => {
  try {
    const usuario       = req.session.user.username;
    const codigoProduto = String(req.body?.codigo_produto || '').trim();
    const numeroOp      = String(req.body?.numero_op || '').trim();
    const itens         = req.body?.itens;
    const temNok        = !!req.body?.tem_nok;
    const userLiberacao = String(req.body?.user_liberacao || '').trim() || null;
    const senhaLib      = String(req.body?.senha_liberacao || '').trim();
    const resolucao     = String(req.body?.resolucao || '').trim() || null;

    if (!codigoProduto) {
      return res.status(400).json({ error: 'codigo_produto é obrigatório.' });
    }
    if (!numeroOp) {
      return res.status(400).json({ error: 'numero_op é obrigatório.' });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: 'itens é obrigatório e não pode estar vazio.' });
    }

    // Validação de itens: cada item deve ter resultado 'ok' ou 'nok'
    const resultadosValidos = itens.every(i => i.resultado === 'ok' || i.resultado === 'nok');
    if (!resultadosValidos) {
      return res.status(400).json({ error: 'Todos os itens devem ter resultado "ok" ou "nok".' });
    }

    if (temNok) {
      if (!userLiberacao) {
        return res.status(400).json({ error: 'Usuário de liberação é obrigatório quando há itens NOK.' });
      }
      if (!senhaLib) {
        return res.status(400).json({ error: 'Senha de liberação é obrigatória quando há itens NOK.' });
      }
      if (!resolucao) {
        return res.status(400).json({ error: 'Resolução é obrigatória quando há itens NOK.' });
      }

      // Verifica senha do usuário de liberação via pgcrypto
      const { rows: authRows } = await dbQuery(
        `SELECT (password_hash = crypt($2, password_hash)) AS ok
           FROM public.auth_user
          WHERE username = $1 AND is_active = TRUE
          LIMIT 1`,
        [userLiberacao, senhaLib]
      );
      if (!authRows.length || !authRows[0].ok) {
        return res.status(401).json({ error: 'Usuário ou senha de liberação inválidos.' });
      }
    }

    const { rows } = await dbQuery(
      `INSERT INTO qualidade."Reg_PC_OK"
         (codigo_produto, numero_op, usuario, itens, tem_nok, user_liberacao, resolucao)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       RETURNING *`,
      [codigoProduto, numeroOp, usuario, JSON.stringify(itens), temNok, userLiberacao, resolucao]
    );

    res.json({ ok: true, registro: rows[0] });
  } catch (err) {
    console.error('[pri-pc-ok] Erro registrar-verificacao:', err);
    res.status(500).json({ error: 'Falha ao registrar verificação.' });
  }
});

module.exports = router;
