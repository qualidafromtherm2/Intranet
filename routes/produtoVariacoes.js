/**
 * Variações de produto (ex.: tamanho 41/42 em botina)
 * Montado em /api/produtos
 */
const express = require('express');
const router = express.Router();
const { dbQuery } = require('../src/db');

let _ensurePromise = null;

async function ensureVariacaoSchema() {
  if (_ensurePromise) return _ensurePromise;
  _ensurePromise = (async () => {
    await dbQuery('CREATE SCHEMA IF NOT EXISTS produto');
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS produto.variacao_tipo (
        id          SERIAL PRIMARY KEY,
        nome        VARCHAR(80) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await dbQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_variacao_tipo_nome_ci
        ON produto.variacao_tipo (LOWER(TRIM(nome)))`);
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS produto.produto_variacao (
        id          SERIAL PRIMARY KEY,
        codigo      VARCHAR(120) NOT NULL,
        tipo_id     INTEGER NOT NULL REFERENCES produto.variacao_tipo(id) ON DELETE RESTRICT,
        valor       VARCHAR(120) NOT NULL,
        ativo       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (codigo, tipo_id, valor)
      )`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_produto_variacao_codigo ON produto.produto_variacao (codigo)`);
    await dbQuery(
      `ALTER TABLE produto.produto_variacao
         ADD COLUMN IF NOT EXISTS estoque_qtd NUMERIC(18,4) NOT NULL DEFAULT 0`
    );
  })().catch((err) => {
    _ensurePromise = null;
    throw err;
  });
  return _ensurePromise;
}

router.use(async (_req, _res, next) => {
  try {
    await ensureVariacaoSchema();
    next();
  } catch (err) {
    console.error('[produto/variacoes] ensureSchema:', err?.message || err);
    next(err);
  }
});

router.get('/variacoes/tipos', async (_req, res) => {
  try {
    const { rows } = await dbQuery(
      `SELECT id, nome, created_at
         FROM produto.variacao_tipo
        ORDER BY nome ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /variacoes/tipos]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar tipos de variação' });
  }
});

router.post('/variacoes/tipos', async (req, res) => {
  try {
    const nome = String(req.body?.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome do tipo é obrigatório' });
    const found = await dbQuery(
      `SELECT id, nome FROM produto.variacao_tipo WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1)) LIMIT 1`,
      [nome]
    );
    if (found.rows[0]) return res.json(found.rows[0]);
    const { rows } = await dbQuery(
      `INSERT INTO produto.variacao_tipo (nome) VALUES ($1) RETURNING id, nome, created_at`,
      [nome]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /variacoes/tipos]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao criar tipo de variação' });
  }
});

router.get('/variacoes/por-codigos', async (req, res) => {
  try {
    const raw = String(req.query.codigos || '').trim();
    if (!raw) return res.json({});
    const codigos = [...new Set(raw.split(',').map((c) => c.trim()).filter(Boolean))].slice(0, 200);
    if (!codigos.length) return res.json({});
    const { rows } = await dbQuery(
      `SELECT
         v.id,
         v.codigo,
         v.valor,
         v.tipo_id,
         v.estoque_qtd,
         t.nome AS tipo_nome
       FROM produto.produto_variacao v
       JOIN produto.variacao_tipo t ON t.id = v.tipo_id
       WHERE v.codigo = ANY($1::text[])
         AND v.ativo IS DISTINCT FROM false
       ORDER BY t.nome, v.valor`,
      [codigos]
    );
    const map = {};
    for (const r of rows) {
      if (!map[r.codigo]) map[r.codigo] = [];
      let tipo = map[r.codigo].find((t) => t.tipo_id === r.tipo_id);
      if (!tipo) {
        tipo = { tipo_id: r.tipo_id, tipo_nome: r.tipo_nome, valores: [] };
        map[r.codigo].push(tipo);
      }
      tipo.valores.push({
        id: r.id,
        valor: r.valor,
        estoque_qtd: Number(r.estoque_qtd) || 0,
      });
    }
    return res.json(map);
  } catch (err) {
    console.error('[GET /variacoes/por-codigos]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao buscar variações' });
  }
});

router.get('/:codigo/variacoes', async (req, res) => {
  const codigo = String(req.params.codigo || '').trim();
  if (!codigo) return res.status(400).json({ error: 'Código obrigatório' });
  try {
    const tipos = await dbQuery(`SELECT id, nome FROM produto.variacao_tipo ORDER BY nome`);
    const { rows } = await dbQuery(
      `SELECT
         v.id,
         v.codigo,
         v.valor,
         v.tipo_id,
         v.ativo,
         v.estoque_qtd,
         t.nome AS tipo_nome
       FROM produto.produto_variacao v
       JOIN produto.variacao_tipo t ON t.id = v.tipo_id
       WHERE v.codigo = $1
         AND v.ativo IS DISTINCT FROM false
       ORDER BY t.nome, v.valor`,
      [codigo]
    );
    const agrupado = [];
    for (const r of rows) {
      let g = agrupado.find((x) => x.tipo_id === r.tipo_id);
      if (!g) {
        g = { tipo_id: r.tipo_id, tipo_nome: r.tipo_nome, valores: [] };
        agrupado.push(g);
      }
      g.valores.push({
        id: r.id,
        valor: r.valor,
        estoque_qtd: Number(r.estoque_qtd) || 0,
      });
    }
    return res.json({ codigo, tipos: tipos.rows, variacoes: agrupado });
  } catch (err) {
    console.error('[GET /:codigo/variacoes]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar variações do produto' });
  }
});

router.post('/:codigo/variacoes', async (req, res) => {
  const codigo = String(req.params.codigo || '').trim();
  if (!codigo) return res.status(400).json({ error: 'Código obrigatório' });
  try {
    let tipoId = Number(req.body?.tipo_id) || null;
    const tipoNome = String(req.body?.tipo_nome || '').trim();
    const valoresRaw = Array.isArray(req.body?.valores)
      ? req.body.valores
      : String(req.body?.valor || '')
          .split(/[,;\n]+/)
          .map((v) => v.trim())
          .filter(Boolean);

    if (!valoresRaw.length) {
      return res.status(400).json({ error: 'Informe ao menos uma variação' });
    }

    if (!tipoId && tipoNome) {
      const found = await dbQuery(
        `SELECT id FROM produto.variacao_tipo WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1)) LIMIT 1`,
        [tipoNome]
      );
      if (found.rows[0]) {
        tipoId = found.rows[0].id;
      } else {
        const ins = await dbQuery(
          `INSERT INTO produto.variacao_tipo (nome) VALUES ($1) RETURNING id`,
          [tipoNome]
        );
        tipoId = ins.rows[0].id;
      }
    }
    if (!tipoId) return res.status(400).json({ error: 'Tipo de variação obrigatório' });

    const inserted = [];
    for (const valor of valoresRaw) {
      const { rows } = await dbQuery(
        `INSERT INTO produto.produto_variacao (codigo, tipo_id, valor)
         VALUES ($1, $2, $3)
         ON CONFLICT (codigo, tipo_id, valor)
         DO UPDATE SET ativo = TRUE
         RETURNING id, codigo, tipo_id, valor, ativo, created_at`,
        [codigo, tipoId, valor]
      );
      if (rows[0]) inserted.push(rows[0]);
    }
    return res.status(201).json({ ok: true, itens: inserted });
  } catch (err) {
    console.error('[POST /:codigo/variacoes]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao salvar variação' });
  }
});

router.delete('/variacoes/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rowCount } = await dbQuery(
      `DELETE FROM produto.produto_variacao WHERE id = $1`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Variação não encontrada' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /variacoes/:id]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao excluir variação' });
  }
});

/** Ajuste fino de estoque da variação (controle interno RH) */
router.patch('/variacoes/:id/estoque', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const hasAbs = req.body?.estoque_qtd != null && req.body?.estoque_qtd !== '';
    const hasDelta = req.body?.delta != null && req.body?.delta !== '';
    if (!hasAbs && !hasDelta) {
      return res.status(400).json({ error: 'Informe estoque_qtd ou delta' });
    }

    let rows;
    if (hasAbs) {
      const estoque_qtd = Number(req.body.estoque_qtd);
      if (!Number.isFinite(estoque_qtd) || estoque_qtd < 0) {
        return res.status(400).json({ error: 'estoque_qtd inválido' });
      }
      ({ rows } = await dbQuery(
        `UPDATE produto.produto_variacao
            SET estoque_qtd = $1
          WHERE id = $2
          RETURNING id, codigo, tipo_id, valor, ativo, estoque_qtd, created_at`,
        [estoque_qtd, id]
      ));
    } else {
      const delta = Number(req.body.delta);
      if (!Number.isFinite(delta) || delta === 0) {
        return res.status(400).json({ error: 'delta inválido' });
      }
      ({ rows } = await dbQuery(
        `UPDATE produto.produto_variacao
            SET estoque_qtd = GREATEST(0, COALESCE(estoque_qtd, 0) + $1)
          WHERE id = $2
          RETURNING id, codigo, tipo_id, valor, ativo, estoque_qtd, created_at`,
        [delta, id]
      ));
    }

    if (!rows[0]) return res.status(404).json({ error: 'Variação não encontrada' });
    return res.json({
      ok: true,
      ...rows[0],
      estoque_qtd: Number(rows[0].estoque_qtd) || 0,
    });
  } catch (err) {
    console.error('[PATCH /variacoes/:id/estoque]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao ajustar estoque da variação' });
  }
});

module.exports = router;
module.exports.ensureVariacaoSchema = ensureVariacaoSchema;
