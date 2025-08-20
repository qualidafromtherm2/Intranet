/* =======================================================================
 *  requisicoes_omie/ListarProdutos.js
 *  ----------------------------------------------------------------------
 *  • Pré-carrega a lista do seu BACKEND (/api/produtos/lista), página a página,
 *    sem cache do navegador, e guarda em:
 *        window.__omieFullCache   (array de produtos)
 *        window.__listaReady      (Promise do preload)
 *  • Escuta atualizações ao vivo via SSE em /api/produtos/stream:
 *      - quando receber { type: 'produtos_updated' }, refaz o preload e
 *        re-renderiza a lista se a aba “Lista de produtos” estiver visível.
 *  • Integra com os filtros (filtro_produto.js).
 * ======================================================================= */

import { loadDadosProduto } from './Dados_produto.js';
import {
  initFiltros,
  setCache,
  getFiltered,
  populateFilters
} from './filtro_produto.js';

/* --------------------- SPINNER helpers -------------------------------- */
let spinnerVisible   = false;
let spinnerFinished  = false;

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
  const len = Math.PI * 2 * +circle.getAttribute('r');
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
    let page   = 1;
    const askLimit = 500; // o back devolve até o teto dele
    let total  = null;
    let loaded = 0;

    while (true) {
      const data = await fetchLista({ page, limit: askLimit, inativo: 'N' });
      const itens = Array.isArray(data.itens) ? data.itens : [];

      if (total === null) {
        total = Number(data.total || 0);
        // se existir setListaTitulo em algum lugar, atualiza com o total inicial
        if (typeof window.setListaTitulo === 'function') {
          window.setListaTitulo(total);
        }
      }

      if (!itens.length) break;

      window.__omieFullCache.push(...itens);
      loaded += itens.length;

      updateSpinnerPct(total ? (loaded / total) * 100 : 0);

      if (total && loaded >= total) break; // terminou
      page++;
    }
  } finally {
    hideProductSpinner();
  }
  return true;
}

/* --------------------- RENDER ---------------------------------------- */
function attachOpenHandlers(ul) {
  ul.querySelectorAll('.abrir-button').forEach(btn => {
    btn.onclick = () => {
      const codigo = btn.dataset.codigo;

      // mostra a aba "Dados do produto" e esconde as outras
      document.querySelector('.main-header')?.style?.setProperty('display', 'flex');
      document.querySelectorAll('.main-header-link')
        .forEach(l => l.classList.remove('is-active'));
      document.querySelector('[data-target="dadosProduto"]')
        ?.classList.add('is-active');
      document.querySelectorAll('.tab-pane')
        .forEach(p => p.style.display = 'none');
      document.getElementById('dadosProduto').style.display = 'block';

      // carrega o detalhe (consulta direta na Omie)
      loadDadosProduto(codigo);
    };
  });
}

function renderList(ul, produtos) {
  ul.innerHTML = produtos.map(p => `
    <li>
      <span class="products">${p.codigo ?? ''}</span>
      <span class="status">${p.descricao ?? ''}</span>
      <div class="button-wrapper">
        <button class="content-button status-button open abrir-button"
                data-codigo="${p.codigo}">Abrir</button>
      </div>
    </li>`).join('');
  attachOpenHandlers(ul);
}

/* --------------------- SSE (atualizações ao vivo) --------------------- */
function setupLiveUpdates() {
  if (!('EventSource' in window)) return;

  const es = new EventSource('/api/produtos/stream');
  let debounce = null;

  es.onmessage = async (ev) => {
    let msg = null;
    try { msg = JSON.parse(ev.data || '{}'); } catch { /* ignore */ }

    // Mensagens aceitas do back:
    //  - { type: 'produtos_updated', ids:[...] }
    //  - { type: 'refresh_all' } (compatibilidade)
    //  - { type: 'product_updated' } (compatibilidade)
    if (!msg || !msg.type) return;
    if (!['produtos_updated','refresh_all','product_updated'].includes(msg.type)) return;

    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try { showProductSpinner(); } catch {}
      await preloadFromDB();

      // Se a aba "Lista" está visível, re-renderiza agora
      const pane = document.getElementById('listaPecas');
      const ul   = document.getElementById('listaProdutosList');
      if (pane && ul && pane.style.display !== 'none') {
        setCache(window.__omieFullCache || []);
        const itens = getFiltered();

        renderList(ul, itens);

        const title = pane.querySelector('.content-section-title');
        if (title) title.textContent = `Lista de produtos (${itens.length})`;
        try { populateFilters(); } catch {}
      }
    }, 400);
  };

  es.onerror = () => {
    // silencioso; EventSource tenta reconectar sozinho
  };

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

  // 1) Precarrega do banco
  if (!window.__listaReady) window.__listaReady = preloadFromDB();

  // 2) Inicializa filtros + render inicial
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

  // 3) Liga SSE para auto-refresh quando o webhook gravar no banco
  setupLiveUpdates();
}

/* --------------------- Bootstrap no DOMContentLoaded ------------------ */
document.addEventListener('DOMContentLoaded', () => {
  // dispara o preload imediatamente (a UI vai aguardar em initListarProdutosUI)
  window.__listaReady = preloadFromDB();
  // também já deixamos o SSE conectado
  setupLiveUpdates();
});

// === DEBUG (console) ==================================================
// deixa acessível no DevTools:
window.__preloadFromDB = preloadFromDB;
// recarrega do banco e re-renderiza a lista se a aba estiver visível
window.__refreshLista = async () => {
  await preloadFromDB();
  try {
    // re-renderiza usando os helpers que você já tem
    setCache(window.__omieFullCache || []);
    const itens = getFiltered();

    const ul   = document.getElementById('listaProdutosList');
    const pane = document.getElementById('listaPecas');
    if (ul && pane && pane.style.display !== 'none') {
      ul.innerHTML = itens.map(p => `
        <li>
          <span class="products">${p.codigo}</span>
          <span class="status">${p.descricao}</span>
          <div class="button-wrapper">
            <button class="content-button status-button open abrir-button"
                    data-codigo="${p.codigo}">Abrir</button>
          </div>
        </li>`).join('');

      // reatacha os handlers “Abrir”
      ul.querySelectorAll('.abrir-button').forEach(btn => {
        btn.onclick = () => {
          const codigo = btn.dataset.codigo;
          document.querySelector('.main-header').style.display = 'flex';
          document.querySelectorAll('.main-header-link')
                  .forEach(l => l.classList.remove('is-active'));
          document.querySelector('[data-target="dadosProduto"]')
                  .classList.add('is-active');
          document.querySelectorAll('.tab-pane')
                  .forEach(p => p.style.display = 'none');
          document.getElementById('dadosProduto').style.display = 'block';
          // função já existente
          try { loadDadosProduto(codigo); } catch {}
        };
      });

      const title = pane.querySelector('.content-section-title');
      if (title) title.textContent = `Lista de produtos (${itens.length})`;
      try { populateFilters(); } catch {}
    }
  } catch (e) {
    console.warn('refreshLista falhou:', e);
  }
};
