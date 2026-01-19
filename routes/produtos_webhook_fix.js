// ============================================================================
// POST /api/produtos/webhook - VERSÃO CORRIGIDA
// Aceita:
//  A) { produto_servico_cadastro: [ {...}, ... ] }  (webhook "clássico")
//  B) { topic:"Produto.Alterado", event:{...} }     (Omie Connect 2.0)
// Valida por ?token=... ou header X-Omie-Token.
// 
// CORREÇÃO DE TIMEOUT:
// - Responde imediatamente (200 OK) para evitar timeout da Omie
// - Processa em background (async sem await)
// - Adiciona logs detalhados para rastreamento
// ============================================================================

// Cole este código no routes/produtos.js, substituindo o router.post('/webhook', ...) existente

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
// Cole esta função ANTES do router.post('/webhook', ...) no routes/produtos.js
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
    try {
      const obj = ensureIntegrationKey({ ...item });
      console.log('[webhook/produtos] Salvando no banco:', {
        messageId,
        label,
        codigo_produto: obj.codigo_produto,
        codigo: obj.codigo,
        descricao: obj.descricao?.substring(0, 50)
      });
      
      await dbQuery('SELECT omie_upsert_produto($1::jsonb)', [obj]);

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
    }
  }

  // A) webhook "clássico"
  if (Array.isArray(body.produto_servico_cadastro) && body.produto_servico_cadastro.length) {
    console.log('[webhook/produtos] Processando webhook clássico:', {
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
      
      await upsertNoBanco(produto, 'omie_connect');
      fireAndForgetResyncById(produto?.codigo_produto || produto?.codigo);

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
