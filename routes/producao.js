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
}

let tabelaGarantida = false;

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
 * GET /api/producao/ordens
 * Busca DIRETAMENTE do IAPP com filtro status=A PRODUZIR (dado sempre preciso).
 * Após responder ao cliente, dispara sync de ENCERRADOS em background.
 * --------------------------------------------------------------- */
router.get('/ordens', async (req, res) => {
  try {
    if (!tabelaGarantida) {
      await garantirTabela();
      tabelaGarantida = true;
    }

    if (!process.env.IAPP_TOKEN || !process.env.IAPP_SECRET) {
      return res.status(500).json({ error: 'IAPP_TOKEN e IAPP_SECRET não configurados.' });
    }

    const OFFSET    = 100;
    const INTERVALO = Math.ceil(1000 / 3); // 3 req/s

    // Busca todas as páginas com status A PRODUZIR direto do IAPP
    const todasOPs = [];
    let page = 1;
    while (true) {
      if (page > 1) await sleep(INTERVALO);
      const r = await iappGet('/manufatura/ordens-producao/lista', {
        offset:    OFFSET,
        sort_by:   'data_abertura',
        sort_type: 'DESC',
        status:    'A PRODUZIR',
        page
      });
      const records = Array.isArray(r.response) ? r.response : [];
      // Filtra client-side como segurança caso a API ignore o filtro
      const ativas = records.filter(op => op.status === 'A PRODUZIR');
      todasOPs.push(...ativas);
      if (records.length < OFFSET) break;
      page++;
    }

    console.log(`[producao] IAPP live: ${todasOPs.length} ordens "A PRODUZIR" em ${page} página(s).`);

    // Normaliza a estrutura esperada pelo front
    const agora = new Date().toISOString();
    const ordens = todasOPs.map(op => ({
      id:                        op.id,
      identificacao:             op.identificacao,
      status:                    op.status,
      qtde:                      op.qtde,
      tempo_total:               op.tempo_total,
      ficha_tecnica:             op.ficha_tecnica,
      linha_producao:            op.linha_producao,
      obs:                       op.obs,
      cliente:                   op.cliente,
      projeto:                   op.projeto,
      origem:                    op.origem,
      documento:                 op.documento,
      data_abertura:             op.data_abertura,
      data_inicio:               op.data_inicio,
      data_final:                op.data_final,
      data_encerramento:         op.data_encerramento,
      data_previsao_faturamento: op.data_previsao_faturamento,
      data_previsao_entrega:     op.data_previsao_entrega,
      data_ultima_atualizacao:   op.data_ultima_atualizacao,
      sincronizado_em:           agora,
      produto: op.produto ? {
        id:            op.produto.id,
        identificacao: op.produto.identificacao,
        descricao:     op.produto.descricao,
        tipo:          op.produto.tipo,
        valor_custo:   op.produto.valor_custo,
        valor_venda:   op.produto.valor_venda,
        unidade_medida:op.produto.unidade_medida,
        status:        op.produto.status
      } : null,
      ordens_servico: Array.isArray(op.ordens_servico) ? op.ordens_servico.map(os => ({
        id:               os.id,
        identificacao:    os.identificacao,
        status:           os.status,
        operacao:         os.operacao,
        tempo_total:      os.tempo_total,
        data_abertura:    os.data_abertura,
        data_inicio:      os.data_inicio,
        data_final:       os.data_final,
        data_encerramento:os.data_encerramento
      })) : []
    }));

    // Responde ao usuário e em background atualiza ENCERRADOS no DB
    setImmediate(() => syncEncerradosBackground());

    return res.json({
      success:          true,
      total_consultado: ordens.length,
      total_ativas:     ordens.length,
      ordens,
      sincronizado_em:  agora
    });
  } catch (err) {
    console.error('[producao] Erro ao buscar ordens do IAPP:', err.message);
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

module.exports = router;

