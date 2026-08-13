/**
 * RH — EPI: catálogo, solicitação e controle de entregas
 * Base: RELAÇÃO DE EPI-FROMTHERM + FT-M00-FCEPI
 */
const express = require('express');
const router = express.Router();
const { dbQuery } = require('../src/db');
const { sessionEhAdmin, sessionEhRh } = require('../utils/navPermissions');
const {
  EPI_RH_LOCAL_CODIGO,
  EPI_RH_LOCAL_NOME,
  incluirAjusteEpiRh,
} = require('../utils/epiEstoqueRh');
const { ensureVariacaoSchema } = require('./produtoVariacoes');

/* ---------- Seed (planilha RELAÇÃO DE EPI) ---------- */

const EPI_SEED_CATALOGO = [
  ['Óculos de proteção /segurança', '10346'],
  ['Óculos de proteção ampla visão', '10346'],
  ['Calçado de segurança', '43698'],
  ['Calçado de segurança', 'Não Informado'],
  ['Avental impermeável', 'Não Informado'],
  ['Luva de látex', 'Não Informado'],
  ['Cadeira ou banco de apoio (repouso)', 'Não se aplica'],
  ['Bota ou calçado de segurança Ergonômico (Conforto)', 'Não se aplica'],
  ['Luvas de Segurança', 'Não Informado'],
  ['Protetor auricular tipo plug', '35981'],
  ['Protetor auricular tipo concha', 'Não se aplica'],
  ['Avental de raspa', '31096'],
  ['Luva de couro/raspa', '26381'],
  ['Máscara SEMI-facial - Filtro PFF3', 'Não se aplica'],
  ['Máscara facial para solda', 'Não se aplica'],
  ['Perneira de raspa', 'Não se aplica'],
  ['Luva Isolante de Eletricidade', 'Não se aplica'],
  ['Capacete Segurança Classe B (Proteção elétrica - Choque)', 'Não se aplica'],
  ['Calça Anti Chama para eletricista', 'Não se aplica'],
  ['Jaleco Anti Chama para eletricista', 'Não se aplica'],
  ['Capacete com Jugular e catraca', 'Não se aplica'],
  ['Cinto de segurança tipo paraquedista', 'Não se aplica'],
  ['Talabarte em corda mosquetão', 'Não se aplica'],
  ['Luva de algodão anti-aderente', 'Não se aplica'],
];

const EPI_SEED_CARGO = {
  'AUXILIAR DE EXPEDIÇÃO': [
    ['Óculos de proteção /segurança', '10346'],
    ['Calçado de segurança', '43698'],
  ],
  LIMPEZA: [
    ['Avental impermeável', 'Não Informado'],
    ['Calçado de segurança', 'Não Informado'],
    ['Luva de látex', 'Não Informado'],
    ['Cadeira ou banco de apoio (repouso)', 'Não se aplica'],
    ['Bota ou calçado de segurança Ergonômico (Conforto)', 'Não se aplica'],
    ['Luvas de Segurança', 'Não Informado'],
    ['Óculos de proteção /segurança', '10346'],
  ],
  'AUXILIAR DE PRODUÇÃO I/II': [
    ['Protetor auricular tipo plug', '35981'],
    ['Óculos de proteção /segurança', '10346'],
    ['Avental de raspa', '31096'],
    ['Calçado de segurança', '43698'],
    ['Luva de couro/raspa', '26381'],
  ],
  'AUXILIAR DE PRODUÇÃO III/IV': [
    ['Protetor auricular tipo plug', '35981'],
    ['Óculos de proteção /segurança', '10346'],
    ['Avental de raspa', '31096'],
    ['Calçado de segurança', '43698'],
    ['Luva de couro/raspa', '26381'],
    ['Máscara SEMI-facial - Filtro PFF3', 'Não se aplica'],
  ],
  'AUXILIAR DE REFRIGERAÇÃO': [
    ['Protetor auricular tipo plug', '35981'],
    ['Avental de raspa', '31096'],
    ['Óculos de proteção /segurança', '10346'],
    ['Calçado de segurança', '43698'],
    ['Luva de couro/raspa', '26381'],
  ],
  'AUXILIAR TECNICO DE REFRIGERAÇÃO I/II': [
    ['Protetor auricular tipo plug', '35981'],
    ['Óculos de proteção /segurança', '10346'],
    ['Máscara SEMI-facial - Filtro PFF3', 'Não se aplica'],
    ['Luva de couro/raspa', '26381'],
    ['Calçado de segurança', '43698'],
    ['Avental de raspa', '31096'],
  ],
  ELETROMECANICO: [
    ['Máscara facial para solda', 'Não se aplica'],
    ['Perneira de raspa', 'Não se aplica'],
    ['Avental de raspa', '31096'],
    ['Calçado de segurança', '43698'],
    ['Luva de couro/raspa', '26381'],
    ['Protetor auricular tipo plug', '35981'],
    ['Óculos de proteção ampla visão', '10346'],
    ['Máscara SEMI-facial - Filtro PFF3', 'Não se aplica'],
    ['Luva Isolante de Eletricidade', 'Não se aplica'],
    ['Capacete Segurança Classe B (Proteção elétrica - Choque)', 'Não se aplica'],
    ['Calça Anti Chama para eletricista', 'Não se aplica'],
    ['Jaleco Anti Chama para eletricista', 'Não se aplica'],
  ],
  'TECNICO EM REFRIGERAÇÃO': [
    ['Protetor auricular tipo concha', 'Não se aplica'],
    ['Protetor auricular tipo plug', '35981'],
    ['Capacete com Jugular e catraca', 'Não se aplica'],
    ['Cinto de segurança tipo paraquedista', 'Não se aplica'],
    ['Talabarte em corda mosquetão', 'Não se aplica'],
    ['Luva de algodão anti-aderente', 'Não se aplica'],
    ['Calçado de segurança', '43698'],
    ['Avental de raspa', '31096'],
    ['Óculos de proteção ampla visão', '10346'],
    ['Máscara SEMI-facial - Filtro PFF3', 'Não se aplica'],
    ['Luva de couro/raspa', '26381'],
  ],
};

let _ensurePromise = null;

async function ensureEpiSchema() {
  if (_ensurePromise) return _ensurePromise;
  _ensurePromise = (async () => {
    await ensureVariacaoSchema().catch((err) => {
      console.warn('[rh/epi] ensureVariacaoSchema:', err?.message || err);
    });
    await dbQuery('CREATE SCHEMA IF NOT EXISTS rh');

    await dbQuery(`
      CREATE TABLE IF NOT EXISTS rh.epi_catalogo (
        id            SERIAL PRIMARY KEY,
        descricao     VARCHAR(255) NOT NULL,
        ca            VARCHAR(50),
        ativo         BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    await dbQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_epi_catalogo_desc_ca
        ON rh.epi_catalogo (LOWER(descricao), COALESCE(ca, ''))`);

    await dbQuery(`
      CREATE TABLE IF NOT EXISTS rh.epi_cargo (
        id               SERIAL PRIMARY KEY,
        cargo_nome       VARCHAR(255) NOT NULL,
        epi_catalogo_id  INTEGER NOT NULL REFERENCES rh.epi_catalogo(id) ON DELETE CASCADE,
        ativo            BOOLEAN NOT NULL DEFAULT TRUE,
        ordem            INTEGER NOT NULL DEFAULT 0,
        UNIQUE (cargo_nome, epi_catalogo_id)
      )`);

    await dbQuery(`ALTER TABLE rh.epi_cargo ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE`);
    await dbQuery(`ALTER TABLE rh.epi_cargo ADD COLUMN IF NOT EXISTS ordem INTEGER NOT NULL DEFAULT 0`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_epi_cargo_nome ON rh.epi_cargo (LOWER(cargo_nome))`);

    await dbQuery(`
      CREATE TABLE IF NOT EXISTS rh.epi_solicitacao (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
        cargo_funcao    VARCHAR(255),
        status          VARCHAR(30) NOT NULL DEFAULT 'aberta',
        observacao      TEXT,
        solicitado_por  VARCHAR(100),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_epi_solicitacao_user ON rh.epi_solicitacao(user_id)`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_epi_solicitacao_status ON rh.epi_solicitacao(status)`);

    await dbQuery(`ALTER TABLE rh.epi_solicitacao ADD COLUMN IF NOT EXISTS assinatura_url TEXT`);
    await dbQuery(`ALTER TABLE rh.epi_solicitacao ADD COLUMN IF NOT EXISTS assinatura_path TEXT`);
    await dbQuery(`ALTER TABLE rh.epi_solicitacao ADD COLUMN IF NOT EXISTS assinado_em TIMESTAMPTZ`);
    await dbQuery(`ALTER TABLE rh.epi_solicitacao ADD COLUMN IF NOT EXISTS estoque_baixado_em TIMESTAMPTZ`);
    await dbQuery(`ALTER TABLE rh.epi_solicitacao ADD COLUMN IF NOT EXISTS estoque_baixa_erro TEXT`);

    // Produtos do cadastro vinculados a cada tipo de EPI do catálogo
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS rh.epi_catalogo_produto (
        id               SERIAL PRIMARY KEY,
        epi_catalogo_id  INTEGER NOT NULL REFERENCES rh.epi_catalogo(id) ON DELETE CASCADE,
        codigo           VARCHAR(120) NOT NULL,
        codigo_produto   VARCHAR(120),
        descricao        VARCHAR(500),
        url_imagem       TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (epi_catalogo_id, codigo)
      )`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_epi_catalogo_produto_cat ON rh.epi_catalogo_produto(epi_catalogo_id)`);

    await dbQuery(`
      CREATE TABLE IF NOT EXISTS rh.epi_solicitacao_item (
        id               SERIAL PRIMARY KEY,
        solicitacao_id   INTEGER NOT NULL REFERENCES rh.epi_solicitacao(id) ON DELETE CASCADE,
        epi_catalogo_id  INTEGER REFERENCES rh.epi_catalogo(id) ON DELETE SET NULL,
        descricao        VARCHAR(255) NOT NULL,
        ca               VARCHAR(50),
        quantidade       INTEGER NOT NULL DEFAULT 1,
        tamanho          VARCHAR(30),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_epi_solicitacao_item_sol ON rh.epi_solicitacao_item(solicitacao_id)`);
    await dbQuery(`ALTER TABLE rh.epi_solicitacao_item ADD COLUMN IF NOT EXISTS codigo VARCHAR(120)`);
    await dbQuery(`ALTER TABLE rh.epi_solicitacao_item ADD COLUMN IF NOT EXISTS produto_variacao_id INTEGER`);
    await dbQuery(
      `ALTER TABLE rh.epi_solicitacao_item ALTER COLUMN tamanho TYPE VARCHAR(255)`
    ).catch(() => {});

    // Tabela base de entrega (pode já existir)
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS rh.epi_entrega (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
        item          VARCHAR(100) NOT NULL,
        tamanho       VARCHAR(20),
        data_entrega  DATE NOT NULL DEFAULT CURRENT_DATE,
        observacao    TEXT,
        registrado_por VARCHAR(100),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    await dbQuery(`ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS ca VARCHAR(50)`);
    await dbQuery(`ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS quantidade INTEGER DEFAULT 1`);
    await dbQuery(`ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS data_devolucao DATE`);
    await dbQuery(`ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS epi_catalogo_id INTEGER`);
    await dbQuery(`ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS solicitacao_id INTEGER`);
    await dbQuery(`ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS codigo_item VARCHAR(50)`);
    await dbQuery(`ALTER TABLE rh.epi_entrega ALTER COLUMN item TYPE VARCHAR(255)`).catch(() => {});

    // Seed / sincroniza relação fiel à planilha (ordem por cargo)
    const { rows: cntRows } = await dbQuery('SELECT COUNT(*)::int AS n FROM rh.epi_catalogo');
    const idByKey = new Map();
    for (const [descricao, ca] of EPI_SEED_CATALOGO) {
      const found = await dbQuery(
        `SELECT id FROM rh.epi_catalogo
          WHERE LOWER(descricao) = LOWER($1) AND COALESCE(ca, '') = COALESCE($2, '')
          LIMIT 1`,
        [descricao, ca]
      );
      let epiId = found.rows[0]?.id;
      if (!epiId) {
        const ins = await dbQuery(
          `INSERT INTO rh.epi_catalogo (descricao, ca) VALUES ($1, $2) RETURNING id`,
          [descricao, ca]
        );
        epiId = ins.rows[0].id;
      }
      idByKey.set(`${descricao}||${ca}`, epiId);
    }

    let ordem = 0;
    for (const [cargo, itens] of Object.entries(EPI_SEED_CARGO)) {
      for (const [descricao, ca] of itens) {
        const epiId = idByKey.get(`${descricao}||${ca}`);
        if (!epiId) continue;
        ordem += 1;
        await dbQuery(
          `INSERT INTO rh.epi_cargo (cargo_nome, epi_catalogo_id, ativo, ordem)
           VALUES ($1, $2, TRUE, $3)
           ON CONFLICT (cargo_nome, epi_catalogo_id)
           DO UPDATE SET ordem = EXCLUDED.ordem`,
          [cargo, epiId, ordem]
        );
      }
    }
    if ((cntRows[0]?.n || 0) === 0) {
      console.log('[rh/epi] Catálogo e relação por cargo carregados do seed.');
    }
  })().catch((err) => {
    _ensurePromise = null;
    throw err;
  });
  return _ensurePromise;
}

router.use(async (_req, _res, next) => {
  try {
    await ensureEpiSchema();
    next();
  } catch (err) {
    console.error('[rh/epi] ensureSchema:', err?.message || err);
    next(err);
  }
});

function sessionUserId(req) {
  const id = Number(req.session?.user?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sessionUserName(req) {
  return String(req.session?.user?.username || req.session?.user?.nome || '').trim() || null;
}

function podeGerirEpiEstoque(req) {
  return sessionEhAdmin(req) || sessionEhRh(req);
}

function codigoDoItem(item) {
  const direto = String(item?.codigo || '').trim();
  if (direto) return direto;
  const desc = String(item?.descricao || '');
  const m = /^([^\s—\-]+)\s*[—\-]/.exec(desc);
  return m ? String(m[1]).trim() : '';
}

/**
 * Baixa estoque ##RH (Omie SAI + variação) e registra entregas.
 * Idempotente via estoque_baixado_em / entregas já gravadas (codigo_item = item.id).
 */
async function baixarEstoqueSolicitacao(solId, { usuario } = {}) {
  const { rows: sols } = await dbQuery(
    `SELECT id, user_id, status, estoque_baixado_em, estoque_baixa_erro, assinado_em
       FROM rh.epi_solicitacao WHERE id = $1 LIMIT 1`,
    [solId]
  );
  const sol = sols[0];
  if (!sol) {
    const err = new Error('Solicitação não encontrada');
    err.status = 404;
    throw err;
  }
  if (sol.estoque_baixado_em) {
    return { ok: true, already: true, solicitacao: sol, erros: [] };
  }

  const { rows: itens } = await dbQuery(
    `SELECT id, epi_catalogo_id, descricao, ca, quantidade, tamanho, codigo, produto_variacao_id
       FROM rh.epi_solicitacao_item
      WHERE solicitacao_id = $1
      ORDER BY id`,
    [solId]
  );
  const { rows: entregasExistentes } = await dbQuery(
    `SELECT codigo_item FROM rh.epi_entrega WHERE solicitacao_id = $1`,
    [solId]
  );
  const jaEntregue = new Set(
    entregasExistentes.map((e) => String(e.codigo_item || '')).filter(Boolean)
  );

  const erros = [];
  const processados = [];

  for (const item of itens) {
    const itemKey = String(item.id);
    if (jaEntregue.has(itemKey)) {
      processados.push(item.id);
      continue;
    }

    const qtd = Math.max(1, Number(item.quantidade) || 1);
    const codigo = codigoDoItem(item);
    const variacaoId = Number(item.produto_variacao_id) || null;
    let variacaoBaixada = false;

    try {
      if (!codigo) {
        throw new Error('Item sem código de produto para baixa no ##RH');
      }

      if (variacaoId) {
        const { rows: varRows } = await dbQuery(
          `UPDATE produto.produto_variacao
              SET estoque_qtd = estoque_qtd - $1
            WHERE id = $2
              AND codigo = $3
              AND estoque_qtd >= $1
            RETURNING id, estoque_qtd, valor`,
          [qtd, variacaoId, codigo]
        );
        if (!varRows[0]) {
          throw new Error(
            `Estoque da variação insuficiente (produto ${codigo}, variação #${variacaoId}, qtd ${qtd})`
          );
        }
        variacaoBaixada = true;
      }

      await incluirAjusteEpiRh({
        dbQuery,
        tipo: 'SAI',
        codigo,
        qtd,
        usuario: usuario || 'sistema',
        obs: `EPI assinatura sol.#${solId} item#${item.id} — ${codigo} x${qtd}`,
      });

      await dbQuery(
        `INSERT INTO rh.epi_entrega
           (user_id, item, tamanho, ca, quantidade, data_entrega, observacao,
            registrado_por, epi_catalogo_id, solicitacao_id, codigo_item)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9, $10)`,
        [
          sol.user_id,
          String(item.descricao || codigo).slice(0, 255),
          item.tamanho || null,
          item.ca || null,
          qtd,
          `Baixa automática ##RH (${EPI_RH_LOCAL_CODIGO})`,
          usuario || 'sistema',
          item.epi_catalogo_id || null,
          solId,
          itemKey,
        ]
      );
      processados.push(item.id);
    } catch (err) {
      if (variacaoBaixada && variacaoId) {
        await dbQuery(
          `UPDATE produto.produto_variacao
              SET estoque_qtd = COALESCE(estoque_qtd, 0) + $1
            WHERE id = $2`,
          [qtd, variacaoId]
        ).catch(() => {});
      }
      erros.push({
        item_id: item.id,
        codigo: codigo || null,
        erro: err.message || String(err),
      });
    }
  }

  if (!erros.length && processados.length === itens.length) {
    const { rows } = await dbQuery(
      `UPDATE rh.epi_solicitacao
          SET status = 'atendida',
              estoque_baixado_em = NOW(),
              estoque_baixa_erro = NULL,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [solId]
    );
    return { ok: true, already: false, solicitacao: rows[0], erros: [], processados };
  }

  const msgErro = erros.map((e) => `#${e.item_id} ${e.codigo || ''}: ${e.erro}`).join(' | ').slice(0, 2000);
  const { rows } = await dbQuery(
    `UPDATE rh.epi_solicitacao
        SET estoque_baixa_erro = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [msgErro || 'Falha parcial na baixa de estoque ##RH', solId]
  );
  return {
    ok: false,
    already: false,
    solicitacao: rows[0],
    erros,
    processados,
  };
}

/* ---------- Catálogo ---------- */

router.get('/epi/catalogo', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const todos = req.query.todos === '1' || req.query.todos === 'true';
    const params = [];
    const wheres = [];
    if (!todos) wheres.push('ativo IS DISTINCT FROM false');
    if (q) {
      params.push(`%${q}%`);
      wheres.push(`(descricao ILIKE $${params.length} OR COALESCE(ca, '') ILIKE $${params.length})`);
    }
    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const { rows } = await dbQuery(
      `SELECT id, descricao, ca, ativo, created_at, updated_at
         FROM rh.epi_catalogo
         ${where}
        ORDER BY descricao, ca`,
      params
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/epi/catalogo]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar catálogo de EPI' });
  }
});

router.post('/epi/catalogo', async (req, res) => {
  try {
    const descricao = String(req.body?.descricao || '').trim();
    const ca = String(req.body?.ca || '').trim() || null;
    const ativar = req.body?.ativo !== false;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
    const found = await dbQuery(
      `SELECT * FROM rh.epi_catalogo
        WHERE LOWER(descricao) = LOWER($1) AND COALESCE(ca, '') = COALESCE($2, '')
        LIMIT 1`,
      [descricao, ca]
    );
    if (found.rows[0]) {
      if (ativar && found.rows[0].ativo === false) {
        const { rows } = await dbQuery(
          `UPDATE rh.epi_catalogo
              SET ativo = TRUE, updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [found.rows[0].id]
        );
        await dbQuery(`UPDATE rh.epi_cargo SET ativo = TRUE WHERE epi_catalogo_id = $1`, [found.rows[0].id]);
        return res.json(rows[0]);
      }
      return res.json(found.rows[0]);
    }
    const { rows } = await dbQuery(
      `INSERT INTO rh.epi_catalogo (descricao, ca, ativo) VALUES ($1, $2, $3) RETURNING *`,
      [descricao, ca, ativar]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/rh/epi/catalogo]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao salvar item do catálogo' });
  }
});

/** Catálogo único (sem repetir por cargo) — para Configuração */
router.get('/epi/catalogo-unico', async (req, res) => {
  try {
    const somenteAtivos = req.query.somente_ativos === '1' || req.query.somente_ativos === 'true';
    const where = somenteAtivos ? 'WHERE c.ativo IS DISTINCT FROM false' : '';
    const { rows } = await dbQuery(
      `SELECT
         c.id AS epi_catalogo_id,
         c.descricao,
         c.ca,
         c.ativo,
         COALESCE(MIN(ec.ordem), 9999) AS ordem,
         (SELECT COUNT(*)::int
            FROM rh.epi_catalogo_produto cp
           WHERE cp.epi_catalogo_id = c.id) AS qtd_produtos,
         COALESCE((
           SELECT json_agg(
                    json_build_object(
                      'id', cp.id,
                      'codigo', cp.codigo,
                      'descricao', cp.descricao,
                      'url_imagem', COALESCE((
                        SELECT TRIM(i.url_imagem)
                          FROM produto.produtos_omie_imagens i
                         WHERE COALESCE(i.ativo, TRUE) = TRUE
                           AND TRIM(COALESCE(i.url_imagem, '')) <> ''
                           AND (
                             i.codigo_produto::text = NULLIF(TRIM(cp.codigo_produto), '')
                             OR i.codigo_produto::text = TRIM(cp.codigo)
                           )
                         ORDER BY i.pos NULLS LAST, i.id DESC
                         LIMIT 1
                      ), cp.url_imagem)
                    )
                    ORDER BY cp.codigo
                  )
             FROM rh.epi_catalogo_produto cp
            WHERE cp.epi_catalogo_id = c.id
         ), '[]'::json) AS produtos
       FROM rh.epi_catalogo c
       LEFT JOIN rh.epi_cargo ec ON ec.epi_catalogo_id = c.id
       ${where}
       GROUP BY c.id, c.descricao, c.ca, c.ativo
       ORDER BY COALESCE(MIN(ec.ordem), 9999) ASC, c.descricao ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/epi/catalogo-unico]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar catálogo único de EPI' });
  }
});

router.patch('/epi/catalogo/:id/ativo', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const ativo = req.body?.ativo;
  if (typeof ativo !== 'boolean') {
    return res.status(400).json({ error: 'Campo ativo (boolean) é obrigatório' });
  }
  try {
    const { rows } = await dbQuery(
      `UPDATE rh.epi_catalogo
          SET ativo = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, descricao, ca, ativo`,
      [ativo, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Item do catálogo não encontrado' });
    // Mantém relação por cargo alinhada
    await dbQuery(`UPDATE rh.epi_cargo SET ativo = $1 WHERE epi_catalogo_id = $2`, [ativo, id]);
    return res.json(rows[0]);
  } catch (err) {
    console.error('[PATCH /api/rh/epi/catalogo/:id/ativo]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao atualizar ativação do EPI' });
  }
});

/** Atualiza C.A. (e opcionalmente descrição) do item do catálogo */
router.patch('/epi/catalogo/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const hasCa = Object.prototype.hasOwnProperty.call(req.body || {}, 'ca');
    const hasDesc = Object.prototype.hasOwnProperty.call(req.body || {}, 'descricao');
    if (!hasCa && !hasDesc) {
      return res.status(400).json({ error: 'Informe ca e/ou descricao' });
    }
    const ca = hasCa ? (String(req.body.ca || '').trim() || null) : undefined;
    const descricao = hasDesc ? String(req.body.descricao || '').trim() : undefined;
    if (hasDesc && !descricao) {
      return res.status(400).json({ error: 'Descrição não pode ser vazia' });
    }
    const { rows } = await dbQuery(
      `UPDATE rh.epi_catalogo
          SET
            ca = CASE WHEN $2::boolean THEN $3 ELSE ca END,
            descricao = CASE WHEN $4::boolean THEN $5 ELSE descricao END,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, descricao, ca, ativo`,
      [id, hasCa, ca ?? null, hasDesc, descricao ?? null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Item do catálogo não encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[PATCH /api/rh/epi/catalogo/:id]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao atualizar catálogo de EPI' });
  }
});

/** Produtos vinculados aos EPIs ativos — para cards da solicitação */
router.get('/epi/produtos-disponiveis', async (_req, res) => {
  try {
    const { rows } = await dbQuery(
      `SELECT
         cp.id AS vinculo_id,
         cp.epi_catalogo_id,
         cp.codigo,
         cp.codigo_produto,
         cp.descricao,
         COALESCE(img.url_imagem, cp.url_imagem) AS url_imagem,
         c.descricao AS epi_tipo,
         c.ca AS epi_ca
       FROM rh.epi_catalogo_produto cp
       JOIN rh.epi_catalogo c ON c.id = cp.epi_catalogo_id
       LEFT JOIN LATERAL (
         SELECT TRIM(i.url_imagem) AS url_imagem
           FROM produto.produtos_omie_imagens i
          WHERE COALESCE(i.ativo, TRUE) = TRUE
            AND TRIM(COALESCE(i.url_imagem, '')) <> ''
            AND (
              i.codigo_produto::text = NULLIF(TRIM(cp.codigo_produto), '')
              OR i.codigo_produto::text = TRIM(cp.codigo)
            )
          ORDER BY i.pos NULLS LAST, i.id DESC
          LIMIT 1
       ) img ON TRUE
       WHERE c.ativo IS DISTINCT FROM false
       ORDER BY c.descricao ASC, cp.descricao ASC NULLS LAST, cp.codigo ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/epi/produtos-disponiveis]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar produtos disponíveis de EPI' });
  }
});

/** Relação fiel à planilha, agrupada por Função/cargo do Excel */
router.get('/epi/relacao', async (req, res) => {
  try {
    const somenteAtivos = req.query.somente_ativos === '1' || req.query.somente_ativos === 'true';
    const where = somenteAtivos ? 'WHERE ec.ativo IS DISTINCT FROM false' : '';
    const { rows } = await dbQuery(
      `SELECT
         ec.id AS epi_cargo_id,
         ec.cargo_nome,
         ec.ativo,
         ec.ordem,
         c.id AS epi_catalogo_id,
         c.descricao,
         c.ca,
         (SELECT COUNT(*)::int
            FROM rh.epi_catalogo_produto cp
           WHERE cp.epi_catalogo_id = c.id) AS qtd_produtos
       FROM rh.epi_cargo ec
       JOIN rh.epi_catalogo c ON c.id = ec.epi_catalogo_id
       ${where}
       ORDER BY ec.ordem ASC, ec.id ASC`
    );

    const grupos = [];
    const map = new Map();
    for (const r of rows) {
      let g = map.get(r.cargo_nome);
      if (!g) {
        g = { cargo_nome: r.cargo_nome, itens: [] };
        map.set(r.cargo_nome, g);
        grupos.push(g);
      }
      g.itens.push({
        epi_cargo_id: r.epi_cargo_id,
        epi_catalogo_id: r.epi_catalogo_id,
        descricao: r.descricao,
        ca: r.ca,
        ativo: r.ativo !== false,
        ordem: r.ordem,
        qtd_produtos: r.qtd_produtos || 0,
      });
    }
    return res.json(grupos);
  } catch (err) {
    console.error('[GET /api/rh/epi/relacao]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar relação de EPI por cargo' });
  }
});

router.patch('/epi/cargo/:id/ativo', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const ativo = req.body?.ativo;
  if (typeof ativo !== 'boolean') {
    return res.status(400).json({ error: 'Campo ativo (boolean) é obrigatório' });
  }
  try {
    const { rows } = await dbQuery(
      `UPDATE rh.epi_cargo SET ativo = $1 WHERE id = $2
       RETURNING id, cargo_nome, epi_catalogo_id, ativo, ordem`,
      [ativo, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Item da relação não encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[PATCH /api/rh/epi/cargo/:id/ativo]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao atualizar ativação do EPI' });
  }
});

router.get('/epi/catalogo/por-cargo', async (req, res) => {
  try {
    const cargo = String(req.query.cargo || '').trim();
    if (!cargo) return res.json([]);
    const { rows } = await dbQuery(
      `SELECT c.id, c.descricao, c.ca, ec.cargo_nome, ec.id AS epi_cargo_id
         FROM rh.epi_cargo ec
         JOIN rh.epi_catalogo c ON c.id = ec.epi_catalogo_id
        WHERE LOWER(ec.cargo_nome) = LOWER($1)
          AND ec.ativo IS DISTINCT FROM false
        ORDER BY ec.ordem, ec.id`,
      [cargo]
    );
    if (!rows.length) {
      const { rows: fuzzy } = await dbQuery(
        `SELECT c.id, c.descricao, c.ca, ec.cargo_nome, ec.id AS epi_cargo_id
           FROM rh.epi_cargo ec
           JOIN rh.epi_catalogo c ON c.id = ec.epi_catalogo_id
          WHERE LOWER(ec.cargo_nome) LIKE LOWER($1)
            AND ec.ativo IS DISTINCT FROM false
          ORDER BY ec.ordem, ec.id`,
        [`%${cargo}%`]
      );
      return res.json(fuzzy);
    }
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/epi/catalogo/por-cargo]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao buscar EPIs do cargo' });
  }
});

router.get('/epi/cargos', async (_req, res) => {
  try {
    const { rows } = await dbQuery(
      `SELECT cargo_nome, MIN(ordem) AS ordem
         FROM rh.epi_cargo
        GROUP BY cargo_nome
        ORDER BY MIN(ordem), cargo_nome`
    );
    return res.json(rows.map((r) => r.cargo_nome));
  } catch (err) {
    console.error('[GET /api/rh/epi/cargos]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar cargos do EPI' });
  }
});

/** Busca produtos (contém) com miniatura — min 4 caracteres, páginas de 10 */
router.get('/epi/produtos/buscar', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 4) {
      return res.json({ ok: true, produtos: [], hasMore: false, offset: 0 });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10) || 10, 1), 10);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
    const tokens = q.split(/\s+/).map((t) => t.trim()).filter(Boolean);
    if (!tokens.length) return res.json({ ok: true, produtos: [], hasMore: false, offset: 0 });

    const whereSql = tokens
      .map((_, i) => {
        const p = i + 1;
        return `(p.codigo ILIKE $${p} OR COALESCE(p.descricao, '') ILIKE $${p})`;
      })
      .join(' AND ');
    const likeParams = tokens.map((t) => `%${t}%`);
    const pPrefix = tokens.length + 1;
    const pLimit = tokens.length + 2;
    const pOffset = tokens.length + 3;

    const { rows } = await dbQuery(
      `SELECT
         TRIM(p.codigo) AS codigo,
         p.descricao,
         p.codigo_produto::text AS codigo_produto,
         img.url_imagem
       FROM produto.produtos_omie p
       LEFT JOIN LATERAL (
         SELECT TRIM(i.url_imagem) AS url_imagem
           FROM produto.produtos_omie_imagens i
          WHERE COALESCE(i.ativo, TRUE) = TRUE
            AND TRIM(COALESCE(i.url_imagem, '')) <> ''
            AND (
              i.codigo_produto::text = p.codigo_produto::text
              OR i.codigo_produto::text = TRIM(p.codigo)
              OR i.codigo_produto::text = COALESCE(p.codigo_produto_integracao, '')
            )
          ORDER BY i.pos NULLS LAST, i.id DESC
          LIMIT 1
       ) img ON TRUE
       WHERE COALESCE(p.inativo, 'N') <> 'S'
         AND ${whereSql}
       ORDER BY
         (CASE WHEN p.codigo ILIKE $${pPrefix} THEN 0 ELSE 1 END),
         p.codigo
       LIMIT $${pLimit} OFFSET $${pOffset}`,
      [...likeParams, `${q}%`, limit, offset]
    );
    return res.json({
      ok: true,
      produtos: rows,
      hasMore: rows.length === limit,
      offset,
      limit,
    });
  } catch (err) {
    console.error('[GET /api/rh/epi/produtos/buscar]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

router.get('/epi/catalogo/:id/produtos', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const cat = await dbQuery(
      `SELECT id, descricao, ca FROM rh.epi_catalogo WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!cat.rows[0]) return res.status(404).json({ error: 'Item do catálogo não encontrado' });
    const { rows } = await dbQuery(
      `SELECT
         cp.id,
         cp.epi_catalogo_id,
         cp.codigo,
         cp.codigo_produto,
         cp.descricao,
         COALESCE(img.url_imagem, cp.url_imagem) AS url_imagem,
         cp.created_at
       FROM rh.epi_catalogo_produto cp
       LEFT JOIN LATERAL (
         SELECT TRIM(i.url_imagem) AS url_imagem
           FROM produto.produtos_omie_imagens i
          WHERE COALESCE(i.ativo, TRUE) = TRUE
            AND TRIM(COALESCE(i.url_imagem, '')) <> ''
            AND (
              i.codigo_produto::text = NULLIF(TRIM(cp.codigo_produto), '')
              OR i.codigo_produto::text = TRIM(cp.codigo)
            )
          ORDER BY i.pos NULLS LAST, i.id DESC
          LIMIT 1
       ) img ON TRUE
        WHERE cp.epi_catalogo_id = $1
        ORDER BY cp.created_at DESC, cp.id DESC`,
      [id]
    );
    return res.json({ catalogo: cat.rows[0], produtos: rows });
  } catch (err) {
    console.error('[GET /api/rh/epi/catalogo/:id/produtos]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar produtos do EPI' });
  }
});

router.post('/epi/catalogo/:id/produtos', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const codigo = String(req.body?.codigo || '').trim();
  if (!codigo) return res.status(400).json({ error: 'Código do produto obrigatório' });
  try {
    const cat = await dbQuery(`SELECT id FROM rh.epi_catalogo WHERE id = $1 LIMIT 1`, [id]);
    if (!cat.rows[0]) return res.status(404).json({ error: 'Item do catálogo não encontrado' });

    let descricao = String(req.body?.descricao || '').trim() || null;
    let codigo_produto = String(req.body?.codigo_produto || '').trim() || null;
    let url_imagem = String(req.body?.url_imagem || '').trim() || null;

    // Completa dados pelo cadastro se faltarem
    const prod = await dbQuery(
      `SELECT
         TRIM(p.codigo) AS codigo,
         p.descricao,
         p.codigo_produto::text AS codigo_produto,
         img.url_imagem
       FROM produto.produtos_omie p
       LEFT JOIN LATERAL (
         SELECT TRIM(i.url_imagem) AS url_imagem
           FROM produto.produtos_omie_imagens i
          WHERE COALESCE(i.ativo, TRUE) = TRUE
            AND TRIM(COALESCE(i.url_imagem, '')) <> ''
            AND (
              i.codigo_produto::text = p.codigo_produto::text
              OR i.codigo_produto::text = TRIM(p.codigo)
            )
          ORDER BY i.pos NULLS LAST, i.id DESC
          LIMIT 1
       ) img ON TRUE
       WHERE TRIM(p.codigo) = $1
          OR p.codigo_produto::text = $1
       LIMIT 1`,
      [codigo]
    );
    if (prod.rows[0]) {
      descricao = descricao || prod.rows[0].descricao || null;
      codigo_produto = codigo_produto || prod.rows[0].codigo_produto || null;
      url_imagem = url_imagem || prod.rows[0].url_imagem || null;
    }

    const { rows } = await dbQuery(
      `INSERT INTO rh.epi_catalogo_produto
         (epi_catalogo_id, codigo, codigo_produto, descricao, url_imagem)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (epi_catalogo_id, codigo)
       DO UPDATE SET
         codigo_produto = COALESCE(EXCLUDED.codigo_produto, rh.epi_catalogo_produto.codigo_produto),
         descricao = COALESCE(EXCLUDED.descricao, rh.epi_catalogo_produto.descricao),
         url_imagem = COALESCE(EXCLUDED.url_imagem, rh.epi_catalogo_produto.url_imagem)
       RETURNING *`,
      [id, codigo, codigo_produto, descricao, url_imagem]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/rh/epi/catalogo/:id/produtos]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao vincular produto ao EPI' });
  }
});

router.delete('/epi/catalogo/:id/produtos/:vinculoId', async (req, res) => {
  const id = Number(req.params.id);
  const vinculoId = Number(req.params.vinculoId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(vinculoId) || vinculoId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rowCount } = await dbQuery(
      `DELETE FROM rh.epi_catalogo_produto
        WHERE id = $1 AND epi_catalogo_id = $2`,
      [vinculoId, id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Vínculo não encontrado' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/rh/epi/catalogo/:id/produtos/:vinculoId]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao remover produto do EPI' });
  }
});

/* ---------- Estoque ##RH ---------- */

router.get('/epi/estoque/saldo', async (req, res) => {
  try {
    const raw = String(req.query.codigos || '').trim();
    if (!raw) return res.json({ local: EPI_RH_LOCAL_CODIGO, local_nome: EPI_RH_LOCAL_NOME, itens: {} });
    const codigos = [...new Set(raw.split(',').map((c) => c.trim()).filter(Boolean))].slice(0, 200);
    if (!codigos.length) {
      return res.json({ local: EPI_RH_LOCAL_CODIGO, local_nome: EPI_RH_LOCAL_NOME, itens: {} });
    }

    const [saldos, variacoes] = await Promise.all([
      dbQuery(
        `SELECT codigo, COALESCE(saldo, 0) AS saldo, COALESCE(fisico, 0) AS fisico, cmc, local_nome
           FROM logistica.estoque_atual
          WHERE local_codigo = $1
            AND codigo = ANY($2::text[])`,
        [EPI_RH_LOCAL_CODIGO, codigos]
      ),
      dbQuery(
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
      ),
    ]);

    const itens = {};
    for (const c of codigos) {
      itens[c] = { saldo_rh: 0, fisico_rh: 0, cmc: null, variacoes: [] };
    }
    for (const r of saldos.rows) {
      itens[r.codigo] = {
        saldo_rh: Number(r.saldo) || 0,
        fisico_rh: Number(r.fisico) || 0,
        cmc: r.cmc != null ? Number(r.cmc) : null,
        variacoes: [],
      };
    }
    for (const v of variacoes.rows) {
      if (!itens[v.codigo]) {
        itens[v.codigo] = { saldo_rh: 0, fisico_rh: 0, cmc: null, variacoes: [] };
      }
      itens[v.codigo].variacoes.push({
        id: v.id,
        tipo_id: v.tipo_id,
        tipo_nome: v.tipo_nome,
        valor: v.valor,
        estoque_qtd: Number(v.estoque_qtd) || 0,
      });
    }

    return res.json({
      local: EPI_RH_LOCAL_CODIGO,
      local_nome: EPI_RH_LOCAL_NOME,
      itens,
    });
  } catch (err) {
    console.error('[GET /api/rh/epi/estoque/saldo]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao consultar saldo ##RH' });
  }
});

router.post('/epi/estoque/entrada', async (req, res) => {
  if (!podeGerirEpiEstoque(req)) {
    return res.status(403).json({ error: 'Somente RH/admin pode registrar entrada no ##RH' });
  }
  try {
    const codigo = String(req.body?.codigo || '').trim();
    const quantidade = Number(req.body?.quantidade);
    const produto_variacao_id = Number(req.body?.produto_variacao_id) || null;
    const observacao = String(req.body?.observacao || '').trim() || null;
    if (!codigo) return res.status(400).json({ error: 'Código obrigatório' });
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return res.status(400).json({ error: 'Quantidade inválida' });
    }

    if (produto_variacao_id) {
      const { rows: vars } = await dbQuery(
        `SELECT id, codigo, valor, estoque_qtd
           FROM produto.produto_variacao
          WHERE id = $1 AND ativo IS DISTINCT FROM false
          LIMIT 1`,
        [produto_variacao_id]
      );
      if (!vars[0]) return res.status(404).json({ error: 'Variação não encontrada' });
      if (String(vars[0].codigo).trim() !== codigo) {
        return res.status(400).json({ error: 'Variação não pertence a este código' });
      }
    }

    const mov = await incluirAjusteEpiRh({
      dbQuery,
      tipo: 'ENT',
      codigo,
      qtd: quantidade,
      usuario: sessionUserName(req) || 'rh',
      obs:
        observacao ||
        `EPI entrada ##RH — ${codigo} x${quantidade}${produto_variacao_id ? ` (var #${produto_variacao_id})` : ''}`,
    });

    let variacao = null;
    if (produto_variacao_id) {
      const { rows } = await dbQuery(
        `UPDATE produto.produto_variacao
            SET estoque_qtd = COALESCE(estoque_qtd, 0) + $1
          WHERE id = $2
          RETURNING id, codigo, valor, estoque_qtd, tipo_id`,
        [quantidade, produto_variacao_id]
      );
      variacao = rows[0]
        ? { ...rows[0], estoque_qtd: Number(rows[0].estoque_qtd) || 0 }
        : null;
    }

    const { rows: saldoRows } = await dbQuery(
      `SELECT COALESCE(saldo, 0) AS saldo, COALESCE(fisico, 0) AS fisico
         FROM logistica.estoque_atual
        WHERE local_codigo = $1 AND codigo = $2
        LIMIT 1`,
      [EPI_RH_LOCAL_CODIGO, codigo]
    );

    return res.json({
      ok: true,
      local: EPI_RH_LOCAL_CODIGO,
      local_nome: EPI_RH_LOCAL_NOME,
      codigo,
      quantidade,
      omie: mov.omie,
      variacao,
      saldo_rh: Number(saldoRows[0]?.saldo) || 0,
      fisico_rh: Number(saldoRows[0]?.fisico) || 0,
    });
  } catch (err) {
    console.error('[POST /api/rh/epi/estoque/entrada]', err?.message || err);
    return res.status(err.status || 500).json({ error: err.message || 'Erro ao registrar entrada ##RH' });
  }
});

/* ---------- Solicitações ---------- */

router.get('/epi/solicitacoes', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE s.status = $1`;
    }
    const { rows } = await dbQuery(
      `SELECT
         s.id,
         s.user_id,
         s.cargo_funcao,
         s.status,
         s.observacao,
         s.solicitado_por,
         s.assinatura_url,
         s.assinatura_path,
         s.assinado_em,
         s.estoque_baixado_em,
         s.estoque_baixa_erro,
         s.created_at,
         s.updated_at,
         COALESCE(u.nome_completo, u.username) AS colaborador,
         u.username,
         COALESCE(f.name, rc.cargo) AS cargo_cadastro,
         (SELECT COUNT(*)::int FROM rh.epi_solicitacao_item i WHERE i.solicitacao_id = s.id) AS qtd_itens
       FROM rh.epi_solicitacao s
       JOIN public.auth_user u ON u.id = s.user_id
       LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
       LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
       LEFT JOIN rh.colaboradores rc ON rc.user_id = u.id
       ${where}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT 500`,
      params
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/epi/solicitacoes]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar solicitações de EPI' });
  }
});

router.get('/epi/solicitacoes/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rows } = await dbQuery(
      `SELECT
         s.*,
         COALESCE(u.nome_completo, u.username) AS colaborador,
         u.username,
         COALESCE(f.name, rc.cargo) AS cargo_cadastro
       FROM rh.epi_solicitacao s
       JOIN public.auth_user u ON u.id = s.user_id
       LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
       LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
       LEFT JOIN rh.colaboradores rc ON rc.user_id = u.id
       WHERE s.id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Solicitação não encontrada' });
    const itens = await dbQuery(
      `SELECT * FROM rh.epi_solicitacao_item WHERE solicitacao_id = $1 ORDER BY id`,
      [id]
    );
    return res.json({ ...rows[0], itens: itens.rows });
  } catch (err) {
    console.error('[GET /api/rh/epi/solicitacoes/:id]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao buscar solicitação' });
  }
});

router.post('/epi/solicitacoes', async (req, res) => {
  try {
    const userId = Number(req.body?.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Colaborador obrigatório' });
    }
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
    if (!itens.length) {
      return res.status(400).json({ error: 'Informe ao menos um EPI' });
    }
    let cargo_funcao = String(req.body?.cargo_funcao || '').trim() || null;
    if (!cargo_funcao) {
      const cargoRow = await dbQuery(
        `SELECT COALESCE(f.name, rc.cargo) AS cargo
           FROM public.auth_user u
           LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
           LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
           LEFT JOIN rh.colaboradores rc ON rc.user_id = u.id
          WHERE u.id = $1
          LIMIT 1`,
        [userId]
      );
      cargo_funcao = cargoRow.rows[0]?.cargo || null;
    }
    const observacao = String(req.body?.observacao || '').trim() || null;
    const solicitado_por = String(req.body?.solicitado_por || '').trim() || sessionUserName(req);

    const { rows: solRows } = await dbQuery(
      `INSERT INTO rh.epi_solicitacao (user_id, cargo_funcao, status, observacao, solicitado_por)
       VALUES ($1, $2, 'aberta', $3, $4)
       RETURNING *`,
      [userId, cargo_funcao, observacao, solicitado_por]
    );
    const sol = solRows[0];
    const inserted = [];
    for (const it of itens) {
      const descricao = String(it.descricao || '').trim();
      if (!descricao) continue;
      const ca = String(it.ca || '').trim() || null;
      const quantidade = Math.max(1, Number(it.quantidade) || 1);
      const tamanho = String(it.tamanho || '').trim() || null;
      const epi_catalogo_id = Number(it.epi_catalogo_id) || null;
      const codigo = String(it.codigo || '').trim() || null;
      const produto_variacao_id = Number(it.produto_variacao_id) || null;
      const { rows } = await dbQuery(
        `INSERT INTO rh.epi_solicitacao_item
           (solicitacao_id, epi_catalogo_id, descricao, ca, quantidade, tamanho, codigo, produto_variacao_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [sol.id, epi_catalogo_id, descricao, ca, quantidade, tamanho, codigo, produto_variacao_id]
      );
      inserted.push(rows[0]);
    }
    if (!inserted.length) {
      await dbQuery('DELETE FROM rh.epi_solicitacao WHERE id = $1', [sol.id]);
      return res.status(400).json({ error: 'Nenhum item válido na solicitação' });
    }
    return res.status(201).json({ ...sol, itens: inserted });
  } catch (err) {
    console.error('[POST /api/rh/epi/solicitacoes]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao criar solicitação de EPI' });
  }
});

/** Área do colaborador: minhas solicitações + entregas */
router.get('/epi/meus', async (req, res) => {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const [sols, entregas, perfil] = await Promise.all([
      dbQuery(
        `SELECT
           s.id, s.user_id, s.cargo_funcao, s.status, s.observacao, s.solicitado_por,
           s.assinatura_url, s.assinatura_path, s.assinado_em, s.created_at, s.updated_at,
           s.estoque_baixado_em, s.estoque_baixa_erro,
           (SELECT COUNT(*)::int FROM rh.epi_solicitacao_item i WHERE i.solicitacao_id = s.id) AS qtd_itens,
           COALESCE(
             (SELECT json_agg(json_build_object(
                'id', i.id, 'descricao', i.descricao, 'ca', i.ca,
                'quantidade', i.quantidade, 'tamanho', i.tamanho,
                'codigo', i.codigo, 'produto_variacao_id', i.produto_variacao_id
              ) ORDER BY i.id)
              FROM rh.epi_solicitacao_item i WHERE i.solicitacao_id = s.id),
             '[]'::json
           ) AS itens
         FROM rh.epi_solicitacao s
         WHERE s.user_id = $1
         ORDER BY s.created_at DESC, s.id DESC`,
        [userId]
      ),
      dbQuery(
        `SELECT id, item, tamanho, ca, quantidade, data_entrega, data_devolucao,
                observacao, codigo_item, created_at
           FROM rh.epi_entrega
          WHERE user_id = $1
          ORDER BY data_entrega DESC NULLS LAST, id DESC`,
        [userId]
      ),
      dbQuery(
        `SELECT
           u.id,
           COALESCE(u.nome_completo, u.username) AS nome,
           u.username,
           COALESCE(f.name, rc.cargo) AS cargo
         FROM public.auth_user u
         LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
         LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
         LEFT JOIN rh.colaboradores rc ON rc.user_id = u.id
         WHERE u.id = $1
         LIMIT 1`,
        [userId]
      ),
    ]);
    return res.json({
      perfil: perfil.rows[0] || { id: userId },
      solicitacoes: sols.rows,
      entregas: entregas.rows,
    });
  } catch (err) {
    console.error('[GET /api/rh/epi/meus]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao carregar seus EPIs' });
  }
});

router.post('/epi/solicitacoes/:id/assinar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'Não autenticado' });

  const raw = String(req.body?.assinatura_base64 || '').trim();
  if (!raw) return res.status(400).json({ error: 'Assinatura obrigatória' });

  try {
    const { rows: sols } = await dbQuery(
      `SELECT id, user_id, assinatura_url FROM rh.epi_solicitacao WHERE id = $1 LIMIT 1`,
      [id]
    );
    const sol = sols[0];
    if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada' });
    if (Number(sol.user_id) !== userId) {
      return res.status(403).json({ error: 'Só o colaborador da solicitação pode assinar' });
    }
    if (sol.assinatura_url) {
      return res.status(409).json({ error: 'Esta solicitação já foi assinada' });
    }

    const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(raw);
    const b64 = m ? m[2] : raw.replace(/^data:image\/\w+;base64,/, '');
    const ext = (m?.[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
    const contentType = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    let buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Assinatura inválida' });
    }
    if (!buffer.length || buffer.length > 2_500_000) {
      return res.status(400).json({ error: 'Assinatura inválida ou muito grande' });
    }

    const { uploadPublicFile } = require('../utils/storage');
    const pathKey = `${userId}/epi/assinaturas/solicitacao_${id}_${Date.now()}.${ext === 'jpg' ? 'jpg' : ext}`;
    const { url, path: savedPath } = await uploadPublicFile('Funcionarios', pathKey, buffer, {
      contentType,
      upsert: true,
    });

    const { rows } = await dbQuery(
      `UPDATE rh.epi_solicitacao
          SET assinatura_url = $1,
              assinatura_path = $2,
              assinado_em = NOW(),
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [url, savedPath || pathKey, id]
    );

    let baixa = null;
    try {
      baixa = await baixarEstoqueSolicitacao(id, {
        usuario: sessionUserName(req) || `user#${userId}`,
      });
    } catch (baixaErr) {
      console.error('[epi/assinar] baixa estoque', baixaErr?.message || baixaErr);
      await dbQuery(
        `UPDATE rh.epi_solicitacao
            SET estoque_baixa_erro = $1, updated_at = NOW()
          WHERE id = $2`,
        [String(baixaErr.message || baixaErr).slice(0, 2000), id]
      );
      baixa = {
        ok: false,
        erros: [{ erro: baixaErr.message || String(baixaErr) }],
        solicitacao: null,
      };
    }

    const solAtual = baixa?.solicitacao || rows[0];
    return res.json({
      ...solAtual,
      estoque_baixa_ok: !!(baixa && baixa.ok),
      estoque_baixa_ja_feita: !!(baixa && baixa.already),
      estoque_baixa_erro: solAtual?.estoque_baixa_erro || (baixa?.ok ? null : (baixa?.erros?.[0]?.erro || 'Falha na baixa ##RH')),
      estoque_baixa_erros: baixa?.erros || [],
    });
  } catch (err) {
    console.error('[POST /api/rh/epi/solicitacoes/:id/assinar]', err?.message || err);
    return res.status(500).json({ error: err.message || 'Erro ao gravar assinatura' });
  }
});

router.post('/epi/solicitacoes/:id/reprocessar-estoque', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  if (!podeGerirEpiEstoque(req)) {
    return res.status(403).json({ error: 'Somente RH/admin pode reprocessar estoque EPI' });
  }
  try {
    const { rows: sols } = await dbQuery(
      `SELECT id, assinado_em, estoque_baixado_em, estoque_baixa_erro
         FROM rh.epi_solicitacao WHERE id = $1 LIMIT 1`,
      [id]
    );
    const sol = sols[0];
    if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada' });
    if (!sol.assinado_em) {
      return res.status(400).json({ error: 'Solicitação ainda não foi assinada' });
    }
    if (sol.estoque_baixado_em) {
      return res.json({
        ok: true,
        already: true,
        message: 'Estoque ##RH já baixado',
        solicitacao: sol,
      });
    }

    const baixa = await baixarEstoqueSolicitacao(id, {
      usuario: sessionUserName(req) || 'rh',
    });
    if (!baixa.ok) {
      return res.status(502).json({
        ok: false,
        error: 'Falha ao reprocessar baixa ##RH',
        estoque_baixa_erro: baixa.solicitacao?.estoque_baixa_erro,
        erros: baixa.erros,
        solicitacao: baixa.solicitacao,
      });
    }
    return res.json({
      ok: true,
      already: !!baixa.already,
      solicitacao: baixa.solicitacao,
    });
  } catch (err) {
    console.error('[POST /api/rh/epi/solicitacoes/:id/reprocessar-estoque]', err?.message || err);
    return res.status(err.status || 500).json({ error: err.message || 'Erro ao reprocessar estoque' });
  }
});

router.patch('/epi/solicitacoes/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!['aberta', 'atendida', 'cancelada'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }
  try {
    const { rows } = await dbQuery(
      `UPDATE rh.epi_solicitacao
          SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [status, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Solicitação não encontrada' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[PATCH /api/rh/epi/solicitacoes/:id/status]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

/* ---------- Entregas (controle / ficha) ---------- */

router.get('/epi/entregas', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const userId = Number(req.query.user_id) || null;
    const params = [];
    const wheres = [];
    if (userId) {
      params.push(userId);
      wheres.push(`e.user_id = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      wheres.push(
        `(e.item ILIKE $${params.length}
          OR COALESCE(e.ca, '') ILIKE $${params.length}
          OR COALESCE(u.nome_completo, u.username) ILIKE $${params.length}
          OR COALESCE(u.username, '') ILIKE $${params.length})`
      );
    }
    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const { rows } = await dbQuery(
      `SELECT
         e.id,
         e.user_id,
         e.item,
         e.tamanho,
         e.ca,
         e.quantidade,
         e.data_entrega,
         e.data_devolucao,
         e.observacao,
         e.registrado_por,
         e.codigo_item,
         e.epi_catalogo_id,
         e.solicitacao_id,
         e.created_at,
         COALESCE(u.nome_completo, u.username) AS colaborador,
         u.username,
         f.name AS funcao
       FROM rh.epi_entrega e
       JOIN public.auth_user u ON u.id = e.user_id
       LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
       LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
       ${where}
       ORDER BY e.data_entrega DESC NULLS LAST, e.id DESC
       LIMIT 1000`,
      params
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/epi/entregas]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar entregas de EPI' });
  }
});

router.post('/epi/entregas', async (req, res) => {
  try {
    const userId = Number(req.body?.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Colaborador obrigatório' });
    }
    const item = String(req.body?.item || req.body?.descricao || '').trim();
    if (!item) return res.status(400).json({ error: 'Descrição do EPI obrigatória' });

    const tamanho = String(req.body?.tamanho || '').trim() || null;
    const ca = String(req.body?.ca || '').trim() || null;
    const quantidade = Math.max(1, Number(req.body?.quantidade) || 1);
    const data_entrega = req.body?.data_entrega || null;
    const data_devolucao = req.body?.data_devolucao || null;
    const observacao = String(req.body?.observacao || '').trim() || null;
    const registrado_por = String(req.body?.registrado_por || '').trim() || sessionUserName(req);
    const codigo_item = String(req.body?.codigo_item || '').trim() || null;
    const epi_catalogo_id = Number(req.body?.epi_catalogo_id) || null;
    const solicitacao_id = Number(req.body?.solicitacao_id) || null;

    const { rows } = await dbQuery(
      `INSERT INTO rh.epi_entrega
         (user_id, item, tamanho, data_entrega, observacao, registrado_por,
          ca, quantidade, data_devolucao, epi_catalogo_id, solicitacao_id, codigo_item)
       VALUES (
         $1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6,
         $7, $8, $9::date, $10, $11, $12
       )
       RETURNING *`,
      [
        userId, item, tamanho, data_entrega, observacao, registrado_por,
        ca, quantidade, data_devolucao, epi_catalogo_id, solicitacao_id, codigo_item,
      ]
    );

    if (solicitacao_id) {
      await dbQuery(
        `UPDATE rh.epi_solicitacao SET status = 'atendida', updated_at = NOW()
          WHERE id = $1 AND status = 'aberta'`,
        [solicitacao_id]
      );
    }

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/rh/epi/entregas]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao registrar entrega de EPI' });
  }
});

router.patch('/epi/entregas/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const fields = [];
    const params = [];
    const map = {
      item: 'item',
      tamanho: 'tamanho',
      ca: 'ca',
      quantidade: 'quantidade',
      data_entrega: 'data_entrega',
      data_devolucao: 'data_devolucao',
      observacao: 'observacao',
      codigo_item: 'codigo_item',
    };
    for (const [bodyKey, col] of Object.entries(map)) {
      if (req.body?.[bodyKey] !== undefined) {
        params.push(req.body[bodyKey] === '' ? null : req.body[bodyKey]);
        if (col.startsWith('data_')) {
          fields.push(`${col} = $${params.length}::date`);
        } else {
          fields.push(`${col} = $${params.length}`);
        }
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(id);
    const { rows } = await dbQuery(
      `UPDATE rh.epi_entrega SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Entrega não encontrada' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[PATCH /api/rh/epi/entregas/:id]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao atualizar entrega' });
  }
});

router.delete('/epi/entregas/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rowCount } = await dbQuery('DELETE FROM rh.epi_entrega WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Entrega não encontrada' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/rh/epi/entregas/:id]', err?.message || err);
    return res.status(500).json({ error: 'Erro ao excluir entrega' });
  }
});

module.exports = router;
module.exports.ensureEpiSchema = ensureEpiSchema;
