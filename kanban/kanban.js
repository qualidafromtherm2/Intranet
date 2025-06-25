// kanban.js  (substitua todo o arquivo)

import {
  carregarKanbanLocal,
  renderKanbanDesdeJSON,
  salvarKanbanLocal,
  enableDragAndDrop
} from './kanban_base.js';

import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

/* ------------------------------------------------------------------ */
/*  kanban.js  –  garantir BASE das chamadas backend                   */
/* ------------------------------------------------------------------ */
const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : window.location.origin;           // Render ou outro domínio

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



function setupAddToggle() {
  const colElem = document.getElementById('coluna-pcp-aprovado');
  if (!colElem) return;                    // sai se não achou o UL
  const col = colElem.closest('.kanban-column');
  if (!col) return;                        // sai se não achou a coluna

  const btn   = col.querySelector('.add-btn');
  const input = col.querySelector('.add-search');
  btn.addEventListener('click', () => {
    col.classList.toggle('search-expand');
    if (col.classList.contains('search-expand')) {
      setTimeout(() => input.focus(), 100);
    }
  });
}

// <<< Cole AQUI, logo abaixo de setupAddToggle()

// ─── busca paginada na OMIE (com logs) ───────────────────────────────────────
// ─── busca paginada na OMIE (com logs) ───────────────────────────────────────
async function fetchAllProducts(filter) {
  const all = [];
  let page = 1;
  const perPage = 50;

  while (true) {
    const payload = {
      call: 'ListarProdutos',
      param: [{
        pagina: page,
        registros_por_pagina: perPage,
        apenas_importado_api: 'N',
        filtrar_apenas_omiepdv: 'N',
        filtrar_apenas_descricao: `%${filter}%`
      }],
      app_key:    OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };

    console.log(`[OMIE][Page ${page}] Enviando payload:`, payload);
    const resp = await fetch(`${API_BASE}/api/omie/produtos`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    console.log(`[OMIE][Page ${page}] Status HTTP:`, resp.status);

    let data;
    try {
      data = await resp.json();
    } catch (err) {
      console.error(`[OMIE][Page ${page}] Falha ao parsear JSON:`, err);
      throw err;
    }
    console.log(`[OMIE][Page ${page}] JSON recebido:`, data);

    // busca pelo campo correto retornado pela OMIE:
    const list = Array.isArray(data.produto_servico_cadastro)
      ? data.produto_servico_cadastro
      : Array.isArray(data.produtos_cadastro)
        ? data.produtos_cadastro
        : [];

    console.log(`[OMIE][Page ${page}] Itens nesta página:`, list.length);
    all.push(...list);

    if (list.length < perPage) break;
    page++;
  }

  console.log('[OMIE] Total de itens coletados:', all.length);
  return all;
}


// ─── renderiza o listbox ─────────────────────────────────────────
function renderSearchResults(products, container) {
  container.innerHTML = '';
  products.forEach(p => {
    const li = document.createElement('li');
    li.classList.add('result-item');
    li.textContent = `${p.codigo} — ${p.descricao}`;
    container.appendChild(li);
li.addEventListener('click', () => {
  // 1.1) Log do item clicado
  console.log('[SEARCH] Você clicou em:', p.codigo, p.descricao);

  // 1.2) Preenche o input
  const input = container.previousElementSibling;
  input.value = `${p.codigo} — ${p.descricao}`;
  console.log('[SEARCH] input.value atualizado para:', input.value);

  // 1.3) Fecha a lista de resultados
  container.innerHTML = '';

  // 1.4) Dispara clique na aba PCP
  const tabPCP = document.querySelector(
    '#kanbanTabs .main-header-link[data-kanban-tab="pcp"]'
  );
  console.log('[SEARCH] Disparando aba PCP');
  tabPCP.click();
});

  });
}

// ─── instala o listener no input (com logs) ───────────────────────────────
function setupProductSearch() {
  const colElem = document.getElementById('coluna-pcp-aprovado');
  if (!colElem) return;
  const col     = colElem.closest('.kanban-column');
  if (!col) return;

  const input   = col.querySelector('.add-search');
  const results = col.querySelector('.add-results');
  let debounce;

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const term = input.value.trim();
    console.log('[SEARCH] input mudou para:', term);
    if (term.length < 4) {
      results.innerHTML = '';
      return;
    }
    debounce = setTimeout(async () => {
      console.log('[SEARCH] Disparando busca OMIE para:', term);
      results.innerHTML = '<li>Buscando…</li>';
      try {
const items = await fetchAllProducts(term);
console.log('[SEARCH] Recebeu itens:', items);

// 1) filtra apenas tipoItem = "04"
const filtered = items.filter(p => p.tipoItem === '04');
console.log('[SEARCH] Itens tipoItem="04":', filtered.length, filtered);

// 2) ordena alfabeticamente pelo código
const sorted = filtered.sort((a, b) => a.codigo.localeCompare(b.codigo));
console.log('[SEARCH] Itens ordenados (códigos):', sorted.map(p => p.codigo));

// 3) renderiza o resultado ordenado
renderSearchResults(sorted, results);


      } catch (err) {
        console.error('[SEARCH] Erro na busca:', err);
        results.innerHTML = `<li class="error">Erro: ${err.message}</li>`;
      }
    }, 300);
  });

}


// ─── 1) Renderiza a Lista de Peças na aba PCP ────────────────────────
async function renderListaPecasPCP() {
// renderListaPecasPCP()
console.log('[PCP] → renderListaPecasPCP() começou');

// 1) encontra a UL
const ul = document.getElementById('listaPecasPCPList');
if (!ul) { console.warn('[PCP] UL não encontrada'); return; }

// 2) encontra o input correto navegando pela coluna
const col = document
  .getElementById('coluna-pcp-aprovado')
  .closest('.kanban-column');
const input = col?.querySelector('.add-search');
console.log('[PCP] input encontrado:', input);
if (!input) { console.warn('[PCP] input .add-search não encontrado'); return; }

// 3) extrai o código
const raw = input.value;
const codigo = raw.split('—')[0]?.trim();
console.log('[PCP] Código extraído:', codigo);
if (!codigo) { console.warn('[PCP] Sem código válido'); return; }

  // 3.2) Chama o seu proxy de “ConsultarEstrutura”
  console.log('[PCP] Enviando requisição para /api/omie/estrutura', codigo);
  const resp = await fetch(`${API_BASE}/api/omie/estrutura`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ param:[{ codProduto: codigo }] })
  });
  console.log('[PCP] status HTTP:', resp.status);

  // 3.3) Parse do JSON
  let data;
  try {
    data = await resp.json();
    console.log('[PCP] JSON recebido:', data);
  } catch (err) {
    console.error('[PCP] Erro ao ler JSON:', err);
    return;
  }

  // 3.4) Pega o array de peças (ajuste o nome se for diferente)
  const pecas = data.itens || data.pecas || [];
  console.log('[PCP] Total de peças:', pecas.length);

  // 3.5) Limpa e popula o UL
  ul.innerHTML = '';
  pecas.forEach(p => {
    const li = document.createElement('li');
    li.classList.add('content-item');
    li.textContent = `${p.codProdMalha} — ${p.descrProdMalha} (Qtd: ${p.quantProdMalha})`;
    li.dataset.codigo    = p.codProdMalha.toLowerCase();
    li.dataset.descricao = p.descrProdMalha.toLowerCase();
    ul.appendChild(li);
  });

  console.log('[PCP] UL populada no DOM com as peças');
}



// ─── 2) Aplica filtros de código e descrição na lista PCP ───────────
function applyPecasFilterPCP() {
  const container = document.querySelector('#listaPecasPCP .title-wrapper');
  if (!container) return;

  // Evita criar duas vezes os inputs
  if (container.querySelector('#codeFilterPCP')) return;

  const codeFilter = document.createElement('input');
  codeFilter.id = 'codeFilterPCP';
  codeFilter.placeholder = 'Pesquisar código';

  const descFilter = document.createElement('input');
  descFilter.id = 'descFilterPCP';
  descFilter.placeholder = 'Pesquisar descrição';

  container.appendChild(codeFilter);
  container.appendChild(descFilter);

  const filtrar = () => {
    const c = codeFilter.value.trim().toLowerCase();
    const d = descFilter.value.trim().toLowerCase();
    document
      .querySelectorAll('#listaPecasPCPList li')
      .forEach(li => {
        const ok = (!c || li.dataset.codigo.includes(c))
                && (!d || li.dataset.descricao.includes(d));
        li.style.display = ok ? '' : 'none';
      });
  };

  codeFilter.addEventListener('input', filtrar);
  descFilter.addEventListener('input', filtrar);
}

/* ───────────────── navegação de abas ───────────────── */
function setupTabNavigation() {
  const links = document.querySelectorAll('#kanbanTabs .main-header-link');
  links.forEach(lk =>
    lk.addEventListener('click', e => {
      e.preventDefault();
      const alvo = lk.dataset.kanbanTab; // comercial | pcp | produção…
      console.log('[TAB] Aba selecionada →', alvo);
      links.forEach(a => a.classList.remove('is-active'));
      lk.classList.add('is-active');
      document.querySelectorAll('.kanban-page')
        .forEach(p => p.style.display = 'none');
      const pg = document.getElementById(`conteudo-${alvo}`);
      if (pg) pg.style.display = 'block';

  if (alvo === 'pcp') {
    console.log('[TAB] Iniciando renderização da lista de peças PCP');
    renderListaPecasPCP();
    applyPecasFilterPCP();
    console.log('[TAB] Lista de peças PCP finalizada');
  }
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
      const resp = await fetch(`${API_BASE}/api/omie/pedido`, {
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
    const respLP = await fetch(`${API_BASE}/api/omie/pedidos`, {
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
        try {
          const r = await fetch(`${API_BASE}/api/omie/estoque/consulta`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payloadEst)
          });
          const d = r.ok?await r.json():{};
          obj.estoque =
            d.saldo ?? d.posicao?.[0]?.saldo_atual ?? d.posicao?.[0]?.quantidade_estoque ?? 0;
        } catch {
          obj.estoque = 0;
        }
        novos.push(obj);
        await sleep(300);
      }
    }

    /* 4) mescla + renderiza */
    const allItems = existingItems.concat(novos);
    renderKanbanDesdeJSON(allItems);
    enableDragAndDrop(allItems);
    if (novos.length) await salvarKanbanLocal(allItems);

    /* 5) ativa dblclick, toggle de “+”, busca e navegação de abas */    /* 5) ativa dblclick, toggle de “+”, busca e navegação de abas */
    attachDoubleClick(allItems, pedidosMap);
    setupAddToggle();        // abre/fecha campo de pesquisa
    setupProductSearch();    // instala listener de digitação
    setupTabNavigation();    // mantém navegação de abas

    /* exibe aba Comercial como default */
    const linkCom = document.querySelector(
      '#kanbanTabs .main-header-link[data-kanban-tab="comercial"]'
    );
    linkCom?.click?.();


  }
  
  
  
  catch (err) {
    console.error('Erro no initKanban:', err);
  } finally {
    hideSpinner();
  }
}

