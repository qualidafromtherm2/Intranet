// intranet/routes/produtos.js
const express  = require('express');
const router   = express.Router();
const { dbQuery, dbGetClient } = require('../src/db');

// === Config Omie (para fallback ConsultarProduto) ============================
const OMIE_WEBHOOK_TOKEN = process.env.OMIE_WEBHOOK_TOKEN || '';
const OMIE_APP_KEY       = process.env.OMIE_APP_KEY || '';
const OMIE_APP_SECRET    = process.env.OMIE_APP_SECRET || '';
const OMIE_PROD_URL      = 'https://app.omie.com.br/api/v1/geral/produtos/';
// Ctrl+F: require('express')  (cole logo abaixo dos requires)
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || 'changeme';
const INTERNAL_BASE = `http://localhost:${process.env.PORT || 5001}`;

// Utilzinho pra ocultar chaves em logs
const mask = s => (s ? String(s).slice(0, 4) + '…' : '');

async function ensureProdutosOmieWebhookOnlyGuard() {
  try {
    await dbQuery(`
      CREATE OR REPLACE FUNCTION public.trg_guard_produtos_omie_webhook_only()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_source text;
      BEGIN
        v_source := current_setting('app.produtos_omie_write_source', true);
        IF COALESCE(v_source, '') <> 'omie_webhook' THEN
          RAISE EXCEPTION 'Escrita em public.produtos_omie permitida apenas via webhook da Omie'
            USING ERRCODE = '42501';
        END IF;

        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;

        RETURN NEW;
      END;
      $$;

      DROP TRIGGER IF EXISTS trg_guard_produtos_omie_webhook_only ON public.produtos_omie;

      CREATE TRIGGER trg_guard_produtos_omie_webhook_only
      BEFORE INSERT OR UPDATE OR DELETE ON public.produtos_omie
      FOR EACH ROW
      EXECUTE FUNCTION public.trg_guard_produtos_omie_webhook_only();
    `);

    console.log('[produtos] Proteção ativa: public.produtos_omie só aceita escrita via webhook Omie');
  } catch (err) {
    console.error('[produtos] Falha ao instalar proteção da public.produtos_omie:', String(err));
  }
}

ensureProdutosOmieWebhookOnlyGuard();

// === Helpers =================================================================
function ensureIntegrationKey(item) {
  if (!item) return item;
  if (!item.codigo_produto_integracao) {
    item.codigo_produto_integracao = item.codigo || String(item.codigo_produto || '');
  }
  return item;
}

// Node 18+ tem fetch; se não tiver, carrega node-fetch
async function httpFetch(url, opts) {
  const f = globalThis.fetch || (await import('node-fetch')).default;
  return f(url, opts);
}

async function consultarProdutoOmie({ codigo_produto, codigo }) {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET ausentes no ambiente.');
  }
  const param =
    codigo_produto ? { codigo_produto } :
    codigo         ? { codigo } :
    null;
  if (!param) throw new Error('Parâmetro de consulta vazio (sem código).');

  const payload = {
    call: 'ConsultarProduto',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [param]
  };

  const r = await httpFetch(OMIE_PROD_URL, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Omie HTTP ${r.status}`);
  const j = await r.json();

  // pode vir como { produto_servico_cadastro: {...} } ou já flat
  return j?.produto_servico_cadastro || j;
}

// GET /api/produtos/detalhe?codigo=FTI55DPTBR
// Retorna os campos para preencher a guia "Dados do produto" direto do Postgres.
// Fontes: public.produtos_omie + public.produtos_omie_imagens
router.get('/detalhe', async (req, res) => {
  try {
    const codigo = String(req.query?.codigo || '').trim();
    if (!codigo) {
      return res.status(400).json({ error: 'Parâmetro ?codigo é obrigatório.' });
    }

    // 1) Busca o produto na tabela principal
    const sql = `
      SELECT
        p.codigo_produto,
        p.codigo,
        p.descricao,
        p.descricao_familia,
        p.unidade,
        p.tipoitem,
        p.ncm,
        p.cfop,
        p.origem_mercadoria,
        p.cest,
        p.aliquota_ibpt,
        p.marca,
        p.modelo,
        p.descr_detalhada,
        p.obs_internas,
        p.visivel_principal,
        p.tipo_compra,
        p.inativo,
        p.bloqueado,
        p.bloquear_exclusao,
        p.quantidade_estoque,
        p.valor_unitario,
        p.preco_definido,
        p.dalt, p.halt, p.dinc, p.hinc, p.ualt, p.uinc,
        p.codigo_familia,
        p.codint_familia
      FROM public.produtos_omie p
      WHERE p.codigo = $1
      LIMIT 1;
    `;
    const { rows } = await dbQuery(sql, [codigo]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado no Postgres.' });
    }
    const r = rows[0];

    // 2) Busca imagens (se houverem)
    const imgSql = `
      SELECT url_imagem, pos
      FROM public.produtos_omie_imagens
      WHERE codigo_produto = $1
      ORDER BY pos ASC
    `;
    const { rows: imgs } = await dbQuery(imgSql, [r.codigo_produto]);
    const imagens = (imgs || []).map(i => ({
      url_imagem: i.url_imagem,
      pos: i.pos
    }));

    // 3) Normaliza o payload para o front (mantendo chaves esperadas)
    const payload = {
      codigo_produto: r.codigo_produto,
      codigo:         r.codigo,
      descricao:      r.descricao,

      // — Detalhes do produto —
      descricao_familia: r.descricao_familia,
      unidade:           r.unidade,
      tipoItem:          r.tipoitem,                // (mantemos camelCase que o front já usa)
      marca:             r.marca,
      modelo:            r.modelo,
      descr_detalhada:   r.descr_detalhada,
      obs_internas:      r.obs_internas,
      visivel_principal: r.visivel_principal,
      tipo_compra:       r.tipo_compra,

      // — Cadastro —
      bloqueado:          r.bloqueado,
      bloquear_exclusao:  r.bloquear_exclusao,
      inativo:            r.inativo,
      codigo_familia:     r.codigo_familia,
      codInt_familia:     r.codint_familia,

      // — Financeiro —
      ncm:             r.ncm,
      cfop:            r.cfop,
      origem_imposto:  r.origem_mercadoria,        // mapeado p/ chave já usada no front
      cest:            r.cest,
      aliquota_ibpt:   r.aliquota_ibpt,

      // — Outras infos úteis ao banner e editors —
      quantidade_estoque: r.quantidade_estoque,
      valor_unitario:     r.valor_unitario,
      preco_definido:     r.preco_definido,
      info: {
        uAlt: r.ualt, dAlt: r.dalt, hAlt: r.halt,
        uInc: r.uinc, dInc: r.dinc, hInc: r.hinc
      },
      imagens
    };

    // evita cache
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache'); res.set('Expires', '0'); res.set('Surrogate-Control', 'no-store');

    return res.json(payload);
  } catch (err) {
    console.error('[produtos/detalhe] erro →', err);
    return res.status(500).json({ error: 'Falha ao consultar detalhes do produto (SQL).' });
  }
});

// ============================================================================
// POST /api/produtos/locais
// Atualiza campos que existem só no Postgres (não enviados à Omie).
// Espera body: { codigo, visivel_principal, tipo_compra }
// ============================================================================
router.post('/locais', async (req, res) => {
  try {
    return res.status(403).json({
      ok: false,
      error: 'Atualização local desabilitada: public.produtos_omie é mantida exclusivamente pelo webhook da Omie.'
    });
  } catch (err) {
    console.error('[produtos/locais] erro →', err);
    res.status(500).json({ error: 'Falha ao atualizar campos locais.' });
  }
});

// ============================================================================
// GET /api/produtos/lista
// Query:
//   q?        → busca (descricao|codigo|codigo_produto_integracao)
//   tipoitem? → ex.: '04'
//   inativo?  → 'S' | 'N'
//   page?     → página (default 1)
//   limit?    → itens por página (default 50, máx 500)
// ============================================================================
router.get('/lista', async (req, res) => {
  try {
    const q        = (req.query.q || '').trim() || null;
    const tipoitem = (req.query.tipoitem || '').trim() || null;
    const inativo  = (req.query.inativo  || '').trim() || null;
    const limit    = Math.min(parseInt(req.query.limit || '50', 10), 500);
    const page     = Math.max(parseInt(req.query.page  || '1', 10), 1);
    const offset   = (page - 1) * limit;

    const sql = `
      WITH base AS (
        SELECT *
        FROM vw_lista_produtos
        WHERE
          ($1::text IS NULL
            OR descricao ILIKE '%' || $1 || '%'
            OR codigo    ILIKE '%' || $1 || '%'
            OR codigo_produto_integracao ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR tipoitem = $2)
          AND ($3::text IS NULL OR inativo  = $3)
      )
      SELECT
        (SELECT COUNT(*) FROM base) AS total,
        json_agg(row_to_json(t.*))  AS itens
      FROM (
        SELECT
          codigo_produto,
          codigo_produto_integracao,
          codigo,
          descricao,
          unidade,
          tipoitem,
          ncm,
          valor_unitario,
          quantidade_estoque,
          inativo,
          bloqueado,
          marca,
          modelo,
          dalt, halt, dinc, hinc,
          primeira_imagem
        FROM base
        ORDER BY descricao ASC
        LIMIT $4 OFFSET $5
      ) AS t;
    `;

    const { rows } = await dbQuery(sql, [q, tipoitem, inativo, limit, offset]);
    const total = Number(rows?.[0]?.total || 0);
    const itens = rows?.[0]?.itens || [];

    // cache busting no lado do cliente + aqui anulamos caches intermediários
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    res.json({ total, page, limit, itens });
  } catch (err) {
    console.error('[produtos/lista] erro →', err);
    res.status(500).json({ error: 'Falha ao consultar produtos.' });
  }
});

// ============================================================================
// POST /api/produtos/webhook
// Aceita:
//  A) { produto_servico_cadastro: [ {...}, ... ] }  (webhook "clássico")
//  B) { topic:"Produto.Alterado", event:{...} }     (Omie Connect 2.0)
// Valida por ?token=... ou header X-Omie-Token.
// Após gravar, dispara SSE via app.get('sseBroadcast') se existir.
// ============================================================================
router.post('/webhook', async (req, res) => {
  const expected = OMIE_WEBHOOK_TOKEN;
  const token    = req.query.token || req.get('X-Omie-Token') || '';

  if (!expected || token !== expected) {
    console.warn('[webhook/produtos] Token inválido - recebido:', mask(token), 'esperado:', mask(expected));
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = req.body || {};
  const messageId = body.messageId || 'N/A';
  const topic = body.topic || 'webhook_classico';
  
  console.log('[webhook/produtos] Recebido:', {
    messageId,
    topic,
    codigo_produto: body.event?.codigo_produto,
    codigo: body.event?.codigo,
    timestamp: new Date().toISOString()
  });

  // ============================================================================
  // RESPONDE IMEDIATAMENTE para evitar timeout (< 1 segundo)
  // ============================================================================
  res.json({ 
    ok: true, 
    message: 'Webhook recebido e será processado em background',
    messageId,
    timestamp: new Date().toISOString()
  });

  // ============================================================================
  // PROCESSA EM BACKGROUND (fire-and-forget)
  // ============================================================================
  processWebhookInBackground(req.app, body, messageId).catch(err => {
    console.error('[webhook/produtos] Erro no processamento em background:', {
      messageId,
      error: String(err),
      stack: err.stack
    });
  });
});

// ============================================================================
// Função auxiliar: processa o webhook em background
// ============================================================================
async function processWebhookInBackground(app, body, messageId) {
  const touchedIds = new Set();
  let processed = 0;
  let fetched   = 0;
  const failures = [];
  const startTime = Date.now();

  console.log('[webhook/produtos] Iniciando processamento em background:', messageId);

  // dispara re-sync da ESTRUTURA (fire-and-forget)
  async function fireAndForgetResyncById(idProduto) {
    if (!idProduto) return;
    const url = `${INTERNAL_BASE}/internal/pcp/estrutura/resync?token=${encodeURIComponent(INTERNAL_TOKEN)}`;
    const body = JSON.stringify({ id_produto: Number(idProduto) });
    try {
      httpFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      }).catch(() => {});
    } catch (_) {}
  }

  async function upsertNoBanco(item, label = 'raw') {
    let client;
    try {
      const obj = ensureIntegrationKey({ ...item });
      console.log('[webhook/produtos] Salvando no banco:', {
        messageId,
        label,
        codigo_produto: obj.codigo_produto,
        codigo: obj.codigo,
        descricao: obj.descricao?.substring(0, 50)
      });

      client = await dbGetClient();
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.produtos_omie_write_source', 'omie_webhook', true)");
      await client.query('SELECT omie_upsert_produto($1::jsonb)', [obj]);
      await client.query('COMMIT');

      const cod = Number(obj.codigo_produto || obj.codigo);
      if (!Number.isNaN(cod)) {
        touchedIds.add(cod);

        // não mexe na estrutura quando o evento for Produto.Excluido
        if ((body?.topic || '') !== 'Produto.Excluido') {
          fireAndForgetResyncById(cod);
        }
      }

      processed++;
      console.log('[webhook/produtos] Produto salvo com sucesso:', {
        messageId,
        codigo_produto: obj.codigo_produto,
        codigo: obj.codigo
      });
    } catch (e) {
      try { await client?.query('ROLLBACK'); } catch (_) {}
      console.error('[webhook/produtos] Erro ao salvar produto:', {
        messageId,
        label,
        id: item?.codigo_produto || item?.codigo,
        error: String(e),
        stack: e.stack
      });
      failures.push({
        step: 'db_upsert',
        label,
        id: item?.codigo_produto || item?.codigo,
        error: String(e)
      });
    } finally {
      try { client?.release?.(); } catch (_) {}
    }
  }

  function mesclarProdutoComEvento(produto, evento) {
    if (!produto && !evento) return null;
    if (!produto) return ensureIntegrationKey({ ...evento });
    if (!evento) return ensureIntegrationKey({ ...produto });

    const merged = { ...produto };

    // preserva identificadores do evento quando presentes
    if (evento.codigo_produto) merged.codigo_produto = evento.codigo_produto;
    if (evento.codigo) merged.codigo = evento.codigo;

    // campos críticos que chegam no webhook e não podem ser "revertidos"
    if (typeof evento.descricao === 'string' && evento.descricao.trim()) {
      merged.descricao = evento.descricao;
    }
    if (typeof evento.descr_detalhada === 'string' && evento.descr_detalhada.trim()) {
      merged.descr_detalhada = evento.descr_detalhada;
    }
    if (typeof evento.obs_internas === 'string' && evento.obs_internas.trim()) {
      merged.obs_internas = evento.obs_internas;
    }

    return ensureIntegrationKey(merged);
  }

  // A) webhook “clássico”
  if (Array.isArray(body.produto_servico_cadastro) && body.produto_servico_cadastro.length) {    console.log('[webhook/produtos] Processando webhook clássico:', {
      messageId,
      quantidade: body.produto_servico_cadastro.length
    });
        for (const raw of body.produto_servico_cadastro) {
      await upsertNoBanco(raw, 'classico');
    }
  }

  // B) Omie Connect 2.0
  if (body.topic === 'Produto.Alterado' && body.event) {
    const ev = body.event;
    console.log('[webhook/produtos] Processando Omie Connect 2.0:', {
      messageId,
      topic: body.topic,
      codigo_produto: ev.codigo_produto,
      codigo: ev.codigo
    });
    
    try {
      // 1) aplica imediatamente o payload do evento para não perder alterações recentes
      await upsertNoBanco(ev, 'omie_connect_event');

      // 2) tenta enriquecer com ConsultarProduto, sem sobrescrever campos críticos do evento
      console.log('[webhook/produtos] Consultando produto na API Omie...');
      const produto = await consultarProdutoOmie({
        codigo_produto: ev.codigo_produto,
        codigo: ev.codigo,
      });
      
      if (!produto) {
        throw new Error('payload vazio da Omie');
      }
      
      console.log('[webhook/produtos] Produto consultado com sucesso:', {
        messageId,
        codigo_produto: produto.codigo_produto,
        codigo: produto.codigo
      });

      const produtoMesclado = mesclarProdutoComEvento(produto, ev);
      await upsertNoBanco(produtoMesclado, 'omie_connect_consulta_mesclada');

      fetched++;
    } catch (e) {
      console.error('[webhook/produtos] Erro ao consultar Omie:', {
        messageId,
        id: ev?.codigo_produto || ev?.codigo,
        error: String(e),
        stack: e.stack
      });
      failures.push({ 
        step: 'omie_consulta', 
        id: ev?.codigo_produto || ev?.codigo, 
        error: String(e) 
      });
    }
  }

  // Dispara SSE para o front (uma única vez)
  try {
    const sse = app.get('sseBroadcast');
    if (typeof sse === 'function' && touchedIds.size) {
      sse({ type: 'produtos_updated', ids: Array.from(touchedIds), at: Date.now() });
      console.log('[webhook/produtos] SSE enviado para o front:', {
        messageId,
        produtos_atualizados: touchedIds.size
      });
    }
  } catch (e) {
    console.warn('[webhook/produtos] SSE broadcast falhou:', {
      messageId,
      error: String(e)
    });
  }

  const duration = Date.now() - startTime;
  console.log('[webhook/produtos] Processamento concluído:', {
    messageId,
    processed,
    fetched_from_omie: fetched,
    failures: failures.length,
    duration_ms: duration,
    touchedIds: Array.from(touchedIds)
  });

  if (failures.length > 0) {
    console.error('[webhook/produtos] Falhas durante o processamento:', {
      messageId,
      failures
    });
  }
}

// ============================================================================
// POST /api/produtos/debug/broadcast
// Permite testar o SSE sem passar pela Omie
// Body: { ids: [104..., ...] }
// ============================================================================
router.post('/debug/broadcast', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const sse = req.app.get('sseBroadcast');
    if (typeof sse === 'function') {
      sse({ type: 'produtos_updated', ids, at: Date.now() });
    }
    res.json({ ok: true, sent: ids });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================================
// GET /api/produtos/familias - Lista famílias da tabela configuracoes.familia
// ============================================================================
router.get('/familias', async (req, res) => {
  try {
    const result = await dbQuery('SELECT id, codigo, nome_familia FROM configuracoes.familia ORDER BY nome_familia');
    res.json(result.rows || []);
  } catch (e) {
    console.error('[GET /api/produtos/familias]', e);
    res.status(500).json({ error: 'Erro ao buscar famílias' });
  }
});

// ============================================================================
// POST /api/produtos/sincronizar-completo
// Sincroniza TODOS os produtos da Omie com streaming de progresso
// Usa Server-Sent Events (SSE) para enviar atualizações em tempo real
// ============================================================================
router.post('/sincronizar-completo', async (req, res) => {
  return res.status(403).json({
    ok: false,
    error: 'Sincronização manual desabilitada: public.produtos_omie é mantida exclusivamente pelo webhook da Omie.'
  });

  // Configura SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const REGISTROS_POR_PAGINA = 50;
  const DELAY_ENTRE_PAGINAS_MS = 300;
  const DELAY_ENTRE_PRODUTOS_MS = 50;
  const MAX_RETRIES = 3;

  const stats = {
    total: 0,
    processados: 0,
    sucesso: 0,
    erros: 0,
    inicio: Date.now()
  };

  // Função para enviar eventos SSE
  function enviarEvento(tipo, dados) {
    res.write(`data: ${JSON.stringify({ tipo, ...dados })}\n\n`);
  }

  // Função de sleep
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Função para listar produtos (paginado)
  async function listarProdutosOmie(pagina, tentativa = 1) {
    const body = {
      call: 'ListarProdutos',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{
        pagina,
        registros_por_pagina: REGISTROS_POR_PAGINA,
        apenas_importado_api: 'N',
        filtrar_apenas_omiepdv: 'N'
      }]
    };

    try {
      const response = await httpFetch(OMIE_PROD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      return await response.json();
    } catch (error) {
      if (tentativa < MAX_RETRIES) {
        enviarEvento('log', {
          mensagem: `⚠️ Erro ao buscar página ${pagina}, tentativa ${tentativa}/${MAX_RETRIES}`,
          nivel: 'warning'
        });
        await sleep(1000 * tentativa);
        return listarProdutosOmie(pagina, tentativa + 1);
      }
      throw error;
    }
  }

  // Função para processar um produto
  async function processarProduto(produto, index, total) {
    const codigoProduto = produto.codigo_produto;
    const codigo = produto.codigo;
    const descricao = produto.descricao || '';

    try {
      // Consulta detalhes completos do produto
      const produtoCompleto = await consultarProdutoOmie({
        codigo_produto: codigoProduto,
        codigo: codigo
      });

      if (!produtoCompleto) {
        enviarEvento('log', {
          mensagem: `⏭️ Produto ${codigo} (${codigoProduto}) - payload vazio, pulando`,
          nivel: 'warning'
        });
        stats.processados++;
        return;
      }

      // Salva no banco
      const obj = ensureIntegrationKey({ ...produtoCompleto });
      await dbQuery('SELECT omie_upsert_produto($1::jsonb)', [obj]);

      stats.sucesso++;
      stats.processados++;

      // Envia progresso
      enviarEvento('progresso', {
        total: stats.total,
        processados: stats.processados,
        sucesso: stats.sucesso,
        erros: stats.erros,
        produto_atual: {
          codigo,
          codigo_produto: codigoProduto,
          descricao
        }
      });

    } catch (error) {
      stats.erros++;
      stats.processados++;

      enviarEvento('log', {
        mensagem: `❌ Erro ao processar ${codigo} (${codigoProduto}): ${error.message}`,
        nivel: 'error'
      });

      enviarEvento('progresso', {
        total: stats.total,
        processados: stats.processados,
        sucesso: stats.sucesso,
        erros: stats.erros
      });
    }

    await sleep(DELAY_ENTRE_PRODUTOS_MS);
  }

  // Processo principal
  try {
    enviarEvento('log', {
      mensagem: '🚀 Iniciando sincronização completa de produtos...',
      nivel: 'info'
    });

    // Busca primeira página para obter totais
    enviarEvento('log', {
      mensagem: '📊 Consultando total de produtos na Omie...',
      nivel: 'info'
    });

    const primeiraPagina = await listarProdutosOmie(1);
    const totalPaginas = Number(primeiraPagina.total_de_paginas || 1);
    stats.total = Number(primeiraPagina.total_de_registros || 0);

    enviarEvento('log', {
      mensagem: `✓ Total: ${stats.total} produtos em ${totalPaginas} páginas`,
      nivel: 'success'
    });

    const tempoEstimado = Math.ceil(
      (totalPaginas * DELAY_ENTRE_PAGINAS_MS +
       stats.total * (DELAY_ENTRE_PRODUTOS_MS + 200)) / 1000 / 60
    );

    enviarEvento('log', {
      mensagem: `⏱️ Tempo estimado: ~${tempoEstimado} minutos`,
      nivel: 'info'
    });

    enviarEvento('progresso', {
      total: stats.total,
      processados: 0,
      sucesso: 0,
      erros: 0
    });

    // Processa todas as páginas
    for (let pagina = 1; pagina <= totalPaginas; pagina++) {
      enviarEvento('log', {
        mensagem: `📄 Processando página ${pagina}/${totalPaginas}...`,
        nivel: 'info'
      });

      const resultado = pagina === 1 ? primeiraPagina : await listarProdutosOmie(pagina);
      const produtos = resultado.produto_servico_cadastro || [];

      for (const produto of produtos) {
        await processarProduto(produto, stats.processados + 1, stats.total);
      }

      await sleep(DELAY_ENTRE_PAGINAS_MS);
    }

    // Finaliza
    const duracao = ((Date.now() - stats.inicio) / 1000 / 60).toFixed(1);

    enviarEvento('concluido', {
      mensagem: `Sincronização concluída! ${stats.sucesso} produtos sincronizados em ${duracao} minutos.`,
      total: stats.total,
      processados: stats.processados,
      sucesso: stats.sucesso,
      erros: stats.erros,
      duracao_minutos: duracao
    });

    res.end();

  } catch (error) {
    console.error('[POST /api/produtos/sincronizar-completo] Erro:', error);
    
    enviarEvento('erro', {
      mensagem: `Erro fatal: ${error.message}`
    });

    res.end();
  }
});

module.exports = router;
