// kanban.js  (substitua todo o arquivo)

import {
  carregarKanbanLocal,
  renderKanbanDesdeJSON,
  salvarKanbanLocal,
  enableDragAndDrop
} from './kanban_base.js';

import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

/* ───────────────── helpers ───────────────── */
function formatDateBR(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const showSpinner = () =>
  (document.querySelector('.kanban-spinner') ?? {}).style && (
    document.querySelector('.kanban-spinner').style.display = 'inline-block');
const hideSpinner = () =>
  (document.querySelector('.kanban-spinner') ?? {}).style && (
    document.querySelector('.kanban-spinner').style.display = 'none');

/* ───────────────── navegação de abas ───────────────── */
function setupTabNavigation() {
  const links = document.querySelectorAll('#kanbanTabs .main-header-link');
  if (!links.length) return;          // evita erro se abas não existirem

  links.forEach(lk =>
    lk.addEventListener('click', e => {
      e.preventDefault();
      const alvo = lk.dataset.kanbanTab;           // comercial | detalhes…

      links.forEach(a => a.classList.remove('is-active'));
      lk.classList.add('is-active');

      document.querySelectorAll('.kanban-page').forEach(p => p.style.display = 'none');
      const pg = document.getElementById(`conteudo-${alvo}`);
      if (pg) pg.style.display = 'block';
    })
  );
}

/* ───────────────── detalhes via duplo-clique ─────────────────
   Agora SEM cache: sempre chama ConsultarPedido.
   A tabela inclui todos os itens (det[]) do pedido. */
function attachDoubleClick(itemsKanban) {
  const ul = document.getElementById('coluna-comercial');
  if (!ul || ul.dataset.dblInit) return;   // evita duplicar listeners
  ul.dataset.dblInit = '1';

  ul.addEventListener('dblclick', async e => {
    const li = e.target.closest('.kanban-card');
    if (!li) return;

    /* identifica o pedido */
    const idx     = parseInt(li.dataset.index, 10);
    const kanItem = itemsKanban[idx];
    if (!kanItem) return;
    const numeroPedido = String(kanItem.pedido);

    /* —— seleciona a aba Detalhes —— */
    document.querySelectorAll('#kanbanTabs .main-header-link').forEach(a =>
      a.classList.toggle('is-active', a.dataset.kanbanTab === 'detalhes'));
    document.querySelectorAll('.kanban-page').forEach(p => p.style.display = 'none');
    const pgDet = document.getElementById('conteudo-detalhes');
    if (pgDet) pgDet.style.display = 'block';

    const container = document.getElementById('detalhesContainer');
    if (!container) return;
    container.innerHTML = '<p class="loading-details">Carregando detalhes…</p>';

    /* —— sempre consulta OMIE —— */
    try {
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
      const cab   = pedObj.cabecalho ?? {};
      const obsV  = pedObj.observacoes?.obs_venda ?? '';
      const detAr = Array.isArray(pedObj.det) ? pedObj.det : [];

      const htmlTopo = `
        <div class="detalhes-header">
          <div class="campo-detalhe"><span class="label-detalhe">Pedido:</span>
            <span class="valor-detalhe">${numeroPedido}</span></div>
          <div class="campo-detalhe"><span class="label-detalhe">Itens:</span>
            <span class="valor-detalhe">${cab.quantidade_itens ?? detAr.length}</span></div>
          <div class="campo-detalhe largura-max"><span class="label-detalhe">Obs. venda:</span>
            <span class="valor-detalhe">${obsV || '(sem)'}</span></div>
        </div>`;

      /* monta tabela com TODOS os det[] */
      let htmlRows = '';
      detAr.forEach(d => {
        const cod  = d.produto?.codigo ?? '';
        const desc = d.produto?.descricao ?? '';
        const qtd  = d.produto?.quantidade ?? '';
        /* tenta achar estoque em itemsKanban (caso já exista) */
        const matchKan = itemsKanban.find(it => it.pedido == numeroPedido && it.codigo == cod);
        const est = matchKan?.estoque ?? 0;

        htmlRows += `
          <tr>
            <td>${cod}</td>
            <td>${desc}</td>
            <td>${qtd}</td>
            <td>${est}</td>
          </tr>`;
      });

      const htmlTabela = `
        <table class="tabela-detalhes">
          <thead>
            <tr><th>Código</th><th>Descrição</th><th>Qtd</th><th>Estoque</th></tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>`;

      container.innerHTML = `
        <div class="detalhes-wrapper">
          ${htmlTopo}
          <div class="detalhes-tabela-container">
            ${htmlTabela}
          </div>
        </div>`;

    } catch (err) {
      container.innerHTML = `<p class="fault-message">
        Erro ao consultar pedido ${numeroPedido}: ${err.message}</p>`;
    }
  });
}


/* ───────────────── FUNÇÃO PRINCIPAL ───────────────── */
export async function initKanban() {
  showSpinner();
  const hoje = formatDateBR(new Date());

  try {
    /* 1) carrega kanban.json existente */
    const existingItems = await carregarKanbanLocal();
    if (existingItems.length) {
      renderKanbanDesdeJSON(existingItems);
      enableDragAndDrop(existingItems);
    }

    /* 2) busca ListarPedidos */
    const payloadLP = {
      call: 'ListarPedidos',
      param: [{ pagina:1, registros_por_pagina:100, etapa:'80', apenas_importado_api:'N' }],
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };
    const respLP = await fetch('/api/omie/pedidos', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payloadLP)
    });
    const dataLP = respLP.ok ? await respLP.json() : {};
    const pedidos = Array.isArray(dataLP.pedido_venda_produto)
      ? dataLP.pedido_venda_produto : [];

    /* cria mapa para cache de pedidos */
    const pedidosMap = {};
    pedidos.forEach(p => {
      pedidosMap[String(p.cabecalho.numero_pedido)] = p;
    });

    /* 3) identifica novos itens / consulta estoque */
    const keySet = new Set(existingItems.map(i => `${i.pedido}|${i.codigo}`));
    const novos = [];

    for (const p of pedidos) {
      const np = p.cabecalho.numero_pedido;
      for (const det of (Array.isArray(p.det)?p.det:[])) {
        const k = `${np}|${det.produto.codigo}`;
        if (keySet.has(k)) continue;

        const obj = {
          pedido: np,
          codigo: det.produto.codigo,
          quantidade: det.produto.quantidade,
          local: Array(det.produto.quantidade).fill('Pedido aprovado'),
          estoque: null,
          _codigoProd: det.produto.codigo_produto
        };
        /* consulta estoque */
        const payloadEst = {
          call:'PosicaoEstoque',
          param:[{ codigo_local_estoque:0, id_prod:obj._codigoProd,
                   cod_int:obj.codigo, data:hoje }],
          app_key:OMIE_APP_KEY, app_secret:OMIE_APP_SECRET
        };
        try{
          const r = await fetch(`${API_BASE}/api/omie/estoque/consulta`,{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payloadEst)});
          const d = r.ok?await r.json():{};
          obj.estoque =
            d.saldo ?? d.posicao?.[0]?.saldo_atual ?? d.posicao?.[0]?.quantidade_estoque ?? 0;
        }catch{ obj.estoque = 0; }
        novos.push(obj);
        await sleep(300);
      }
    }

    /* 4) mescla + renderiza */
    const allItems = existingItems.concat(novos);
    renderKanbanDesdeJSON(allItems);
    enableDragAndDrop(allItems);
    if (novos.length) await salvarKanbanLocal(allItems);

    /* 5) ativa dblclick & abas */
    attachDoubleClick(allItems, pedidosMap);
    setupTabNavigation();

    /* exibe aba Comercial como default */
    const linkCom = document.querySelector('#kanbanTabs .main-header-link[data-kanban-tab="comercial"]');
    linkCom?.click?.();

  } catch (err) {
    console.error('Erro no initKanban:', err);
  } finally {
    hideSpinner();
  }
}
