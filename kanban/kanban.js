// kanban.js  (substitua todo o arquivo)

import {
  renderKanbanDesdeJSON,
  enableDragAndDrop,
  salvarKanbanLocal,
  gerarEtiqueta,
  gerarEtiquetaPP,
  gerarEtiquetaObs
} from './kanban_base.js';

// kanban.js  – depois dos imports
let pcpOpBusy = false;      // evita cliques repetidos enquanto processa

/* ——————————————————————————————————— */
/*  🔹  Cache com TODOS os produtos tipo 04  */
let productsCache = null;           // null = ainda não carregou
/* ——————————————————————————————————— */

function obterDescricao(codMP) {
  if (!productsCache) return '';
  const prod = productsCache.find(p => p.codigo === codMP);
  return prod ? prod.descricao : '';
}

import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;
/* ——— Filtro de estoque (true = mostra tudo, false = só baixos) ——— */
let pcpShowAll = false;           // começa mostrando **apenas** itens em vermelho
let kanbanCache = [];      // mantém os itens atuais em memória

/* ------------------------------------------------------------------ */
/*  kanban.js  –  garantir BASE das chamadas backend                   */
/* ------------------------------------------------------------------ */
// ——— depósito fixo para Atualizar Kanban ———
const COD_LOCAL_ESTOQUE = 10520299822;
const COD_LOCAL_PCP = 10564345392;   // depósito onde ficam as peças separadas

const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : window.location.origin;



/* ───────────────── helpers ───────────────── */

/* ────────────────────────────────
   Atualiza saldo só dos cartões
   "Pedido aprovado" (coluna comercial)
   ──────────────────────────────── */
async function atualizarEstoqueKanban () {
  const HOJE       = new Date().toLocaleDateString('pt-BR'); // dd/mm/aaaa
  const OMIE_URL   = `${API_BASE}/api/omie/estoque/consulta`;

  /* 1) monta o payload – só 1 página, 50 itens */
  const payload = {
    call      : 'ListarPosEstoque',
    app_key   : OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param     : [{
      nPagina: 1,
      nRegPorPagina: 50,
      dDataPosicao: HOJE,
      cExibeTodos: 'N',
      codigo_local_estoque: COD_LOCAL_ESTOQUE,
      cTipoItem: '04'           // produtos acabados
    }]
  };

  /* 2) chama o backend (proxy) */
  const resp = await fetch(OMIE_URL, {
    method : 'POST',
    headers: { 'Content-Type':'application/json' },
    body   : JSON.stringify(payload)
  });
  if (!resp.ok) {
    console.warn('[Kanban] estoque 105… status', resp.status);
    return;
  }
  const dados = await resp.json();

  /* 3) monta mapa código → saldo */
  const mapa = {};
  (dados.produtos || []).forEach(p => {
    mapa[p.cCodigo.toLowerCase()] = p.nSaldo ?? p.fisico ?? 0;
  });

  /* 4) aplica só nos cartões Pedido aprovado */
  let mudou = false;
  kanbanCache.forEach(it => {
    if (!it.local.some(l => l.startsWith('Pedido aprovado'))) return;

    const key  = it.codigo.toLowerCase();
    const novo = key in mapa ? mapa[key] : 0;   // ← default 0

    if (it.estoque !== novo) {                  // grava sempre que mudou
      it.estoque = novo;
      mudou = true;
    }
  });

  /* 5) se algo mudou, salva e re-renderiza */
  if (mudou) {
    await salvarKanbanLocal(kanbanCache, 'comercial');
    renderKanbanDesdeJSON(kanbanCache);
    enableDragAndDrop(kanbanCache);
  }
}


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



const PAGE_SIZE   = 100;
async function loadProductsCache () {
  if (productsCache) return productsCache;          // já carregado

  const todos = [];
  let   page  = 1;
  let   totPg = 1;                                  // 1ª suposição

  do {
    const body = {
      call : 'ListarProdutosResumido',
      param: [{
        pagina: page,
        registros_por_pagina: PAGE_SIZE,
        apenas_importado_api : 'N',
        filtrar_apenas_omiepdv: 'N',
        filtrar_apenas_tipo   : '04'                // 💡 só produtos finais
      }]
    };

    const res  = await fetch(`${API_BASE}/api/omie/produtos`, {
      method      : 'POST',
      credentials : 'include',
      headers     : { 'Content-Type':'application/json' },
      body        : JSON.stringify(body)
    });

    if (!res.ok) {
      console.error('[loadProductsCache] HTTP', res.status, await res.text());
      throw new Error('Falha ao consultar OMIE');
    }

    const json = await res.json();
    const arr  = json.produto_servico_resumido || [];
    todos.push(...arr);

    // OMIE devolve o nº total de páginas
    totPg = json.total_de_paginas ?? 1;
    page++;

    if (page <= totPg) await sleep(650);            // 0,65 s ≈ 2 req/s
  } while (page <= totPg);

  todos.sort((a,b) => a.codigo.localeCompare(b.codigo));
  productsCache = todos;
  return todos;
}


function setupAddToggle() {
  const colElem = document.getElementById('coluna-pcp-aprovado');
  if (!colElem) return;

  const col     = colElem.closest('.kanban-column');
  if (!col) return;

  const btn     = col.querySelector('.add-btn');
  const input   = col.querySelector('.add-search');
  const results = col.querySelector('.add-results');

  btn.addEventListener('click', async () => {
    col.classList.toggle('search-expand');
    if (!col.classList.contains('search-expand')) return;
    setTimeout(() => input.focus(), 100);
    results.innerHTML = ''; // nada de pré-carregar
  });
}


/* Fecha o painel de busca: remove a classe, limpa UL e zera o input */
 function collapseSearchPanel() {
   /* fecha QUALQUER coluna que esteja com o search aberto */
   document.querySelectorAll('.kanban-column.search-expand').forEach(col => {
     col.classList.remove('search-expand');
     col.querySelector('.add-results')?.replaceChildren(); // limpa lista
   });
 }

window.collapseSearchPanel = collapseSearchPanel;   // torna-a global

// <<< Cole AQUI, logo abaixo de setupAddToggle()


// === SSE p/ auto-atualização do Kanban Comercial ===
let __comercialSseStarted = false;

export function startComercialSSE() {
  if (__comercialSseStarted) return;
  __comercialSseStarted = true;

  try {
    const src = new EventSource('/api/produtos/stream');

    // Qualquer evento (exceto o "hello" inicial) dispara um refresh do quadro
    src.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg && msg.type === 'hello') return;
      } catch (_) {
        // não era JSON? Sem crise, atualiza do mesmo jeito
      }
      Promise.resolve(initKanban()).catch(err =>
        console.error('[SSE][Comercial] falha ao recarregar:', err)
      );
    };

    window.addEventListener('beforeunload', () => src.close?.());
  } catch (e) {
    console.warn('[SSE] EventSource indisponível, ativando polling como fallback');
    setInterval(() => {
      Promise.resolve(initKanban()).catch(() => {});
    }, 5000);
  }
}

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
    li.dataset.desc = p.descricao;              // << NOVO
    container.appendChild(li);
li.addEventListener('click', ev => {
  /* 0) Impede que o clique “vaze” para outros handlers */
  ev.preventDefault();
  ev.stopPropagation();

  /* 1) Preenche o input com código e descrição */
  const input = container.previousElementSibling;
  input.value = `${p.codigo} — ${p.descricao}`;

  /* 2) Esconde a lista e recolhe o painel de busca */
  container.innerHTML = '';
  container.closest('.kanban-column')
           ?.classList.remove('search-expand');

  /* 3) Abre a aba PCP (isso já chama renderListaPecasPCP() lá) */
  document.querySelector(
    '#kanbanTabs .main-header-link[data-kanban-tab="pcp"]'
  )?.click();
});


  });
}

function setupProductSearch() {
  const col     = document
    .getElementById('coluna-pcp-aprovado')
    ?.closest('.kanban-column');
  if (!col) return;

  const input   = col.querySelector('.add-search');
  const results = col.querySelector('.add-results');

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const term = input.value.trim();
      if (term.length < 2) {
        results.innerHTML = '';
        return;
      }
      try {
const url = `/api/produtos/search?q=${encodeURIComponent(term)}&limit=40`;
const resp = await fetch(url, { credentials: 'include' });
const json = await resp.json();
const items = json?.data || [];   // <-- era json.items

results.innerHTML = '';
items.forEach(p => {
  const li = document.createElement('li');
  li.classList.add('result-item');
  li.textContent = `${p.codigo} — ${p.descricao}`;
  li.dataset.desc = p.descricao;

          li.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();

            input.value = `${p.codigo} — ${p.descricao}`;

            // recolhe a caixa
            results.innerHTML = '';
            col.classList.remove('search-expand');

            // troca para a aba PCP para montar a lista de peças
            document.querySelector(
              '#kanbanTabs .main-header-link[data-kanban-tab="pcp"]'
            )?.click();
          });

          results.appendChild(li);
        });
      } catch (err) {
        console.error('[autocomplete produtos]', err);
        results.innerHTML = '<li class="error">Erro ao buscar</li>';
      }
    }, 150);
  });
}



function filtrarPorEstoque() {
  document.querySelectorAll('#listaPecasPCPList li').forEach(li => {
    /* span.est recebe .low quando estoque < 1  OU  estoque < Qtd   */
    const isLow = li.querySelector('.est')?.classList.contains('low');
    li.style.display = (pcpShowAll || isLow) ? '' : 'none';
  });


}

// ─── 1) Renderiza a Lista de Peças na aba PCP ────────────────────────
// Resolve o código de produto que a PCP deve usar agora
function _pcpResolveCodigoAtual() {
  // 1) veio da aba Preparação (kanban_preparacao.js seta window.prepCodigoSelecionado)
  if (window.prepCodigoSelecionado && typeof window.prepCodigoSelecionado === 'string') {
    const cod = window.prepCodigoSelecionado.trim();
    if (cod) {
      window.pcpCodigoAtual = cod;      // memoriza
      window.prepCodigoSelecionado = null;
      return cod;
    }
  }

  // 2) já usamos algo antes nesta sessão
  if (window.pcpCodigoAtual) return String(window.pcpCodigoAtual).trim();

  // 3) fallback: lê o input da coluna “Separação logística” (se existir)
  const col = document.getElementById('coluna-pcp-aprovado')?.closest('.kanban-column');
  const input = col?.querySelector('.add-search');
  const raw = input?.value || '';
  const cod = raw.split('—')[0]?.trim();
  if (cod) {
    window.pcpCodigoAtual = cod;
    return cod;
  }

  return '';
}

// Re-renderiza a lista ao clicar OK (multiplicador) sem recarregar de novo do servidor
function _pcpReaplicarFator(ul, dados) {
  const fator = Math.max(1, parseFloat(document.getElementById('pcp-factor')?.value || '1') || 1);
  // remove todas as linhas (menos o cabeçalho)
  ul.querySelectorAll('li:not(.header-row)').forEach(li => li.remove());

  dados.forEach(p => {
    const li = document.createElement('li');
// util leve pra escapar HTML quando usado em template string
function _esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

li.innerHTML = `
  <div class="cod" title="${_esc(p.comp_descricao)}" data-full="${_esc(p.comp_descricao)}">${_esc(p.comp_codigo)}</div>
  <div class="unid" style="text-align:center">${_esc(p.comp_unid || '')}</div>
  <div class="qtd"  style="text-align:center">${(Number(p.comp_qtd) * fator).toLocaleString('pt-BR')}</div>
  <div class="perda" style="text-align:center">${Number(p.comp_perda_pct || 0).toLocaleString('pt-BR')}</div>
  <div class="qtdb" style="text-align:center">${(Number(p.comp_qtd_bruta) * fator).toLocaleString('pt-BR')}</div>
  <div class="qtdpro" style="text-align:center">-</div>
  <div class="qtdalm" style="text-align:center">-</div>
  <div class="acao" style="text-align:center">
    <button type="button" class="content-button status-button pcp-request" data-codigo="${_esc(p.comp_codigo)}" title="Solicitar produto">Solicitar</button>
  </div>
`;

li.dataset.codigo    = String(p.comp_codigo || '').toLowerCase();
li.dataset.descricao = String(p.comp_descricao || '').toLowerCase();


    ul.appendChild(li);
  });
}

function _pcpColetarCodigosDaUL(ul) {
  return Array.from(ul.querySelectorAll('li:not(.header-row) .cod'))
    .map(el => (el.textContent || '').trim())
    .filter(Boolean);
}

async function pcpPreencherSaldosDuplos(ul) {
  try {
    const codigos = _pcpColetarCodigosDaUL(ul);
    if (!codigos.length) return;

    const r = await fetch('/api/armazem/saldos_duplos', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      credentials: 'include',
      body: JSON.stringify({ codigos })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const pro = j?.pro || {};
    const alm = j?.alm || {};

    // aplica nos elementos
    ul.querySelectorAll('li:not(.header-row)').forEach(li => {
      const cod = (li.querySelector('.cod')?.textContent || '').trim();
      const qtdProEl = li.querySelector('.qtdpro');
      const qtdAlmEl = li.querySelector('.qtdalm');

      const vPro = Number(pro[cod] ?? 0);
      const vAlm = Number(alm[cod] ?? 0);

      if (qtdProEl) qtdProEl.textContent = vPro.toLocaleString('pt-BR');
      if (qtdAlmEl) qtdAlmEl.textContent = vAlm.toLocaleString('pt-BR');

      // feedback visual opcional (sem bloquear):
      if (qtdProEl && vPro <= 0) qtdProEl.style.color = '#e44';
      if (qtdAlmEl && vAlm <= 0) qtdAlmEl.style.color = '#e44';
    });
  } catch (e) {
    console.warn('[PCP] preencher saldos duplos falhou:', e);
  }
}


async function renderListaPecasPCP() {
  console.debug('[PCP] renderListaPecasPCP()');
  const ul = document.getElementById('listaPecasPCPList');
  if (!ul) { console.warn('[PCP] UL não encontrada'); return; }

  // 1) qual código vamos usar?
  const codigo = _pcpResolveCodigoAtual();
  if (!codigo) {
    // sem código → limpa linhas e esconde a barra
    ul.querySelectorAll('li:not(.header-row)').forEach(li => li.remove());
    const bar = document.getElementById('pcp-code-bar');
    if (bar) bar.style.display = 'none';
    console.warn('[PCP] Nenhum código disponível para listar peças.');
    return;
  }

  // 2) mostra a barra e preenche os campos
  const bar = document.getElementById('pcp-code-bar');
  if (bar) {
    bar.style.display = '';
    const elCode = document.getElementById('pcp-code');
    if (elCode) elCode.textContent = codigo;
    const elFactor = document.getElementById('pcp-factor');
    if (elFactor && !elFactor.value) elFactor.value = 1;
  }

  // 3) busca no SQL (nosso endpoint já testado via curl)
  //    Ex.: POST /api/pcp/estrutura?pai_codigo=04.PP.N.51005  body: {}
  let json;
  try {
    const r = await fetch(`/api/pcp/estrutura?pai_codigo=${encodeURIComponent(codigo)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'include'
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    json = await r.json();
  } catch (e) {
    console.error('[PCP] erro buscando SQL:', e);
    return;
  }

  const dados = Array.isArray(json?.dados) ? json.dados : [];
  console.debug('[PCP] itens na estrutura:', dados.length);

  // 4) preenche a lista aplicando o multiplicador atual
  _pcpReaplicarFator(ul, dados);

  // 5) botão OK reaplica o fator localmente (sem pedir de novo ao servidor)
  const ok = document.getElementById('pcp-ok');
  if (ok) {
    ok.onclick = () => _pcpReaplicarFator(ul, dados);
  }

  // 6) “+” abre a busca (reaproveita o input da coluna de Separação logística)
  const plus = document.getElementById('pcp-open-search');
  if (plus) {
    plus.onclick = () => {
      const col = document.getElementById('coluna-pcp-aprovado')?.closest('.kanban-column');
      col?.classList.add('search-expand');              // mostra o painel de busca
      col?.querySelector('.add-search')?.focus();
    };
  }
  await pcpPreencherSaldosDuplos(ul);

}

function pcpBindDescTooltipOnce() {
  if (pcpBindDescTooltipOnce._bound) return;
  pcpBindDescTooltipOnce._bound = true;

  const ul = document.getElementById('listaPecasPCPList');
  if (!ul) return;

  const tip = document.createElement('div');
  tip.className = 'pcp-tip';
  document.body.appendChild(tip);

  let active = null;

  ul.addEventListener('mouseover', (ev) => {
    const d = ev.target.closest('.desc');
    if (!d || !ul.contains(d)) return;
    active = d;
    tip.textContent = d.dataset.full || d.textContent || '';
    tip.classList.add('show');
  });

  ul.addEventListener('mousemove', (ev) => {
    if (!active) return;
    tip.style.left = `${ev.clientX}px`;
    tip.style.top  = `${ev.clientY}px`;
  });

  const hide = () => { active = null; tip.classList.remove('show'); };
  ul.addEventListener('mouseout', (ev) => {
    const to = ev.relatedTarget;
    if (active && (!to || !active.contains(to))) hide();
  });
  document.addEventListener('scroll', hide, true);
}

// depois que você termina de montar a lista:
pcpBindDescTooltipOnce();



// ─── 2) Aplica filtros de código e descrição na lista PCP ───────────
function applyPecasFilterPCP() {
  const container = document.querySelector('#listaPecasPCP .title-wrapper');
  if (!container) return;

  // Evita criar duas vezes os inputs
  if (container.querySelector('#codeFilterPCP')) return;

  const codeFilter = document.createElement('input');
  codeFilter.id = 'codeFilterPCP';
  codeFilter.placeholder = 'Pesquisar código';

/* --- CAMPO "Pesquisar descrição" + ícone Limpar ---------------- */
const descFilter = document.createElement('input');
descFilter.id          = 'descFilterPCP';
descFilter.placeholder = 'Pesquisar descrição';

/* wrapper mantém input e ícone lado-a-lado */
const wrapper = document.createElement('div');
wrapper.className = 'desc-wrapper';
wrapper.appendChild(descFilter);

/* ícone “X” para limpar (a lógica virá depois) */
const clearBtn = document.createElement('button');
clearBtn.type       = 'button';
clearBtn.id         = 'clearFilterPCP';
clearBtn.className  = 'clear-icon';
clearBtn.innerHTML  = '&times;';   // ×
wrapper.appendChild(clearBtn);

clearBtn.addEventListener('click', () => {
  pcpShowAll = !pcpShowAll;                // inverte: true = mostra todos
  clearBtn.classList.toggle('active', pcpShowAll);  // (estilo opcional)
  filtrarPorEstoque();                     // reaplica filtro
});

/* ordem visual: código | descrição+ícone */
container.appendChild(codeFilter);
container.appendChild(wrapper);

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
      e.stopPropagation();         // ← ADICIONE ESTA LINHA
        collapseSearchPanel();      // garante que “+” nunca fique bloqueado

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
export async function initKanban() {
  // mostra spinner se existir (já tinha no seu código)
  if (typeof showSpinner === 'function') showSpinner();

  try {
    // 1) carrega do SQL: só etapa 80
    const resp = await fetch(`${API_BASE}/api/comercial/pedidos/kanban`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();

    // 2) pega apenas a coluna "Pedido aprovado"
    const aprov = (payload?.colunas?.['Pedido aprovado']) || [];

    // 3) adapta cada linha do SQL ao formato do seu renderizador
    //    - 'pedido'  → numero_pedido (fallback: codigo_pedido)
    //    - 'codigo'  → produto_codigo_txt
    //    - 'quantidade' → usa para repetir o status "Pedido aprovado" no array 'local'
    const arr = aprov.map((r) => {
      const qtd = Math.max(1, Number(r.quantidade || 1));
      const local = Array.from({ length: qtd }, () => 'Pedido aprovado'); // p/ (count)

      return {
        pedido     : String(r.numero_pedido || r.codigo_pedido || ''),
        codigo     : String(r.produto_codigo_txt || ''),
        quantidade : qtd,
        estoque    : 0,                   // saldo pode ser atualizado depois, se quiser
        local,                            // usado pelo renderKanbanDesdeJSON p/ (count)
        // campos extras úteis (sem quebrar nada):
        _codigo_pedido : String(r.codigo_pedido || ''),
        _descricao     : String(r.produto_descricao || ''),
        _previsao_br   : r.data_previsao_br || r.data_previsao || null,
        _valor_total   : r.valor_total_pedido || null,
      };
    });

    // 4) cache e render com seus utilitários já existentes
    if (typeof kanbanCache !== 'undefined') kanbanCache = arr;
    renderKanbanDesdeJSON(arr);      // já usa "Pedido aprovado" → "coluna-comercial"
    enableDragAndDrop(arr);          // mantém DnD preparado p/ fase 100/101

    // 5) ganchos auxiliares que você já usa (detalhes, busca, abas…)
    if (typeof attachDoubleClick === 'function') attachDoubleClick(arr, {});
    if (typeof setupAddToggle === 'function') setupAddToggle();
    if (typeof setupProductSearch === 'function') setupProductSearch();
    if (typeof setupTabNavigation === 'function') setupTabNavigation();

  } catch (err) {
    console.error('[KANBAN] Falha ao carregar do SQL:', err);
    alert('Falha ao carregar o Kanban do SQL em /api/comercial/pedidos/kanban.');
  } finally {
    if (typeof hideSpinner === 'function') hideSpinner();
  }
}


async function carregarPosicaoEstoque() {
  try {
    const r = await fetch('/api/armazem/producao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'include'
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();

    const mapSaldo = {};
    (j.dados || []).forEach(it => {
      const k = String(it.codigo || '').toLowerCase();
      const saldo = (typeof it.saldo === 'number') ? it.saldo
                  : (typeof it.fisico === 'number') ? it.fisico
                  : 0;
      mapSaldo[k] = saldo;
    });

    // injeta unidade + (Est: …) nos itens já renderizados
    document.querySelectorAll('#listaPecasPCPList li').forEach(li => {
      const codigo = li.dataset.codigo;
      const qtdEl  = li.querySelector('.qtd') || li;
      const val    = mapSaldo[codigo];

      // unidade (se existir no data attr)
      const un = (li.dataset.unid || '').trim();
      if (un) {
        const spanUn = document.createElement('span');
        spanUn.className = 'unit';
        spanUn.textContent = ` ${un}`;
        qtdEl.appendChild(spanUn);
      }

      // (Est: …)
      const spanEst = document.createElement('span');
      spanEst.className = 'est';
      if (typeof val === 'number') {
        spanEst.textContent = ` (Est: ${val})`;
        if (val < 1) spanEst.style.color = '#e44';
      } else {
        spanEst.textContent = ' (Est: –)';
      }
      qtdEl.appendChild(spanEst);
    });
  } catch (e) {
    console.warn('[PCP] carregarPosicaoEstoque (SQL) falhou:', e);
  }
}


function aplicarMultiplicador (fator) {
  document.querySelectorAll('#listaPecasPCPList li').forEach(li => {
    const base = Number(li.dataset.qtdBase);
    const novo = +(base * fator);                // força número

    /* 1) guarda e exibe a nova quantidade */
    li.dataset.qtd = novo;
    const spanQtd  = li.querySelector('.qtd');
    if (spanQtd) spanQtd.firstChild.nodeValue = `(Qtd: ${novo})`;

        /* —— ajusta a cor / classe do estoque —— */
    const estSpan = li.querySelector('.est');
    if (estSpan) {
      const estValor = Number(
        estSpan.textContent.match(/-?\d+(?:[.,]\d+)?/)[0]
      );
      if (estValor < 1 || estValor < novo) {
        estSpan.classList.add('low');
        estSpan.style.color = '#e44';
      } else {
        estSpan.classList.remove('low');
        estSpan.style.color = '';
      }
    }

    /* 2) recolore o (Est: …) conforme regra */
    const spanEst = li.querySelector('.est');
    if (spanEst) {
      const estVal = Number(spanEst.textContent.match(/[-\d.]+/)[0] || 0);
      if (estVal < 1 || estVal < novo) {
        spanEst.style.color = '#e44';
      } else {
        spanEst.style.color = '';       // volta ao padrão
      }
    }
  });
filtrarPorEstoque();
}

