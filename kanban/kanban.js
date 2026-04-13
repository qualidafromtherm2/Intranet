// kanban.js  (substitua todo o arquivo)

import {
  renderKanbanDesdeJSON,
  salvarKanbanLocal,
  gerarEtiqueta,
  gerarEtiquetaPP,
  gerarEtiquetaObs,
  gerarEtiquetaSeparacao,
  gerarTicket,
  openPcpForCodigo
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
    attachModalTriggers(kanbanCache);
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

const pad2 = (n) => String(n).padStart(2, '0');

const normalizeStageValue = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

function parseDateTimeParts(value) {
  if (!value) return null;

  const fromDate = (d) => {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    return {
      date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      hour: pad2(d.getHours()),
      minute: pad2(d.getMinutes()),
      second: pad2(d.getSeconds())
    };
  };

  if (value instanceof Date) {
    return fromDate(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const dt = new Date(raw);
    const parsed = fromDate(dt);
    if (parsed) return parsed;
  }

  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return {
      date: match[1],
      hour: match[2],
      minute: match[3],
      second: match[4] || '00'
    };
  }

  const onlyDate = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (onlyDate) {
    return {
      date: onlyDate[1],
      hour: '00',
      minute: '00',
      second: '00'
    };
  }

  return null;
}

function serializeLocalDateTime(value) {
  const parts = parseDateTimeParts(value);
  if (!parts) return null;
  return `${parts.date}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function displayStageLabel(dataImpressao, etapa) {
  const etapaNorm = normalizeStageValue(etapa);
  if (etapaNorm === 'produzindo') return 'Produzindo';
  if (etapaNorm === 'excluido') return 'Excluído';
  const parts = parseDateTimeParts(dataImpressao);
  if (!parts) return '—';
  const [yyyy, mm, dd] = parts.date.split('-');
  return `${dd}/${mm}/${yyyy} ${parts.hour}:${parts.minute}`;
}


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


/* [COMERCIAL] Toggle do painel de busca agora vive na coluna "Pedido aprovado" (ul#coluna-comercial) */
function setupAddToggle() {
  const colElem = document.getElementById('coluna-comercial'); // antes: 'coluna-pcp-aprovado'
  if (!colElem) return;

  const col = colElem.closest('.kanban-column');
  if (!col) return;

  const btn     = col.querySelector('.add-btn');
  const input   = col.querySelector('.add-search');
  const results = col.querySelector('.add-results');

  if (!btn || !input || !results) return;

  btn.addEventListener('click', async () => {
    col.classList.toggle('search-expand');
    if (!col.classList.contains('search-expand')) return;
    setTimeout(() => input.focus(), 100);
    results.innerHTML = ''; // limpa a lista ao abrir
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
// abre PCP com o código certo (atualiza header + carrega lista SQL)
window.PCP?.open(p.codigo);

});


  });
}
/* [COMERCIAL] Autocomplete do painel de busca — agora abre a PCP do código clicado */
function setupProductSearch() {
  // âncora: cabeçalho da coluna "Pedido aprovado"
  const col = document.getElementById('coluna-comercial')?.closest('.kanban-column');
  if (!col) {
    console.warn('[KANBAN] Coluna "Pedido aprovado" (#coluna-comercial) não encontrada.');
    return;
  }

  const input   = col.querySelector('.add-search');
  const results = col.querySelector('.add-results');
  if (!input || !results) {
    console.warn('[KANBAN] Markup .add-search / .add-results ausente na coluna Comercial.');
    return;
  }

  // evita bind duplicado (SSE/reloads)
  if (input.dataset.autocompleteBound === '1') return;
  input.dataset.autocompleteBound = '1';

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
        const url  = `/api/produtos/search?q=${encodeURIComponent(term)}&limit=40`;
        const resp = await fetch(url, { credentials: 'include' });
        const json = await resp.json();
        const items = json?.data || [];

        results.innerHTML = '';
        items.forEach(p => {
          const li = document.createElement('li');
          li.classList.add('result-item');
          li.textContent = `${p.codigo} — ${p.descricao}`;

          li.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();

            // feedback no input
            input.value = `${p.codigo} — ${p.descricao}`;

            // fecha o painel de busca
            results.innerHTML = '';
            col.classList.remove('search-expand');

            // caminho único: seta código e carrega a estrutura via SQL
            // (isso já troca a aba pra PCP e roda ensurePCPEstruturaAutoLoad)
            window.PCP?.open(p.codigo);
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
function _pcpResolveCodigoAtual() {
  // fonte única de verdade: quem clicou (Comercial/Preparação) já setou isto
  return String(window.pcpCodigoAtual || '').trim();
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

// ─── 1) Renderiza a Lista de Peças na aba PCP ────────────────────────
// Constrói as linhas em grade + adiciona o botão "Estrutura" que expande a sub-lista
async function renderListaPecasPCP() {
  console.log('[PCP] → renderListaPecasPCP() começou');

  // 1) UL da lista
  const ul = document.getElementById('listaPecasPCPList');
  if (!ul) { console.warn('[PCP] UL não encontrada'); return; }

  // 2) pega o código atual no campo de busca da coluna PCP
    // 2) pega o código atual no campo de busca (agora na coluna Comercial)
  const col = document.getElementById('coluna-comercial')?.closest('.kanban-column'); // antes: 'coluna-pcp-aprovado'
  const input = col?.querySelector('.add-search');
  if (!input) { console.warn('[PCP] input .add-search não encontrado'); return; }

  const raw = input.value;
  const codigo = raw.split('—')[0]?.trim();
  if (!codigo) { console.warn('[PCP] Sem código válido'); return; }

  // 3) consulta sua estrutura (proxy OMIE)
  const resp = await fetch(`${API_BASE}/api/omie/estrutura`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ param: [{ codProduto: codigo }] })
  });

  let data;
  try { data = await resp.json(); } catch (err) {
    console.error('[PCP] Erro ao ler JSON:', err);
    return;
  }

  // 4) normaliza a coleção
  const pecas = data.itens || data.pecas || [];

  // 5) helpers locais
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const num = v => (v ?? 0).toLocaleString('pt-BR');

  // 6) desenha cabeçalho (mantém suas mesmas colunas)
  ul.innerHTML = '';
  const header = document.createElement('li');
  header.className = 'header-row';
  header.innerHTML = `
    <div>Código</div>
    <div>Descrição</div>
    <div>Unid</div>
    <div>Qtd</div>
    <div>Qtd prod</div>
    <div>Qtd Pro</div>
    <div>Qtd Alm</div>
    <div>Ação</div>`;
  ul.appendChild(header);

  // 7) linhas
  pecas.forEach(p => {
    const li = document.createElement('li');
    li.className = 'content-item';
    li.dataset.codigo    = (p.codProdMalha || '').toLowerCase();
    li.dataset.descricao = (p.descrProdMalha || '').toLowerCase();

    li.innerHTML = `
      <div class="cod">${esc(p.codProdMalha)}</div>
      <div class="desc" title="${esc(p.descrProdMalha)}">${esc(p.descrProdMalha)}</div>
      <div class="unid">${esc(p.unidade || p.unid || '')}</div>
      <div class="qtd">${num(p.quantProdMalha)}</div>
      <div class="qtdprod">${num(p.qtdProd || 0)}</div>
      <div class="qtdpro">${num(p.qtdPro || 0)}</div>
      <div class="qtdalm">${num(p.qtdAlm || p.estoque || 0)}</div>
      <div class="acoes">
        <!-- terceiro botão: Estrutura -->
        <button class="icon-btn btn-estrutura" data-action="estrutura" title="Mostrar estrutura do item" aria-label="Mostrar estrutura">
          <svg class="i" viewBox="0 0 24 24" width="18" height="18">
            <path d="M6 3h12v4H6zM12 7v4M4 13h8v4H4zM12 13h8v4h-8z" stroke-width="1.6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `;
    ul.appendChild(li);
  });

  // 8) registra (uma única vez) o delegate para abrir/fechar a sub-estrutura
  if (!ul.dataset.estruturaListener) {
    ul.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-estrutura');
      if (!btn) return;

      const row = btn.closest('li');
      const codigo = row.querySelector('.cod')?.textContent.trim();
      if (!codigo) return;

      await toggleEstruturaPCP(row, codigo);
    });
    ul.dataset.estruturaListener = '1';
  }

  console.log('[PCP] UL populada com grade + botão Estrutura');
}

// Expande/colapsa a sub-lista com a estrutura do item clicado.
// Usa o MESMO endpoint/payload da guia “Estrutura de produto”.
async function toggleEstruturaPCP(rowLi, codProduto) {
  // se já estiver aberta: fecha
  const maybe = rowLi.nextElementSibling;
  if (maybe && maybe.classList.contains('sub-estrutura-row')) {
    maybe.remove();
    return;
  }

  // busca itens da malha
  let itens = [];
  try {
    const r = await fetch(`${API_BASE}/api/malha`, {
      method : 'POST',
      headers: { 'Content-Type':'application/json' },
      body   : JSON.stringify({ intProduto: codProduto }) // igual à página Estrutura
    });
    const j = await r.json();
    itens = Array.isArray(j?.itens) ? j.itens : [];
  } catch (err) {
    console.error('[PCP] Erro /api/malha:', err);
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const num = v => (v ?? 0).toLocaleString('pt-BR');

  // constrói a linha “sub-estrutura” logo abaixo da linha clicada
  const wrap = document.createElement('li');
  wrap.className = 'sub-estrutura-row';
  wrap.innerHTML = `
    <div class="sub-estrutura">
      <div class="sub-title">Estrutura de ${esc(codProduto)}</div>
      <ul class="malha-sub">
        ${itens.map(it => `
          <li class="child-row">
            <div class="cod">${esc(it.codProdMalha || it.intMalha || '')}</div>
            <div class="desc" title="${esc(it.descrProdMalha || '')}">${esc(it.descrProdMalha || '')}</div>
            <div class="unidade">${esc(it.unidade || it.unid || '')}</div>
            <div class="qtd">${num(it.quantProdMalha)}</div>
            <div class="custo-real">${num(it.custoReal || 0)}</div>
            <div class="acoes"></div>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
  rowLi.after(wrap);
}



window.renderListaPecasPCP = renderListaPecasPCP;

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
  console.log('[TAB] Aba selecionada — pcp');
  // nada de auto-render aqui; quem chamou a aba (Comercial/Preparação)
  // já cuidou de setar o código e chamar ensurePCPEstruturaAutoLoad(cod)
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
        param: [{ numero_pedido: numeroPedido }],
        source: 'kanban/kanban.js:dblclick-detalhes'
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
  window.__kanbanExcluidosRaw = [];
  window.__kanbanExcluidosGrouped = [];

  try {
    // 1) carrega do SQL: só etapa 80
    const resp = await fetch(`${API_BASE}/api/comercial/pedidos/kanban`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();

    const aprovadosRaw = (payload?.colunas?.['Pedido aprovado']) || [];
    const aguardandoRaw = (payload?.colunas?.['Aguardando prazo']) || [];
    const filaRaw       = (payload?.colunas?.['Fila de produção'])   || [];

    const { cards: aprovCards, map: pedidosMap } = buildPedidoCards(aprovadosRaw);
    const aguardCards   = buildGroupedCards(aguardandoRaw, 'Aguardando prazo', false, pedidosMap);
    const filaCards     = buildGroupedCards(filaRaw, 'Fila de produção', true, pedidosMap);
    const excluidosRaw  = (payload?.colunas?.['Excluido']) || [];
    const excluidosCards = buildGroupedCards(excluidosRaw, 'Excluido', true, pedidosMap);

    const arr = [...aprovCards, ...aguardCards, ...filaCards];

    // cache e render
    if (typeof kanbanCache !== 'undefined') kanbanCache = arr;
    renderKanbanDesdeJSON(arr);
    attachModalTriggers(arr);
    window.__kanbanExcluidosRaw = excluidosRaw;
    window.__kanbanExcluidosGrouped = excluidosCards;

    // 5) ganchos auxiliares que você já usa (detalhes, busca, abas…)
    if (typeof attachDoubleClick === 'function') attachDoubleClick(arr, {});
    if (typeof setupAddToggle === 'function') setupAddToggle();
    if (typeof setupProductSearch === 'function') setupProductSearch();
    if (typeof setupTabNavigation === 'function') setupTabNavigation();

  } catch (err) {
    console.error('[KANBAN] Falha ao carregar do SQL:', err);
    alert('Falha ao carregar o Kanban do SQL em /api/comercial/pedidos/kanban.');
  } finally {
    setupExcludedButton();
    if (typeof hideSpinner === 'function') hideSpinner();
  }
}

function buildGroupedCards(registros, colunaNome, incluirDatas = false, pedidosMap = window.__kanbanPedidosMap || new Map()) {
  const map = new Map();

  registros.forEach(r => {
    const rawLocal = String(r.local_impressao || 'Sem local').trim() || 'Sem local';
    const keyLocal = rawLocal.toUpperCase();
    if (!map.has(keyLocal)) {
      map.set(keyLocal, {
        aguardandoPrazo      : colunaNome === 'Aguardando prazo',
        local_impressao      : keyLocal,
        local_impressao_label: rawLocal,
        quantidade           : 0,
        local                : [],
        gruposMap            : new Map()
      });
    }
    const entry = map.get(keyLocal);

    const rawCodigo = String(r.codigo_produto || '').trim() || 'Sem código';
    const keyCodigo = rawCodigo.toUpperCase();
    if (!entry.gruposMap.has(keyCodigo)) {
      const pedidoInfo = pedidosMap?.get?.(keyCodigo) || pedidosMap?.get?.(rawCodigo) || null;
      entry.gruposMap.set(keyCodigo, {
        codigo     : rawCodigo,
        quantidade : 0,
        ops        : [],
        pedidos    : Array.isArray(pedidoInfo?.pedidos)
          ? pedidoInfo.pedidos.map(p => ({
              numero_pedido    : String(p.numero_pedido || '').trim(),
              quantidade       : Number(p.quantidade || 0) || 0,
              numero_cliente   : p.numero_cliente || null,
              data_previsao_br : p.data_previsao_br || null
            }))
          : []
      });
    }
    const grupo = entry.gruposMap.get(keyCodigo);

    const numeroOp = String(r.numero_op || '').trim();
    const etapaRaw = String(r.etapa || '').trim();
    const etapaNormalized = normalizeStageValue(etapaRaw);
    if (etapaNormalized === 'excluido' && colunaNome !== 'Excluido') {
      return;
    }
    const dataImpressao = serializeLocalDateTime(r.data_impressao);

    grupo.ops.push({
      numero_op      : numeroOp || rawCodigo,
      etiqueta_id    : r.id ?? null,
      data_impressao : dataImpressao,
      etapa          : etapaRaw,
      local_impressao: entry.local_impressao_label,
      usuario        : r.usuario_criacao || null
    });
    grupo.quantidade += 1;
    entry.quantidade += 1;
  });

  return Array.from(map.values()).map(entry => ({
    aguardandoPrazo : entry.aguardandoPrazo,
    local_impressao : entry.local_impressao,
    local_impressao_label: entry.local_impressao_label,
    quantidade      : entry.quantidade,
    codigo          : '',
    pedido          : entry.local_impressao_label,
    local           : Array.from({ length: entry.quantidade }, () => colunaNome),
    grupos          : Array.from(entry.gruposMap.values()).sort((a, b) =>
      (a.codigo || '').localeCompare(b.codigo || '')
    )
  })).sort((a, b) => (a.local_impressao || '').localeCompare(b.local_impressao || ''));
}

function buildPedidoCards(registros = []) {
  const map = new Map();

  registros.forEach(r => {
    const codigo = String(r.produto_codigo || '').trim() || 'Sem código';
    const key = codigo.toUpperCase();
    if (!map.has(key)) {
      map.set(key, {
        coluna           : 'Pedido aprovado',
        aguardandoPrazo  : false,
        codigo,
        descricao        : String(r.produto_descricao || '').trim() || null,
        unidade          : String(r.unidade || '').trim() || null,
        totalQuantidade  : 0,
        pedidos          : [],
        local            : [],
        grupos           : []
      });
    }
    const entry = map.get(key);
    const qtd = Number(r.quantidade || 0) || 0;
    entry.totalQuantidade += qtd;
    entry.local.push('Pedido aprovado');
    entry.pedidos.push({
      numero_pedido: String(r.numero_pedido || '').trim(),
      quantidade: qtd,
      numero_cliente: String(r.numero_pedido_cliente || '').trim() || null,
      data_previsao_br: r.data_previsao_br || null
    });
  });

  const cards = Array.from(map.values()).map(entry => ({
    coluna           : 'Pedido aprovado',
    aguardandoPrazo  : false,
    codigo           : entry.codigo,
    descricao        : entry.descricao,
    unidade          : entry.unidade,
    quantidade       : entry.totalQuantidade,
    local            : entry.local,
    pedidos          : entry.pedidos
  })).sort((a, b) => a.codigo.localeCompare(b.codigo));

  if (typeof window !== 'undefined') {
    window.__kanbanPedidosMap = map;
  }

  return { cards, map };
}

function attachModalTriggers(itemsKanban) {
  document.querySelectorAll('.kanban-modal-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.kanban-card');
      const localKey = (card?.dataset.localImpressao || '').toUpperCase();
      const localLabel = btn.dataset.local || card?.dataset.localImpressao || 'Sem local';
      const codigo = btn.dataset.codigo || 'Sem código';
      const column = btn.dataset.coluna || card?.dataset.column || 'Aguardando prazo';
      const item = itemsKanban.find(it =>
        it.local_impressao === localKey && Array.isArray(it.local) && it.local.includes(column)
      );
      if (!item) return;
      const grupo = (item.grupos || []).find(g => g.codigo === codigo);
      if (!grupo) return;
      openOpsModal({ localLabel, codigo, grupo, column });
    });
  });

  document.querySelectorAll('.kanban-stock-trigger').forEach(btn => {
    if (btn.dataset.stockBound === '1') return;
    btn.dataset.stockBound = '1';
    btn.addEventListener('click', async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const codigo = btn.dataset.codigo || '';
      const pedido = btn.dataset.pedido || '';
      try {
        await openPcpForCodigo({ codigo, pedido });
      } catch (err) {
        console.error('[KANBAN] falha ao consultar estoque:', err);
      }
    });
  });
}

window.attachModalTriggers = attachModalTriggers;

function setupExcludedButton() {
  const btn = document.getElementById('btn-listar-excluidos');
  if (!btn || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => {
    openExcludedModal();
  });
}

function openOpsModal({ localLabel, codigo, grupo, column }) {
  closeOpsModal();

  const esc = (val) => String(val ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch] || ch));

  const overlay = document.createElement('div');
  overlay.className = 'kanban-modal-overlay';
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeOpsModal();
  });

  const modal = document.createElement('div');
  modal.className = 'kanban-modal';
  modal.innerHTML = `
    <header>
      <div>
        <h2>${localLabel}</h2>
        <span>${codigo}</span>
      </div>
      <button class="close-btn" aria-label="Fechar">&times;</button>
    </header>
    <div class="kanban-modal-body"></div>
    <footer>
      <button type="button" class="modal-secondary">Cancelar</button>
      <button type="button" class="modal-primary">Salvar</button>
    </footer>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.querySelector('.close-btn').addEventListener('click', closeOpsModal);
  modal.querySelector('.modal-secondary').addEventListener('click', closeOpsModal);

  const body = modal.querySelector('.kanban-modal-body');
  const block = document.createElement('div');
  block.className = 'modal-code-block';
  block.innerHTML = `
    <div class="modal-code-header">
      <span>${grupo.codigo}</span>
      <span>${grupo.quantidade || grupo.ops.length} OP(s)</span>
    </div>
  `;

  const pedidos = Array.isArray(grupo.pedidos) ? grupo.pedidos.filter(p => p && (p.numero_pedido || p.quantidade)) : [];
  if (pedidos.length) {
    const sanitized = String(codigo || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
    const selectId = `modal-orders-${sanitized}`;
    const size = Math.min(pedidos.length, 8);
    const optionsHtml = pedidos.map(p => {
      const pedNum = esc(p.numero_pedido || '—');
      const qty = esc(p.quantidade ?? 0);
      const cliente = p.numero_cliente ? ` • Cliente ${esc(p.numero_cliente)}` : '';
      const previsao = p.data_previsao_br ? ` • Prev ${esc(p.data_previsao_br)}` : '';
      const label = `Pedido ${pedNum} • Qtd ${qty}${cliente}${previsao}`;
      return `<option value="${pedNum}">${label}</option>`;
    }).join('');

    const ordersWrapper = document.createElement('div');
    ordersWrapper.className = 'modal-orders';
    ordersWrapper.innerHTML = `
      <label for="${selectId}">Pedidos relacionados</label>
      <select id="${selectId}" size="${size}">
        ${optionsHtml}
      </select>
    `;
    block.appendChild(ordersWrapper);
  }

  const form = document.createElement('div');
  grupo.ops.forEach(op => {
    const row = document.createElement('div');
    row.className = 'op-row';
    const inputId = `op-date-${op.numero_op}`;
    const timeId  = `op-time-${op.numero_op}`;
    const dateValue = formatDateInput(op.data_impressao);
    const timeValue = formatTimeInput(op.data_impressao);
    row.innerHTML = `
      <strong>${op.numero_op}</strong>
      <div class="op-inputs">
        <input type="date" id="${inputId}" value="${dateValue}" />
        <input type="time" id="${timeId}" value="${timeValue}" />
      </div>
      <button type="button"
              class="op-excluir"
              data-op="${op.numero_op}"
              title="Marcar como excluída"
              aria-label="Marcar OP ${op.numero_op} como excluída">
        <i class="fas fa-trash" aria-hidden="true"></i>
      </button>
    `;
    form.appendChild(row);
  });
  block.appendChild(form);
  body.appendChild(block);

  form.querySelectorAll('.op-excluir').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const numeroOp = btn.dataset.op;
      if (!numeroOp) return;
      const confirmacao = confirm(`Marcar a OP ${numeroOp} como Excluída?`);
      if (!confirmacao) return;
      btn.disabled = true;
      try {
        await setOpEtapa(numeroOp, 'Excluido', grupo.codigo);
        closeOpsModal();
        await initKanban();
      } catch (err) {
        console.error('[KANBAN] excluir OP', err);
        alert('Falha ao marcar a OP como excluída.');
        btn.disabled = false;
      }
    });
  });

  modal.querySelector('.modal-primary').addEventListener('click', async () => {
    try {
      const updates = grupo.ops.map(op => {
        const dateInput = modal.querySelector(`input[id="op-date-${op.numero_op}"]`);
        const timeInput = modal.querySelector(`input[id="op-time-${op.numero_op}"]`);
        const iso = combineDateTime(dateInput?.value || '', timeInput?.value || defaultTime());
        const targetColumn = (!iso) ? 'Aguardando prazo' : 'Fila de produção';
        return { numero_op: op.numero_op, data_impressao: iso, coluna: targetColumn };
      });
      await salvarDatasImpressao(updates);
      if (typeof closeOpsModal === 'function') closeOpsModal();
      await initKanban();
    } catch (err) {
      console.error('[KANBAN] salvar datas', err);
      alert('Falha ao salvar as datas das OPs.');
    }
  });
}

function closeOpsModal() {
  document.querySelectorAll('.kanban-modal-overlay')
    .forEach(el => el.remove());
}

function openExcludedModal() {
  closeOpsModal();
  const grupos = Array.isArray(window.__kanbanExcluidosGrouped)
    ? window.__kanbanExcluidosGrouped
    : [];

  if (!grupos.length) {
    alert('Nenhuma OP marcada como excluída.');
    return;
  }

  const esc = (val) => String(val ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch] || ch));

  const overlay = document.createElement('div');
  overlay.className = 'kanban-modal-overlay';
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeOpsModal();
  });

  const modal = document.createElement('div');
  modal.className = 'kanban-modal';
  modal.innerHTML = `
    <header>
      <div>
        <h2>OPs excluídas</h2>
        <span>Visualização</span>
      </div>
      <button class="close-btn" aria-label="Fechar">&times;</button>
    </header>
    <div class="kanban-modal-body"></div>
    <footer>
      <button type="button" class="modal-primary">Fechar</button>
    </footer>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.querySelector('.close-btn').addEventListener('click', closeOpsModal);
  modal.querySelector('.modal-primary').addEventListener('click', closeOpsModal);

  const body = modal.querySelector('.kanban-modal-body');
  grupos.forEach(entry => {
    const localLabel = entry.local_impressao_label || entry.local_impressao || 'Sem local';
    (entry.grupos || []).forEach(grupo => {
      const block = document.createElement('div');
      block.className = 'modal-code-block';
      block.innerHTML = `
        <div class="modal-code-header">
          <span>${esc(grupo.codigo || 'Sem código')}</span>
          <span>${grupo.quantidade || grupo.ops.length} OP(s) • ${esc(localLabel)}</span>
        </div>
      `;

      const list = document.createElement('div');
      list.className = 'kanban-op-list';
      list.innerHTML = (grupo.ops || []).map(op => {
        const rawOp = String(op.numero_op || '');
        const opCode = esc(rawOp);
        const etapaLabel = displayStageLabel(op.data_impressao, op.etapa);
        const etapaText = esc(etapaLabel);
        const codigoAttr = encodeURIComponent(String(grupo.codigo || ''));
        const opAttr = encodeURIComponent(rawOp);
        return `
          <div class="kanban-op-line excluded-op-line">
            <div class="excluded-op-info">
              <span class="op-code">${opCode}</span>
              <span class="kanban-op-date">${etapaText}</span>
            </div>
            <button type="button"
                    class="op-reativar"
                    data-op="${opAttr}"
                    data-codigo="${codigoAttr}"
                    title="Reativar OP ${opCode}">
              <i class="fas fa-undo" aria-hidden="true"></i>
              <span>Reativar</span>
            </button>
          </div>
        `;
      }).join('');

      block.appendChild(list);
      body.appendChild(block);
    });
  });

  body.querySelectorAll('.op-reativar').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const numeroOp = decodeURIComponent(btn.dataset.op || '');
      const produtoCodigo = btn.dataset.codigo ? decodeURIComponent(btn.dataset.codigo) : null;
      if (!numeroOp) return;
      const confirmar = confirm(`Reativar a OP ${numeroOp}?`);
      if (!confirmar) return;
      btn.disabled = true;
      try {
        await reactivateOp(numeroOp, produtoCodigo);
        closeOpsModal();
        await initKanban();
      } catch (err) {
        console.error('[KANBAN] reativar OP', err);
        alert('Falha ao reativar a OP.');
        btn.disabled = false;
      }
    });
  });
}

function formatDateInput(value) {
  const parts = parseDateTimeParts(value);
  return parts ? parts.date : '';
}

async function salvarDatasImpressao(atualizacoes = []) {
  const resp = await fetch(`${API_BASE}/api/etiquetas/aguardando/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ itens: atualizacoes })
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp.json();
}

function formatTimeInput(value) {
  if (!value) return defaultTime();
  const parts = parseDateTimeParts(value);
  if (!parts) return defaultTime();
  return `${parts.hour}:${parts.minute}`;
}

function combineDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const hora = timeStr || defaultTime();
  return `${dateStr}T${hora}:00`;
}

async function setOpEtapa(numeroOp, etapa, produtoCodigo = null) {
  const payload = { etapa };
  if (produtoCodigo && produtoCodigo !== 'Sem código') {
    payload.produto_codigo = produtoCodigo;
  }
  const resp = await fetch(`${API_BASE}/api/etiquetas/op/${encodeURIComponent(numeroOp)}/etapa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${txt}`);
  }
  return resp.json();
}

async function reactivateOp(numeroOp, produtoCodigo = null) {
  const payload = {};
  if (produtoCodigo && produtoCodigo !== 'Sem código') {
    payload.produto_codigo = produtoCodigo;
  }
  const resp = await fetch(`${API_BASE}/api/etiquetas/op/${encodeURIComponent(numeroOp)}/reativar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${txt}`);
  }
  return resp.json();
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
function defaultTime() {
  return '17:30';
}
