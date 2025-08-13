// preparacao_api.js
(function () {
  async function carregarKanban() {
    const res = await fetch('/api/preparacao/listar', { cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao listar preparação');
    const { data } = await res.json(); // { 'Fila de produção':[], 'Em produção':[], 'No estoque':[] }
    return data;
  }

  async function iniciarProducao(op) {
    const res = await fetch(`/api/preparacao/op/${encodeURIComponent(op)}/iniciar`, {
      method: 'POST'
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      throw new Error(json.error || 'Falha ao iniciar produção');
    }
    // depois do POST, devolvemos o kanban atualizado
    return await carregarKanban();
  }

  async function finalizarProducao(op) {
  const res = await fetch(`/api/preparacao/op/${encodeURIComponent(op)}/concluir`, {
    method: 'POST'
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(json.error || 'Falha ao finalizar produção');
  }
  return await carregarKanban();
}

// mantenha as três funções como estão declaradas acima…
window.Preparacao = {
  carregarKanban,
  iniciarProducao,
  finalizarProducao,  // <-- não deixe de exportar!
};


})();
