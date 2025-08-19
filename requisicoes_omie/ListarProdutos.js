/* =======================================================================
 *  ListarProdutos.js
 *  ---------------------------------------------------------------
 *  • Pré-carrega a lista completa de produtos (ListarProdutos) assim que
 *    a SPA carrega. 500 itens por página, chamadas em série.
 *  • Guarda o resultado em:
 *        window.__omieFullCache   (array de produtos)
 *        window.__listaReady      (Promise do preload)
 *  • UI de “Lista de produtos” apenas consome o cache — sem nova chamada
 *    à Omie. Spinner some assim que chega a 100 %.
 * ======================================================================= */

/*import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;
const API_BASE = window.location.origin;  // 'https://intranet-30av.onrender.com'*/

import { loadDadosProduto } from './Dados_produto.js';
import {
  initFiltros,
  setCache,
  getFiltered,
  populateFilters
} from './filtro_produto.js';

/* --------------------- CONSTANTES ------------------------------------ */
const PAGE_SIZE = 500;

/* --------------------- SPINNER helpers ------------------------------- */
let spinnerVisible   = false;
let spinnerLocked    = false;
let spinnerFinished  = false;    // ← NOVO


// === evita cache do /api/produtos/lista ===
function buildListaUrl({ limit=50, offset=0, q='', tipoitem='', inativo='' } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    q,
    tipoitem,
    inativo
  });
  // cache-buster
  params.set('t', Date.now());
  return `/api/produtos/lista?` + params.toString();
}

async function fetchLista(params) {
  const url = buildListaUrl(params);
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// --- Live updates via SSE ---
function setupLiveUpdates() {
  if (!('EventSource' in window)) return;

  const es = new EventSource('/api/produtos/stream');
  let debounce = null;

  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (!msg) return;

      // Quando o back avisar, recarrega a lista (com debounce)
      if (msg.type === 'refresh_all' || msg.type === 'product_updated') {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          // mostra o spinner (se você já tiver esses helpers)
          try { showProductSpinner?.(); } catch {}
          // refaz todo o preload e a UI espera por __listaReady
          window.__listaReady = preloadFromDB();
        }, 800);
      }
    } catch (_) {}
  };

  es.onerror = () => {
    // silencioso: EventSource já tenta reconectar sozinho
  };
}

function showProductSpinner() {
  if (spinnerFinished || spinnerVisible) return;   // ← NOVO
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
  if (spinnerFinished) return;                    // ← NOVO
  const pct  = Math.max(0, Math.min(100, Math.floor(val)));
  const cont = document.getElementById('productSpinner');
  if (!cont || !spinnerVisible) return;
  cont.setAttribute('data-pct', pct);
  const circle = cont.querySelector('#bar');
  const len = Math.PI * 2 * +circle.getAttribute('r');
  circle.style.strokeDashoffset = ((100 - pct) / 100) * len;

  if (pct >= 100) {
    spinnerLocked   = true;
    spinnerFinished = true;                       // ← NOVO
    hideProductSpinner();
  }
}




/* --------------------- CACHE GLOBAL ---------------------------------- */
window.__omieFullCache = null;   // array de produtos (pronto)
window.__listaReady    = null;   // Promise de preload


/* --------------------- RENDER & EVENTOS ------------------------------ */
function attachOpenHandlers(ul) {
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
      loadDadosProduto(codigo);
    };
  });
}

function renderList(ul, produtos) {
  ul.innerHTML = produtos.map(p => `
    <li>
      <span class="products">${p.codigo}</span>
      <span class="status">${p.descricao}</span>
      <div class="button-wrapper">
        <button class="content-button status-button open abrir-button"
                data-codigo="${p.codigo}">Abrir</button>
      </div>
    </li>`).join('');
  attachOpenHandlers(ul);
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

  /* mostra aba Lista */
  hdr.style.display = 'none';
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  pane.style.display = 'block';

  await window.__listaReady;
  /* filtros e render */
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
}


// === NOVO: pré-carregar do Postgres (com cache-busting) ===
async function preloadFromDB() {
  try {
    showProductSpinner?.();

    // zera o cache local antes de recarregar tudo
    window.__omieFullCache = [];
    let page   = 1;
    const askLimit = 500;
    let total  = null;
    let loaded = 0;

    while (true) {
      const params = new URLSearchParams({
        page   : String(page),
        limit  : String(askLimit),
        inativo: 'N',      // ajuste se quiser ver inativos
        // tipoitem: '04', // opcional
        // q: 'termo',     // opcional
        t: String(Date.now()) // <- cache-busting
      });

      const resp = await fetch(`/api/produtos/lista?${params.toString()}`, {
        cache: 'no-store' // <-
      });
      if (!resp.ok) throw new Error('Falha ao carregar produtos do banco.');
      const data  = await resp.json();
      const itens = Array.isArray(data.itens) ? data.itens : [];

      if (total === null) {
        total = Number(data.total || 0);
        // atualiza o título com o total
        typeof setListaTitulo === 'function' && setListaTitulo(total);
      }

      if (!itens.length) break;

      window.__omieFullCache.push(...itens);
      loaded += itens.length;

      updateSpinnerPct?.(total ? (loaded / total) * 100 : 0);

      if (total && loaded >= total) break; // terminou
      page++;
    }
  } finally {
    hideProductSpinner?.();
  }
  return true;
}



document.addEventListener('DOMContentLoaded', () => {
  window.__listaReady = preloadFromDB();

  // === AUTO-REFRESH: escuta o webhook e recarrega a lista ===
(function connectSSE() {
  try {
    const es = new EventSource('/api/produtos/stream');
    es.onmessage = async (ev) => {
      let msg = {};
      try { msg = JSON.parse(ev.data || '{}'); } catch {}
      if (msg.type === 'refresh_all') {
        // limpa e recarrega a lista
        await preloadFromDB();
        // chame aqui a MESMA função que você já usa
        // para desenhar a tabela após o preload inicial:
        if (typeof renderListaProdutos === 'function') {
          renderListaProdutos(window.__omieFullCache);
        } else if (typeof montarTabelaProdutos === 'function') {
          montarTabelaProdutos(window.__omieFullCache);
        } else if (typeof popularTabela === 'function') {
          popularTabela(window.__omieFullCache);
        }
      }
    };
    es.onerror = () => { /* opcional: reconectar com backoff */ };
  } catch (_) {}
})();

});

await window.__listaReady;

