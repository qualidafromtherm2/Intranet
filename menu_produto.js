// menu_produto.js
import config from './config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;
const API_BASE = window.location.origin; // já serve https://intranet-30av.onrender.com
let ultimoCodigo = null;      // <-- NOVO

import { initListarProdutosUI } from './requisicoes_omie/ListarProdutos.js';
import { initDadosColaboradoresUI } from './requisicoes_omie/dados_colaboradores.js';
import { initAnexosUI } from './requisicoes_omie/anexos.js';
import { initKanban } from './kanban/kanban.js';
let lastKanbanTab = 'comercial';   // lembra a sub-aba atual

import { loadDadosProduto as loadDadosProdutoReal }
  from './requisicoes_omie/Dados_produto.js';
/* ——— IMPORT único do módulo Kanban ——— */
import * as KanbanViews from './kanban/kanban.js';

import { initPreparacaoKanban } from './kanban/kanban_preparacao.js';

let almoxCurrentPage = 1;
// —— Produção —— //
let prodAllDados   = [];
let prodCurrentPage = 1;
let prodTotalPages  = 1;
// —— Filtro Produção —— //
let prodTipoMap        = new Map();   // desc -> prefixo
let prodActivePrefixes = new Set();   // prefixos ativos
let prodCsvLoaded      = false;


let almoxAllDados = [];   // mantém o array completo para filtro
/* — Filtro por Tipo (Almoxarifado) — */
let almoxTipoMap        = new Map();   // desc  -> prefixo (Tipo do produto)
let almoxActivePrefixes = new Set();   // prefixos atualmente exibidos
let almoxCsvLoaded      = false;

// ——— formatação numérica (xx.xxx,yy) ———
const fmtBR = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/* —— desenha <tbody> a partir de um array —— */
function renderAlmoxTable(arr) {
  const tbody = document.querySelector('#tbl-almoxarifado tbody');
  tbody.innerHTML = '';

  let somaCMC = 0;
  arr.forEach(p => {
    somaCMC += parseFloat(p.cmc);  // acumula total

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.codigo}</td>
      <td>${p.descricao}</td>
      <td class="num">${fmtBR.format(p.min)}</td>
      <td class="num">${fmtBR.format(p.fisico)}</td>
      <td class="num">${fmtBR.format(p.reservado)}</td>
      <td class="num">${fmtBR.format(p.saldo)}</td>
      <td class="num">R$ ${fmtBR.format(p.cmc)}</td>`;
    tbody.appendChild(tr);
  });

  /* contador de itens */
  document.getElementById('almoxCount').textContent = arr.length;

  /* total CMC */
  document.getElementById('almoxCmcTotal').textContent =
    `Total CMC: R$ ${fmtBR.format(somaCMC)}`;
}


function aplicarFiltroAlmox() {
  const termo = document.getElementById('almoxSearch').value
                 .trim().toLowerCase();

  const filtrados = almoxAllDados.filter(p => {
    const prefixOk = [...almoxActivePrefixes]
                   .some(pre => p.codigo.startsWith(pre));

    const buscaOk  = p.descricao.toLowerCase().includes(termo);
    return prefixOk && buscaOk;
  });
  renderAlmoxTable(filtrados);
}

function renderProdTable(arr) {
  const tbody = document.querySelector('#tbl-producao tbody');
  tbody.innerHTML = '';
  let soma = 0;

  arr.forEach(p => {
    soma += parseFloat(p.cmc);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.codigo}</td>
      <td>${p.descricao}</td>
      <td class="num">${fmtBR.format(p.min)}</td>
      <td class="num">${fmtBR.format(p.fisico)}</td>
      <td class="num">${fmtBR.format(p.reservado)}</td>
      <td class="num">${fmtBR.format(p.saldo)}</td>
      <td class="num">R$ ${fmtBR.format(p.cmc)}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('prodCount').textContent = arr.length;
  document.getElementById('prodCmcTotal').textContent =
    `Total CMC: R$ ${fmtBR.format(soma)}`;
}

function aplicarFiltroProd() {
  const termo = document.getElementById('prodSearch').value.trim().toLowerCase();

  const filtrados = prodAllDados.filter(p => {
    const prefixOk = [...prodActivePrefixes]
                      .some(pre => p.codigo.startsWith(pre));
    const buscaOk  = p.descricao.toLowerCase().includes(termo);
    return prefixOk && buscaOk;
  });
  renderProdTable(filtrados);
}


let almoxTotalPages  = 1;


// deixa a versão completa visível globalmente
window.loadDadosProduto = loadDadosProdutoReal;


async function fetchAndRenderProdutos() {
  console.log('[DEBUG] fetchAndRenderProdutos: iniciando');
  showSpinner();
  try {
    console.log(`[DEBUG] fetchAndRenderProdutos: enviando requisição para ${API_BASE}/api/omie/produtos`);
    const res = await fetch(`${API_BASE}/api/omie/produtos`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type':'application/json' },
      body: JSON.stringify({
        call:       'ListarProdutosResumido',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          pagina: 1,
          registros_por_pagina: 100,
          filtrar_apenas_descricao: ''
        }]
      })
    });
    console.log('[DEBUG] fetchAndRenderProdutos: resposta HTTP recebida, status', res.status);

    const json = await res.json();
    console.log('[DEBUG] fetchAndRenderProdutos: JSON completo:', json);

    const items = json.produto_servico_resumido || [];
    console.log('[DEBUG] fetchAndRenderProdutos: items extraídos:', items.length, 'itens');

    // atualiza contador
    document.getElementById('productCount').textContent = items.length;
    console.log('[DEBUG] fetchAndRenderProdutos: contador atualizado para', items.length);

    // monta a lista
    const ul = document.getElementById('listaProdutosList');
    console.log('[DEBUG] fetchAndRenderProdutos: UL encontrado:', ul);

    ul.innerHTML = items.map(item => `
      <li data-codigo="${item.codigo}" data-descricao="${item.descricao}">
        <span class="products">${item.codigo}</span>
        <span class="status">${item.descricao}</span>
        <span class="unidade">${item.saldo_disponivel ?? '-'}</span>
      </li>
    `).join('');
    console.log('[DEBUG] fetchAndRenderProdutos: UL.innerHTML atualizado');

  } catch (err) {
    console.error('[DEBUG] fetchAndRenderProdutos: erro ao buscar produtos →', err);
    alert('Erro ao buscar produtos: ' + err.message);
  } finally {
    hideSpinner();
    console.log('[DEBUG] fetchAndRenderProdutos: spinner escondido');
    console.log('[DEBUG] fetchAndRenderProdutos() terminou');
  }
}



function showMainTab(tabId) {
  // esconde TUDO que possa ser página principal:
  document
    .querySelectorAll('.tab-pane, .kanban-page')
    .forEach(p => (p.style.display = 'none'));

  // tenta achar o alvo em 2 formatos:
  //   • id = tabId  (ex.:  "listaPecas")
  //   • id = "conteudo-" + tabId  (ex.:  "conteudo-pcp")
  const alvo =
    document.getElementById(tabId) ||
    document.getElementById(`conteudo-${tabId}`);

  if (alvo) alvo.style.display = 'block';
}


window.showMainTab = showMainTab;   // expõe p/ outros módulos
// referências ao container principal e ao painel de Acessos
const wrapper      = document.querySelector('.wrapper');
const acessosPanel = document.getElementById('acessos');

// Spinner de carregamento

/* ======== Helpers – alternar Pedidos (Kanban) ======== */
function showKanban () {
    hideArmazem();                 // ← NOVA LINHA
  /* esconde QUALQUER painel de produtos que ainda possa estar visível */
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');

  /* mostra somente a estrutura do Kanban */
  document.getElementById('produtoTabs').style.display   = 'none';
  document.getElementById('kanbanTabs').style.display    = 'flex';
  document.getElementById('kanbanContent').style.display = 'block';

  /* (re)carrega dados e abre a sub-aba que o usuário visitou por último */
  initKanban();
  showKanbanTab(lastKanbanTab || 'comercial');
}


function hideKanban () {
  document.getElementById('kanbanTabs').style.display    = 'none';
  document.getElementById('kanbanContent').style.display = 'none';
  document.getElementById('produtoTabs').style.display   = 'block';
}



function showSpinner() {
  document.getElementById('productSpinner').style.display = 'inline-flex';
}
function hideSpinner() {
  document.getElementById('productSpinner').style.display = 'none';
}

// --- patch restrito APENAS à rota ListarProdutos -------------------
let prodPending = 0;
// suba isto para cima, antes de qualquer outro fetch
const _origFetch = window.fetch;
window.fetch = async function(input, init = {}) {
  // força o envio do cookie de sessão em TODAS as requests
  init.credentials = init.credentials ?? 'include';

  // --- spinner antigo permanece inalterado ---
  const url = input;
  const isListaProd = typeof url === 'string'
    && url.includes('/api/omie/produtos');

  if (isListaProd && prodPending === 0) showSpinner();
  if (isListaProd) prodPending++;

  try {
    return await _origFetch(input, init);
  } finally {
    if (isListaProd) {
      prodPending--;
      if (prodPending === 0) hideSpinner();
    }
  }
};

function loadEstruturaProduto(codigo) {
  if (!codigo) return;
  ultimoCodigo = codigo;

  const ul      = document.getElementById('malha');
  const spinner = document.getElementById('estoqueSpinnerBox');
  ul.innerHTML  = '';                     // limpa antes de começar
  spinner.style.display = 'inline-flex';  // mostra spinner

 fetch(`${API_BASE}/api/malha`, {
   method:      'POST',
   credentials: 'include',               // se precisar enviar cookies
   headers:     { 'Content-Type':'application/json' },
   body:        JSON.stringify({ intProduto: codigo })
 })
  .then(r => r.json())
  .then(json => {
    spinner.style.display = 'none';

       // aceita tanto { itens: [...] } como [...] puro
   const itens = Array.isArray(json.itens)
     ? json.itens
     : Array.isArray(json)
       ? json
       : [];

    if (json.notFound || !Array.isArray(json.itens)) {
      ul.innerHTML = '<li class="fault-message">Estrutura não cadastrada</li>';
      return;
    }

    json.itens.forEach(it => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div>${it.codProdMalha}</div>
        <div class="status">${it.descrProdMalha}</div>
        <div class="qtd">${it.quantProdMalha}</div>
        <div class="unidade">${it.unidProdMalha}</div>
        <div class="custo-real">${it.custoReal ?? '–'}</div>
        <div class="button-wrapper">
          <button class="content-button status-button open"
                  data-cod="${it.codProdMalha}">Editar</button>
        </div>`;
      ul.appendChild(li);
    });
  })
  .catch(err => {
    spinner.style.display = 'none';
    ul.innerHTML = `<li class="fault-message">Erro: ${err.message}</li>`;
  });
}
window.loadEstruturaProduto = loadEstruturaProduto;   // ← deixa global

// Abre a aba Dados do produto
function openDadosProdutoTab() {
  hideKanban();

  // 1) esconde todas as panes
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  // 2) limpa destaque de todos os links principais
  document.querySelectorAll('.main-header-link').forEach(l => l.classList.remove('is-active'));
  // 3) destaca “Dados do produto”
  const dadosLink = document.querySelector('.main-header-link[data-target="dadosProduto"]');
  if (dadosLink) dadosLink.classList.add('is-active');
  // 4) mostra painel e sub-header
  document.getElementById('dadosProduto').style.display = 'block';
  document.querySelector('.main-header').style.display = 'flex';
  // 5) dispara sempre a sub-aba “Detalhes”
  const detalhesInicial = document.querySelector(
    '#dadosProduto .sub-tabs .main-header-link[data-subtarget="detalhesTab"]'
  );
  if (detalhesInicial) detalhesInicial.click();
}


/* ======== Helpers – alternar Armazéns ======== */
function showArmazem () {
  // esconde qualquer pane de Produto
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  // esconde Kanban e Produto
  hideKanban();
  document.getElementById('produtoTabs').style.display = 'none';

  // mostra Armazéns
  document.getElementById('armazemTabs').style.display    = 'flex';
  document.getElementById('armazemContent').style.display = 'block';
  showArmazemTab('almoxarifado');          // primeira aba
}

function hideArmazem () {
  document.getElementById('armazemTabs').style.display    = 'none';
  document.getElementById('armazemContent').style.display = 'none';
  // se preferir, pode voltar a mostrar produtoTabs aqui
}

/* ——— sub-abas internas ——— */
async function showArmazemTab(nome) {

  document.querySelectorAll('#armazemTabs .main-header-link')
    .forEach(a => a.classList.toggle('is-active', a.dataset.armTab === nome));

  document.querySelectorAll('#armazemContent .armazem-page')
    .forEach(p => p.style.display = (p.id === `conteudo-${nome}` ? 'block' : 'none'));

// —— Almoxarifado: sempre recarrega a página corrente ——
if (nome === 'almoxarifado') {
  // 1) busca dados caso ainda não exista nada carregado
  if (!almoxAllDados.length) {
    await carregarAlmoxarifado();      // primeira vez
  } else {
    aplicarFiltroAlmox();              // reaplica prefixos + texto
  }

  // 2) carrega o CSV e monta checkboxes só na primeira abertura
  if (!almoxCsvLoaded) {
    await loadAlmoxTipoCSV();
  }
}
else if (nome === 'producao') {
  if (!prodAllDados.length) {
    await carregarProducao();          // busca dados 1ª vez
  } else {
    aplicarFiltroProd();
  }

  if (!prodCsvLoaded) await loadProdTipoCSV();
}



}


/* ====================================================== */
/*  Almoxarifado – carregar dados                         */
/* ====================================================== */
let almoxDataLoaded = false;

/* ====================================================== */
/*  Almoxarifado – carregar todos os itens                */
/* ====================================================== */
async function carregarAlmoxarifado() {
  const tbody = document.querySelector('#tbl-almoxarifado tbody');
  tbody.innerHTML = '<tr><td colspan="7">⏳ Carregando…</td></tr>';

  try {
    const resp = await fetch('/api/armazem/almoxarifado', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ pagina: 1 })        // backend devolve tudo
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Falha na API');

    /* —— guarda e desenha —— */
    almoxAllDados   = json.dados;      // mantém a lista completa
    almoxTotalPages = 1;               // sempre 1 agora
    almoxCurrentPage = 1;

    renderAlmoxTable(almoxAllDados);   // cria as <tr>

    /* —— contador e pager —— */
    document.querySelector('.almox-pager').style.display = 'none';  // esconde ◀▶
    document.getElementById('almoxPageInfo').textContent = '1 / 1';
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="7">⚠️ Erro ao carregar dados</td></tr>';
  }
}

async function loadAlmoxTipoCSV() {
  if (almoxCsvLoaded) return;     // só carrega uma vez

  const panel = document.getElementById('almoxFilterPanel');
  // carrega CSV (servido como arquivo estático)
  const textoCsv = await (await fetch('csv/Tipo.csv')).text();

  Papa.parse(textoCsv, {
    header: true,
    skipEmptyLines: true,
    complete: ({ data }) => {
      data.forEach(row => {
        const desc   = row['Descrição'].trim();
        const raw    = row['Grupo'].trim();
const prefix = raw.padStart(2, '0');   // “1” → “01”, “9” → “09”
 
        const padrao = row['almoxarifado']?.trim().toUpperCase() === 'S';

        almoxTipoMap.set(desc, prefix);
        if (padrao) almoxActivePrefixes.add(prefix);

        // monta checkbox
        const id = `chk_${prefix}`;
        const label = document.createElement('label');
        label.innerHTML = `
          <input type="checkbox" id="${id}" ${padrao ? 'checked' : ''}>
          <span>${desc}</span>`;
        panel.appendChild(label);

        // listener deste checkbox
        label.querySelector('input').addEventListener('change', e => {
          if (e.target.checked)  almoxActivePrefixes.add(prefix);
          else                   almoxActivePrefixes.delete(prefix);
          aplicarFiltroAlmox();           // refaz a tabela
        });
      });
      // se os dados já estão na memória, reaplica filtro imediatamente
      if (almoxAllDados.length) aplicarFiltroAlmox();

      almoxCsvLoaded = true;
    }
  });
}

async function loadProdTipoCSV() {
  if (prodCsvLoaded) return;

  const panel = document.getElementById('prodFilterPanel');
  const textoCsv = await (await fetch('csv/Tipo.csv')).text();

  Papa.parse(textoCsv, {
    header: true,
    skipEmptyLines: true,
    complete: ({ data }) => {
      data.forEach(row => {
        const desc   = row['Descrição'].trim();
        const raw    = row['Grupo'].trim();
        const prefix = raw.padStart(2, '0');         // “1” → “01”
        // Na aba Produção vamos iniciar **todos** ativos
prodTipoMap.set(desc, prefix);
const padrao = (row['produção'] ?? '').trim().toUpperCase() !== 'N';
if (padrao) prodActivePrefixes.add(prefix);


        const id = `chkProd_${prefix}`;
        const label = document.createElement('label');
label.innerHTML = `
  <input type="checkbox" id="${id}" ${padrao ? 'checked' : ''}>
  <span>${desc}</span>`;

        panel.appendChild(label);

        label.querySelector('input').addEventListener('change', e => {
          if (e.target.checked)  prodActivePrefixes.add(prefix);
          else                   prodActivePrefixes.delete(prefix);
          aplicarFiltroProd();          // refaz tabela produção
        });
      });

      prodCsvLoaded = true;
      if (prodAllDados.length) aplicarFiltroProd();   // reaplica filtro inicial
    }
  });
}


async function carregarProducao() {
  const tbody = document.querySelector('#tbl-producao tbody');
  tbody.innerHTML = '<tr><td colspan="7">⏳ Carregando…</td></tr>';

  try {
    const resp = await fetch('/api/armazem/producao', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ pagina:1 })
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Falha na API');

    prodAllDados   = json.dados;
    prodCurrentPage = 1;
    prodTotalPages  = 1;

    renderProdTable(prodAllDados);
    document.querySelector('#conteudo-producao .almox-pager').style.display = 'none';
    document.getElementById('prodPageInfo').textContent = '1 / 1';
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="7">⚠️ Erro ao carregar dados</td></tr>';
  }
}


document.getElementById('menu-armazens').addEventListener('click', e => {
  e.preventDefault();
  showArmazem();
});

document.querySelectorAll('#armazemTabs .main-header-link')
  .forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      showArmazemTab(link.dataset.armTab);   // almoxarifado / producao / …
    });
  });

  /* ——— paginação ——— */
document.getElementById('almoxPrev').addEventListener('click', () => {
  if (almoxCurrentPage > 1) {
    carregarAlmoxarifado(almoxCurrentPage - 1);
  }
});
document.getElementById('almoxNext').addEventListener('click', () => {
  if (almoxCurrentPage < almoxTotalPages) {
    carregarAlmoxarifado(almoxCurrentPage + 1);
  }
});

/* —— pesquisa em tempo-real —— */
const inpSearch = document.getElementById('almoxSearch');
inpSearch.addEventListener('input', aplicarFiltroAlmox);

/* —— Botão de filtro (toggle) —— */
const btnFiltro = document.getElementById('almoxFilterBtn');
btnFiltro.addEventListener('click', () => {
  const panel = document.getElementById('almoxFilterPanel');
  const vis = panel.style.display === 'block';
  panel.style.display = vis ? 'none' : 'block';

  if (!vis) {
    // posiciona logo abaixo do botão
    const r = btnFiltro.getBoundingClientRect();
    panel.style.left = r.left + 'px';
    panel.style.top  = (r.bottom + 6) + 'px';
  }
});

/* —— busca Produção —— */
const prodInput = document.getElementById('prodSearch');
prodInput.addEventListener('input', aplicarFiltroProd);

const prodBtnFiltro = document.getElementById('prodFilterBtn');
prodBtnFiltro.addEventListener('click', () => {
  const panel = document.getElementById('prodFilterPanel');
  const vis = panel.style.display === 'block';
  panel.style.display = vis ? 'none' : 'block';

  if (!vis) {
    const r = prodBtnFiltro.getBoundingClientRect();
    panel.style.left = r.left + 'px';
    panel.style.top  = (r.bottom + 6) + 'px';
  }
});


// Navega para a aba de Detalhes
function navigateToDetalhes(codigo) {
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.main-header-link').forEach(l => l.classList.remove('is-active'));
  document.querySelector('[data-target="dadosProduto"]').classList.add('is-active');
  document.getElementById('dadosProduto').style.display = 'block';
  document.querySelector('.main-header').style.display = 'flex';
  window.loadDadosProduto(codigo);
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[menu_produto] DOMContentLoaded disparou');
// abre o painel Início como padrão
showMainTab('paginaInicio');

 const inputBusca = document.querySelector('.search-bar input');
console.log('[INIT] inputBusca', inputBusca);

 /* ── anima a barra de pesquisa (lupa) ─────────────────────────── */
const searchBar   = document.querySelector('.search-bar');       // <div …>
const searchInput = inputBusca;                                  // <input …>

// ► abre a barra e foca no input
searchBar.addEventListener('click', e => {
  e.stopPropagation();            // não deixa o clique “vazar”
  searchBar.classList.add('active');
  searchInput.focus();            // aparece o cursor
});

// ► fecha se clicar fora (e o campo estiver vazio)
document.addEventListener('click', e => {
  const clicouFora = !searchBar.contains(e.target);
  const vazio      = !searchInput.value.trim();
  if (clicouFora && vazio) {
    searchBar.classList.remove('active');
  }
});
/* ─────────────────────────────────────────────────────────────── */

// garante foco mesmo se clicar no ícone ou no espaço à esquerda
searchBar.addEventListener('mousedown', e => {
  if (e.target !== inputBusca) {   // agora inputBusca existe :)
    e.preventDefault();
    inputBusca.focus();
  }
});

  const codeFilter = document.getElementById('codeFilter');
  const descFilter = document.getElementById('descFilter');
    // 0) Esconde a aba “Acessos” se não for admin
    const status = await fetch(`${API_BASE}/api/auth/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    })
      .then(r => r.json());
    
if (status.loggedIn && !status.user.roles.includes('admin')) {
document.getElementById('menu-acessos')
.style.display = 'none';
}

// agora seleciona o UL correto da aba "Lista de produtos"
const ulList     = document.getElementById('listaProdutosList');
  const countEl    = document.getElementById('productCount');

  // Guarda os itens da busca resumida
  let resumoItems = [];

  // FILTRO LOCAL (SEM RE-RENDER)
  function applyResumoFilters() {
    const termCode = codeFilter.value.trim().toLowerCase();
    const termDesc = descFilter.value.trim().toLowerCase();
  
    ulList.querySelectorAll('li').forEach(li => {
      const code = (li.dataset.codigo    || '').toLowerCase();
      const desc = (li.dataset.descricao || '').toLowerCase();
  
      const show = ((!termCode || code.includes(termCode)) &&
                    (!termDesc || desc.includes(termDesc)));
      li.style.display = show ? '' : 'none';
    });
  }
  
  codeFilter.addEventListener('input', applyResumoFilters);
  descFilter.addEventListener('input', applyResumoFilters);


  // pega referências ao botão e ao painel de filtros
const filterBtn   = document.getElementById('filterBtn');
const filterPanel = document.getElementById('filterPanel');

filterBtn.addEventListener('click', e => {
  e.preventDefault();
  // alterna visibilidade
  if (filterPanel.style.display === 'block') {
    filterPanel.style.display = 'none';
  } else {
    filterPanel.style.display = 'block';
  }
});

  // PESQUISA PRINCIPAL
inputBusca.addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const termo = inputBusca.value.trim();
  if (!termo) return;

  // 1) tenta abrir detalhes
  try {
    console.log('[FETCH] buscando detalhes do produto →', termo);
    const resDet = await fetch(
      `${API_BASE}/api/produtos/detalhes/${encodeURIComponent(termo)}`,
      { credentials: 'include' }
    );
    if (!resDet.ok) throw new Error(`HTTP ${resDet.status}`);
    const detData = await resDet.json();
    if (!detData.error) {
      navigateToDetalhes(termo);
      inputBusca.value = '';
      return;
    }
  } catch {
    // se não existe ou deu erro, cai no fallback
    console.log('[SEARCH] produto não encontrado em detalhes, lista resumida…');
  }

  // 2) fallback: lista resumida
  inputBusca.value = '';
  document.querySelectorAll('.tab-pane').forEach(p => (p.style.display = 'none'));
  document.getElementById('listaProdutos').style.display = 'block';
  document.querySelector('.main-header').style.display = 'none';
  ulList.innerHTML = '';
  countEl.textContent = '0';

    showSpinner();
    try {
const resResumo = await fetch(`${API_BASE}/api/omie/produtos`, {
  method:      'POST',
  credentials: 'include',
  headers:     { 'Content-Type':'application/json' },
  body:        JSON.stringify({
    call:       'ListarProdutosResumido',
    app_key:    OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      pagina: 1,
      registros_por_pagina: 50,
      filtrar_apenas_descricao: `%${termo}%`,
      apenas_importado_api: 'N',
      filtrar_apenas_omiepdv: 'N'
    }]
  })
});

      const dados = await resResumo.json();
      resumoItems = dados.produto_servico_resumido || [];
      countEl.textContent = resumoItems.length;

      resumoItems.forEach(item => {
        const li = document.createElement('li');
        li.dataset.codigo    = item.codigo;
        li.dataset.descricao = item.descricao;
        li.innerHTML = `
          <span class="products">${item.codigo}</span>
          <span class="status">${item.descricao}</span>
          <div class="button-wrapper">
            <button class="content-button status-button open"
                    data-codigo="${item.codigo}">Abrir</button>
          </div>`;
        li.querySelector('button.open').addEventListener('click', () => {
          navigateToDetalhes(item.codigo);
        });
        ulList.appendChild(li);
      });
       // reaplica o filtro de Código/Descrição
       applyResumoFilters();
    } catch {
      alert('Erro ao buscar produtos');
    } finally {
      hideSpinner();
    }
  });

  // === HOME – Preparação elétrica =========================
document.getElementById('btn-prep-eletrica')?.addEventListener('click', e => {
  e.preventDefault();                 // não siga o href
  window.location.href = 'preparacao_eletrica.html';  // carrega a nova página
});


  // ATALHO ÚNICO: abre aba cacheada + carrega cache EM UM SÓ CLIQUE

   const btnCache = document.getElementById('btn-omie-list1')
                  || document.getElementById('btn-omie-list');
  console.log('[DEBUG] btnCache encontrado em DOMContentLoaded:', btnCache);
if (btnCache) {
btnCache.addEventListener('click', async e => {
  e.preventDefault();
  hideKanban();

  // 1) esconde todas as panes e mostra só o painel de produtos
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.getElementById('listaProdutos').style.display = 'block';

  // 2) remove destaque e destaca o menu lateral
  document.querySelector('.main-header').style.display = 'none';
  document.querySelectorAll('.side-menu a').forEach(a => a.classList.remove('is-active'));
  btnCache.classList.add('is-active');

  // 3) carrega toda a lista usando o cache e filtros já testados
  console.log('[DEBUG] iniciando initListarProdutosUI…');
  await initListarProdutosUI('listaProdutos', 'listaProdutosList');
  console.log('[DEBUG] initListarProdutosUI completo');
});

}


  document.getElementById('menu-produto')
  .addEventListener('click', e => {
    e.preventDefault();
    openDadosProdutoTab();
  });


// Função para buscar e renderizar usuários sem os campos Admin/Editor
async function loadUsers() {
  const container = document.getElementById('userList');

  // 1) Busca usuários
  const res = await fetch(`${API_BASE}/api/users`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  });
  if (!res.ok) {
    let errText = res.statusText;
    try { errText = (await res.json()).error || errText; } catch {}
    container.innerHTML = `<p class="empty">❌ ${errText}</p>`;
    return;
  }

  // 2) Extrai array
  const data  = await res.json();
  const users = Array.isArray(data) ? data : (data.users || []);
  if (users.length === 0) {
    container.innerHTML = '<p class="empty">Nenhum usuário encontrado</p>';
    return;
  }

  // 3) Gera opções
  const options = users
    .map(u => `<option value="${u.id}">${u.username}</option>`)
    .join('');

  // 4) Renderiza listbox
// substitua por isto:
container.innerHTML = `
  <select
    id="userSelect"
    class="content-select"
  >
    ${options}
  </select>
`;

}






// Botão “Novo Usuário” mostra o formulário
document.getElementById('btnNewUser')
  .addEventListener('click', () => {
    document.getElementById('userForm').style.display = 'block';
  });

// Salvar novo usuário
document.getElementById('btnSaveUser')
  .addEventListener('click', async () => {
    const username = document.getElementById('inpUsername').value.trim();
    const password = '123';      // senha fixa
    const roles    = [];         // sem definição prévia de roles

    await fetch(`${API_BASE}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, roles })
    });

    document.getElementById('userForm').style.display = 'none';
    loadUsers();
  });

  // ——— Configura evento para todas as abas do header ———
// ——— Configura evento para todas as abas do header ———
const headerLinks   = document.querySelectorAll('.header .header-menu > .menu-link');
const leftSide      = document.querySelector('.left-side');
const mainContainer = document.querySelector('.main-container');
const panes         = mainContainer.querySelectorAll('.tab-pane');

headerLinks.forEach(link => {
  link.addEventListener('click', async e => {
    e.preventDefault();
    // 1) limpa destaque e esconde todos os panes
    headerLinks.forEach(a => a.classList.remove('is-active'));
    panes.forEach(p => p.style.display = 'none');

        /* toda vez que sair de Pedidos, esconde o painel Kanban */
if (link.id !== 'menu-pedidos') hideKanban();
if (link.id !== 'menu-armazens') hideArmazem();

    // 2) destaca o clicado
    link.classList.add('is-active');



    if (link.id === 'menu-acessos') {
      acessosPanel.style.display = 'block';
      await loadUsers();
      loadMenus();
    
    } else if (link.id === 'menu-produto') {
      acessosPanel.style.display = 'none';
      openDadosProdutoTab();
    
    } else if (link.id === 'menu-notificacoes') {        // ← NOVO
      acessosPanel.style.display = 'none';
      if (window.openNotificacoes) window.openNotificacoes();
      
} else if (link.id === 'menu-inicio') {

  /* 1) fecha Kanban e Armazéns, se abertos */
  hideKanban();
  hideArmazem();

  /* 2) esconde todas as outras seções */
  document.querySelectorAll('.tab-pane, .kanban-page')
          .forEach(p => p.style.display = 'none');
  document.getElementById('produtoTabs').style.display  = 'none';
  document.getElementById('kanbanTabs').style.display   = 'none';
  document.getElementById('armazemTabs').style.display  = 'none';
const mh = document.querySelector('.main-header');
if (mh) mh.style.display = 'none';


  /* 3) mostra a Home com os 6 botões */
  showMainTab('paginaInicio');

  /* 4) mantém o link Início destacado */
  headerLinks.forEach(a => a.classList.remove('is-active'));
  link.classList.add('is-active');

  /* 5) garante que a sidebar esteja visível */
  document.querySelector('.left-side')?.classList.remove('is-hidden');
}





    
  });
});

/* dentro do MESMO callback que já existe */
const bell       = document.getElementById('bell-icon');
const printBtn   = document.getElementById('print-icon');
const cloudBtn   = document.getElementById('cloud-icon');
const avatar     = document.getElementById('profile-icon');
const etiquetasModal = document.getElementById('etiquetasModal');
const listaEtiq       = document.getElementById('listaEtiquetas');

  /* –– SINO –– */
  bell?.addEventListener('click', e => {
    e.preventDefault();
    // Faz o mesmo que clicar no link do header
    document.getElementById('menu-notificacoes')?.click();
  });

  /* –– IMPRESSORA –– */
printBtn?.addEventListener('click', async e => {
  e.preventDefault(); e.stopPropagation();

  listaEtiq.innerHTML = '<li>carregando…</li>';
  try {
    const resp = await fetch('/api/etiquetas');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const files = await resp.json();  // ex.: ["etiqueta_F06250019.zpl"]

    if (files.length === 0) {
      listaEtiq.innerHTML = '<li>Nenhuma etiqueta encontrada</li>';
    } else {
      listaEtiq.innerHTML = files.map(f => `
        <li>
          <span>${f}</span>
          <button class="btn-print" data-file="${f}">Imprimir</button>
        </li>`).join('');
    }
  } catch (err) {
    console.error(err);
    listaEtiq.innerHTML = '<li>Falha ao buscar etiquetas</li>';
  }

  etiquetasModal.classList.add('is-active');
});

document
  .querySelector('#etiquetasModal .close-modal')
  .addEventListener('click', () =>
    etiquetasModal.classList.remove('is-active')
  );

listaEtiq.addEventListener('click', e => {
  if (e.target.matches('.btn-print')) {
    const file = e.target.dataset.file;
    window.open(`/etiquetas/printed/${encodeURIComponent(file)}`, '_blank');
  }
});

  /* –– NUVEM –– */
  cloudBtn?.addEventListener('click', e => {
    e.preventDefault();
    alert('Clicou em nuvem');
  });
/* –– AVATAR –– */
/*  Só chama o modal se a função já estiver registrada
    (login.js a registra na janela).  Nada de redirecionar! */
avatar?.addEventListener('click', e => {
  e.preventDefault();
  if (window.openLoginModal) window.openLoginModal();
});


// ─── Sub-abas unificadas em Dados do produto ───
const subTabLinks = document.querySelectorAll(
  '#dadosProduto .sub-tabs .main-header-link'
);
subTabLinks.forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    // 1) destaco só este link
    subTabLinks.forEach(l => l.classList.remove('is-active'));
    link.classList.add('is-active');
    // 2) escondo todos os sub-conteúdos
    document
      .querySelectorAll('#dadosProduto .sub-content')
      .forEach(sec => (sec.style.display = 'none'));
    // 3) mostro só o target correto
    const alvoId = link.dataset.subtarget;            // ex: "detalhesTab"
    const alvoEl = document.getElementById(alvoId);
    if (!alvoEl) return console.error(`Sub-aba "${alvoId}" não existe`);
    alvoEl.style.display = 'block';
    console.log(`[Sub-aba] exibindo "${alvoId}"`);
  });
});

// forço, ao abrir Dados do produto, a sub-aba “Detalhes”
const detalhesInicial = document.querySelector(
  '#dadosProduto .sub-tabs .main-header-link[data-subtarget="detalhesTab"]'
);
if (detalhesInicial) detalhesInicial.click();

// Ao carregar, parte da Home → oculta abas internas de Produto
const prodHeader = document.querySelector('#produtoTabs .main-header');
if (prodHeader) prodHeader.style.display = 'none';
document.getElementById('produtoTabs').style.display = 'none';



  // … quaisquer outras inicializações finais …
  initDadosColaboradoresUI();
  initAnexosUI();
});  // <--- aqui fecha o DOMContentLoaded



// garante que clicar em QUALQUER ponto da barra de pesquisa dá foco ao input
document.querySelector('.search-bar').addEventListener('click', () => {
  const inp = document.querySelector('.search-bar input');
  if (inp) inp.focus();
});


// Função para preencher os menus lateral e superior com um <select> de permissões
function loadMenus() {
  const sideContainer = document.getElementById('sideMenuList');
  const topContainer  = document.getElementById('topMenuList');
  if (!sideContainer || !topContainer) return;

  const roles = ['admin', 'visualizacao', 'edição', 'Ocultar'];

  // — Preenche Menu Lateral —
  sideContainer.innerHTML = '';
  document.querySelectorAll('.left-side .side-menu a').forEach(link => {
    const li     = document.createElement('li');
    const span   = document.createElement('span');
    const select = document.createElement('select');

    li.classList.add('content-list-item');
    select.classList.add('content-select');

    span.textContent = link.textContent.trim();
    roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value       = r;
      opt.textContent = r;
      select.appendChild(opt);
    });
    select.value = 'Ocultar';

    li.append(span, select);
    sideContainer.appendChild(li);
  });

  // — Preenche Menu Superior —
  topContainer.innerHTML = '';
  document.querySelectorAll('.header .header-menu > .menu-link').forEach(link => {
    const li     = document.createElement('li');
    const span   = document.createElement('span');
    const select = document.createElement('select');

    li.classList.add('content-list-item');
    select.classList.add('content-select');

    span.textContent = link.textContent.trim();
    roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value       = r;
      opt.textContent = r;
      select.appendChild(opt);
    });
    select.value = 'Ocultar';

    li.append(span, select);
    // **Aqui** você deve usar o topContainer
    topContainer.appendChild(li);
  });
}


// 1) Alterna entre Produto ⇄ Pedidos
/* ======== Links diretos do cabeçalho ======== */
document.getElementById('menu-produto') .addEventListener('click', e => {
  e.preventDefault();
  hideKanban();            // <<<<< usa o helper novo
  openDadosProdutoTab();   // já existia
});

document.getElementById('menu-pedidos').addEventListener('click', e => {
  e.preventDefault();
  showKanban();            // <<<<< usa o helper novo
});


/* ------------------------------------------------------------ *
 *  Mostra uma sub-aba do Kanban                                *
 *  nome = comercial | pcp | preparacao | producao | detalhes   *
 * ------------------------------------------------------------ */
function showKanbanTab(nome) {

  /* 1) destaca o link ativo na barra -------------------------- */
  document.querySelectorAll('#kanbanTabs .main-header-link')
    .forEach(a => a.classList.toggle('is-active',
                                     a.dataset.kanbanTab === nome));

  /* 2) exibe só o painel correspondente ----------------------- */
  document.querySelectorAll('#kanbanContent .kanban-page')
    .forEach(p =>
      p.style.display = (p.id === `conteudo-${nome}` ? 'block' : 'none')
    );

  /* 3) carrega / atualiza as colunas da aba escolhida ---------- */
if (nome === 'comercial')       KanbanViews.renderKanbanComercial?.();
else if (nome === 'pcp')        KanbanViews.renderKanbanPCP?.();
else if (nome === 'preparacao') initPreparacaoKanban();
else if (nome === 'producao')   KanbanViews.renderKanbanProducao?.();
else if (nome === 'detalhes')   KanbanViews.renderKanbanDetalhes?.();



  /* 4) guarda a última aba visitada --------------------------- */
  lastKanbanTab = nome;
}

/* ------------------------------------------------------------ *
 *  Listeners da barra “Comercial | PCP | …”                    *
 * ------------------------------------------------------------ */
document.querySelectorAll('#kanbanTabs .main-header-link')
  .forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();                    // cancela o href
      hideArmazem();                         // oculta abas de estoque
      const alvo = link.dataset.kanbanTab;   // comercial / pcp / …
      showKanbanTab(alvo);                   // exibe sub-kanban
    });
  });



// ---------- MENU RESPONSIVO ----------
const header   = document.getElementById('appHeader');   // <div class="header">
const menu     = document.getElementById('mainMenu');    // <nav …>
const moreBtn  = document.getElementById('moreBtn');     // botão ⋯
const moreMenu = document.getElementById('moreMenu');    // dropdown
const notifLi  = document.getElementById('menu-notificacoes'); // link “Notificações”

function recalculaMenu () {
  /* 1) devolve tudo ao <nav> antes de medir ----------------------- */
  while (moreMenu.firstChild) menu.appendChild(moreMenu.firstChild);
  moreBtn.style.display = 'none';

  /* 2)       ↙ larg. header  − (busca + ícones + paddings + ‘…’) */
  const busca   = document.getElementById('searchBar');
  const icones  = document.querySelector('.header-profile');
  const padding = 60;                             // 2 × 30 px

  const livre = header.clientWidth
              - busca.offsetWidth
              - icones.offsetWidth
              - moreBtn.offsetWidth
              - padding;

  /* 3) força “Notificações” a ficar SEMPRE no dropdown ------------ */
  if (notifLi && menu.contains(notifLi)) {
    moreMenu.prepend(notifLi);
    moreBtn.style.display = 'block';
  }

  /* 4) empurra o que mais não couber ------------------------------ */
  while (menu.scrollWidth > livre && menu.children.length > 1) {
    moreMenu.prepend(menu.lastElementChild);
    moreBtn.style.display = 'block';
  }
}

/* abre/fecha o dropdown */
moreBtn.addEventListener('click', () => {
  moreMenu.classList.toggle('open');
});

/* recalcula em 3 situações */
window.addEventListener('resize',           recalculaMenu);
document.fonts?.ready.then(                  recalculaMenu);
document.addEventListener('DOMContentLoaded', recalculaMenu);
document.addEventListener('DOMContentLoaded', () => {
  if (window.inicializarImportacaoCaracteristicas)
       window.inicializarImportacaoCaracteristicas();
});

