// kanban_detalhes.js  – responsável por abrir a aba Detalhes
// Sempre consulta a OMIE e mostra TODOS os itens do pedido.

import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

/**
 * Registra duplo‑clique na coluna "Pedido aprovado".
 * Quando acionado:
 *   1) troca para aba Detalhes;
 *   2) faz ConsultarPedido na OMIE;
 *   3) monta cabeçalho + tabela com todos os itens.
 * Evita múltiplas instalações usando flag no DOM.
 *
 * @param {Array} itemsKanban  – array em memória já renderizado
 */
export function initKanbanDetalhes(itemsKanban) {
  const ul = document.getElementById('coluna-comercial');
  if (!ul || ul.dataset.dblInit) return;   // já instalado
  ul.dataset.dblInit = '1';

  ul.addEventListener('dblclick', async e => {
    const li = e.target.closest('.kanban-card');
    if (!li) return;

    /* identifica pedido */
    const idx = parseInt(li.dataset.index, 10);
    const kanItem = itemsKanban[idx];
    if (!kanItem) return;
    const numeroPedido = String(kanItem.pedido);

    // —— abre aba Detalhes ——
    document.querySelectorAll('#kanbanTabs .main-header-link')
      .forEach(a => a.classList.toggle('is-active', a.dataset.kanbanTab === 'detalhes'));
    document.querySelectorAll('.kanban-page').forEach(p => p.style.display = 'none');
    const pg = document.getElementById('conteudo-detalhes');
    if (pg) pg.style.display = 'block';

    const container = document.getElementById('detalhesContainer');
    if (!container) return;
    container.innerHTML = '<p class="loading-details">Carregando detalhes…</p>';

    try {
      /* consulta OMIE */
      const payload = {
        call: 'ConsultarPedido',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{ numero_pedido: numeroPedido }]
      };
      const resp = await fetch('/api/omie/pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(`status ${resp.status}`);
      const data = await resp.json();

      const pedObj = Array.isArray(data.pedido_venda_produto)
        ? data.pedido_venda_produto[0]
        : data.pedido_venda_produto;
      if (!pedObj) throw new Error('pedido_venda_produto vazio');

      /* cabeçalho */
      const cab  = pedObj.cabecalho ?? {};
      const obsV = pedObj.observacoes?.obs_venda ?? '';
      const detA = Array.isArray(pedObj.det) ? pedObj.det : [];

      const topo = `
        <div class="detalhes-header">
          <div class="campo-detalhe"><span class="label-detalhe">Pedido:</span>
            <span class="valor-detalhe">${numeroPedido}</span></div>
          <div class="campo-detalhe"><span class="label-detalhe">Itens:</span>
            <span class="valor-detalhe">${cab.quantidade_itens ?? detA.length}</span></div>
          <div class="campo-detalhe largura-max"><span class="label-detalhe">Obs. venda:</span>
            <span class="valor-detalhe">${obsV || '(sem)'}</span></div>
        </div>`;

      /* tabela */
      let linhas = '';
      detA.forEach(d => {
        const cod  = d.produto?.codigo ?? '';
        const desc = d.produto?.descricao ?? '';
        const qtd  = d.produto?.quantidade ?? '';
        const est  = (itemsKanban.find(it => it.pedido == numeroPedido && it.codigo == cod)?.estoque) ?? 0;

        linhas += `
          <tr>
            <td>${cod}</td>
            <td>${desc}</td>
            <td>${qtd}</td>
            <td>${est}</td>
          </tr>`;
      });

      container.innerHTML = `
        <div class="detalhes-wrapper">
          ${topo}
          <div class="detalhes-tabela-container">
            <table class="tabela-detalhes">
              <thead>
                <tr><th>Código</th><th>Descrição</th><th>Qtd</th><th>Estoque</th></tr>
              </thead>
              <tbody>${linhas}</tbody>
            </table>
          </div>
        </div>`;

    } catch (err) {
      container.innerHTML = `<p class="fault-message">Erro ao consultar pedido ${numeroPedido}: ${err.message}</p>`;
    }
  });
}
