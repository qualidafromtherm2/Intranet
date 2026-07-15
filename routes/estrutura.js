/**
 * Schema estrutura — cache local da ficha técnica IAPP (BOM completa).
 * Sync respeita rate limit IAPP: 1 chamada/segundo.
 */
const express = require('express');
const https = require('https');
const { dbQuery } = require('../src/db');
const {
  ensureSchemaEstrutura,
  lerEstruturaDoSql,
  obterFichaCompletaPorId,
  atualizarFichaCompletaPorId,
  obterItemCompletoPorId,
  atualizarItemCompletoPorId,
  atualizarPostoItemPorId,
  trocarProdutoItemPorOmie,
  adicionarItemFichaPorOmie,
  excluirItemFicha,
} = require('../utils/estruturaSql');

const router = express.Router();

const IAPP_BASE = 'https://api.iniciativaaplicativos.com.br/api';
const IAPP_RATE_MS = 1000;
const FICHA_LISTA_PAGE_SIZE = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseIappDate(value) {
  if (value == null || value === '') return null;
  const d = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function iappGet(path, params = {}) {
  return new Promise((resolve, reject) => {
    const token = process.env.IAPP_TOKEN;
    const secret = process.env.IAPP_SECRET;
    if (!token || !secret) {
      return reject(new Error('IAPP_TOKEN e IAPP_SECRET não configurados no .env'));
    }

    const qs = new URLSearchParams(params).toString();
    const url = new URL(`${IAPP_BASE}${path}${qs ? `?${qs}` : ''}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        token,
        secret,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (resp) => {
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
        } catch (e) {
          reject(new Error(`Resposta inválida da API IAPP: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function iappGetRateLimited(path, params = {}) {
  const data = await iappGet(path, params);
  await sleep(IAPP_RATE_MS);
  return data;
}

async function atualizarSyncLog(syncId, fields) {
  const sets = [];
  const vals = [];
  let idx = 1;
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = $${idx++}`);
    vals.push(value);
  }
  vals.push(syncId);
  await dbQuery(
    `UPDATE estrutura.sync_log SET ${sets.join(', ')} WHERE id = $${idx}`,
    vals
  );
}

function normalizarCodigoProduto(codigo) {
  return String(codigo || '').trim().toUpperCase();
}

async function localizarFichaPorCodigo(codigoProduto, counter) {
  const codigoNorm = normalizarCodigoProduto(codigoProduto);
  if (!codigoNorm) return null;

  let page = 1;
  while (page <= 100) {
    const data = await iappGetRateLimited('/engenharia/fichas/lista', {
      page,
      offset: FICHA_LISTA_PAGE_SIZE,
    });
    if (counter) counter.apiCalls += 1;
    if (data.success === false) {
      throw new Error(data.message || data.code || 'Erro ao listar fichas no IAPP.');
    }
    const batch = Array.isArray(data.response) ? data.response : [];
    const hit = batch.find(
      (f) => normalizarCodigoProduto(f?.produto) === codigoNorm
    );
    if (hit) return hit;
    if (batch.length < FICHA_LISTA_PAGE_SIZE) break;
    page += 1;
  }
  return null;
}

async function consultarFichaIapp(fichaId, counter) {
  const id = Number(fichaId) || 0;
  if (!id) return null;
  const data = await iappGetRateLimited(`/engenharia/fichas/busca/${id}`);
  if (counter) counter.apiCalls += 1;
  if (data.success === false) {
    throw new Error(data.message || data.code || 'Ficha não encontrada no IAPP.');
  }
  return data.response || null;
}

async function consultarProdutoIapp(produtoId, counter) {
  const id = Number(produtoId) || 0;
  if (!id) return null;
  const data = await iappGetRateLimited(`/engenharia/produtos/busca/${id}`);
  if (counter) counter.apiCalls += 1;
  if (data.success === false || !data.response) return null;
  return data.response;
}

async function upsertProdutoIapp(prod) {
  if (!prod?.id) return;
  await dbQuery(
    `INSERT INTO estrutura.produto_iapp (
       id, identificacao, descricao, unidade_medida, ean, tipo, origem,
       valor_venda, valor_custo, altura, peso_bruto, peso_liquido,
       comprimento, largura, ncm, cest, status, fabricante, projeto, linha,
       grupo, subgrupo, tag_grupo, codigo_dun, genero, area, diametro,
       localizacao, qtde_volume, tipo_volume, qtde_embalagem, tipo_embalagem,
       lucro_pretendido, vcc, validade_vcc, lote_minimo_compra,
       maximo_empilhamentos, qtde_seguranca, qtde_minima, peso_tara,
       data_ultima_atualizacao, raw, sincronizado_em
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       identificacao = EXCLUDED.identificacao,
       descricao = EXCLUDED.descricao,
       unidade_medida = EXCLUDED.unidade_medida,
       ean = EXCLUDED.ean,
       tipo = EXCLUDED.tipo,
       origem = EXCLUDED.origem,
       valor_venda = EXCLUDED.valor_venda,
       valor_custo = EXCLUDED.valor_custo,
       altura = EXCLUDED.altura,
       peso_bruto = EXCLUDED.peso_bruto,
       peso_liquido = EXCLUDED.peso_liquido,
       comprimento = EXCLUDED.comprimento,
       largura = EXCLUDED.largura,
       ncm = EXCLUDED.ncm,
       cest = EXCLUDED.cest,
       status = EXCLUDED.status,
       fabricante = EXCLUDED.fabricante,
       projeto = EXCLUDED.projeto,
       linha = EXCLUDED.linha,
       grupo = EXCLUDED.grupo,
       subgrupo = EXCLUDED.subgrupo,
       tag_grupo = EXCLUDED.tag_grupo,
       codigo_dun = EXCLUDED.codigo_dun,
       genero = EXCLUDED.genero,
       area = EXCLUDED.area,
       diametro = EXCLUDED.diametro,
       localizacao = EXCLUDED.localizacao,
       qtde_volume = EXCLUDED.qtde_volume,
       tipo_volume = EXCLUDED.tipo_volume,
       qtde_embalagem = EXCLUDED.qtde_embalagem,
       tipo_embalagem = EXCLUDED.tipo_embalagem,
       lucro_pretendido = EXCLUDED.lucro_pretendido,
       vcc = EXCLUDED.vcc,
       validade_vcc = EXCLUDED.validade_vcc,
       lote_minimo_compra = EXCLUDED.lote_minimo_compra,
       maximo_empilhamentos = EXCLUDED.maximo_empilhamentos,
       qtde_seguranca = EXCLUDED.qtde_seguranca,
       qtde_minima = EXCLUDED.qtde_minima,
       peso_tara = EXCLUDED.peso_tara,
       data_ultima_atualizacao = EXCLUDED.data_ultima_atualizacao,
       raw = EXCLUDED.raw,
       sincronizado_em = NOW()`,
    [
      prod.id,
      prod.identificacao || null,
      prod.descricao || null,
      prod.unidade_medida || null,
      prod.ean || null,
      prod.tipo || null,
      prod.origem || null,
      num(prod.valor_venda),
      num(prod.valor_custo),
      num(prod.altura),
      num(prod.peso_bruto),
      num(prod.peso_liquido),
      num(prod.comprimento),
      num(prod.largura),
      prod.ncm || null,
      prod.cest || null,
      prod.status || null,
      prod.fabricante || null,
      prod.projeto || null,
      prod.linha || null,
      prod.grupo ? JSON.stringify(prod.grupo) : null,
      prod.subgrupo ? JSON.stringify(prod.subgrupo) : null,
      prod.tag_grupo ? JSON.stringify(prod.tag_grupo) : null,
      prod.codigo_dun || null,
      prod.genero || null,
      num(prod.area),
      num(prod.diametro),
      prod.localizacao || null,
      num(prod.qtde_volume),
      prod.tipo_volume || null,
      num(prod.qtde_embalagem),
      prod.tipo_embalagem || null,
      num(prod.lucro_pretendido),
      num(prod.vcc),
      num(prod.validade_vcc),
      num(prod.lote_minimo_compra),
      num(prod.maximo_empilhamentos),
      num(prod.qtde_seguranca),
      num(prod.qtde_minima),
      num(prod.peso_tara),
      parseIappDate(prod.data_ultima_atualizacao),
      JSON.stringify(prod),
    ]
  );
}

async function lerPostosFichaAntesSync(fichaId) {
  const id = Number(fichaId) || 0;
  if (!id) return new Map();
  const { rows } = await dbQuery(
    `SELECT operacao, tipo, produto_iapp_id, posto
       FROM estrutura.ficha_item
      WHERE ficha_id = $1
        AND posto IS NOT NULL
        AND BTRIM(posto) <> ''
      ORDER BY id ASC`,
    [id]
  );
  const mapa = new Map();
  for (const row of rows || []) {
    const key = `${row.operacao}|${row.tipo}|${row.produto_iapp_id}`;
    if (!mapa.has(key)) mapa.set(key, []);
    mapa.get(key).push(String(row.posto).trim());
  }
  return mapa;
}

function consumirPostoPreservado(mapaPostos, operacaoId, tipo, produtoIappId) {
  const key = `${operacaoId}|${tipo}|${produtoIappId}`;
  const fila = mapaPostos.get(key);
  if (!fila || !fila.length) return null;
  return fila.shift() || null;
}

async function gravarFichaCompleta(ficha, codigoProduto) {
  const fichaId = Number(ficha.id);
  const codigo = String(codigoProduto || ficha.produto || '').trim();
  await ensureSchemaEstrutura();
  const mapaPostos = await lerPostosFichaAntesSync(fichaId);

  await dbQuery(`DELETE FROM estrutura.ficha WHERE id = $1`, [fichaId]);

  await dbQuery(
    `INSERT INTO estrutura.ficha (
       id, codigo_produto, identificacao, descricao, status, modelo,
       qtde, qtde_batelada, qtde_referencia, data_validade, vcpp, vcp,
       data_criacao, data_ultima_atualizacao, usuario_criador,
       ultimo_usuario_atualizador, raw, sincronizado_em
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW()
     )`,
    [
      fichaId,
      codigo,
      ficha.identificacao || null,
      ficha.descricao || null,
      ficha.status || null,
      ficha.modelo || null,
      num(ficha.qtde),
      num(ficha.qtde_batelada),
      num(ficha.qtde_referencia),
      parseIappDate(ficha.data_validade),
      num(ficha.vcpp),
      num(ficha.vcp),
      parseIappDate(ficha.data_criacao),
      parseIappDate(ficha.data_ultima_atualizacao),
      num(ficha.usuario_criador),
      num(ficha.ultimo_usuario_atualizador),
      JSON.stringify(ficha),
    ]
  );

  let ordem = 0;
  let totalItens = 0;

  for (const op of (ficha.operacoes || [])) {
    const operacaoId = Number(op.operacao);
    await dbQuery(
      `INSERT INTO estrutura.ficha_operacao (
         ficha_id, operacao, unidade, tempo_operacao, tempo_preparacao,
         tempo_espera, tempo_transporte, tempo_fila, tempo_total_pessimista,
         tempo_total_otimista, valor_total, capacidade, meta, checklists, servicos, raw
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
       )`,
      [
        fichaId,
        operacaoId,
        op.unidade || null,
        num(op.tempo_operacao),
        num(op.tempo_preparacao),
        num(op.tempo_espera),
        num(op.tempo_transporte),
        num(op.tempo_fila),
        num(op.tempo_total_pessimista),
        num(op.tempo_total_otimista),
        num(op.valor_total),
        num(op.capacidade),
        num(op.meta),
        op.checklists ? JSON.stringify(op.checklists) : null,
        op.servicos ? JSON.stringify(op.servicos) : null,
        JSON.stringify(op),
      ]
    );

    for (const item of (op.materiais || [])) {
      ordem += 1;
      totalItens += 1;
      const produtoIappId = Number(item.produto);
      const postoPreservado = consumirPostoPreservado(mapaPostos, operacaoId, 'Material', produtoIappId);
      await dbQuery(
        `INSERT INTO estrutura.ficha_item (
           ficha_id, operacao, tipo, produto_iapp_id, qtde, porcentagem,
           qtde_custo_perdas, observacoes, comportamento, ordem, raw, posto
         ) VALUES ($1,$2,'Material',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          fichaId,
          operacaoId,
          produtoIappId,
          num(item.qtde),
          num(item.porcentagem),
          num(item.qtde_custo_perdas),
          null,
          null,
          ordem,
          JSON.stringify(item),
          postoPreservado,
        ]
      );
    }

    for (const item of (op.subprodutos || [])) {
      ordem += 1;
      totalItens += 1;
      const produtoIappId = Number(item.produto);
      const postoPreservado = consumirPostoPreservado(mapaPostos, operacaoId, 'Subproduto', produtoIappId);
      await dbQuery(
        `INSERT INTO estrutura.ficha_item (
           ficha_id, operacao, tipo, produto_iapp_id, qtde, porcentagem,
           qtde_custo_perdas, observacoes, comportamento, ordem, raw, posto
         ) VALUES ($1,$2,'Subproduto',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          fichaId,
          operacaoId,
          produtoIappId,
          num(item.qtde),
          null,
          null,
          item.observacoes || null,
          item.comportamento || null,
          ordem,
          JSON.stringify(item),
          postoPreservado,
        ]
      );
    }
  }

  return totalItens;
}

function coletarProdutoIds(ficha) {
  const ids = new Set();
  for (const op of (ficha?.operacoes || [])) {
    for (const item of (op.materiais || [])) {
      const id = Number(item?.produto);
      if (id > 0) ids.add(id);
    }
    for (const item of (op.subprodutos || [])) {
      const id = Number(item?.produto);
      if (id > 0) ids.add(id);
    }
  }
  return [...ids];
}

async function executarSyncEstrutura({ syncId, codigo, fichaIdHint, usuario }) {
  const counter = { apiCalls: 0 };

  try {
    await atualizarSyncLog(syncId, {
      etapa: 'localizar_ficha',
      mensagem: 'Localizando ficha técnica no IAPP...',
    });

    let fichaResumo = null;
    if (Number(fichaIdHint) > 0) {
      fichaResumo = { id: Number(fichaIdHint) };
    } else {
      fichaResumo = await localizarFichaPorCodigo(codigo, counter);
    }

    if (!fichaResumo?.id) {
      throw new Error(`Ficha técnica não encontrada no IAPP para ${codigo}.`);
    }

    await atualizarSyncLog(syncId, {
      ficha_id: Number(fichaResumo.id),
      etapa: 'buscar_ficha',
      mensagem: 'Baixando ficha completa...',
      total_api_calls: counter.apiCalls,
    });

    const ficha = await consultarFichaIapp(fichaResumo.id, counter);
    if (!ficha) throw new Error('Resposta vazia ao consultar ficha no IAPP.');

    const produtoIds = coletarProdutoIds(ficha);
    const progressoTotal = produtoIds.length + 1;

    await atualizarSyncLog(syncId, {
      etapa: 'gravar_ficha',
      progresso_atual: 0,
      progresso_total: progressoTotal,
      mensagem: 'Gravando ficha, operações e itens...',
      total_api_calls: counter.apiCalls,
    });

    const totalItens = await gravarFichaCompleta(ficha, codigo);

    await atualizarSyncLog(syncId, {
      etapa: 'buscar_produtos',
      progresso_atual: 0,
      progresso_total: produtoIds.length,
      total_itens: totalItens,
      mensagem: `Sincronizando ${produtoIds.length} produto(s)...`,
      total_api_calls: counter.apiCalls,
    });

    let produtosOk = 0;
    for (let i = 0; i < produtoIds.length; i += 1) {
      const produtoId = produtoIds[i];
      const prod = await consultarProdutoIapp(produtoId, counter);
      if (prod) {
        await upsertProdutoIapp(prod);
        produtosOk += 1;
      }
      await atualizarSyncLog(syncId, {
        progresso_atual: i + 1,
        progresso_total: produtoIds.length,
        total_api_calls: counter.apiCalls,
        total_produtos: produtosOk,
        mensagem: `Produto ${i + 1}/${produtoIds.length}`,
      });
    }

    await atualizarSyncLog(syncId, {
      status: 'ok',
      etapa: 'concluido',
      progresso_atual: produtoIds.length,
      progresso_total: produtoIds.length,
      total_api_calls: counter.apiCalls,
      total_itens: totalItens,
      total_produtos: produtosOk,
      mensagem: `Estrutura salva: ${totalItens} item(ns), ${produtosOk} produto(s).`,
      finalizado_em: new Date().toISOString(),
    });
  } catch (err) {
    await atualizarSyncLog(syncId, {
      status: 'erro',
      etapa: 'erro',
      mensagem: err.message || 'Erro na sincronização.',
      total_api_calls: counter.apiCalls,
      finalizado_em: new Date().toISOString(),
    });
  }
}

/**
 * POST /api/estrutura/sync
 * Body: { codigo, ficha_id?, usuario? }
 */
router.post('/sync', async (req, res) => {
  try {
    await ensureSchemaEstrutura();

    const codigo = String(req.body?.codigo || '').trim();
    const fichaIdHint = Number(req.body?.ficha_id) || 0;
    const usuario = String(req.body?.usuario || req.user?.nome || req.user?.email || '').trim() || null;

    if (!codigo) {
      return res.status(400).json({ error: 'Informe o código do produto (codigo).' });
    }

    const running = await dbQuery(
      `SELECT id FROM estrutura.sync_log
        WHERE UPPER(BTRIM(codigo_produto)) = UPPER(BTRIM($1))
          AND status = 'running'
          AND iniciado_em > NOW() - INTERVAL '2 hours'
        LIMIT 1`,
      [codigo]
    );
    if (running.rows[0]?.id) {
      return res.json({
        success: true,
        syncId: running.rows[0].id,
        status: 'running',
        message: 'Já existe uma sincronização em andamento para este produto.',
      });
    }

    const insert = await dbQuery(
      `INSERT INTO estrutura.sync_log (codigo_produto, ficha_id, status, etapa, usuario, mensagem)
       VALUES ($1, $2, 'running', 'inicio', $3, 'Sincronização iniciada.')
       RETURNING id`,
      [codigo, fichaIdHint || null, usuario]
    );
    const syncId = insert.rows[0].id;

    setImmediate(() => {
      executarSyncEstrutura({ syncId, codigo, fichaIdHint, usuario }).catch((err) => {
        console.error('[estrutura/sync]', err.message);
      });
    });

    return res.json({
      success: true,
      syncId,
      status: 'running',
      message: 'Sincronização iniciada. Aguarde (1 chamada IAPP por segundo).',
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /api/estrutura/sync/:id
 */
router.get('/sync/:id', async (req, res) => {
  try {
    await ensureSchemaEstrutura();
    const syncId = Number(req.params.id) || 0;
    if (!syncId) return res.status(400).json({ error: 'ID inválido.' });

    const { rows } = await dbQuery(
      `SELECT id, codigo_produto, ficha_id, status, etapa, progresso_atual, progresso_total,
              total_api_calls, total_itens, total_produtos, mensagem, usuario,
              iniciado_em, finalizado_em
         FROM estrutura.sync_log
        WHERE id = $1`,
      [syncId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Sincronização não encontrada.' });
    return res.json({ success: true, sync: rows[0] });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /api/estrutura/ficha?codigo=FTI115LPTBR
 */
router.get('/ficha', async (req, res) => {
  try {
    const codigo = String(req.query?.codigo || '').trim();
    if (!codigo) return res.status(400).json({ error: 'Informe codigo.' });

    const cache = await lerEstruturaDoSql(codigo);
    if (!cache) {
      return res.json({ success: true, codigo, fonte: null, ficha: null, total: 0, itens: [] });
    }

    return res.json({
      success: true,
      codigo: cache.codigo,
      fonte: cache.fonte,
      sincronizado_em: cache.sincronizado_em,
      ficha: cache.ficha,
      total: cache.itens.length,
      itens: cache.itens,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /api/estrutura/ficha/:id/completo
 */
router.get('/ficha/:id/completo', async (req, res) => {
  try {
    const fichaId = Number(req.params.id) || 0;
    if (!fichaId) return res.status(400).json({ error: 'ID da ficha inválido.' });
    const dados = await obterFichaCompletaPorId(fichaId);
    if (!dados) return res.status(404).json({ error: 'Ficha não encontrada no cache SQL.' });
    return res.json({ success: true, fonte: 'sql', ...dados });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * PUT /api/estrutura/ficha/:id/completo
 */
router.put('/ficha/:id/completo', async (req, res) => {
  try {
    const fichaId = Number(req.params.id) || 0;
    if (!fichaId) return res.status(400).json({ error: 'ID da ficha inválido.' });
    const dados = await atualizarFichaCompletaPorId(fichaId, req.body || {});
    return res.json({ success: true, fonte: 'sql', message: 'Ficha atualizada.', ...dados });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /api/estrutura/item/:id/completo
 */
router.get('/item/:id/completo', async (req, res) => {
  try {
    const itemId = Number(req.params.id) || 0;
    if (!itemId) return res.status(400).json({ error: 'ID do item inválido.' });
    const dados = await obterItemCompletoPorId(itemId);
    if (!dados) return res.status(404).json({ error: 'Item não encontrado no cache SQL.' });
    return res.json({ success: true, fonte: 'sql', ...dados });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * PUT /api/estrutura/item/:id/completo
 */
router.put('/item/:id/completo', async (req, res) => {
  try {
    const itemId = Number(req.params.id) || 0;
    if (!itemId) return res.status(400).json({ error: 'ID do item inválido.' });
    const dados = await atualizarItemCompletoPorId(itemId, req.body || {});
    return res.json({ success: true, fonte: 'sql', message: 'Item atualizado.', ...dados });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * PUT /api/estrutura/item/:id/posto
 * Body: { posto } — nome do kanban (ex.: "Montagem hermetica") ou vazio para limpar.
 */
router.put('/item/:id/posto', express.json(), async (req, res) => {
  try {
    const itemId = Number(req.params.id) || 0;
    if (!itemId) return res.status(400).json({ error: 'ID do item inválido.' });
    const posto = Object.prototype.hasOwnProperty.call(req.body || {}, 'posto')
      ? req.body.posto
      : null;
    const dados = await atualizarPostoItemPorId(itemId, posto);
    return res.json({
      success: true,
      fonte: 'sql',
      message: 'Posto do item atualizado.',
      ...dados,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * PUT /api/estrutura/item/:id/trocar-produto
 * Body: { codigo, codigo_produto } — produtos_omie
 */
router.put('/item/:id/trocar-produto', express.json(), async (req, res) => {
  try {
    const itemId = Number(req.params.id) || 0;
    if (!itemId) return res.status(400).json({ error: 'ID do item inválido.' });
    const dados = await trocarProdutoItemPorOmie(itemId, req.body || {});
    return res.json({
      success: true,
      fonte: 'sql',
      message: 'Produto do item trocado.',
      ...dados,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/estrutura/ficha/:id/item
 * Body: { codigo, codigo_produto, operacao?, tipo?, qtde? }
 */
router.post('/ficha/:id/item', express.json(), async (req, res) => {
  try {
    const fichaId = Number(req.params.id) || 0;
    if (!fichaId) return res.status(400).json({ error: 'ID da ficha inválido.' });
    const dados = await adicionarItemFichaPorOmie(fichaId, req.body || {});
    return res.json({
      success: true,
      fonte: 'sql',
      message: 'Item adicionado à estrutura.',
      ...dados,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * DELETE /api/estrutura/item/:id
 */
router.delete('/item/:id', async (req, res) => {
  try {
    const itemId = Number(req.params.id) || 0;
    if (!itemId) return res.status(400).json({ error: 'ID do item inválido.' });
    const dados = await excluirItemFicha(itemId);
    return res.json({
      success: true,
      fonte: 'sql',
      message: 'Item removido da estrutura.',
      ...dados,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
