// preparacao_api.js
(function () {
  // --- Helpers -----------------------------------------------------------
  function normOp(op) {
    // aceita "P101102" (cCodIntOP) ou "10713583228" (nCodOP)
    return String(op || '').trim().toUpperCase();
  }

  function pickError(json, resp) {
    return (
      json?.omie?.faultstring ||
      json?.error ||
      json?.message ||
      (resp ? `HTTP ${resp.status}` : 'Erro desconhecido')
    );
  }

  async function postEtapa(url) {
    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });

    let json = null;
    try { json = await resp.json(); } catch { json = {}; }

    if (!resp.ok || json?.ok === false) {
      throw new Error(pickError(json, resp));
    }
    return json;
  }

  // --- API pública -------------------------------------------------------
  async function carregarKanban() {
    const res = await fetch('/api/preparacao/listar', {
      cache: 'no-store',
      credentials: 'include'
    });
    if (!res.ok) throw new Error(`Falha ao listar preparação (HTTP ${res.status})`);
    const json = await res.json();
    // Esperado: { mode:'pg', data:{ 'A Produzir':[], 'Produzindo':[], 'teste 1':[], 'teste final':[], 'concluido':[] } }
    return json?.data || {};
  }

  async function iniciarProducao(op) {
    op = normOp(op);
    if (!op) throw new Error('OP inválida.');
    await postEtapa(`/api/preparacao/op/${encodeURIComponent(op)}/iniciar`); // etapa 20
    // devolve o kanban atualizado (útil para atualizar a UI imediatamente)
    return carregarKanban();
  }

  async function finalizarProducao(op) {
    op = normOp(op);
    if (!op) throw new Error('OP inválida.');
    await postEtapa(`/api/preparacao/op/${encodeURIComponent(op)}/concluir`); // etapa 60
    return carregarKanban();
  }

  // --- Exposição global --------------------------------------------------
  window.Preparacao = {
    carregarKanban,
    iniciarProducao,
    finalizarProducao,
  };
})();
