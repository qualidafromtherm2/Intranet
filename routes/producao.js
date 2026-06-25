// routes/producao.js
// Integração com API IAPP (https://api.iniciativaaplicativos.com.br/api)
// Auth: headers { token, secret } — obtidos em Engrenagem > Minha Empresa > rodapé
// Env vars: IAPP_TOKEN, IAPP_SECRET
const express = require('express');
const https   = require('https');
const { dbQuery } = require('../src/db');

const router = express.Router();

const IAPP_BASE = 'https://api.iniciativaaplicativos.com.br/api';

/** Aguarda N milissegundos */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Faz uma requisição GET à API IAPP.
 * @param {string} path  ex: '/manufatura/ordens-producao/lista'
 * @param {object} params  query string params (offset, page, filters, etc.)
 */
function iappGet(path, params = {}) {
  return new Promise((resolve, reject) => {
    const token  = process.env.IAPP_TOKEN;
    const secret = process.env.IAPP_SECRET;

    if (!token || !secret) {
      return reject(new Error('IAPP_TOKEN e IAPP_SECRET não configurados no .env'));
    }

    const qs = new URLSearchParams(params).toString();
    const url = new URL(`${IAPP_BASE}${path}${qs ? '?' + qs : ''}`);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'token': token,
        'secret': secret,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (resp) => {
      let body = '';
      resp.on('data', chunk => { body += chunk; });
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
        } catch (e) {
          reject(new Error(`Resposta inválida da API IAPP: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Faz uma requisição PUT à API IAPP.
 * @param {string} path  ex: '/manufatura/ordens-producao/atualiza/2009270'
 * @param {object} body  payload JSON
 */
function iappPut(path, body = {}) {
  return new Promise((resolve, reject) => {
    const token  = process.env.IAPP_TOKEN;
    const secret = process.env.IAPP_SECRET;

    if (!token || !secret) {
      return reject(new Error('IAPP_TOKEN e IAPP_SECRET não configurados no .env'));
    }

    const payload = JSON.stringify(body);
    const url = new URL(`${IAPP_BASE}${path}`);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PUT',
      headers: {
        'token': token,
        'secret': secret,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (resp.statusCode >= 400) {
            const err = new Error(json.message || `HTTP ${resp.statusCode}`);
            err.status = resp.statusCode;
            err.iappCode = json.code;
            return reject(err);
          }
          resolve(json);
        } catch (e) {
          reject(new Error(`Resposta inválida da API IAPP: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/* ---------------------------------------------------------------
 * Schema Producao.Kanban_programacao — vínculo pedido → programado
 * --------------------------------------------------------------- */
let kanbanProgSchemaOk = false;

async function garantirSchemaKanbanProgramacao() {
  if (kanbanProgSchemaOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS "Producao"`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS "Producao"."Kanban_programacao" (
      id              BIGSERIAL PRIMARY KEY,
      codigo_produto  BIGINT,
      codigo          TEXT NOT NULL,
      descricao       TEXT,
      codigo_pedido   BIGINT NOT NULL,
      numero_pedido   TEXT,
      quantidade      NUMERIC(18,4) NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_kanban_prog_ped_cod
      ON "Producao"."Kanban_programacao" (codigo_pedido, codigo);
  `);
  await dbQuery(`ALTER TABLE "Producao"."Kanban_programacao" ADD COLUMN IF NOT EXISTS numero_op TEXT`);
  await dbQuery(`ALTER TABLE "Producao"."Kanban_programacao" ADD COLUMN IF NOT EXISTS op_iapp_id BIGINT`);
  await dbQuery(`ALTER TABLE "Producao"."Kanban_programacao" ADD COLUMN IF NOT EXISTS status TEXT`);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_kanban_prog_op_iapp
      ON "Producao"."Kanban_programacao" (op_iapp_id);
    CREATE INDEX IF NOT EXISTS idx_kanban_prog_numero_op
      ON "Producao"."Kanban_programacao" (numero_op);
  `);
  kanbanProgSchemaOk = true;
}

function normCodigoSql(expr) {
  return `UPPER(TRIM(COALESCE(${expr}, '')))`;
}

/* ---------------------------------------------------------------
 * Garante que o schema IAPP_API e as 3 tabelas existem (idempotente)
 * --------------------------------------------------------------- */
async function garantirTabela() {
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS "IAPP_API"`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS "IAPP_API".op_iapp_produto (
      produto_id            INTEGER       NOT NULL PRIMARY KEY,
      identificacao         TEXT,
      descricao             TEXT,
      unidade_medida        TEXT,
      ean                   TEXT,
      tipo                  TEXT,
      origem                TEXT,
      ncm                   TEXT,
      cest                  TEXT,
      status                TEXT,
      valor_venda           NUMERIC(18,6),
      valor_custo           NUMERIC(18,6),
      lucro_pretendido      NUMERIC(18,4),
      altura                NUMERIC(12,4),
      largura               NUMERIC(12,4),
      comprimento           NUMERIC(12,4),
      peso_bruto            NUMERIC(12,4),
      peso_liquido          NUMERIC(12,4),
      peso_tara             NUMERIC(12,4),
      area                  NUMERIC(12,4),
      diametro              NUMERIC(12,4),
      qtde_volume           NUMERIC(12,4),
      tipo_volume           TEXT,
      qtde_embalagem        NUMERIC(12,4),
      tipo_embalagem        TEXT,
      lote_minimo_compra    NUMERIC(12,4),
      maximo_empilhamentos  NUMERIC(12,4),
      qtde_seguranca        NUMERIC(12,4),
      qtde_minima           NUMERIC(12,4),
      grupo_id              INTEGER,
      grupo_identificacao   TEXT,
      grupo_descricao       TEXT,
      data_ultima_atualizacao TIMESTAMP,
      sincronizado_em       TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_iapp_produto_ident  ON "IAPP_API".op_iapp_produto (identificacao);
    CREATE INDEX IF NOT EXISTS idx_iapp_produto_tipo   ON "IAPP_API".op_iapp_produto (tipo);
    CREATE INDEX IF NOT EXISTS idx_iapp_produto_status ON "IAPP_API".op_iapp_produto (status);

    CREATE TABLE IF NOT EXISTS "IAPP_API".op_iapp (
      iapp_id               INTEGER       NOT NULL PRIMARY KEY,
      identificacao         TEXT,
      status                TEXT,
      produto_id            INTEGER  REFERENCES "IAPP_API".op_iapp_produto (produto_id) ON DELETE SET NULL,
      ficha_tecnica         INTEGER,
      linha_producao        INTEGER,
      qtde                  NUMERIC(18,4),
      tempo_total           NUMERIC(18,4),
      obs                   TEXT,
      cliente               JSONB,
      projeto               JSONB,
      origem                JSONB,
      documento             JSONB,
      data_abertura              TIMESTAMP,
      data_inicio                TIMESTAMP,
      data_final                 TIMESTAMP,
      data_encerramento          TIMESTAMP,
      data_previsao_faturamento  TIMESTAMP,
      data_previsao_entrega      TIMESTAMP,
      data_ultima_atualizacao    TIMESTAMP,
      sincronizado_em       TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_iapp_op_status          ON "IAPP_API".op_iapp (status);
    CREATE INDEX IF NOT EXISTS idx_iapp_op_produto_id      ON "IAPP_API".op_iapp (produto_id);
    CREATE INDEX IF NOT EXISTS idx_iapp_op_data_abertura   ON "IAPP_API".op_iapp (data_abertura DESC);
    CREATE INDEX IF NOT EXISTS idx_iapp_op_ult_atualizacao ON "IAPP_API".op_iapp (data_ultima_atualizacao DESC);

    CREATE TABLE IF NOT EXISTS "IAPP_API".op_iapp_os (
      os_id                 INTEGER       NOT NULL PRIMARY KEY,
      op_iapp_id            INTEGER       NOT NULL REFERENCES "IAPP_API".op_iapp (iapp_id) ON DELETE CASCADE,
      identificacao         TEXT,
      status                TEXT,
      operacao              TEXT,
      grupo_equipamentos    JSONB,
      equipamento           JSONB,
      projeto               JSONB,
      tempo_total           NUMERIC(18,4),
      data_abertura         TIMESTAMP,
      data_inicio           TIMESTAMP,
      data_final            TIMESTAMP,
      data_encerramento     TIMESTAMP,
      data_ultima_atualizacao TIMESTAMP,
      sincronizado_em       TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_iapp_os_op_id  ON "IAPP_API".op_iapp_os (op_iapp_id);
    CREATE INDEX IF NOT EXISTS idx_iapp_os_status ON "IAPP_API".op_iapp_os (status);
  `);

  await dbQuery(`ALTER TABLE "IAPP_API".op_iapp_os ADD COLUMN IF NOT EXISTS status_producao TEXT`);
  await dbQuery(`ALTER TABLE "IAPP_API".op_iapp_os ADD COLUMN IF NOT EXISTS operador TEXT`);
  await dbQuery(`ALTER TABLE "IAPP_API".op_iapp_os ADD COLUMN IF NOT EXISTS data_status_producao TIMESTAMP`);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS "IAPP_API".op_iapp_os_parada (
      parada_id     SERIAL PRIMARY KEY,
      os_id         INTEGER NOT NULL REFERENCES "IAPP_API".op_iapp_os (os_id) ON DELETE CASCADE,
      op_iapp_id    INTEGER NOT NULL,
      data_parada   TIMESTAMP NOT NULL DEFAULT NOW(),
      operador      TEXT,
      motivo        TEXT NOT NULL,
      data_retorno  TIMESTAMP
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_iapp_os_parada_os
      ON "IAPP_API".op_iapp_os_parada (os_id, data_parada DESC)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_iapp_os_parada_aberta
      ON "IAPP_API".op_iapp_os_parada (os_id)
      WHERE data_retorno IS NULL
  `);
}

let tabelaGarantida = false;

function getOperador(req) {
  return (
    req.session?.user?.fullName
    || req.session?.user?.username
    || req.session?.user?.login
    || String(req.headers['x-user'] || '').trim()
    || 'sistema'
  );
}

function requireAuth(req, res, next) {
  if (!req.session?.user?.id && !req.session?.user?.username) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  next();
}

/* ---------------------------------------------------------------
 * Upsert nas 3 tabelas (schema IAPP_API) para um lote de OPs
 * --------------------------------------------------------------- */
function parseTs(v) { return v || null; }

async function upsertOps(ops) {
  if (!ops.length) return;
  for (const op of ops) {
    const p = op.produto || {};

    // 1. Upsert produto
    if (p.id) {
      await dbQuery(`
        INSERT INTO "IAPP_API".op_iapp_produto (
          produto_id, identificacao, descricao, unidade_medida, ean,
          tipo, origem, ncm, cest, status,
          valor_venda, valor_custo, lucro_pretendido,
          altura, largura, comprimento, peso_bruto, peso_liquido, peso_tara, area, diametro,
          qtde_volume, tipo_volume, qtde_embalagem, tipo_embalagem,
          lote_minimo_compra, maximo_empilhamentos, qtde_seguranca, qtde_minima,
          grupo_id, grupo_identificacao, grupo_descricao,
          data_ultima_atualizacao, sincronizado_em
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,
          $11,$12,$13,
          $14,$15,$16,$17,$18,$19,$20,$21,
          $22,$23,$24,$25,
          $26,$27,$28,$29,
          $30,$31,$32,
          $33, NOW()
        )
        ON CONFLICT (produto_id) DO UPDATE SET
          identificacao        = EXCLUDED.identificacao,
          descricao            = EXCLUDED.descricao,
          unidade_medida       = EXCLUDED.unidade_medida,
          ean                  = EXCLUDED.ean,
          tipo                 = EXCLUDED.tipo,
          origem               = EXCLUDED.origem,
          ncm                  = EXCLUDED.ncm,
          cest                 = EXCLUDED.cest,
          status               = EXCLUDED.status,
          valor_venda          = EXCLUDED.valor_venda,
          valor_custo          = EXCLUDED.valor_custo,
          lucro_pretendido     = EXCLUDED.lucro_pretendido,
          altura               = EXCLUDED.altura,
          largura              = EXCLUDED.largura,
          comprimento          = EXCLUDED.comprimento,
          peso_bruto           = EXCLUDED.peso_bruto,
          peso_liquido         = EXCLUDED.peso_liquido,
          peso_tara            = EXCLUDED.peso_tara,
          area                 = EXCLUDED.area,
          diametro             = EXCLUDED.diametro,
          qtde_volume          = EXCLUDED.qtde_volume,
          tipo_volume          = EXCLUDED.tipo_volume,
          qtde_embalagem       = EXCLUDED.qtde_embalagem,
          tipo_embalagem       = EXCLUDED.tipo_embalagem,
          lote_minimo_compra   = EXCLUDED.lote_minimo_compra,
          maximo_empilhamentos = EXCLUDED.maximo_empilhamentos,
          qtde_seguranca       = EXCLUDED.qtde_seguranca,
          qtde_minima          = EXCLUDED.qtde_minima,
          grupo_id             = EXCLUDED.grupo_id,
          grupo_identificacao  = EXCLUDED.grupo_identificacao,
          grupo_descricao      = EXCLUDED.grupo_descricao,
          data_ultima_atualizacao = EXCLUDED.data_ultima_atualizacao,
          sincronizado_em      = NOW()
      `, [
        p.id, p.identificacao || null, p.descricao || null, p.unidade_medida || null, p.ean || null,
        p.tipo || null, p.origem || null, p.ncm || null, p.cest || null, p.status || null,
        p.valor_venda ?? null, p.valor_custo ?? null, p.lucro_pretendido ?? null,
        p.altura ?? null, p.largura ?? null, p.comprimento ?? null,
        p.peso_bruto ?? null, p.peso_liquido ?? null, p.peso_tara ?? null,
        p.area ?? null, p.diametro ?? null,
        p.qtde_volume ?? null, p.tipo_volume || null, p.qtde_embalagem ?? null, p.tipo_embalagem || null,
        p.lote_minimo_compra ?? null, p.maximo_empilhamentos ?? null,
        p.qtde_seguranca ?? null, p.qtde_minima ?? null,
        p.grupo?.id || null, p.grupo?.identificacao || null, p.grupo?.descricao || null,
        parseTs(p.data_ultima_atualizacao)
      ]);
    }

    // 2. Upsert OP
    await dbQuery(`
      INSERT INTO "IAPP_API".op_iapp (
        iapp_id, identificacao, status,
        produto_id, ficha_tecnica, linha_producao,
        qtde, tempo_total, obs,
        cliente, projeto, origem, documento,
        data_abertura, data_inicio, data_final, data_encerramento,
        data_previsao_faturamento, data_previsao_entrega, data_ultima_atualizacao,
        sincronizado_em
      ) VALUES (
        $1,$2,$3,
        $4,$5,$6,
        $7,$8,$9,
        $10,$11,$12,$13,
        $14,$15,$16,$17,
        $18,$19,$20,
        NOW()
      )
      ON CONFLICT (iapp_id) DO UPDATE SET
        identificacao         = EXCLUDED.identificacao,
        status                = EXCLUDED.status,
        produto_id            = EXCLUDED.produto_id,
        ficha_tecnica         = EXCLUDED.ficha_tecnica,
        linha_producao        = EXCLUDED.linha_producao,
        qtde                  = EXCLUDED.qtde,
        tempo_total           = EXCLUDED.tempo_total,
        obs                   = EXCLUDED.obs,
        cliente               = EXCLUDED.cliente,
        projeto               = EXCLUDED.projeto,
        origem                = EXCLUDED.origem,
        documento             = EXCLUDED.documento,
        data_abertura              = EXCLUDED.data_abertura,
        data_inicio                = EXCLUDED.data_inicio,
        data_final                 = EXCLUDED.data_final,
        data_encerramento          = EXCLUDED.data_encerramento,
        data_previsao_faturamento  = EXCLUDED.data_previsao_faturamento,
        data_previsao_entrega      = EXCLUDED.data_previsao_entrega,
        data_ultima_atualizacao    = EXCLUDED.data_ultima_atualizacao,
        sincronizado_em            = NOW()
    `, [
      op.id, op.identificacao, op.status,
      p.id || null, op.ficha_tecnica || null, op.linha_producao || null,
      op.qtde ?? null, op.tempo_total ?? null, op.obs || null,
      op.cliente ? JSON.stringify(op.cliente) : null,
      op.projeto ? JSON.stringify(op.projeto) : null,
      op.origem  ? JSON.stringify(op.origem)  : null,
      op.documento ? JSON.stringify(op.documento) : null,
      parseTs(op.data_abertura), parseTs(op.data_inicio), parseTs(op.data_final),
      parseTs(op.data_encerramento), parseTs(op.data_previsao_faturamento),
      parseTs(op.data_previsao_entrega), parseTs(op.data_ultima_atualizacao)
    ]);

    // 3. Upsert OSs (ordens de serviço)
    const oss = Array.isArray(op.ordens_servico) ? op.ordens_servico : [];
    for (const os of oss) {
      await dbQuery(`
        INSERT INTO "IAPP_API".op_iapp_os (
          os_id, op_iapp_id, identificacao, status, operacao,
          grupo_equipamentos, equipamento, projeto, tempo_total,
          data_abertura, data_inicio, data_final, data_encerramento,
          data_ultima_atualizacao, sincronizado_em
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,
          $10,$11,$12,$13,
          $14, NOW()
        )
        ON CONFLICT (os_id) DO UPDATE SET
          op_iapp_id         = EXCLUDED.op_iapp_id,
          identificacao      = EXCLUDED.identificacao,
          status             = EXCLUDED.status,
          operacao           = EXCLUDED.operacao,
          grupo_equipamentos = EXCLUDED.grupo_equipamentos,
          equipamento        = EXCLUDED.equipamento,
          projeto            = EXCLUDED.projeto,
          tempo_total        = EXCLUDED.tempo_total,
          data_abertura      = EXCLUDED.data_abertura,
          data_inicio        = EXCLUDED.data_inicio,
          data_final         = EXCLUDED.data_final,
          data_encerramento  = EXCLUDED.data_encerramento,
          data_ultima_atualizacao = EXCLUDED.data_ultima_atualizacao,
          sincronizado_em    = NOW()
      `, [
        os.id, op.id, os.identificacao || null, os.status || null, os.operacao || null,
        os.grupo_equipamentos ? JSON.stringify(os.grupo_equipamentos) : null,
        os.equipamento        ? JSON.stringify(os.equipamento)        : null,
        os.projeto            ? JSON.stringify(os.projeto)            : null,
        os.tempo_total ?? null,
        parseTs(os.data_abertura), parseTs(os.data_inicio), parseTs(os.data_final),
        parseTs(os.data_encerramento), parseTs(os.data_ultima_atualizacao)
      ]);
    }
  }
}

/* ---------------------------------------------------------------
 * syncEncerradosBackground()
 * Busca OPs com status ENCERRADO no IAPP e persiste no DB (schema IAPP_API).
 * Usa smart-stop: se uma página inteira já está no DB como ENCERRADO,
 * as páginas mais antigas também estão → para a paginação.
 * Chamada automaticamente após cada GET /ordens (setImmediate).
 * --------------------------------------------------------------- */
let syncEncerradosEmAndamento = false;

async function syncEncerradosBackground() {
  if (syncEncerradosEmAndamento) return;
  syncEncerradosEmAndamento = true;

  try {
    if (!tabelaGarantida) {
      await garantirTabela();
      tabelaGarantida = true;
    }

    const OFFSET    = 100;
    const INTERVALO = Math.ceil(1000 / 3); // 3 req/s

    // Carrega encerrados já no DB para evitar upserts desnecessários
    let encerradosNoDb = new Set();
    try {
      const r = await dbQuery(`SELECT iapp_id FROM "IAPP_API".op_iapp WHERE status = 'ENCERRADO'`);
      encerradosNoDb = new Set(r.rows.map(row => row.iapp_id));
    } catch (e) {
      console.warn('[producao] syncEncerrados: não foi possível carregar cache:', e.message);
    }

    let page = 1;
    let totalUpserted = 0;

    while (true) {
      if (page > 1) await sleep(INTERVALO);
      const r = await iappGet('/manufatura/ordens-producao/lista', {
        offset:    OFFSET,
        sort_by:   'data_abertura',
        sort_type: 'DESC',
        status:    'ENCERRADO',
        page
      });
      const records = Array.isArray(r.response) ? r.response : [];
      if (records.length === 0) break;

      // Smart-stop: se todos nesta página já estão no DB → para
      if (records.every(op => encerradosNoDb.has(op.id))) {
        console.log(`[producao] syncEncerrados: página ${page} toda cacheada — encerrando.`);
        break;
      }

      // Upsert apenas os ainda não cacheados
      const paraUpsert = records.filter(op => !encerradosNoDb.has(op.id));
      if (paraUpsert.length > 0) {
        await upsertOps(paraUpsert);
        totalUpserted += paraUpsert.length;
      }

      if (records.length < OFFSET) break;
      page++;
    }

    console.log(`[producao] syncEncerrados concluído: ${totalUpserted} upsertados em IAPP_API.`);
  } catch (err) {
    console.error('[producao] Erro no sync ENCERRADOS:', err.message);
  } finally {
    syncEncerradosEmAndamento = false;
  }
}

/* ---------------------------------------------------------------
 * fromDb(onlyMontagem)
 * Lê ordens do cache DB (rápido). Usado na carga inicial do kanban.
 * onlyMontagem=false → status='A PRODUZIR'
 * onlyMontagem=true  → status!='ENCERRADO' + produto.tipo='04 - Produto Acabado'
 * --------------------------------------------------------------- */
async function fromDb(onlyMontagem = false) {
  const whereExtra = onlyMontagem
    ? `AND op.status != 'ENCERRADO' AND TRIM(COALESCE(p.tipo,'')) = '04 - Produto Acabado'`
    : `AND op.status = 'A PRODUZIR'`;

  const { rows } = await dbQuery(`
    SELECT
      op.iapp_id                         AS id,
      op.identificacao,
      op.status,
      op.qtde::text                      AS qtde,
      op.tempo_total,
      op.ficha_tecnica,
      op.linha_producao,
      op.obs,
      op.cliente,
      op.projeto,
      op.origem,
      op.documento,
      op.data_abertura::text             AS data_abertura,
      op.data_inicio::text               AS data_inicio,
      op.data_final::text                AS data_final,
      op.data_encerramento::text         AS data_encerramento,
      op.data_previsao_faturamento::text AS data_previsao_faturamento,
      op.data_previsao_entrega::text     AS data_previsao_entrega,
      op.data_ultima_atualizacao::text   AS data_ultima_atualizacao,
      op.sincronizado_em::text           AS sincronizado_em,
      CASE WHEN p.produto_id IS NOT NULL THEN json_build_object(
        'id',             p.produto_id,
        'identificacao',  p.identificacao,
        'descricao',      p.descricao,
        'tipo',           p.tipo,
        'valor_custo',    p.valor_custo::text,
        'valor_venda',    p.valor_venda::text,
        'unidade_medida', p.unidade_medida,
        'status',         p.status
      ) ELSE NULL END AS produto,
      COALESCE(
        json_agg(json_build_object(
          'id',                    os.os_id,
          'identificacao',         os.identificacao,
          'status',                os.status,
          'operacao',              os.operacao,
          'tempo_total',           os.tempo_total::text,
          'data_abertura',         os.data_abertura::text,
          'data_inicio',           os.data_inicio::text,
          'data_final',            os.data_final::text,
          'data_encerramento',     os.data_encerramento::text,
          'status_producao',       os.status_producao,
          'operador',              os.operador,
          'data_status_producao',  os.data_status_producao::text
        ) ORDER BY os.os_id) FILTER (WHERE os.os_id IS NOT NULL),
        '[]'::json
      ) AS ordens_servico
    FROM "IAPP_API".op_iapp op
    LEFT JOIN "IAPP_API".op_iapp_produto p  ON p.produto_id  = op.produto_id
    LEFT JOIN "IAPP_API".op_iapp_os      os ON os.op_iapp_id = op.iapp_id
    WHERE 1=1 ${whereExtra}
    GROUP BY
      op.iapp_id, op.identificacao, op.status, op.qtde, op.tempo_total,
      op.ficha_tecnica, op.linha_producao, op.obs, op.cliente, op.projeto,
      op.origem, op.documento, op.data_abertura, op.data_inicio, op.data_final,
      op.data_encerramento, op.data_previsao_faturamento, op.data_previsao_entrega,
      op.data_ultima_atualizacao, op.sincronizado_em,
      p.produto_id, p.identificacao, p.descricao, p.tipo,
      p.valor_custo, p.valor_venda, p.unidade_medida, p.status
    ORDER BY op.data_abertura DESC NULLS LAST
  `);
  return rows;
}

/* ---------------------------------------------------------------
 * GET /api/producao/ordens
 * Carga rápida do cache DB. Front chama /sync-ativas em seguida.
 * --------------------------------------------------------------- */
router.get('/ordens', async (req, res) => {
  try {
    if (!tabelaGarantida) { await garantirTabela(); tabelaGarantida = true; }
    const ordens = await fromDb(false);
    const agora  = new Date().toISOString();
    setImmediate(() => syncEncerradosBackground());
    return res.json({ success: true, total_consultado: ordens.length, total_ativas: ordens.length, ordens, sincronizado_em: agora, from_db: true });
  } catch (err) {
    console.error('[producao] Erro ao ler ordens do DB:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------
 * GET /api/producao/ordens-montagem
 * Carga rápida do cache DB (produto.tipo='04 - Produto Acabado').
 * --------------------------------------------------------------- */
router.get('/ordens-montagem', async (req, res) => {
  try {
    if (!tabelaGarantida) { await garantirTabela(); tabelaGarantida = true; }
    const ordens = await fromDb(true);
    const agora  = new Date().toISOString();
    setImmediate(() => syncEncerradosBackground());
    return res.json({ success: true, total_consultado: ordens.length, total_ativas: ordens.length, ordens, sincronizado_em: agora, from_db: true });
  } catch (err) {
    console.error('[producao] Erro ao ler montagem do DB:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------
 * POST /api/producao/sync
 * Força sincronização manual de ENCERRADOS no DB (uso administrativo).
 * --------------------------------------------------------------- */
router.post('/sync', async (req, res) => {
  setImmediate(() => syncEncerradosBackground());
  return res.json({ success: true, message: 'Sync de ENCERRADOS iniciado em background.' });
});

/* ---------------------------------------------------------------
 * GET /api/producao/sync-ativas
 * Busca registros ativos direto do IAPP, faz upsert no DB e retorna
 * a lista atualizada. Chamado pelo front após carga rápida do DB.
 * Query param: ?montagem=1 para painel Produção Montagem.
 * --------------------------------------------------------------- */
router.get('/sync-ativas', async (req, res) => {
  const onlyMontagem = req.query.montagem === '1';
  try {
    if (!tabelaGarantida) { await garantirTabela(); tabelaGarantida = true; }

    if (!process.env.IAPP_TOKEN || !process.env.IAPP_SECRET) {
      return res.status(500).json({ error: 'IAPP_TOKEN e IAPP_SECRET não configurados.' });
    }

    const OFFSET    = 100;
    const INTERVALO = Math.ceil(1000 / 3); // 3 req/s
    const TIPO_ALVO = '04 - Produto Acabado';
    const todasOPs  = [];
    let   page      = 1;

    if (onlyMontagem) {
      // Todos os status (smart-stop quando página inteira ENCERRADO)
      while (true) {
        if (page > 1) await sleep(INTERVALO);
        const r = await iappGet('/manufatura/ordens-producao/lista', {
          offset: OFFSET, sort_by: 'data_abertura', sort_type: 'DESC', page
        });
        const records = Array.isArray(r.response) ? r.response : [];
        if (records.length === 0) break;
        if (records.every(op => op.status === 'ENCERRADO')) break;
        todasOPs.push(...records.filter(op => op.status !== 'ENCERRADO'));
        if (records.length < OFFSET) break;
        page++;
      }
    } else {
      // Somente A PRODUZIR
      while (true) {
        if (page > 1) await sleep(INTERVALO);
        const r = await iappGet('/manufatura/ordens-producao/lista', {
          offset: OFFSET, sort_by: 'data_abertura', sort_type: 'DESC', status: 'A PRODUZIR', page
        });
        const records = Array.isArray(r.response) ? r.response : [];
        todasOPs.push(...records.filter(op => op.status === 'A PRODUZIR'));
        if (records.length < OFFSET) break;
        page++;
      }
    }

    console.log(`[producao] sync-ativas (montagem=${onlyMontagem}): ${todasOPs.length} OPs em ${page} pág.`);

    // Upsert no DB para manter cache atualizado
    if (todasOPs.length > 0) await upsertOps(todasOPs);

    // Retorna lista atualizada do DB (já inclui os recém-upsertados)
    const ordens = await fromDb(onlyMontagem);
    const agora  = new Date().toISOString();

    setImmediate(() => syncEncerradosBackground());

    return res.json({ success: true, total_consultado: ordens.length, total_ativas: ordens.length, ordens, sincronizado_em: agora, from_iapp: true });
  } catch (err) {
    console.error('[producao] Erro em sync-ativas:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/** Enriquece itens IAPP com estoque físico (logistica.estoque_atual.fisico) por produto.identificacao = codigo */
async function enrichMateriaisComFisico(itens) {
  if (!Array.isArray(itens) || !itens.length) return itens;

  const codigos = [...new Set(
    itens.map(i => String(i.produto?.identificacao || '').trim()).filter(Boolean)
  )];
  if (!codigos.length) return itens;

  const norms = codigos.map(c => c.toUpperCase());
  const result = await dbQuery(`
    SELECT UPPER(BTRIM(codigo)) AS codigo_norm, COALESCE(SUM(fisico), 0) AS fisico
    FROM logistica.estoque_atual
    WHERE UPPER(BTRIM(codigo)) = ANY($1::text[])
    GROUP BY UPPER(BTRIM(codigo))
  `, [norms]);

  const byNorm = {};
  for (const row of result.rows) {
    byNorm[row.codigo_norm] = Number(row.fisico) || 0;
  }

  return itens.map(item => {
    const cod = String(item.produto?.identificacao || '').trim();
    const norm = cod.toUpperCase();
    return {
      ...item,
      estoque_fisico: Object.prototype.hasOwnProperty.call(byNorm, norm) ? byNorm[norm] : null
    };
  });
}

/* ---------------------------------------------------------------
 * GET /api/producao/materiais-previstos/:id
 * Proxy para IAPP /manufatura/ordens-producao/busca/{id}/materiais-previstos
 * Aceita o iapp_id da OP (op.id no frontend) ou, via ?tipo=os, o os_id.
 * Retorna o JSON bruto da API IAPP.
 * --------------------------------------------------------------- */
router.get('/materiais-previstos/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const data = await iappGet(`/manufatura/ordens-producao/busca/${id}/materiais-previstos`);
    if (Array.isArray(data.response)) {
      data.response = await enrichMateriaisComFisico(data.response);
    }
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, iappCode: err.iappCode });
  }
});

/* ---------------------------------------------------------------
 * GET /api/producao/apontamentos/:id
 * Proxy para IAPP /manufatura/ordens-producao/busca/{id}/producao
 * {id} = iapp_id da OP (op.id no frontend / op_iapp.iapp_id no DB).
 * Retorna listagem de apontamentos de produção realizados na OP.
 * --------------------------------------------------------------- */
router.get('/apontamentos/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const data = await iappGet(`/manufatura/ordens-producao/busca/${id}/producao`);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, iappCode: err.iappCode });
  }
});

/* ---------------------------------------------------------------
 * GET /api/producao/ordem/:id
 * Proxy para IAPP GET Consultar - /manufatura/ordens-producao/busca/{id}
 * {id} = iapp_id da OP (op.id no frontend / op_iapp.iapp_id no DB).
 * Retorna os dados completos da OP (produto, OSs, datas, status, etc.).
 * --------------------------------------------------------------- */
router.get('/ordem/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const data = await iappGet(`/manufatura/ordens-producao/busca/${id}`);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, iappCode: err.iappCode });
  }
});

/* ---------------------------------------------------------------
 * PUT /api/producao/ordem/:id
 * Proxy para IAPP PUT Atualizar - /manufatura/ordens-producao/atualiza/{id}
 * Body: campos parciais da OP (ex.: { obs: "..." } ou { data_previsao_entrega: "..." }).
 * --------------------------------------------------------------- */
router.put('/ordem/:id', express.json(), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!Object.keys(body).length) {
      return res.status(400).json({ error: 'Body vazio — informe ao menos um campo para atualizar.' });
    }
    const data = await iappPut(`/manufatura/ordens-producao/atualiza/${id}`, body);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, iappCode: err.iappCode });
  }
});

/* ---------------------------------------------------------------
 * GET /api/producao/os-materiais/:id
 * Proxy para IAPP GET Materiais - /manufatura/ordens-servico/busca/{id}/materiais
 * {id} = os_id da OS (os.id no frontend / op_iapp_os.os_id no DB).
 * Retorna materiais vinculados à ordem de serviço (ex.: MONTAGEM 0002673.05).
 * --------------------------------------------------------------- */
router.get('/os-materiais/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const data = await iappGet(`/manufatura/ordens-servico/busca/${id}/materiais`);
    if (Array.isArray(data.response)) {
      data.response = await enrichMateriaisComFisico(data.response);
    }
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, iappCode: err.iappCode });
  }
});

/* ---------------------------------------------------------------
 * POST /api/producao/estoque-fisico
 * Retorna estoque físico (logistica.estoque_atual.fisico) por código de produto.
 * Body: { codigos: string[] }
 * Response: { fisico: { [codigo]: number } }
 * --------------------------------------------------------------- */
router.post('/estoque-fisico', async (req, res) => {
  try {
    const codigos = Array.isArray(req.body?.codigos)
      ? [...new Set(req.body.codigos.map(c => String(c || '').trim()).filter(Boolean))]
      : [];
    if (!codigos.length) return res.json({ fisico: {} });

    const norms = codigos.map(c => c.toUpperCase());
    const result = await dbQuery(`
      SELECT UPPER(BTRIM(codigo)) AS codigo_norm, COALESCE(SUM(fisico), 0) AS fisico
      FROM logistica.estoque_atual
      WHERE UPPER(BTRIM(codigo)) = ANY($1::text[])
      GROUP BY UPPER(BTRIM(codigo))
    `, [norms]);

    const byNorm = {};
    for (const row of result.rows) {
      byNorm[row.codigo_norm] = Number(row.fisico) || 0;
    }

    const fisico = {};
    for (const cod of codigos) {
      const norm = cod.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(byNorm, norm)) {
        fisico[cod] = byNorm[norm];
      }
    }
    return res.json({ fisico });
  } catch (err) {
    console.error('[producao] estoque-fisico:', err.message);
    return res.status(500).json({ error: err.message || 'Erro ao consultar estoque físico.' });
  }
});

/* ---------------------------------------------------------------
 * GET /api/producao/iapp/qualidade/inspecoes/lista?page=1&offset=100
 * Proxy enxuto para listar inspeções da IAPP.
 * --------------------------------------------------------------- */
/* ---------------------------------------------------------------
 * POST /api/producao/os/:osId/iniciar
 * Registra início ou retorno de produção na OS (Intranet).
 * --------------------------------------------------------------- */
router.post('/os/:osId/iniciar', requireAuth, async (req, res) => {
  const osId = Number.parseInt(String(req.params.osId || ''), 10);
  if (!Number.isFinite(osId) || osId <= 0) {
    return res.status(400).json({ error: 'osId inválido.' });
  }

  try {
    if (!tabelaGarantida) { await garantirTabela(); tabelaGarantida = true; }

    const operador = getOperador(req);
    const atual = await dbQuery(`
      SELECT os_id, op_iapp_id, status_producao
      FROM "IAPP_API".op_iapp_os
      WHERE os_id = $1
    `, [osId]);

    if (!atual.rows.length) {
      return res.status(404).json({ error: 'Ordem de serviço não encontrada.' });
    }

    const row = atual.rows[0];
    const statusAtual = String(row.status_producao || '').trim();
    const retomando = statusAtual.toLowerCase() === 'parado';
    const novoStatus = retomando ? 'Produzindo' : 'Iniciado';

    if (statusAtual && !retomando && ['iniciado', 'produzindo'].includes(statusAtual.toLowerCase())) {
      return res.json({
        success: true,
        already_active: true,
        os_id: osId,
        status_producao: statusAtual,
        operador: operador,
        message: 'Produção já está em andamento.'
      });
    }

    await dbQuery(`
      UPDATE "IAPP_API".op_iapp_os
      SET status_producao = $2,
          operador = $3,
          data_status_producao = NOW()
      WHERE os_id = $1
    `, [osId, novoStatus, operador]);

    if (retomando) {
      await dbQuery(`
        UPDATE "IAPP_API".op_iapp_os_parada
        SET data_retorno = NOW()
        WHERE os_id = $1 AND data_retorno IS NULL
      `, [osId]);
    }

    const updated = await dbQuery(`
      SELECT os_id, op_iapp_id, status_producao, operador, data_status_producao::text AS data_status_producao
      FROM "IAPP_API".op_iapp_os
      WHERE os_id = $1
    `, [osId]);

    return res.json({ success: true, ...updated.rows[0] });
  } catch (err) {
    console.error('[producao] iniciar OS:', err.message);
    return res.status(500).json({ error: err.message || 'Erro ao iniciar produção.' });
  }
});

/* ---------------------------------------------------------------
 * POST /api/producao/os/:osId/pausar
 * Body: { motivo: string }
 * Registra parada e altera status_producao para Parado.
 * --------------------------------------------------------------- */
router.post('/os/:osId/pausar', requireAuth, express.json(), async (req, res) => {
  const osId = Number.parseInt(String(req.params.osId || ''), 10);
  if (!Number.isFinite(osId) || osId <= 0) {
    return res.status(400).json({ error: 'osId inválido.' });
  }

  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) {
    return res.status(400).json({ error: 'Informe o motivo da parada.' });
  }

  try {
    if (!tabelaGarantida) { await garantirTabela(); tabelaGarantida = true; }

    const operador = getOperador(req);
    const atual = await dbQuery(`
      SELECT os_id, op_iapp_id, status_producao
      FROM "IAPP_API".op_iapp_os
      WHERE os_id = $1
    `, [osId]);

    if (!atual.rows.length) {
      return res.status(404).json({ error: 'Ordem de serviço não encontrada.' });
    }

    const statusAtual = String(atual.rows[0].status_producao || '').trim().toLowerCase();
    if (!['iniciado', 'produzindo'].includes(statusAtual)) {
      return res.status(400).json({ error: 'Só é possível pausar uma OS com produção iniciada.' });
    }

    const opIappId = atual.rows[0].op_iapp_id;

    await dbQuery(`
      UPDATE "IAPP_API".op_iapp_os
      SET status_producao = 'Parado',
          operador = $2,
          data_status_producao = NOW()
      WHERE os_id = $1
    `, [osId, operador]);

    const parada = await dbQuery(`
      INSERT INTO "IAPP_API".op_iapp_os_parada (os_id, op_iapp_id, data_parada, operador, motivo)
      VALUES ($1, $2, NOW(), $3, $4)
      RETURNING parada_id, os_id, op_iapp_id, data_parada::text AS data_parada, operador, motivo, data_retorno
    `, [osId, opIappId, operador, motivo]);

    const updated = await dbQuery(`
      SELECT os_id, op_iapp_id, status_producao, operador, data_status_producao::text AS data_status_producao
      FROM "IAPP_API".op_iapp_os
      WHERE os_id = $1
    `, [osId]);

    return res.json({
      success: true,
      ...updated.rows[0],
      parada: parada.rows[0]
    });
  } catch (err) {
    console.error('[producao] pausar OS:', err.message);
    return res.status(500).json({ error: err.message || 'Erro ao pausar produção.' });
  }
});

router.get('/iapp/qualidade/inspecoes/lista', async (req, res) => {
  try {
    const pageParam = Number.parseInt(String(req.query.page || '1'), 10);
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const offsetParam = Number.parseInt(String(req.query.offset || '100'), 10);
    const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 100;

    const data = await iappGet('/qualidade/inspecoes/lista', { page, offset });

    return res.json({
      ...data,
      success: data?.success !== false,
      page: String(data?.page || page),
      total: Number.isFinite(Number(data?.total)) ? Number(data.total) : 0,
      response: Array.isArray(data?.response) ? data.response : []
    });
  } catch (err) {
    console.error('[producao] Erro ao listar inspeções IAPP:', err.message);
    return res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Erro ao listar inspeções na IAPP.'
    });
  }
});

/* ---------------------------------------------------------------
 * GET /api/producao/pedidos-kanban
 * Pedidos de venda (etapa 80) com saldo não programado em Kanban_programacao.
 * --------------------------------------------------------------- */
router.get('/pedidos-kanban', async (req, res) => {
  try {
    await garantirSchemaKanbanProgramacao();

    const { rows } = await dbQuery(`
      WITH movimentado AS (
        SELECT
          codigo_pedido,
          ${normCodigoSql('codigo')} AS codigo_norm,
          SUM(quantidade) AS qtd_mov
        FROM "Producao"."Kanban_programacao"
        GROUP BY codigo_pedido, ${normCodigoSql('codigo')}
      ),
      itens_saldo AS (
        SELECT
          p.codigo_pedido,
          p.numero_pedido,
          p.obs_venda,
          p.updated_at,
          i.seq,
          i.codigo_produto,
          i.codigo,
          i.descricao,
          GREATEST(COALESCE(i.quantidade, 0) - COALESCE(m.qtd_mov, 0), 0) AS saldo
        FROM "Vendas".pedidos_venda p
        JOIN "Vendas".pedidos_venda_itens i
          ON i.codigo_pedido = p.codigo_pedido
        LEFT JOIN movimentado m
          ON m.codigo_pedido = p.codigo_pedido
         AND m.codigo_norm = ${normCodigoSql('i.codigo')}
        WHERE TRIM(COALESCE(p.etapa::text, '')) = '80'
          AND TRIM(COALESCE(p.bloqueado, '')) = 'N'
          AND TRIM(COALESCE(p.encerrado, '')) IN ('', 'N')
      )
      SELECT
        codigo_pedido,
        numero_pedido,
        obs_venda,
        updated_at::text AS updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'seq',           seq,
              'codigo_produto', codigo_produto,
              'codigo',        codigo,
              'descricao',     descricao,
              'quantidade',    saldo::text
            )
            ORDER BY seq NULLS LAST, codigo
          ) FILTER (WHERE saldo > 0),
          '[]'::json
        ) AS itens
      FROM itens_saldo
      GROUP BY codigo_pedido, numero_pedido, obs_venda, updated_at
      HAVING COUNT(*) FILTER (WHERE saldo > 0) > 0
      ORDER BY numero_pedido ASC NULLS LAST, codigo_pedido ASC
    `);

    return res.json({ success: true, total: rows.length, pedidos: rows });
  } catch (err) {
    console.error('[producao] Erro ao listar pedidos kanban:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ---------------------------------------------------------------
 * POST /api/producao/kanban-programacao
 * Registra arraste Pedidos → Programado (saldo do pedido >= qtde programada).
 * Body: { codigo_pedido, codigo, quantidade_programado, numero_op, op_iapp_id }
 * --------------------------------------------------------------- */
router.post('/kanban-programacao', express.json(), async (req, res) => {
  try {
    await garantirSchemaKanbanProgramacao();

    const codigoPedido = Number(req.body?.codigo_pedido);
    const codigo = String(req.body?.codigo || '').trim();
    const qtdProgramado = Number(req.body?.quantidade_programado);
    const numeroOp = String(req.body?.numero_op || '').trim();
    const opIappId = Number(req.body?.op_iapp_id);

    if (!Number.isFinite(codigoPedido) || codigoPedido <= 0) {
      return res.status(400).json({ success: false, error: 'codigo_pedido inválido.' });
    }
    if (!codigo) {
      return res.status(400).json({ success: false, error: 'codigo do produto é obrigatório.' });
    }
    if (!numeroOp) {
      return res.status(400).json({ success: false, error: 'numero_op é obrigatório.' });
    }
    if (!Number.isFinite(opIappId) || opIappId <= 0) {
      return res.status(400).json({ success: false, error: 'op_iapp_id inválido.' });
    }
    if (!Number.isFinite(qtdProgramado) || qtdProgramado <= 0) {
      return res.status(400).json({ success: false, error: 'quantidade_programado inválida.' });
    }

    const { rows: itemRows } = await dbQuery(`
      SELECT
        i.codigo_produto,
        i.codigo,
        i.descricao,
        i.quantidade::float8 AS quantidade_original,
        p.numero_pedido,
        p.codigo_pedido,
        COALESCE(m.qtd_mov, 0)::float8 AS quantidade_movimentada
      FROM "Vendas".pedidos_venda_itens i
      JOIN "Vendas".pedidos_venda p
        ON p.codigo_pedido = i.codigo_pedido
      LEFT JOIN (
        SELECT codigo_pedido, ${normCodigoSql('codigo')} AS codigo_norm, SUM(quantidade) AS qtd_mov
        FROM "Producao"."Kanban_programacao"
        WHERE codigo_pedido = $1
        GROUP BY codigo_pedido, ${normCodigoSql('codigo')}
      ) m
        ON m.codigo_pedido = i.codigo_pedido
       AND m.codigo_norm = ${normCodigoSql('i.codigo')}
      WHERE i.codigo_pedido = $1
        AND ${normCodigoSql('i.codigo')} = ${normCodigoSql('$2')}
        AND TRIM(COALESCE(p.etapa::text, '')) = '80'
        AND TRIM(COALESCE(p.bloqueado, '')) = 'N'
        AND TRIM(COALESCE(p.encerrado, '')) IN ('', 'N')
      ORDER BY i.seq NULLS LAST
      LIMIT 1
    `, [codigoPedido, codigo]);

    if (!itemRows.length) {
      return res.status(404).json({ success: false, error: 'Item do pedido não encontrado ou pedido inativo.' });
    }

    const item = itemRows[0];
    const saldo = Number(item.quantidade_original) - Number(item.quantidade_movimentada);

    if (saldo < qtdProgramado) {
      return res.status(400).json({
        success: false,
        error: `Saldo do pedido (${saldo}) é menor que a quantidade programada (${qtdProgramado}).`,
        saldo,
        quantidade_programado: qtdProgramado
      });
    }

    const { rows: inserted } = await dbQuery(`
      INSERT INTO "Producao"."Kanban_programacao" (
        codigo_produto, codigo, descricao, codigo_pedido, numero_pedido, quantidade, numero_op, op_iapp_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, codigo_produto, codigo, descricao, codigo_pedido, numero_pedido, quantidade::text,
                numero_op, op_iapp_id, created_at
    `, [
      item.codigo_produto || null,
      item.codigo,
      item.descricao || null,
      item.codigo_pedido,
      item.numero_pedido || null,
      qtdProgramado,
      numeroOp,
      opIappId
    ]);

    const saldoRestante = saldo - qtdProgramado;

    return res.json({
      success: true,
      registro: inserted[0],
      saldo_restante: saldoRestante
    });
  } catch (err) {
    console.error('[producao] Erro ao registrar kanban programacao:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ---------------------------------------------------------------
 * GET /api/producao/kanban-programacao
 * Lista vínculos pedido → OP (destaque no kanban).
 * --------------------------------------------------------------- */
router.get('/kanban-programacao', async (req, res) => {
  try {
    await garantirSchemaKanbanProgramacao();

    const { rows } = await dbQuery(`
      SELECT
        id,
        codigo_produto,
        codigo,
        descricao,
        codigo_pedido,
        numero_pedido,
        quantidade::text AS quantidade,
        numero_op,
        op_iapp_id,
        status,
        created_at
      FROM "Producao"."Kanban_programacao"
      ORDER BY created_at DESC, id DESC
    `);

    return res.json({ success: true, total: rows.length, registros: rows });
  } catch (err) {
    console.error('[producao] Erro ao listar kanban programacao:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

