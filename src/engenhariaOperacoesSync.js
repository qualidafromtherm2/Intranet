const https = require('https');
const { dbGetClient } = require('./db');

const IAPP_BASE = 'https://api.iniciativaaplicativos.com.br/api';
const DEFAULT_OFFSET = 100;
const DEFAULT_DELAY_MS = 300;
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

async function ensureOperacoesTables(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS engenharia;

    CREATE TABLE IF NOT EXISTS engenharia.iapp_operacoes_linha_producao (
      id INTEGER PRIMARY KEY,
      identificacao TEXT,
      descricao TEXT,
      raw_payload JSONB,
      sincronizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_iapp_operacoes_linha_producao_identificacao
      ON engenharia.iapp_operacoes_linha_producao (identificacao);

    CREATE TABLE IF NOT EXISTS engenharia.iapp_operacoes_fase_produtiva (
      id INTEGER PRIMARY KEY,
      descricao TEXT,
      raw_payload JSONB,
      sincronizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS engenharia.iapp_operacoes_grupo_maquinas (
      id INTEGER PRIMARY KEY,
      identificacao TEXT,
      descricao TEXT,
      raw_payload JSONB,
      sincronizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_iapp_operacoes_grupo_maquinas_identificacao
      ON engenharia.iapp_operacoes_grupo_maquinas (identificacao);

    CREATE TABLE IF NOT EXISTS engenharia.iapp_operacoes_funcionario_padrao (
      id INTEGER PRIMARY KEY,
      identificacao TEXT,
      nome TEXT,
      cracha TEXT,
      raw_payload JSONB,
      sincronizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_iapp_operacoes_funcionario_padrao_identificacao
      ON engenharia.iapp_operacoes_funcionario_padrao (identificacao);
    CREATE INDEX IF NOT EXISTS idx_iapp_operacoes_funcionario_padrao_cracha
      ON engenharia.iapp_operacoes_funcionario_padrao (cracha);

    CREATE TABLE IF NOT EXISTS engenharia.iapp_operacoes (
      id INTEGER PRIMARY KEY,
      identificacao TEXT,
      descricao TEXT,
      ordem INTEGER,
      unidade TEXT,
      valor_unidade_tempo NUMERIC(18,6),
      local TEXT,
      classificacao TEXT,
      capacidade_diaria NUMERIC(18,6),
      qtde_capacidade_diaria NUMERIC(18,6),
      qtde_meta NUMERIC(18,6),
      projeto JSONB,
      linha_producao_id INTEGER REFERENCES engenharia.iapp_operacoes_linha_producao (id) ON DELETE SET NULL,
      fase_produtiva_id INTEGER REFERENCES engenharia.iapp_operacoes_fase_produtiva (id) ON DELETE SET NULL,
      grupo_maquinas_id INTEGER REFERENCES engenharia.iapp_operacoes_grupo_maquinas (id) ON DELETE SET NULL,
      funcionario_padrao_id INTEGER REFERENCES engenharia.iapp_operacoes_funcionario_padrao (id) ON DELETE SET NULL,
      linha_producao JSONB,
      fase_produtiva JSONB,
      grupo_maquinas JSONB,
      funcionario_padrao JSONB,
      raw_payload JSONB NOT NULL,
      data_ultima_atualizacao TIMESTAMP,
      sincronizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_iapp_operacoes_identificacao
      ON engenharia.iapp_operacoes (identificacao);
    CREATE INDEX IF NOT EXISTS idx_iapp_operacoes_ordem
      ON engenharia.iapp_operacoes (ordem);
    CREATE INDEX IF NOT EXISTS idx_iapp_operacoes_classificacao
      ON engenharia.iapp_operacoes (classificacao);
    CREATE INDEX IF NOT EXISTS idx_iapp_operacoes_linha_producao_id
      ON engenharia.iapp_operacoes (linha_producao_id);
    CREATE INDEX IF NOT EXISTS idx_iapp_operacoes_fase_produtiva_id
      ON engenharia.iapp_operacoes (fase_produtiva_id);
    CREATE INDEX IF NOT EXISTS idx_iapp_operacoes_data_ultima_atualizacao
      ON engenharia.iapp_operacoes (data_ultima_atualizacao DESC);
  `);
}

async function listEngenhariaOperacoesDb(options = {}) {
  const client = await dbGetClient();

  try {
    await ensureOperacoesTables(client);

    const limit = parseInteger(options.limit);
    const params = [];
    let limitSql = '';

    if (limit && limit > 0) {
      params.push(limit);
      limitSql = `LIMIT $${params.length}`;
    }

    const { rows } = await client.query(`
      SELECT
        op.id,
        op.identificacao,
        op.descricao,
        op.ordem,
        op.unidade,
        op.valor_unidade_tempo::text AS valor_unidade_tempo,
        op.local,
        op.classificacao,
        op.capacidade_diaria::text AS capacidade_diaria,
        op.qtde_capacidade_diaria::text AS qtde_capacidade_diaria,
        op.qtde_meta::text AS qtde_meta,
        op.projeto,
        op.data_ultima_atualizacao::text AS data_ultima_atualizacao,
        op.sincronizado_em::text AS sincronizado_em,
        CASE
          WHEN lp.id IS NOT NULL THEN json_build_object(
            'id', lp.id,
            'identificacao', lp.identificacao,
            'descricao', lp.descricao
          )
          ELSE NULL
        END AS linha_producao,
        CASE
          WHEN fp.id IS NOT NULL THEN json_build_object(
            'id', fp.id,
            'descricao', fp.descricao
          )
          ELSE NULL
        END AS fase_produtiva,
        CASE
          WHEN gm.id IS NOT NULL THEN json_build_object(
            'id', gm.id,
            'identificacao', gm.identificacao,
            'descricao', gm.descricao
          )
          ELSE NULL
        END AS grupo_maquinas,
        CASE
          WHEN fu.id IS NOT NULL THEN json_build_object(
            'id', fu.id,
            'identificacao', fu.identificacao,
            'nome', fu.nome,
            'cracha', fu.cracha
          )
          ELSE NULL
        END AS funcionario_padrao
      FROM engenharia.iapp_operacoes op
      LEFT JOIN engenharia.iapp_operacoes_linha_producao lp ON lp.id = op.linha_producao_id
      LEFT JOIN engenharia.iapp_operacoes_fase_produtiva fp ON fp.id = op.fase_produtiva_id
      LEFT JOIN engenharia.iapp_operacoes_grupo_maquinas gm ON gm.id = op.grupo_maquinas_id
      LEFT JOIN engenharia.iapp_operacoes_funcionario_padrao fu ON fu.id = op.funcionario_padrao_id
      ORDER BY COALESCE(lp.descricao, ''), op.ordem NULLS LAST, COALESCE(op.identificacao, '')
      ${limitSql}
    `, params);

    const metaQuery = await client.query(`
      SELECT
        COUNT(*)::int AS total_operacoes,
        COUNT(DISTINCT op.linha_producao_id)::int AS linhas_producao,
        COUNT(DISTINCT op.fase_produtiva_id)::int AS fases_produtivas,
        COUNT(DISTINCT op.grupo_maquinas_id)::int AS grupos_maquinas,
        COUNT(DISTINCT op.funcionario_padrao_id)::int AS funcionarios_padrao,
        MAX(op.sincronizado_em)::text AS ultima_sincronizacao,
        MAX(op.data_ultima_atualizacao)::text AS ultima_atualizacao_iapp
      FROM engenharia.iapp_operacoes op
    `);

    return {
      operacoes: rows,
      meta: metaQuery.rows[0] || {
        total_operacoes: 0,
        linhas_producao: 0,
        fases_produtivas: 0,
        grupos_maquinas: 0,
        funcionarios_padrao: 0,
        ultima_sincronizacao: null,
        ultima_atualizacao_iapp: null
      }
    };
  } finally {
    client.release();
  }
}

async function upsertLinhaProducao(client, linhaProducao) {
  const id = parseInteger(linhaProducao?.id);
  if (!id) return null;

  await client.query(`
    INSERT INTO engenharia.iapp_operacoes_linha_producao (
      id, identificacao, descricao, raw_payload, sincronizado_em
    ) VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (id) DO UPDATE SET
      identificacao = EXCLUDED.identificacao,
      descricao = EXCLUDED.descricao,
      raw_payload = EXCLUDED.raw_payload,
      sincronizado_em = NOW()
    WHERE engenharia.iapp_operacoes_linha_producao.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload
  `, [
    id,
    normalizeText(linhaProducao?.identificacao),
    normalizeText(linhaProducao?.descricao),
    toJsonb(linhaProducao)
  ]);

  return id;
}

async function upsertFaseProdutiva(client, faseProdutiva) {
  const id = parseInteger(faseProdutiva?.id);
  if (!id) return null;

  await client.query(`
    INSERT INTO engenharia.iapp_operacoes_fase_produtiva (
      id, descricao, raw_payload, sincronizado_em
    ) VALUES ($1, $2, $3, NOW())
    ON CONFLICT (id) DO UPDATE SET
      descricao = EXCLUDED.descricao,
      raw_payload = EXCLUDED.raw_payload,
      sincronizado_em = NOW()
    WHERE engenharia.iapp_operacoes_fase_produtiva.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload
  `, [
    id,
    normalizeText(faseProdutiva?.descricao),
    toJsonb(faseProdutiva)
  ]);

  return id;
}

async function upsertGrupoMaquinas(client, grupoMaquinas) {
  const id = parseInteger(grupoMaquinas?.id);
  if (!id) return null;

  await client.query(`
    INSERT INTO engenharia.iapp_operacoes_grupo_maquinas (
      id, identificacao, descricao, raw_payload, sincronizado_em
    ) VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (id) DO UPDATE SET
      identificacao = EXCLUDED.identificacao,
      descricao = EXCLUDED.descricao,
      raw_payload = EXCLUDED.raw_payload,
      sincronizado_em = NOW()
    WHERE engenharia.iapp_operacoes_grupo_maquinas.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload
  `, [
    id,
    normalizeText(grupoMaquinas?.identificacao),
    normalizeText(grupoMaquinas?.descricao),
    toJsonb(grupoMaquinas)
  ]);

  return id;
}

async function upsertFuncionarioPadrao(client, funcionarioPadrao) {
  const id = parseInteger(funcionarioPadrao?.id);
  if (!id) return null;

  await client.query(`
    INSERT INTO engenharia.iapp_operacoes_funcionario_padrao (
      id, identificacao, nome, cracha, raw_payload, sincronizado_em
    ) VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET
      identificacao = EXCLUDED.identificacao,
      nome = EXCLUDED.nome,
      cracha = EXCLUDED.cracha,
      raw_payload = EXCLUDED.raw_payload,
      sincronizado_em = NOW()
    WHERE engenharia.iapp_operacoes_funcionario_padrao.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload
  `, [
    id,
    normalizeText(funcionarioPadrao?.identificacao),
    normalizeText(funcionarioPadrao?.nome),
    normalizeText(funcionarioPadrao?.cracha),
    toJsonb(funcionarioPadrao)
  ]);

  return id;
}

async function upsertOperacao(client, operacao) {
  const linhaProducaoId = await upsertLinhaProducao(client, operacao?.linha_producao);
  const faseProdutivaId = await upsertFaseProdutiva(client, operacao?.fase_produtiva);
  const grupoMaquinasId = await upsertGrupoMaquinas(client, operacao?.grupo_maquinas);
  const funcionarioPadraoId = await upsertFuncionarioPadrao(client, operacao?.funcionario_padrao);

  await client.query(`
    INSERT INTO engenharia.iapp_operacoes (
      id, identificacao, descricao, ordem, unidade,
      valor_unidade_tempo, local, classificacao,
      capacidade_diaria, qtde_capacidade_diaria, qtde_meta,
      projeto,
      linha_producao_id, fase_produtiva_id, grupo_maquinas_id, funcionario_padrao_id,
      linha_producao, fase_produtiva, grupo_maquinas, funcionario_padrao,
      raw_payload, data_ultima_atualizacao, sincronizado_em
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8,
      $9, $10, $11,
      $12,
      $13, $14, $15, $16,
      $17, $18, $19, $20,
      $21, $22, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      identificacao = EXCLUDED.identificacao,
      descricao = EXCLUDED.descricao,
      ordem = EXCLUDED.ordem,
      unidade = EXCLUDED.unidade,
      valor_unidade_tempo = EXCLUDED.valor_unidade_tempo,
      local = EXCLUDED.local,
      classificacao = EXCLUDED.classificacao,
      capacidade_diaria = EXCLUDED.capacidade_diaria,
      qtde_capacidade_diaria = EXCLUDED.qtde_capacidade_diaria,
      qtde_meta = EXCLUDED.qtde_meta,
      projeto = EXCLUDED.projeto,
      linha_producao_id = EXCLUDED.linha_producao_id,
      fase_produtiva_id = EXCLUDED.fase_produtiva_id,
      grupo_maquinas_id = EXCLUDED.grupo_maquinas_id,
      funcionario_padrao_id = EXCLUDED.funcionario_padrao_id,
      linha_producao = EXCLUDED.linha_producao,
      fase_produtiva = EXCLUDED.fase_produtiva,
      grupo_maquinas = EXCLUDED.grupo_maquinas,
      funcionario_padrao = EXCLUDED.funcionario_padrao,
      raw_payload = EXCLUDED.raw_payload,
      data_ultima_atualizacao = EXCLUDED.data_ultima_atualizacao,
      sincronizado_em = NOW()
    WHERE engenharia.iapp_operacoes.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload
  `, [
    parseInteger(operacao?.id),
    normalizeText(operacao?.identificacao),
    normalizeText(operacao?.descricao),
    parseInteger(operacao?.ordem),
    normalizeText(operacao?.unidade),
    parseNumeric(operacao?.valor_unidade_tempo),
    normalizeText(operacao?.local),
    normalizeText(operacao?.classificacao),
    parseNumeric(operacao?.capacidade_diaria),
    parseNumeric(operacao?.qtde_capacidade_diaria),
    parseNumeric(operacao?.qtde_meta),
    toJsonb(operacao?.projeto),
    linhaProducaoId,
    faseProdutivaId,
    grupoMaquinasId,
    funcionarioPadraoId,
    toJsonb(operacao?.linha_producao),
    toJsonb(operacao?.fase_produtiva),
    toJsonb(operacao?.grupo_maquinas),
    toJsonb(operacao?.funcionario_padrao),
    toJsonb(operacao),
    parseTimestamp(operacao?.data_ultima_atualizacao)
  ]);
}

async function upsertOperacoesBatch(client, operacoes) {
  for (const operacao of operacoes) {
    await upsertOperacao(client, operacao);
  }
}

async function getTableCounts(client) {
  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM engenharia.iapp_operacoes) AS operacoes,
      (SELECT COUNT(*)::int FROM engenharia.iapp_operacoes_linha_producao) AS linhas_producao,
      (SELECT COUNT(*)::int FROM engenharia.iapp_operacoes_fase_produtiva) AS fases_produtivas,
      (SELECT COUNT(*)::int FROM engenharia.iapp_operacoes_grupo_maquinas) AS grupos_maquinas,
      (SELECT COUNT(*)::int FROM engenharia.iapp_operacoes_funcionario_padrao) AS funcionarios_padrao
  `);

  return rows[0] || {
    operacoes: 0,
    linhas_producao: 0,
    fases_produtivas: 0,
    grupos_maquinas: 0,
    funcionarios_padrao: 0
  };
}

async function syncEngenhariaOperacoesIapp(options = {}) {
  const offset = parseInteger(options.offset) || DEFAULT_OFFSET;
  const startPage = parseInteger(options.startPage) || 1;
  const maxPages = parseInteger(options.maxPages);
  const delayMs = parseInteger(options.delayMs) || DEFAULT_DELAY_MS;
  const logger = options.logger || console;

  const client = await dbGetClient();
  const startedAt = new Date().toISOString();

  try {
    await ensureOperacoesTables(client);

    let currentPage = startPage;
    let paginasProcessadas = 0;
    let registrosProcessados = 0;
    let totalInformadoApi = null;

    while (true) {
      if (paginasProcessadas > 0) {
        await sleep(delayMs);
      }

      const data = await iappGet('/engenharia/operacoes/lista', {
        page: String(currentPage),
        offset: String(offset)
      });

      if (data.success === false) {
        const err = new Error(data.message || data.code || 'Falha ao consultar a API de operações.');
        err.iappCode = data.code;
        throw err;
      }

      const operacoes = Array.isArray(data.response) ? data.response : [];
      if (totalInformadoApi === null && data.total !== undefined) {
        totalInformadoApi = parseInteger(data.total);
      }

      if (!operacoes.length) {
        break;
      }

      await client.query('BEGIN');
      try {
        await upsertOperacoesBatch(client, operacoes);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      paginasProcessadas += 1;
      registrosProcessados += operacoes.length;

      if (logger && typeof logger.log === 'function') {
        logger.log(`[engenharia-operacoes-sync] página ${currentPage} processada com ${operacoes.length} registro(s).`);
      }

      if (maxPages && paginasProcessadas >= maxPages) {
        break;
      }

      if (operacoes.length < offset) {
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

async function syncEngenhariaOperacoesIappSerial(options = {}) {
  if (syncEmAndamento) return syncEmAndamento;

  syncEmAndamento = syncEngenhariaOperacoesIapp(options)
    .finally(() => {
      syncEmAndamento = null;
    });

  return syncEmAndamento;
}

module.exports = {
  syncEngenhariaOperacoesIapp,
  syncEngenhariaOperacoesIappSerial,
  listEngenhariaOperacoesDb,
  ensureOperacoesTables
};