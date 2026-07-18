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

import { loadDadosProduto } from './Dados_produto.js?v=20260710c';
import {
  initFiltros,
  setCache,
  getFiltered,
  reapplyFilters,
  populateFilters
} from './filtro_produto.js?v=20260716-limitado';

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
let __preloadPromise = null;

/* --------------------- Helpers HTTP (sem cache) ----------------------- */
function buildListaUrl({ page=1, limit=500, q='', tipoitem='', inativo='' } = {}) {
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
  const resp = await fetch(url, { cache: 'no-store', credentials: 'include' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/* --------------------- PRELOAD do banco (paginado) -------------------- */
async function preloadFromDB() {
  if (__preloadPromise) return __preloadPromise;

  __preloadPromise = (async () => {
    try {
      spinnerFinished = false;
      showProductSpinner();

      window.__omieFullCache = [];
      let page     = 1;
      const limit  = 500; // o back limita ao teto dele
      let total    = null;
      let loaded   = 0;

      while (true) {
        const data  = await fetchLista({ page, limit });
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

      // Remove duplicatas (mesmo codigo_produto) que inflam contagens de família
      const seen = new Set();
      window.__omieFullCache = window.__omieFullCache.filter((p) => {
        const key = String(p.codigo_produto ?? '') + '|' + String(p.codigo ?? '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return true;
    } finally {
      hideProductSpinner();
      __preloadPromise = null;
    }
  })();

  return __preloadPromise;
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

const __gridState = {
  items: [],
  rendered: 0,
  batchSize: 50,
  loading: false,
  generation: 0
};

let __listaViewMode = 'grid';
const __listaRefs = {
  ul: null,
  grid: null,
  toggleBtn: null,
  pagination: null
};

function getListaGridEl() {
  const live = document.getElementById('listaProdutosGrid');
  if (live) __listaRefs.grid = live;
  return live || __listaRefs.grid;
}

function normalizeCatalogoProdutos(produtos = []) {
  return produtos.map(p => ({
    codigo: p.codigo ?? '',
    descricao: p.descricao ?? '',
    codigo_produto: p.codigo_produto ?? null,
    url_imagem: p.primeira_imagem || p.url_imagem || '',
    descricao_familia: p.descricao_familia || p.familia || '',
    abaixo_minimo: p.abaixo_minimo || false,
    saldo_estoque: p.saldo_estoque ?? p.quantidade_estoque,
    estoque_minimo: p.estoque_minimo
  }));
}

function renderGrid(grid, produtos) {
  const gridEl = grid || getListaGridEl();
  if (!gridEl) return;
  const normalizados = normalizeCatalogoProdutos(produtos);
  // Não sobrescreve o catálogo completo de compras — só a lista filtrada da aba
  window.__listaProdutosGridItems = normalizados;

  __gridState.generation += 1;
  const generation = __gridState.generation;
  __gridState.items = normalizados;
  __gridState.rendered = 0;
  __gridState.loading = false;
  gridEl.innerHTML = '';

  if (typeof window.renderizarCatalogoOmie !== 'function') {
    gridEl.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;grid-column:1/-1;">Visualização em grade indisponível</div>';
    return;
  }

  renderNextGridBatch(gridEl, generation);
  bindGridLazyLoad(gridEl);
}

function renderNextGridBatch(grid, generation = __gridState.generation) {
  if (__gridState.loading) return;
  if (generation !== __gridState.generation) return;
  const gridEl = grid || getListaGridEl();
  if (!gridEl) return;

  const start = __gridState.rendered;
  const end = start + __gridState.batchSize;
  const slice = __gridState.items.slice(start, end);
  if (!slice.length) return;

  __gridState.loading = true;
  try {
    if (generation !== __gridState.generation) return;
    window.renderizarCatalogoOmie(slice, {
      containerId: 'listaProdutosGrid',
      atualizarContador: false,
      append: start > 0
    });
    if (generation === __gridState.generation) {
      __gridState.rendered += slice.length;
    }
  } finally {
    __gridState.loading = false;
  }
}

function bindGridLazyLoad(grid) {
  if (!grid || grid.__lazyBound) return;
  grid.__lazyBound = true;

  grid.addEventListener('scroll', () => {
    const nearBottom = grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 400;
    if (nearBottom) {
      renderNextGridBatch(grid, __gridState.generation);
    }
  });
}

const __paginationState = {
  currentPage: 1,
  pageSize: 50,
  showAll: false
};

let __externalFilterFn = null;
let __externalFilterLabel = '';

function applyExternalFilter(itens) {
  if (typeof __externalFilterFn !== 'function') return itens;
  return (Array.isArray(itens) ? itens : []).filter(__externalFilterFn);
}

function ensureListaRefs() {
  __listaRefs.ul = document.getElementById('listaProdutosList') || __listaRefs.ul;
  __listaRefs.grid = document.getElementById('listaProdutosGrid') || __listaRefs.grid;
  __listaRefs.toggleBtn = document.getElementById('viewToggleBtn') || __listaRefs.toggleBtn;
  __listaRefs.pagination = document.getElementById('pagination') || __listaRefs.pagination;
  return __listaRefs;
}

function resetListaPagination() {
  __paginationState.currentPage = 1;
}

function clampListaPage(totalPages) {
  const safeTotalPages = Math.max(1, Number(totalPages) || 1);
  const nextPage = Math.min(Math.max(1, __paginationState.currentPage), safeTotalPages);
  __paginationState.currentPage = nextPage;
  return nextPage;
}

function getListaPagedItems(itens) {
  const source = Array.isArray(itens) ? itens : [];
  const totalItems = source.length;
  if (__paginationState.showAll) {
    return { totalItems, totalPages: 1, currentPage: 1, pageItems: source };
  }
  const totalPages = Math.max(1, Math.ceil(totalItems / __paginationState.pageSize));
  const currentPage = clampListaPage(totalPages);
  const start = (currentPage - 1) * __paginationState.pageSize;

  return {
    totalItems,
    totalPages,
    currentPage,
    pageItems: source.slice(start, start + __paginationState.pageSize)
  };
}

function renderListaPagination(totalItems) {
  const { pagination } = ensureListaRefs();
  if (!pagination) return;

  pagination.style.display = 'flex';

  if (__paginationState.showAll) {
    pagination.innerHTML = `
      <span>Exibindo todos os ${Number(totalItems) || 0} produtos</span>
      <button type="button" class="content-button active" data-list-mode="paged">
        Usar páginas de 50
      </button>
    `;
    pagination.querySelector('[data-list-mode="paged"]')?.addEventListener('click', () => {
      __paginationState.showAll = false;
      resetListaPagination();
      renderListaFiltradaComTitulo(document.getElementById(__listaPaneId), getFiltered(), { resetPage: false });
    });
    return;
  }

  const totalPages = Math.max(1, Math.ceil((Number(totalItems) || 0) / __paginationState.pageSize));
  const currentPage = clampListaPage(totalPages);
  const pageStart = totalItems > 0 ? ((currentPage - 1) * __paginationState.pageSize) + 1 : 0;
  const pageEnd = totalItems > 0 ? Math.min(totalItems, currentPage * __paginationState.pageSize) : 0;
  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;

  pagination.innerHTML = `
    <button type="button" class="content-button" data-page-action="first" ${prevDisabled ? 'disabled' : ''}>
      Primeira
    </button>
    <button type="button" class="content-button" data-page-action="prev" ${prevDisabled ? 'disabled' : ''}>
      Anterior
    </button>
    <span>${totalItems ? `${pageStart}-${pageEnd} de ${totalItems}` : 'Nenhum produto encontrado'}</span>
    <button type="button" class="content-button" data-page-action="next" ${nextDisabled ? 'disabled' : ''}>
      Próxima
    </button>
    <button type="button" class="content-button" data-page-action="last" ${nextDisabled ? 'disabled' : ''}>
      Última
    </button>
    <span>Página ${currentPage}/${totalPages}</span>
    <span>50 por página</span>
    <button type="button" class="content-button" data-list-mode="all">
      Lista completa
    </button>
  `;

  pagination.querySelectorAll('[data-page-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-page-action');
      if (action === 'first') __paginationState.currentPage = 1;
      else if (action === 'last') __paginationState.currentPage = totalPages;
      else {
        const delta = action === 'next' ? 1 : -1;
        __paginationState.currentPage = Math.min(
          Math.max(1, __paginationState.currentPage + delta),
          totalPages
        );
      }
      renderListaFiltradaComTitulo(document.getElementById(__listaPaneId), getFiltered(), { resetPage: false });
      const scrollTarget = __listaViewMode === 'grid' ? __listaRefs.grid : __listaRefs.ul;
      if (scrollTarget) scrollTarget.scrollTop = 0;
    });
  });

  pagination.querySelector('[data-list-mode="all"]')?.addEventListener('click', () => {
    __paginationState.showAll = true;
    resetListaPagination();
    renderListaFiltradaComTitulo(document.getElementById(__listaPaneId), getFiltered(), { resetPage: false });
    const scrollTarget = __listaViewMode === 'grid' ? __listaRefs.grid : __listaRefs.ul;
    if (scrollTarget) scrollTarget.scrollTop = 0;
  });
}

function renderListaFiltradaComTitulo(pane, itens, options = {}) {
  const { resetPage = true } = options;
  if (resetPage) resetListaPagination();
  const itensFiltrados = applyExternalFilter(itens);
  renderListaView(itensFiltrados);
  try { window.__lpBulkOnListaRendered?.(); } catch (_) {}

  const suffix = __externalFilterLabel ? ` - ${__externalFilterLabel}` : '';
  const title = pane?.querySelector('.content-section-title');
  if (title) title.textContent = `Lista de produtos (${itensFiltrados.length})${suffix}`;

  const productCountEl = document.getElementById('productCount');
  if (productCountEl) productCountEl.textContent = itensFiltrados.length;
}

function updateListaViewUI() {
  const { ul, grid, toggleBtn, pagination } = ensureListaRefs();
  if (!ul || !grid || !toggleBtn) return;

  const isGrid = __listaViewMode === 'grid';
  ul.style.display = isGrid ? 'none' : '';
  grid.style.display = isGrid ? 'grid' : 'none';
  if (pagination) pagination.style.display = '';

  toggleBtn.title = isGrid ? 'Alternar para lista' : 'Alternar para grade';
  toggleBtn.classList.toggle('active', isGrid);
  toggleBtn.innerHTML = isGrid
    ? `
      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none"
           stroke-linecap="round" stroke-linejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"></line>
        <line x1="8" y1="12" x2="21" y2="12"></line>
        <line x1="8" y1="18" x2="21" y2="18"></line>
        <circle cx="4" cy="6" r="1"></circle>
        <circle cx="4" cy="12" r="1"></circle>
        <circle cx="4" cy="18" r="1"></circle>
      </svg>
    `
    : `
      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none"
           stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"></rect>
        <rect x="14" y="3" width="7" height="7" rx="1"></rect>
        <rect x="3" y="14" width="7" height="7" rx="1"></rect>
        <rect x="14" y="14" width="7" height="7" rx="1"></rect>
      </svg>
    `;
}

function renderListaView(itens) {
  const { ul } = ensureListaRefs();
  const grid = getListaGridEl();
  const { totalItems, pageItems } = getListaPagedItems(itens);
  if (__listaViewMode === 'grid') {
    renderGrid(grid, pageItems);
  } else if (ul) {
    renderList(ul, pageItems);
    ul.scrollTop = 0;
  }
  renderListaPagination(totalItems);
}

/* --------------------- “Hard refresh” da lista ----------------------- */
let __refreshing = false;
let __cacheDirty = false;
let __listaPaneId = 'listaProdutos';

function setCacheDirty(flag) {
  __cacheDirty = Boolean(flag);
  const indicator = document.getElementById('refreshCacheIndicator');
  if (indicator) {
    indicator.style.display = __cacheDirty ? 'inline-block' : 'none';
  }
}

function renderFromCache() {
  // Garante que o modo de visualização correto seja aplicado antes de renderizar
  updateListaViewUI();
  ensureListaRefs();
  // Fallback: aplica diretamente no DOM caso __listaRefs ainda não estejam populados
  const gridEl = document.getElementById('listaProdutosGrid');
  const ulEl   = document.getElementById('listaProdutosList');
  if (gridEl && ulEl) {
    const isGrid = __listaViewMode === 'grid';
    gridEl.style.display = isGrid ? 'grid' : 'none';
    ulEl.style.display   = isGrid ? 'none' : '';
    // popula refs para uso futuro, caso estejam vazios
    if (!__listaRefs.grid)   __listaRefs.grid   = gridEl;
    if (!__listaRefs.ul)     __listaRefs.ul     = ulEl;
    if (!__listaRefs.toggleBtn) __listaRefs.toggleBtn = document.getElementById('viewToggleBtn');
    if (!__listaRefs.pagination) __listaRefs.pagination = document.getElementById('pagination');
    // chama novamente agora que refs estão preenchidas
    updateListaViewUI();
  }

  setCache(window.__omieFullCache || []);
  const itens = getFiltered();
  const pane = document.getElementById(__listaPaneId);
  renderListaFiltradaComTitulo(pane, itens, { resetPage: true });
}

async function hardRefreshLista() {
  if (__refreshing) return;
  __refreshing = true;
  try {
    showProductSpinner();
    await preloadFromDB();

    // Atualiza filtros e re-renderiza (se a aba estiver visível ou não)
    renderFromCache();
    setCacheDirty(false);

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
      debounce = setTimeout(() => setCacheDirty(true), 200);
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
  const grid = document.getElementById('listaProdutosGrid');
  const toggleBtn = document.getElementById('viewToggleBtn');
  const refreshBtn = document.getElementById('refreshCacheBtn');
  const scrollTopBtn = document.getElementById('listaProdutosScrollTopBtn');
  const abrirCarrinhoBtn = document.getElementById('listaProdutosAbrirCarrinhoBtn');
  const floatingActions = document.getElementById('listaProdutosFloatingActions');
  const pagination = document.getElementById('pagination');
  const hdr  = document.querySelector('.main-header');
  if (!pane || !ul || !hdr) return;

  __listaPaneId = paneId;
  __listaRefs.ul = ul;
  __listaRefs.grid = grid;
  __listaRefs.toggleBtn = toggleBtn;
  __listaRefs.pagination = pagination;
  updateListaViewUI();

  // mostra aba Lista e esconde as outras
  hdr.style.display = 'none';
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  pane.style.display = 'block';

  console.log('[ListarProdutos] Carregando contador do carrinho da API...');
  
  // Carrega quantidade de itens do carrinho diretamente da API
  fetch('/api/compras/carrinho', { credentials: 'include' })
    .then(res => res.json())
    .then(data => {
      if (data.ok && Array.isArray(data.itens)) {
        const qtd = data.itens.length;
        console.log('[ListarProdutos] Itens no carrinho (API):', qtd);
        
        // Atualiza o badge
        const badge = document.getElementById('listaProdutosCarrinhoCount');
        if (badge) {
          badge.textContent = qtd;
          badge.style.display = qtd > 0 ? 'flex' : 'none';
          console.log('[ListarProdutos] ✅ Badge atualizado:', qtd, 'itens');
        } else {
          console.warn('[ListarProdutos] ❌ Badge não encontrado');
        }
        
        // Atualiza também o window.carrinhoCompras para manter sincronizado
        if (!window.carrinhoCompras) {
          window.carrinhoCompras = data.itens.map(item => ({
            id_db: item.id,
            produto_codigo: item.produto_codigo,
            produto_descricao: item.produto_descricao,
            quantidade: item.quantidade ?? '',
            prazo_solicitado: item.prazo_solicitado,
            familia_nome: item.familia_produto,
            observacao: item.observacao,
            solicitante: item.solicitante,
            departamento: item.departamento,
            centro_custo: item.centro_custo
          }));
        }
      } else {
        console.warn('[ListarProdutos] ⚠️ API retornou erro ou dados inválidos:', data);
      }
    })
    .catch(err => {
      console.error('[ListarProdutos] ❌ Erro ao buscar carrinho da API:', err);
    });

  // primeira carga
  if (!window.__listaReady) window.__listaReady = preloadFromDB();
  await window.__listaReady;

  renderFromCache();

  const codeFilterInput = document.getElementById('codeFilter');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  
  // Limpa o campo de pesquisa ao inicializar a página
  if (codeFilterInput) {
    codeFilterInput.value = '';
  }

  initFiltros({
    _codeInput      : codeFilterInput,
    _familySelect   : document.getElementById('familySelect'),
    _tipoItemSelect : document.getElementById('tipoItemSelect'),
    _filterBtn      : document.getElementById('filterBtn'),
    _filterPanel    : document.getElementById('filterPanel'),
    onFiltered: itens => {
      renderListaFiltradaComTitulo(pane, itens);
    }
  });
  
  // Mostra/esconde botão X baseado no conteúdo do input
  if (codeFilterInput && clearSearchBtn) {
    const updateClearButton = () => {
      clearSearchBtn.style.display = codeFilterInput.value.trim() ? 'block' : 'none';
    };
    
    codeFilterInput.addEventListener('input', updateClearButton);
    
    // Limpa o campo e aplica filtros ao clicar no X
    clearSearchBtn.addEventListener('click', () => {
      codeFilterInput.value = '';
      clearSearchBtn.style.display = 'none';
      // Dispara evento input para aplicar o filtro vazio
      codeFilterInput.dispatchEvent(new Event('input'));
    });
    
    // Atualiza visibilidade inicial
    updateClearButton();
  }

  populateFilters();

  bindViewToggle();

  refreshBtn?.addEventListener('click', async () => {
    await hardRefreshLista();
  });

  const updateScrollTopVisibility = () => {
    const target = (__listaViewMode === 'grid' ? grid : ul);
    if (!target || !floatingActions) return;
    const shouldShow = target.scrollTop > 40;
    floatingActions.style.display = shouldShow ? 'flex' : 'none';
  };

  scrollTopBtn?.addEventListener('click', () => {
    const target = (__listaViewMode === 'grid' ? grid : ul);
    if (target) target.scrollTop = 0;
    updateScrollTopVisibility();
  });

  abrirCarrinhoBtn?.addEventListener('click', async () => {
    // Mostra spinner enquanto carrega
    const iconElement = abrirCarrinhoBtn.querySelector('i:not(.carrinho-badge)');
    
    if (iconElement) {
      abrirCarrinhoBtn.disabled = true;
      // Troca classes para mostrar spinner
      iconElement.className = 'fa-solid fa-spinner';
      iconElement.style.animation = 'spin 1s linear infinite';
    }

    try {
      if (typeof window.abrirModalCarrinhoCompras === 'function') {
        await window.abrirModalCarrinhoCompras();
      }
    } catch (err) {
      console.error('[ListarProdutos] Erro ao abrir carrinho:', err);
      // Restaura imediatamente em caso de erro
      if (iconElement) {
        iconElement.className = 'fa-solid fa-cart-shopping';
        iconElement.style.animation = '';
        abrirCarrinhoBtn.disabled = false;
      }
    }
  });

  // Listener para resetar o botão quando o modal fechar
  window.addEventListener('carrinhoModalFechado', () => {
    const iconElement = abrirCarrinhoBtn?.querySelector('i:not(.carrinho-badge)');
    if (iconElement && abrirCarrinhoBtn) {
      iconElement.className = 'fa-solid fa-cart-shopping';
      iconElement.style.animation = '';
      abrirCarrinhoBtn.disabled = false;
    }
  });

  grid?.addEventListener('scroll', updateScrollTopVisibility);
  ul?.addEventListener('scroll', updateScrollTopVisibility);
  updateScrollTopVisibility();

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
    const pane = document.getElementById(__listaPaneId);
    renderListaFiltradaComTitulo(pane, itens, { resetPage: true });
  } catch (e) {
    console.warn('forceListaRefresh falhou:', e);
  }
};

window.__setListaProdutosExternalFilter = function (fn, label = '') {
  __externalFilterFn = typeof fn === 'function' ? fn : null;
  __externalFilterLabel = (__externalFilterFn && label) ? String(label) : '';

  const pane = document.getElementById(__listaPaneId);
  setCache(window.__omieFullCache || []); // reaplica família/busca/etc.
  const itens = getFiltered();
  renderListaFiltradaComTitulo(pane, itens, { resetPage: true });
};

window.__clearListaProdutosExternalFilter = function () {
  __externalFilterFn = null;
  __externalFilterLabel = '';
  const pane = document.getElementById(__listaPaneId);
  setCache(window.__omieFullCache || []);
  const itens = getFiltered();
  renderListaFiltradaComTitulo(pane, itens, { resetPage: true });
};

/** Produtos visíveis na lista (filtros da tela + filtro externo / exclusões em massa). */
window.__getListaProdutosVisiveis = function () {
  return applyExternalFilter(getFiltered());
};

// Handler do menu: mostra a aba e força refresh SEM F5
(function wireMenuClick() {
  const btn = document.getElementById('menuListaProdutos')
          || document.getElementById('btn-omie-list1'); // fallback ao seu id atual
  if (!btn) return;

  btn.addEventListener('click', async (ev) => {
    try { ev.preventDefault(); } catch {}
    try { window.__clearListaProdutosExternalFilter?.(); } catch {}
    // mostra a aba da lista
    const pane = document.getElementById(__listaPaneId);
    const hdr  = document.querySelector('.main-header');
    if (hdr) hdr.style.display = 'none';
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    if (pane) pane.style.display = 'block';

    // usa cache se disponível; só recarrega quando marcado como desatualizado
    if (window.__listaReady && !__cacheDirty) {
      await window.__listaReady;
      renderFromCache();
    } else {
      await window.__forceListaRefresh();
    }
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
    try { window.__clearListaProdutosExternalFilter?.(); } catch {}
    if (window.__listaReady && !__cacheDirty) {
      await window.__listaReady;
      renderFromCache();
    } else {
      await hardRefreshLista();
    }

    // se você também alterna as abas manualmente em outro script, ótimo.
    // se não, garante que a aba fique visível:
    const pane = document.getElementById(__listaPaneId);
    const hdr  = document.querySelector('.main-header');
    if (hdr) hdr.style.display = 'none';
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    if (pane) pane.style.display = 'block';
  });

  connectSSE();
});

function bindViewToggle() {
  const toggleBtn = document.getElementById('viewToggleBtn');
  if (!toggleBtn || toggleBtn.__boundToggle) return;
  toggleBtn.__boundToggle = true;

  toggleBtn.addEventListener('click', () => {
    __listaViewMode = __listaViewMode === 'list' ? 'grid' : 'list';
    updateListaViewUI();
    renderListaView(getFiltered());
  });
}

window.__setListaProdutosViewMode = function (mode) {
  __listaViewMode = String(mode || '').toLowerCase() === 'list' ? 'list' : 'grid';
  updateListaViewUI();
  renderListaView(getFiltered());
};
