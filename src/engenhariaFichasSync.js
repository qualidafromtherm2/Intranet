const https = require('https');
const { dbGetClient } = require('./db');

const IAPP_BASE = 'https://api.iniciativaaplicativos.com.br/api';
const DEFAULT_OFFSET = 10;
const DEFAULT_DELAY_MS = 350;
let syncEmAndamento = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function iappGet(path, params = {}) {
  return new Promise((resolve, reject) => {
    const token = process.env.IAPP_TOKEN;
    const secret = process.env.IAPP_SECRET;

    if (!token || !secret) {
      return reject(new Error('IAPP_TOKEN e IAPP_SECRET não configurados no .env'));
    }

    const qs = new URLSearchParams(params).toString();
    const url = new URL(`${IAPP_BASE}${path}${qs ? `?${qs}` : ''}`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        token,
        secret,
        'Content-Type': 'application/json'
      }
    }, (resp) => {
      let body = '';
      resp.on('data', (chunk) => { body += chunk; });
      resp.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (resp.statusCode >= 400) {
            const err = new Error(json.message || `HTTP ${resp.statusCode}`);
            err.status = resp.statusCode;
            err.iappCode = json.code;
            return reject(err);
          }
          resolve(json);
        } catch (error) {
          reject(new Error(`Resposta inválida da API IAPP: ${body.slice(0, 300)}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function normalizeText(value) {
  if (value === null || typeof value === 'undefined') return null;
  const text = String(value).trim();
  return text || null;
}

function parseInteger(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const num = Number.parseInt(String(value), 10);
  return Number.isFinite(num) ? num : null;
}

function parseNumeric(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseTimestamp(value) {
  return normalizeText(value);
}

function toJsonb(value) {
  if (value === null || typeof value === 'undefined') return null;
  return JSON.stringify(value);
}

function getItemDescricao(value) {
  if (!value || typeof value !== 'object') return null;
  return normalizeText(value.descricao)
    || normalizeText(value.nome)
    || normalizeText(value.identificacao)
    || normalizeText(value.codigo)
    || null;
}

async function ensureFichasTables(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS engenharia;

    CREATE TABLE IF NOT EXISTS engenharia.iapp_fichas (
      id INTEGER PRIMARY KEY,
      identificacao TEXT,
      descricao TEXT,
      status TEXT,
      modelo TEXT,
      data_validade TIMESTAMP,
      qtde NUMERIC(18,6),
      qtde_batelada NUMERIC(18,6),
      qtde_referencia NUMERIC(18,6),
      produto TEXT,
      vcpp NUMERIC(18,6),
      vcp NUMERIC(18,6),
      data_criacao TIMESTAMP,
      data_ultima_atualizacao TIMESTAMP,
      usuario_criador INTEGER,
      ultimo_usuario_atualizador INTEGER,
      raw_payload JSONB NOT NULL,
      sincronizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_iapp_fichas_identificacao
      ON engenharia.iapp_fichas (identificacao);
    CREATE INDEX IF NOT EXISTS idx_iapp_fichas_descricao
      ON engenharia.iapp_fichas (descricao);
    CREATE INDEX IF NOT EXISTS idx_iapp_fichas_status
      ON engenharia.iapp_fichas (status);
    CREATE INDEX IF NOT EXISTS idx_iapp_fichas_produto
      ON engenharia.iapp_fichas (produto);
    CREATE INDEX IF NOT EXISTS idx_iapp_fichas_data_ultima_atualizacao
      ON engenharia.iapp_fichas (data_ultima_atualizacao DESC);

    CREATE TABLE IF NOT EXISTS engenharia.iapp_fichas_operacoes (
      ficha_id INTEGER NOT NULL REFERENCES engenharia.iapp_fichas (id) ON DELETE CASCADE,
      item_index INTEGER NOT NULL,
      operacao_id INTEGER,
      tempo_operacao NUMERIC(18,6),
      tempo_preparacao NUMERIC(18,6),
      tempo_espera NUMERIC(18,6),
      tempo_transporte NUMERIC(18,6),
      tempo_fila NUMERIC(18,6),
      tempo_total_pessimista NUMERIC(18,6),
      tempo_total_otimista NUMERIC(18,6),
      valor_total NUMERIC(18,6),
      capacidade NUMERIC(18,6),
      meta NUMERIC(18,6),
      unidade TEXT,
      raw_payload JSONB NOT NULL,
      sincronizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (ficha_id, item_index)
    );
    CREATE INDEX IF NOT EXISTS idx_iapp_fichas_operacoes_operacao_id
      ON engenharia.iapp_fichas_operacoes (operacao_id);

    CREATE TABLE IF NOT EXISTS engenharia.iapp_fichas_operacao_materiais (
      ficha_id INTEGER NOT NULL,
      operacao_item_index INTEGER NOT NULL,
      item_index INTEGER NOT NULL,
      produto_id INTEGER,
      qtde NUMERIC(18,6),
      porcentagem NUMERIC(18,6),
      qtde_custo_perdas NUMERIC(18,6),
      raw_payload JSONB NOT NULL,
      sincronizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (ficha_id, operacao_item_index, item_index),
      CONSTRAINT fk_iapp_fichas_operacao_materiais_operacao
        FOREIGN KEY (ficha_id, operacao_item_index)
        REFERENCES engenharia.iapp_fichas_operacoes (ficha_id, item_index)
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_iapp_fichas_operacao_materiais_produto_id
      ON engenharia.iapp_fichas_operacao_materiais (produto_id);

    CREATE TABLE IF NOT EXISTS engenharia.iapp_fichas_operacao_subprodutos (
      ficha_id INTEGER NOT NULL,
      operacao_item_index INTEGER NOT NULL,
      item_index INTEGER NOT NULL,
      produto_id INTEGER,
      descricao TEXT,
      qtde NUMERIC(18,6),
      porcentagem NUMERIC(18,6),
      qtde_custo_perdas NUMERIC(18,6),
      raw_payload JSONB NOT NULL,
      sincronizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (ficha_id, operacao_item_index, item_index),
      CONSTRAINT fk_iapp_fichas_operacao_subprodutos_operacao
        FOREIGN KEY (ficha_id, operacao_item_index)
        REFERENCES engenharia.iapp_fichas_operacoes (ficha_id, item_index)
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_iapp_fichas_operacao_subprodutos_produto_id
      ON engenharia.iapp_fichas_operacao_subprodutos (produto_id);

    CREATE TABLE IF NOT EXISTS engenharia.iapp_fichas_operacao_checklists (
      ficha_id INTEGER NOT NULL,
      operacao_item_index INTEGER NOT NULL,
      item_index INTEGER NOT NULL,
      checklist_id INTEGER,
      descricao TEXT,
      status TEXT,
      raw_payload JSONB NOT NULL,
      sincronizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (ficha_id, operacao_item_index, item_index),
      CONSTRAINT fk_iapp_fichas_operacao_checklists_operacao
        FOREIGN KEY (ficha_id, operacao_item_index)
        REFERENCES engenharia.iapp_fichas_operacoes (ficha_id, item_index)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS engenharia.iapp_fichas_operacao_servicos (
      ficha_id INTEGER NOT NULL,
      operacao_item_index INTEGER NOT NULL,
      item_index INTEGER NOT NULL,
      servico_id INTEGER,
      descricao TEXT,
      qtde NUMERIC(18,6),
      valor_total NUMERIC(18,6),
      raw_payload JSONB NOT NULL,
      sincronizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (ficha_id, operacao_item_index, item_index),
      CONSTRAINT fk_iapp_fichas_operacao_servicos_operacao
        FOREIGN KEY (ficha_id, operacao_item_index)
        REFERENCES engenharia.iapp_fichas_operacoes (ficha_id, item_index)
        ON DELETE CASCADE
    );
  `);
}

async function replaceFichaChildren(client, fichaId, operacoes) {
  await client.query(`
    DELETE FROM engenharia.iapp_fichas_operacoes
    WHERE ficha_id = $1
  `, [fichaId]);

  for (let operacaoIndex = 0; operacaoIndex < operacoes.length; operacaoIndex += 1) {
    const operacao = operacoes[operacaoIndex] || {};
    const itemIndex = operacaoIndex + 1;

    await client.query(`
      INSERT INTO engenharia.iapp_fichas_operacoes (
        ficha_id, item_index, operacao_id,
        tempo_operacao, tempo_preparacao, tempo_espera,
        tempo_transporte, tempo_fila,
        tempo_total_pessimista, tempo_total_otimista,
        valor_total, capacidade, meta, unidade,
        raw_payload, sincronizado_em
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8,
        $9, $10,
        $11, $12, $13, $14,
        $15, NOW()
      )
    `, [
      fichaId,
      itemIndex,
      parseInteger(operacao.operacao),
      parseNumeric(operacao.tempo_operacao),
      parseNumeric(operacao.tempo_preparacao),
      parseNumeric(operacao.tempo_espera),
      parseNumeric(operacao.tempo_transporte),
      parseNumeric(operacao.tempo_fila),
      parseNumeric(operacao.tempo_total_pessimista),
      parseNumeric(operacao.tempo_total_otimista),
      parseNumeric(operacao.valor_total),
      parseNumeric(operacao.capacidade),
      parseNumeric(operacao.meta),
      normalizeText(operacao.unidade),
      toJsonb(operacao)
    ]);

    const materiais = Array.isArray(operacao.materiais) ? operacao.materiais : [];
    for (let materialIndex = 0; materialIndex < materiais.length; materialIndex += 1) {
      const material = materiais[materialIndex] || {};
      await client.query(`
        INSERT INTO engenharia.iapp_fichas_operacao_materiais (
          ficha_id, operacao_item_index, item_index,
          produto_id, qtde, porcentagem, qtde_custo_perdas,
          raw_payload, sincronizado_em
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `, [
        fichaId,
        itemIndex,
        materialIndex + 1,
        parseInteger(material.produto),
        parseNumeric(material.qtde),
        parseNumeric(material.porcentagem),
        parseNumeric(material.qtde_custo_perdas),
        toJsonb(material)
      ]);
    }

    const subprodutos = Array.isArray(operacao.subprodutos) ? operacao.subprodutos : [];
    for (let subprodutoIndex = 0; subprodutoIndex < subprodutos.length; subprodutoIndex += 1) {
      const subproduto = subprodutos[subprodutoIndex] || {};
      await client.query(`
        INSERT INTO engenharia.iapp_fichas_operacao_subprodutos (
          ficha_id, operacao_item_index, item_index,
          produto_id, descricao, qtde, porcentagem, qtde_custo_perdas,
          raw_payload, sincronizado_em
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `, [
        fichaId,
        itemIndex,
        subprodutoIndex + 1,
        parseInteger(subproduto.produto || subproduto.id),
        getItemDescricao(subproduto),
        parseNumeric(subproduto.qtde),
        parseNumeric(subproduto.porcentagem),
        parseNumeric(subproduto.qtde_custo_perdas),
        toJsonb(subproduto)
      ]);
    }

    const checklists = Array.isArray(operacao.checklists) ? operacao.checklists : [];
    for (let checklistIndex = 0; checklistIndex < checklists.length; checklistIndex += 1) {
      const checklist = checklists[checklistIndex] || {};
      await client.query(`
        INSERT INTO engenharia.iapp_fichas_operacao_checklists (
          ficha_id, operacao_item_index, item_index,
          checklist_id, descricao, status,
          raw_payload, sincronizado_em
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [
        fichaId,
        itemIndex,
        checklistIndex + 1,
        parseInteger(checklist.checklist || checklist.id),
        getItemDescricao(checklist),
        normalizeText(checklist.status),
        toJsonb(checklist)
      ]);
    }

    const servicos = Array.isArray(operacao.servicos) ? operacao.servicos : [];
    for (let servicoIndex = 0; servicoIndex < servicos.length; servicoIndex += 1) {
      const servico = servicos[servicoIndex] || {};
      await client.query(`
        INSERT INTO engenharia.iapp_fichas_operacao_servicos (
          ficha_id, operacao_item_index, item_index,
          servico_id, descricao, qtde, valor_total,
          raw_payload, sincronizado_em
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `, [
        fichaId,
        itemIndex,
        servicoIndex + 1,
        parseInteger(servico.servico || servico.id),
        getItemDescricao(servico),
        parseNumeric(servico.qtde),
        parseNumeric(servico.valor_total),
        toJsonb(servico)
      ]);
    }
  }
}

async function upsertFicha(client, ficha) {
  const fichaId = parseInteger(ficha?.id);
  if (!fichaId) return;

  const rawPayload = toJsonb(ficha);
  const result = await client.query(`
    INSERT INTO engenharia.iapp_fichas (
      id, identificacao, descricao, status, modelo,
      data_validade, qtde, qtde_batelada, qtde_referencia,
      produto, vcpp, vcp,
      data_criacao, data_ultima_atualizacao,
      usuario_criador, ultimo_usuario_atualizador,
      raw_payload, sincronizado_em
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12,
      $13, $14,
      $15, $16,
      $17, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      identificacao = EXCLUDED.identificacao,
      descricao = EXCLUDED.descricao,
      status = EXCLUDED.status,
      modelo = EXCLUDED.modelo,
      data_validade = EXCLUDED.data_validade,
      qtde = EXCLUDED.qtde,
      qtde_batelada = EXCLUDED.qtde_batelada,
      qtde_referencia = EXCLUDED.qtde_referencia,
      produto = EXCLUDED.produto,
      vcpp = EXCLUDED.vcpp,
      vcp = EXCLUDED.vcp,
      data_criacao = EXCLUDED.data_criacao,
      data_ultima_atualizacao = EXCLUDED.data_ultima_atualizacao,
      usuario_criador = EXCLUDED.usuario_criador,
      ultimo_usuario_atualizador = EXCLUDED.ultimo_usuario_atualizador,
      raw_payload = EXCLUDED.raw_payload,
      sincronizado_em = NOW()
    WHERE engenharia.iapp_fichas.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload
  `, [
    fichaId,
    normalizeText(ficha.identificacao),
    normalizeText(ficha.descricao),
    normalizeText(ficha.status),
    normalizeText(ficha.modelo),
    parseTimestamp(ficha.data_validade),
    parseNumeric(ficha.qtde),
    parseNumeric(ficha.qtde_batelada),
    parseNumeric(ficha.qtde_referencia),
    normalizeText(ficha.produto),
    parseNumeric(ficha.vcpp),
    parseNumeric(ficha.vcp),
    parseTimestamp(ficha.data_criacao),
    parseTimestamp(ficha.data_ultima_atualizacao),
    parseInteger(ficha.usuario_criador),
    parseInteger(ficha.ultimo_usuario_atualizador),
    rawPayload
  ]);

  if (result.rowCount > 0) {
    await replaceFichaChildren(client, fichaId, Array.isArray(ficha.operacoes) ? ficha.operacoes : []);
  }
}

async function upsertFichasBatch(client, fichas) {
  for (const ficha of fichas) {
    await upsertFicha(client, ficha);
  }
}

async function getTableCounts(client) {
  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM engenharia.iapp_fichas) AS fichas,
      (SELECT COUNT(*)::int FROM engenharia.iapp_fichas_operacoes) AS operacoes,
      (SELECT COUNT(*)::int FROM engenharia.iapp_fichas_operacao_materiais) AS materiais,
      (SELECT COUNT(*)::int FROM engenharia.iapp_fichas_operacao_subprodutos) AS subprodutos,
      (SELECT COUNT(*)::int FROM engenharia.iapp_fichas_operacao_checklists) AS checklists,
      (SELECT COUNT(*)::int FROM engenharia.iapp_fichas_operacao_servicos) AS servicos
  `);

  return rows[0] || {
    fichas: 0,
    operacoes: 0,
    materiais: 0,
    subprodutos: 0,
    checklists: 0,
    servicos: 0
  };
}

async function hasOperacoesReferenceTables(client) {
  const { rows } = await client.query(`
    SELECT
      to_regclass('engenharia.iapp_operacoes') IS NOT NULL AS has_operacoes,
      to_regclass('engenharia.iapp_operacoes_linha_producao') IS NOT NULL AS has_linhas,
      to_regclass('engenharia.iapp_operacoes_fase_produtiva') IS NOT NULL AS has_fases
  `);

  const row = rows[0] || {};
  return Boolean(row.has_operacoes && row.has_linhas && row.has_fases);
}

async function listEngenhariaFichasDb(options = {}) {
  const client = await dbGetClient();

  try {
    await ensureFichasTables(client);
    const hasOperacoesRefs = await hasOperacoesReferenceTables(client);

    const limit = parseInteger(options.limit);
    const params = [];
    let limitSql = '';
    const opIdentSql = hasOperacoesRefs ? 'op.identificacao' : 'NULL';
    const opDescSql = hasOperacoesRefs ? 'op.descricao' : 'NULL';
    const opUnidadeSql = hasOperacoesRefs ? 'COALESCE(fo.unidade, op.unidade)' : 'fo.unidade';
    const linhaSql = hasOperacoesRefs
      ? `CASE
          WHEN lp.id IS NOT NULL THEN json_build_object(
            'id', lp.id,
            'identificacao', lp.identificacao,
            'descricao', lp.descricao
          )
          ELSE NULL
        END`
      : 'NULL';
    const faseSql = hasOperacoesRefs
      ? `CASE
          WHEN fp.id IS NOT NULL THEN json_build_object(
            'id', fp.id,
            'descricao', fp.descricao
          )
          ELSE NULL
        END`
      : 'NULL';
    const joinsSql = hasOperacoesRefs
      ? `
          LEFT JOIN engenharia.iapp_operacoes op ON op.id = fo.operacao_id
          LEFT JOIN engenharia.iapp_operacoes_linha_producao lp ON lp.id = op.linha_producao_id
          LEFT JOIN engenharia.iapp_operacoes_fase_produtiva fp ON fp.id = op.fase_produtiva_id
        `
      : '';

    if (limit && limit > 0) {
      params.push(limit);
      limitSql = `LIMIT $${params.length}`;
    }

    const { rows } = await client.query(`
      SELECT
        f.id,
        f.identificacao,
        f.descricao,
        f.status,
        f.modelo,
        f.data_validade::text AS data_validade,
        f.qtde::text AS qtde,
        f.qtde_batelada::text AS qtde_batelada,
        f.qtde_referencia::text AS qtde_referencia,
        f.produto,
        f.vcpp::text AS vcpp,
        f.vcp::text AS vcp,
        f.data_criacao::text AS data_criacao,
        f.data_ultima_atualizacao::text AS data_ultima_atualizacao,
        f.sincronizado_em::text AS sincronizado_em,
        f.usuario_criador,
        f.ultimo_usuario_atualizador,
        (
          SELECT COUNT(*)::int
          FROM engenharia.iapp_fichas_operacoes fo
          WHERE fo.ficha_id = f.id
        ) AS total_operacoes,
        (
          SELECT COUNT(*)::int
          FROM engenharia.iapp_fichas_operacao_materiais mat
          WHERE mat.ficha_id = f.id
        ) AS total_materiais,
        (
          SELECT COUNT(*)::int
          FROM engenharia.iapp_fichas_operacao_subprodutos sub
          WHERE sub.ficha_id = f.id
        ) AS total_subprodutos,
        (
          SELECT COUNT(*)::int
          FROM engenharia.iapp_fichas_operacao_checklists chk
          WHERE chk.ficha_id = f.id
        ) AS total_checklists,
        (
          SELECT COUNT(*)::int
          FROM engenharia.iapp_fichas_operacao_servicos srv
          WHERE srv.ficha_id = f.id
        ) AS total_servicos,
        (
          SELECT COALESCE(json_agg(
            json_build_object(
              'item_index', fo.item_index,
              'operacao_id', fo.operacao_id,
              'identificacao', ${opIdentSql},
              'descricao', ${opDescSql},
              'unidade', ${opUnidadeSql},
              'tempo_operacao', fo.tempo_operacao::text,
              'tempo_preparacao', fo.tempo_preparacao::text,
              'tempo_espera', fo.tempo_espera::text,
              'tempo_transporte', fo.tempo_transporte::text,
              'tempo_fila', fo.tempo_fila::text,
              'tempo_total_pessimista', fo.tempo_total_pessimista::text,
              'tempo_total_otimista', fo.tempo_total_otimista::text,
              'valor_total', fo.valor_total::text,
              'capacidade', fo.capacidade::text,
              'meta', fo.meta::text,
              'linha_producao', ${linhaSql},
              'fase_produtiva', ${faseSql},
              'totais', json_build_object(
                'materiais', (
                  SELECT COUNT(*)::int
                  FROM engenharia.iapp_fichas_operacao_materiais mat
                  WHERE mat.ficha_id = fo.ficha_id
                    AND mat.operacao_item_index = fo.item_index
                ),
                'subprodutos', (
                  SELECT COUNT(*)::int
                  FROM engenharia.iapp_fichas_operacao_subprodutos sub
                  WHERE sub.ficha_id = fo.ficha_id
                    AND sub.operacao_item_index = fo.item_index
                ),
                'checklists', (
                  SELECT COUNT(*)::int
                  FROM engenharia.iapp_fichas_operacao_checklists chk
                  WHERE chk.ficha_id = fo.ficha_id
                    AND chk.operacao_item_index = fo.item_index
                ),
                'servicos', (
                  SELECT COUNT(*)::int
                  FROM engenharia.iapp_fichas_operacao_servicos srv
                  WHERE srv.ficha_id = fo.ficha_id
                    AND srv.operacao_item_index = fo.item_index
                )
              ),
              'materiais_preview', (
                SELECT COALESCE(json_agg(json_build_object(
                  'produto_id', mat_preview.produto_id,
                  'qtde', mat_preview.qtde::text,
                  'porcentagem', mat_preview.porcentagem::text
                ) ORDER BY mat_preview.item_index), '[]'::json)
                FROM (
                  SELECT item_index, produto_id, qtde, porcentagem
                  FROM engenharia.iapp_fichas_operacao_materiais
                  WHERE ficha_id = fo.ficha_id
                    AND operacao_item_index = fo.item_index
                  ORDER BY item_index
                  LIMIT 5
                ) mat_preview
              )
            )
            ORDER BY fo.item_index
          ), '[]'::json)
          FROM engenharia.iapp_fichas_operacoes fo
          ${joinsSql}
          WHERE fo.ficha_id = f.id
        ) AS operacoes
      FROM engenharia.iapp_fichas f
      ORDER BY COALESCE(f.data_ultima_atualizacao, f.data_criacao) DESC NULLS LAST, COALESCE(f.identificacao, '')
      ${limitSql}
    `, params);

    const metaQuery = await client.query(`
      SELECT
        COUNT(*)::int AS total_fichas,
        (SELECT COUNT(*)::int FROM engenharia.iapp_fichas_operacoes) AS total_operacoes,
        (SELECT COUNT(*)::int FROM engenharia.iapp_fichas_operacao_materiais) AS total_materiais,
        (SELECT COUNT(*)::int FROM engenharia.iapp_fichas_operacao_subprodutos) AS total_subprodutos,
        (SELECT COUNT(*)::int FROM engenharia.iapp_fichas_operacao_checklists) AS total_checklists,
        (SELECT COUNT(*)::int FROM engenharia.iapp_fichas_operacao_servicos) AS total_servicos,
        MAX(sincronizado_em)::text AS ultima_sincronizacao,
        MAX(data_ultima_atualizacao)::text AS ultima_atualizacao_iapp
      FROM engenharia.iapp_fichas
    `);

    return {
      fichas: rows,
      meta: metaQuery.rows[0] || {
        total_fichas: 0,
        total_operacoes: 0,
        total_materiais: 0,
        total_subprodutos: 0,
        total_checklists: 0,
        total_servicos: 0,
        ultima_sincronizacao: null,
        ultima_atualizacao_iapp: null
      }
    };
  } finally {
    client.release();
  }
}

async function syncEngenhariaFichasIapp(options = {}) {
  const offset = parseInteger(options.offset) || DEFAULT_OFFSET;
  const startPage = parseInteger(options.startPage) || 1;
  const maxPages = parseInteger(options.maxPages);
  const delayMs = parseInteger(options.delayMs) || DEFAULT_DELAY_MS;
  const logger = options.logger || console;

  const client = await dbGetClient();
  const startedAt = new Date().toISOString();

  try {
    await ensureFichasTables(client);

    let currentPage = startPage;
    let paginasProcessadas = 0;
    let registrosProcessados = 0;
    let totalInformadoApi = null;

    while (true) {
      if (paginasProcessadas > 0) {
        await sleep(delayMs);
      }

      const data = await iappGet('/engenharia/fichas/lista', {
        page: String(currentPage),
        offset: String(offset)
      });

      if (data.success === false) {
        const err = new Error(data.message || data.code || 'Falha ao consultar a API de fichas.');
        err.iappCode = data.code;
        throw err;
      }

      const fichas = Array.isArray(data.response) ? data.response : [];
      if (totalInformadoApi === null && data.total !== undefined) {
        totalInformadoApi = parseInteger(data.total);
      }

      if (!fichas.length) {
        break;
      }

      await client.query('BEGIN');
      try {
        await upsertFichasBatch(client, fichas);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      paginasProcessadas += 1;
      registrosProcessados += fichas.length;

      if (logger && typeof logger.log === 'function') {
        logger.log(`[engenharia-fichas-sync] página ${currentPage} processada com ${fichas.length} registro(s).`);
      }

      if (maxPages && paginasProcessadas >= maxPages) {
        break;
      }

      if (fichas.length < offset) {
        break;
      }

      currentPage += 1;
    }

    const counts = await getTableCounts(client);

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      offset,
      startPage,
      maxPages: maxPages || null,
      delayMs,
      paginasProcessadas,
      registrosProcessados,
      totalInformadoApi,
      tabelas: counts
    };
  } finally {
    client.release();
  }
}

async function syncEngenhariaFichasIappSerial(options = {}) {
  if (syncEmAndamento) return syncEmAndamento;

  syncEmAndamento = syncEngenhariaFichasIapp(options)
    .finally(() => {
      syncEmAndamento = null;
    });

  return syncEmAndamento;
}

function isEngenhariaFichasSyncRunning() {
  return Boolean(syncEmAndamento);
}

module.exports = {
  ensureFichasTables,
  listEngenhariaFichasDb,
  syncEngenhariaFichasIapp,
  syncEngenhariaFichasIappSerial,
  isEngenhariaFichasSyncRunning
};