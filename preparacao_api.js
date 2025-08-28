// preparacao_api.js (versão consolidada)

(function () {
  // Helpers básicos
  function normOp(op) { return String(op || '').trim().toUpperCase(); }

  // Pega o produto atual da aba Produto (ou do global setado no clique do card)
  function getProdutoSelecionado() {
    const h = document.getElementById('produtoSelecionado');
    if (h?.dataset?.codigo) return h.dataset.codigo;
    if (window.__prepProdutoSelecionado) return window.__prepProdutoSelecionado;
    return null;
  }

// POST genérico com payload opcional
async function postEtapa(url, extra = {}) {
  const resp = await fetch(url, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(extra)
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  console.log('[prep][postEtapa]', url, { status: resp.status, json, raw: text });

  if (!resp.ok) {
    throw new Error(json?.error || json?.message || text || `HTTP ${resp.status}`);
  }
  return json ?? { ok: true };
}


  // Lista do kanban (usa sua rota /api/preparacao/listar)
  async function carregarKanban() {
    const res = await fetch('/api/preparacao/listar', { cache: 'no-store', credentials: 'include' });
    if (!res.ok) throw new Error(`Falha ao listar preparação (HTTP ${res.status})`);
    const json = await res.json();
    return json?.data || {};
  }

// 🔄 Refresca o quadro principal + mini-board do produto atual
async function refreshPreparacaoUI() {
  try {
    // quadro principal (Início)
    if (typeof carregarKanbanPreparacao === 'function') {
      await carregarKanbanPreparacao();           // se existir no teu projeto
    } else if (typeof initPreparacaoKanban === 'function') {
      await initPreparacaoKanban(true);           // força recarregar
    } else if (typeof window.initPreparacaoKanban === 'function') {
      await window.initPreparacaoKanban(true);
    }
  } catch (e) {
    console.warn('[prep][refresh] principal falhou:', e);
  }

  try {
    // mini-kanban (aba Produto), se há um produto selecionado
    const alfa = (window.codigoSelecionado || '').trim();
    const cp   = (window.codigoSelecionadoCP || '').toString().trim() || null;
    if (alfa && typeof window.renderMiniKanban === 'function') {
      await window.renderMiniKanban(alfa, cp);
    }
  } catch (e) {
    console.warn('[prep][refresh] mini-kanban falhou:', e);
  }
}

async function iniciarProducao(op) {
  op = (op || '').toString().trim().toUpperCase();
  if (!op) throw new Error('OP inválida.');

  // pistas do produto, se disponíveis
  const prodAlpha = (function () {
    const h = document.getElementById('produtoSelecionado');
    return (h?.dataset?.codigo || window.__prepProdutoSelecionado || '').trim();
  })();
  const prodNum = (window.codigoSelecionadoCP || '').toString().trim();

  // desabilita botão (se existir) para evitar duplo clique
  const btn = document.getElementById('btn-iniciar');
  if (btn) btn.disabled = true;

  try {
    await postEtapa(
      `/api/preparacao/op/${encodeURIComponent(op)}/iniciar`,
      {
        produto_codigo     : prodAlpha || null,
        produto_codigo_num : prodNum   || null
      }
    );

    // fecha modal de QR se aberto
    try { document.getElementById('qrModal')?.close?.(); } catch {}

    // 🔄 refresca tudo
    await refreshPreparacaoUI();
  } finally {
    if (btn) btn.disabled = false;
  }
}


async function finalizarProducao(op) {
  op = (op || '').toString().trim().toUpperCase();
  if (!op) throw new Error('OP inválida.');

  const prodAlpha = (function () {
    const h = document.getElementById('produtoSelecionado');
    return (h?.dataset?.codigo || window.__prepProdutoSelecionado || '').trim();
  })();
  const prodNum = (window.codigoSelecionadoCP || '').toString().trim();

  // data de hoje no formato ISO; o backend aceita ISO ou dd/MM/yyyy
  const hoje = new Date();
  const iso = hoje.toISOString().slice(0,10);

  const btn = document.getElementById('btn-finalizar');
  if (btn) btn.disabled = true;

  try {
    const resp = await postEtapa(
      `/api/preparacao/op/${encodeURIComponent(op)}/concluir`,
      {
        produto_codigo     : prodAlpha || null,
        produto_codigo_num : prodNum   || null,
        data               : iso,       // o backend converte pra dd/MM/yyyy
        quantidade         : 1
      }
    );
    console.log('[prep][finalizar] retorno:', resp);

    // fecha modal (se aberto) e atualiza UI toda
    try { document.getElementById('qrModal')?.close?.(); } catch {}
    await refreshPreparacaoUI();
  } finally {
    if (btn) btn.disabled = false;
  }
}


// exporta helpers
window.Preparacao = Object.assign(window.Preparacao || {}, {
  iniciarProducao,
  finalizarProducao,
  refreshPreparacaoUI
});

  // API pública
  window.Preparacao = { carregarKanban, iniciarProducao, finalizarProducao };
})();
