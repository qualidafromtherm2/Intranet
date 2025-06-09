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

import config from '../config.client.js';
import { loadDadosProduto } from './Dados_produto.js';
import {
  initFiltros,
  setCache,
  getFiltered,
  populateFilters
} from './filtro_produto.js';

const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

/* --------------------- CONSTANTES ------------------------------------ */
const PAGE_SIZE = 500;

/* --------------------- SPINNER helpers ------------------------------- */
let spinnerVisible   = false;
let spinnerLocked    = false;
let spinnerFinished  = false;    // ← NOVO

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
/* --------------------- Omie → uma página ----------------------------- */
async function fetchPage(pagina = 1) {
  const body = {
    call :'ListarProdutos',
    app_key   : OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param:[{
      pagina,
      registros_por_pagina: PAGE_SIZE,
      apenas_importado_api: 'N',
      filtrar_apenas_omiepdv: 'N',
      exibir_caracteristicas: 'S',
      exibir_obs: 'S',
      exibir_kit: 'S'
    }]
  };
  const res = await fetch('/api/omie/produtos', {
    method :'POST',
    headers:{ 'Content-Type':'application/json' },
    body   : JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* --------------------- CACHE GLOBAL ---------------------------------- */
window.__omieFullCache = null;   // array de produtos (pronto)
window.__listaReady    = null;   // Promise de preload

/* --------------------- MONTA CACHE COMPLETO -------------------------- */
async function buildListaCache() {
  showProductSpinner();

  const first = await fetchPage(1);
  const totalPag = first.total_de_paginas   || 1;
  const totalReg = first.total_de_registros || first.produto_servico_cadastro.length;
  const items    = [...(first.produto_servico_cadastro || [])];

  updateSpinnerPct((items.length / totalReg) * 100);

  for (let p = 2; p <= totalPag; p++) {
    const page = await fetchPage(p);
    items.push(...(page.produto_servico_cadastro || []));
    updateSpinnerPct((items.length / totalReg) * 100);
  }

  updateSpinnerPct(100);
  hideProductSpinner();

  window.__omieFullCache = items;        // cache preenchido
}

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

  /* espera cache */
  await window.__listaReady;

  /* filtros e render */
  setCache(window.__omieFullCache);

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

/* --------------------- DISPARA PRELOAD NO LOAD ----------------------- */
document.addEventListener('DOMContentLoaded', () => {
  window.__listaReady = buildListaCache().catch(hideProductSpinner);
});
