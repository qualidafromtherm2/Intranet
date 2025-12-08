/* =======================================================================
 *  requisicoes_omie/ListarProdutos.js
 *  ----------------------------------------------------------------------
 *  • Carrega a lista do seu BACKEND (/api/produtos/lista) sem cache,
 *    guarda em window.__omieFullCache e re-renderiza a tabela.
 *  • Ao clicar no item do menu "Lista de produtos", força um refresh do
 *    banco e depois desenha a lista — sem precisar dar F5.
 *  • Mantém SSE opcional: se o backend emitir {type:'produtos_updated'},
 *    também refaz o preload automaticamente.
 * ======================================================================= */

import { loadDadosProduto } from './Dados_produto.js';
import {
  initFiltros,
  setCache,
  getFiltered,
  populateFilters
} from './filtro_produto.js';

/* --------------------- SPINNER helpers -------------------------------- */
let spinnerVisible  = false;
let spinnerFinished = false;

function showProductSpinner() {
  if (spinnerFinished || spinnerVisible) return;
  const sp = document.getElementById('productSpinner');
  if (!sp) return;
  sp.style.display = 'flex';
  sp.style.zIndex  = '1000';
  spinnerVisible   = true;
  updateSpinnerPct(0);
}
function hideProductSpinner() {
  if (!spinnerVisible) return;
  const sp = document.getElementById('productSpinner');
  if (sp) sp.style.display = 'none';
  spinnerVisible = false;
}
function updateSpinnerPct(val) {
  if (spinnerFinished) return;
  const pct  = Math.max(0, Math.min(100, Math.floor(val)));
  const cont = document.getElementById('productSpinner');
  if (!cont || !spinnerVisible) return;
  cont.setAttribute('data-pct', pct);
  const circle = cont.querySelector('#bar');
  const len    = Math.PI * 2 * +circle.getAttribute('r');
  circle.style.strokeDashoffset = ((100 - pct) / 100) * len;

  if (pct >= 100) {
    spinnerFinished = true;
    hideProductSpinner();
  }
}

/* --------------------- CACHE GLOBAL ----------------------------------- */
window.__omieFullCache = [];   // array de produtos
window.__listaReady    = null; // Promise do preload

/* --------------------- Helpers HTTP (sem cache) ----------------------- */
function buildListaUrl({ page=1, limit=500, q='', tipoitem='', inativo='N' } = {}) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    q, tipoitem, inativo
  });
  // cache-buster
  params.set('t', Date.now());
  return `/api/produtos/lista?` + params.toString();
}

async function fetchLista(params) {
  const url  = buildListaUrl(params);
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/* --------------------- PRELOAD do banco (paginado) -------------------- */
async function preloadFromDB() {
  try {
    spinnerFinished = false;
    showProductSpinner();

    window.__omieFullCache = [];
    let page     = 1;
    const limit  = 500; // o back limita ao teto dele
    let total    = null;
    let loaded   = 0;

    while (true) {
      const data  = await fetchLista({ page, limit, inativo: 'N' });
      const itens = Array.isArray(data.itens) ? data.itens : [];

      if (total === null) {
        total = Number(data.total || 0);
        if (typeof window.setListaTitulo === 'function') {
          window.setListaTitulo(total);
        }
      }

      if (!itens.length) break;

      window.__omieFullCache.push(...itens);
      loaded += itens.length;

      updateSpinnerPct(total ? (loaded / total) * 100 : 0);

      if (total && loaded >= total) break; // terminou tudo
      page++;
    }
  } finally {
    hideProductSpinner();
  }
  return true;
}

/* --------------------- RENDER ---------------------------------------- */
function attachOpenHandlers(ul) {
  // Torna cada <li> clicável ao invés de ter botão "Abrir"
  ul.querySelectorAll('li[data-codigo]').forEach(li => {
    li.style.cursor = 'pointer';
    li.onclick = () => {
      const codigo = li.dataset.codigo;

      // mostra a aba "Dados do produto" e esconde as outras
      document.querySelector('.main-header')?.style?.setProperty('display', 'flex');
      document.querySelectorAll('.main-header-link')
        .forEach(l => l.classList.remove('is-active'));
      document.querySelector('[data-target="dadosProduto"]')
        ?.classList.add('is-active');
      document.querySelectorAll('.tab-pane')
        .forEach(p => p.style.display = 'none');
      document.getElementById('dadosProduto').style.display = 'block';

      // detalhe busca direto na Omie
      loadDadosProduto(codigo);
    };
  });
}

function renderList(ul, produtos) {
  ul.innerHTML = produtos.map(p => `
    <li data-codigo="${p.codigo ?? ''}" style="cursor: pointer;" class="product-list-item">
      <span class="products">${p.codigo ?? ''}</span>
      <span class="status">${p.descricao ?? ''}</span>
    </li>`).join('');
  attachOpenHandlers(ul);
}

/* --------------------- “Hard refresh” da lista ----------------------- */
let __refreshing = false;

async function hardRefreshLista() {
  if (__refreshing) return;
  __refreshing = true;
  try {
    showProductSpinner();
    await preloadFromDB();

    // Atualiza filtros e re-renderiza (se a aba estiver visível ou não)
    setCache(window.__omieFullCache || []);
    const itens = getFiltered();

    const pane = document.getElementById('listaPecas');
    const ul   = document.getElementById('listaProdutosList');
    if (ul) renderList(ul, itens);

    const title = pane?.querySelector('.content-section-title');
    if (title) title.textContent = `Lista de produtos (${itens.length})`;

    try { populateFilters(); } catch {}
  } finally {
    __refreshing = false;
    hideProductSpinner();
  }
}

// deixa disponível global (se quiser chamar manualmente)
window.__forceListaRefresh = hardRefreshLista;

/* --------------------- SSE (opcional) --------------------------------- */
let __esInstance = null;  // garante uma única conexão

function connectSSE() {
  if (!('EventSource' in window)) return null;
  if (__esInstance) return __esInstance;

  const es = new EventSource('/api/produtos/stream');
  let debounce = null;

  es.onmessage = async (ev) => {
    let msg = null;
    try { msg = JSON.parse(ev.data || '{}'); } catch {}
    if (!msg || !msg.type) return;

    if (['produtos_updated','refresh_all','product_updated'].includes(msg.type)) {
      clearTimeout(debounce);
      debounce = setTimeout(() => hardRefreshLista(), 400);
    }
  };

  es.onerror = () => { /* EventSource reconecta sozinho */ };
  __esInstance = es;
  return es;
}

/* --------------------- UI PRINCIPAL ---------------------------------- */
export async function initListarProdutosUI(
  paneId = 'listaPecas',
  listId = 'listaProdutosList'
) {
  const pane = document.getElementById(paneId);
  const ul   = document.getElementById(listId);
  const hdr  = document.querySelector('.main-header');
  if (!pane || !ul || !hdr) return;

  // mostra aba Lista e esconde as outras
  hdr.style.display = 'none';
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  pane.style.display = 'block';

  // primeira carga
  if (!window.__listaReady) window.__listaReady = preloadFromDB();
  await window.__listaReady;

  setCache(window.__omieFullCache || []);
  const produtosFiltrados = getFiltered();
  renderList(ul, produtosFiltrados);

  const title = pane.querySelector('.content-section-title');
  if (title) title.textContent = `Lista de produtos (${produtosFiltrados.length})`;

  initFiltros({
    _codeInput            : document.getElementById('codeFilter'),
    _descInput            : document.getElementById('descFilter'),
    _familySelect         : document.getElementById('familySelect'),
    _tipoItemSelect       : document.getElementById('tipoItemSelect'),
    _caracteristicaSelect : document.getElementById('caracteristicaSelect'),
    _conteudoLabel        : document.getElementById('conteudoLabel'),
    _conteudoSelect       : document.getElementById('conteudoSelect'),
    _filterBtn            : document.getElementById('filterBtn'),
    _filterPanel          : document.getElementById('filterPanel'),
    onFiltered: itens => {
      renderList(ul, itens);
      if (title) title.textContent = `Lista de produtos (${itens.length})`;
      populateFilters();
    }
  });

  populateFilters();

  // liga SSE (se estiver funcionando no back)
  connectSSE();
}

// === FORÇAR ATUALIZAÇÃO AO CLICAR NO MENU ===============================
// Função global que refaz o cache e redesenha a lista
window.__forceListaRefresh = async function () {
  try {
    // 1) baixa tudo do /api/produtos/lista (sem cache do browser)
    await preloadFromDB();

    // 2) coloca no filtro/cache e pega os itens já filtrados
    setCache(window.__omieFullCache || []);
    const itens = getFiltered();

    // 3) redesenha a UL
    const pane = document.getElementById('listaPecas');
    const ul   = document.getElementById('listaProdutosList');
    if (ul) {
      ul.innerHTML = itens.map(p => `
        <li data-codigo="${p.codigo ?? ''}" style="cursor: pointer;" class="product-list-item">
          <span class="products">${p.codigo ?? ''}</span>
          <span class="status">${p.descricao ?? ''}</span>
        </li>`).join('');

      // reatacha os handlers - agora cada <li> é clicável
      ul.querySelectorAll('li[data-codigo]').forEach(li => {
        li.style.cursor = 'pointer';
        li.onclick = () => {
          const codigo = li.dataset.codigo;
          document.querySelector('.main-header')?.style && (document.querySelector('.main-header').style.display = 'flex');
          document.querySelectorAll('.main-header-link')
                  .forEach(l => l.classList.remove('is-active'));
          document.querySelector('[data-target="dadosProduto"]')
                  ?.classList.add('is-active');
          document.querySelectorAll('.tab-pane')
                  .forEach(p => p.style.display = 'none');
          document.getElementById('dadosProduto').style.display = 'block';
          // se você já tem loadDadosProduto importado:
          try { loadDadosProduto(codigo); } catch {}
        };
      });
    }

    // 4) atualiza o título com a contagem
    const title = pane?.querySelector('.content-section-title');
    if (title) title.textContent = `Lista de produtos (${itens.length})`;
  } catch (e) {
    console.warn('forceListaRefresh falhou:', e);
  }
};

// Handler do menu: mostra a aba e força refresh SEM F5
(function wireMenuClick() {
  const btn = document.getElementById('menuListaProdutos')
          || document.getElementById('btn-omie-list1'); // fallback ao seu id atual
  if (!btn) return;

  btn.addEventListener('click', async (ev) => {
    try { ev.preventDefault(); } catch {}
    // mostra a aba da lista
    const pane = document.getElementById('listaPecas');
    const hdr  = document.querySelector('.main-header');
    if (hdr) hdr.style.display = 'none';
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    if (pane) pane.style.display = 'block';

    // força recarregar e redesenhar
    await window.__forceListaRefresh();
  });
})();

/* --------------------- Bootstrap no DOMContentLoaded ------------------ */
document.addEventListener('DOMContentLoaded', () => {
  // pré-carrega assim que a SPA nasce
  window.__listaReady = preloadFromDB();

  // **AQUI ESTÁ O PULO DO GATO**
  // toda vez que clicar no menu "Lista de produtos", força refresh antes de mostrar
  const btn = document.getElementById('menuListaProdutos');
  btn?.addEventListener('click', async (ev) => {
    try { ev.preventDefault(); } catch {}
    await hardRefreshLista();

    // se você também alterna as abas manualmente em outro script, ótimo.
    // se não, garante que a aba fique visível:
    const pane = document.getElementById('listaPecas');
    const hdr  = document.querySelector('.main-header');
    if (hdr) hdr.style.display = 'none';
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    if (pane) pane.style.display = 'block';
  });

  connectSSE();
});
