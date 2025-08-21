// kanban/kanban_preparacao.js

// kanban/kanban_preparacao.js
import config from '../config.client.js';
import { enableDragAndDrop } from './kanban_base.js';


const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

// Mapa de rótulo → id da <ul> correspondente
const PREP_COLUMN_MAP = {
  'A Produzir' : 'coluna-prep-fila',         // era "Fila de produção"
  'Produzindo' : 'coluna-prep-em-producao',  // já existia
  'teste 1'    : 'coluna-prep-estoque',      // substitui "No estoque"
  'teste final': 'coluna-prep-teste-final',  // NOVA
  'concluido'  : 'coluna-prep-concluido'     // NOVA
};




// utilitário id ⇄ nome
const getPrepUlId = name => PREP_COLUMN_MAP[name];




const API_BASE = window.location.origin;   // mesmo host do front-end
let   tipo03Cache   = null;   // ← guarda o array completo
let   tipo03Ready   = null;   // ← Promise que resolve quando o cache estiver pronto
let   _debugReqId   = 0;      // já existia
const IS_LOCALHOST = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);

async function carregarKanbanPreparacao () {
  // localhost => usa JSON local; Render => usa SQL (sem fallback para JSON)
  if (IS_LOCALHOST) {
    // JSON local servido pelo backend (lê data/kanban_preparacao.json)
    const r = await fetch(`${API_BASE}/api/kanban_preparacao`, { cache: 'no-store' });
    if (!r.ok) return [];
    const arr = await r.json();
    return Array.isArray(arr) ? arr : [];
  }

  // PRODUÇÃO/Render => SQL
// PRODUÇÃO/Render => SQL
const r = await fetch('/api/preparacao/listar', { cache: 'no-store' });
if (!r.ok) throw new Error(`HTTP ${r.status}`);
const j = await r.json();

/* Esperado (novo): { mode:'pg', data:{ 'A Produzir':[], 'Produzindo':[], 'teste 1':[], 'teste final':[], 'concluido':[] } }
   Ainda assim, tornamos robusto a nomes/chaves. */
if (j && j.mode === 'pg' && j.data) {
  const perProd = new Map();
  const colunas = Object.keys(j.data); // usa o que o servidor mandar

  colunas.forEach(st => {
    (j.data[st] || []).forEach(it => {
      const codigo = it.produto || it.produto_codigo || it.codigo;
      if (!codigo) return;
      const arr = perProd.get(codigo) || [];
      arr.push(`${st},${it.op || ''}`); // "Status,OP"
      perProd.set(codigo, arr);
    });
  });

  return [...perProd.entries()].map(([codigo, local]) => ({
    pedido: 'Estoque',
    codigo,
    local
  }));
}
  return [];
}





function renderKanbanPreparacao (items) {
  // 1) limpa as três colunas
  Object.values(PREP_COLUMN_MAP).forEach(id => {
    const ul = document.getElementById(id);
    if (ul) ul.innerHTML = '';
  });

  // 2) cria os cartões
  items.forEach((item, index) => {
    const counts = item.local.reduce((acc, raw) => {
      const col = raw.split(',')[0];        // nome da coluna
      acc[col] = (acc[col] || 0) + 1;
      return acc;
    }, {});

    Object.entries(counts).forEach(([columnName, qt]) => {
      const ulId = getPrepUlId(columnName);
      const ul   = document.getElementById(ulId);
      if (!ul) return;

      const li = document.createElement('li');
      li.textContent      = `${item.pedido} – ${item.codigo} (${qt})`;
      li.classList.add('kanban-card');
      li.setAttribute('draggable', 'true');
      li.dataset.index    = index;
      li.dataset.column   = columnName;
      li.dataset.codigo   = item.codigo;   // <-- facilita o clique nas duas colunas
      ul.appendChild(li);
    });
  });
}


// Busca primeiro no cache global carregado pelo módulo ListarProdutos
function searchInCache(term) {
  if (!window.__omieFullCache) return null;          // ainda não carregou
  const q = term.toLowerCase();
  return window.__omieFullCache.filter(p =>
    p.codigo.toLowerCase().includes(q) ||
    (p.descricao || '').toLowerCase().includes(q)
  );
}

// ———————————————————————————————————————————————
// Baixa TODOS os produtos tipo 03 em uma única chamada
// ———————————————————————————————————————————————
async function buildTipo03Cache() {
  if (tipo03Ready) return tipo03Ready;        // já em andamento / pronto

  tipo03Ready = (async () => {
    _debugReqId += 1;
    const rid = _debugReqId;
    console.groupCollapsed(`[Tipo03] Req #${rid} (descobrir total)`);

    /* 1) Descobre quantos registros existem  -------------------------- */
    const firstPayload = {
      call : 'ListarProdutosResumido',
      param: [{
        pagina: 1,
        registros_por_pagina: 1,
        apenas_importado_api : 'N',
        filtrar_apenas_omiepdv: 'N',
        filtrar_apenas_tipo  : '03'
      }],
      app_key   : OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };

    const firstResp = await fetch(`${API_BASE}/api/omie/produtos`, {
      method      : 'POST',
      credentials : 'include',
      headers     : { 'Content-Type': 'application/json' },
      body        : JSON.stringify(firstPayload)
    });

    if (!firstResp.ok) {
      console.error(`[Tipo03] primeira chamada falhou (${firstResp.status})`);
      throw new Error(`HTTP ${firstResp.status}`);
    }

    const firstJson = await firstResp.json();
    const total = firstJson.total_de_registros;
    console.log(`[Tipo03] total_de_registros = ${total}`);

    /* 2) Busca todos de uma vez -------------------------------------- */
    const fullPayload = {
      ...firstPayload,
      param: [{
        ...firstPayload.param[0],
        registros_por_pagina: total           // uma única página
      }]
    };

    const fullResp = await fetch(`${API_BASE}/api/omie/produtos`, {
      method      : 'POST',
      credentials : 'include',
      headers     : { 'Content-Type': 'application/json' },
      body        : JSON.stringify(fullPayload)
    });

    if (!fullResp.ok) {
      console.error(`[Tipo03] download completo falhou (${fullResp.status})`);
      throw new Error(`HTTP ${fullResp.status}`);
    }

    const fullJson = await fullResp.json();
    tipo03Cache = Array.isArray(fullJson.produto_servico_resumido)
      ? fullJson.produto_servico_resumido
      : [];

    console.log(`[Tipo03] cache pronto – itens:`, tipo03Cache.length);
    console.groupEnd();
    return tipo03Cache;
  })();

  return tipo03Ready;
}

function renderSearchResults(items, container) {
  container.innerHTML = '';
  items.forEach(p => {
    const li = document.createElement('li');
    li.className       = 'result-item';
    li.textContent     = `${p.codigo} — ${p.descricao}`;
    li.dataset.codigo  = p.codigo;      // só o código!
    li.dataset.desc    = p.descricao;
    container.appendChild(li);
  });
}



function setupProductSearchByUl(ulId) {
  const ul = document.getElementById(ulId);
  if (!ul) return;                             // coluna nem existe

  const col   = ul.closest('.kanban-column');
  if (!col) return;

  const input = col.querySelector('.add-search');
  const list  = col.querySelector('.add-results');

  // ⚠️ Página sem UI de busca? Não faz nada.
  if (!input || !list) return;

  let debounceId;

  input.addEventListener('input', () => {
    clearTimeout(debounceId);
    const q = input.value.trim().toLowerCase();
    if (q.length < 3) { list.innerHTML = ''; return; }

    debounceId = setTimeout(async () => {
      list.innerHTML = '<li>Carregando catálogo…</li>';
      try {
        await buildTipo03Cache();
        const resultados = tipo03Cache
          .filter(p =>
            p.codigo.toLowerCase().includes(q) ||
            (p.descricao || '').toLowerCase().includes(q)
          )
          .sort((a, b) => a.codigo.localeCompare(b.codigo));

        renderSearchResults(resultados, list);
      } catch (err) {
        list.innerHTML = `<li class="error">Erro: ${err.message}</li>`;
      }
    }, 300);
  });

  list.addEventListener('click', e => {
    const li = e.target.closest('.result-item');
    if (!li) return;

    window.prepCodigoSelecionado = li.dataset.codigo;
    document
      .querySelector('#kanbanTabs .main-header-link[data-kanban-tab="pcp"]')
      ?.click();

    setTimeout(() => {
      if (typeof renderListaPecasPCP === 'function') renderListaPecasPCP();
    }, 80);

    input.value   = `${li.dataset.codigo} — ${li.dataset.desc}`;
    list.innerHTML = '';
  });
}






// Apenas estrutura inicial – lógica virá depois
export async function initPreparacaoKanban() {
  // limpar TODAS as colunas declaradas no mapa
  Object.values(PREP_COLUMN_MAP)
    .forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });

  const cached = await carregarKanbanPreparacao();
  if (cached.length) {
    renderKanbanPreparacao(cached);
    enableDragAndDrop?.(cached);
  }

  setupAddToggleSolicitar();
  setupProductSearchByUl('coluna-prep-fila');
}



/* ——— listeners locais do “+” (Solicitar produção) ——— */
document.addEventListener('click', e => {
  if (!e.target.classList.contains('add-btn')) return;
  const coluna = e.target.closest('.kanban-column');
  const container = coluna.querySelector('.add-container');
  container.classList.toggle('open');
});


function setupAddToggleSolicitar() {
  const colElem = document.getElementById('coluna-prep-fila');
  if (!colElem) return;

  const col   = colElem.closest('.kanban-column');
  if (!col) return;

  const btn   = col.querySelector('.add-btn');
  const input = col.querySelector('.add-search');

  // ⚠️ Se a página não tem botão/campo, não arma o toggle.
  if (!btn || !input) return;

  btn.addEventListener('click', () => {
    collapseSearchPanel?.();               // ok se não existir
    col.classList.toggle('search-expand');
    if (col.classList.contains('search-expand')) {
      setTimeout(() => input.focus(), 100);
      buildTipo03Cache().catch(err =>
        console.error('[Tipo03] falha ao construir cache:', err)
      );
    }
  });
}

