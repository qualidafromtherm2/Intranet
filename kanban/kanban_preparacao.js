// kanban/kanban_preparacao.js

// kanban/kanban_preparacao.js
import config from '../config.client.js';
import { enableDragAndDrop } from './kanban_base.js';

const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

const PREP_COLUMN_MAP = {
  'Fila de produção': 'coluna-prep-fila',
  'Em produção'     : 'coluna-prep-em-producao',
  'No estoque'      : 'coluna-prep-estoque',
};



// utilitário id ⇄ nome
const getPrepUlId = name => PREP_COLUMN_MAP[name];




const API_BASE = window.location.origin;   // mesmo host do front-end
let   tipo03Cache   = null;   // ← guarda o array completo
let   tipo03Ready   = null;   // ← Promise que resolve quando o cache estiver pronto
let   _debugReqId   = 0;      // já existia


async function carregarKanbanPreparacao () {
  try {
    const resp = await fetch(`${API_BASE}/api/kanban_preparacao`);
    if (!resp.ok) {
      console.warn('GET /api/kanban_preparacao →', resp.status);
      return [];
    }
    const json = await resp.json();
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.error('Falha ao carregar kanban_preparacao:', err);
    return [];
  }
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
  const ul    = document.getElementById(ulId);
  if (!ul) return;
  const col   = ul.closest('.kanban-column');
  const input = col.querySelector('.add-search');
  const list  = col.querySelector('.add-results');

  let debounceId;

  // 🔸 pesquisa enquanto digita
  input.addEventListener('input', () => {
    clearTimeout(debounceId);
    const q = input.value.trim().toLowerCase();
    if (q.length < 3) { list.innerHTML = ''; return; }

    debounceId = setTimeout(async () => {
      list.innerHTML = '<li>Carregando catálogo…</li>';
      try {
        await buildTipo03Cache();
        const resultados = tipo03Cache.filter(p =>
          p.codigo.toLowerCase().includes(q) ||
          (p.descricao || '').toLowerCase().includes(q)
        ).sort((a, b) => a.codigo.localeCompare(b.codigo));

        renderSearchResults(resultados, list);
      } catch (err) {
        list.innerHTML = `<li class="error">Erro: ${err.message}</li>`;
      }
    }, 300);
  });

// 🔹 clique em um item da lista
list.addEventListener('click', e => {
  const li = e.target.closest('.result-item');
  if (!li) return;

  /* 0) guarda o código para a aba PCP */
  window.prepCodigoSelecionado = li.dataset.codigo;   // ex.: "FTI55DPTBR"

  /* 1) troca para a aba PCP (isso dispara renderListaPecasPCP internamente) */
  document
    .querySelector('#kanbanTabs .main-header-link[data-kanban-tab="pcp"]')
    ?.click();

  /* 2) relança renderListaPecasPCP após ~80 ms – garante atualização
        mesmo que a função já tenha rodado antes com outro código        */
  setTimeout(() => {
    if (typeof renderListaPecasPCP === 'function') {
      renderListaPecasPCP();
    }
  }, 80);   // ajuste se sua máquina precisar de um tempo diferente

  /* 3) mantém o campo local preenchido e recolhe a lista */
  input.value   = `${li.dataset.codigo} — ${li.dataset.desc}`;
  list.innerHTML = '';
});


}





// Apenas estrutura inicial – lógica virá depois
export async function initPreparacaoKanban() {
   // 0) limpa colunas
['coluna-prep-fila',
 'coluna-prep-em-producao',
 'coluna-prep-estoque']

     .forEach(id => document.getElementById(id).innerHTML = '');

  // 1) carrega cache salvo em disco
  const cached = await carregarKanbanPreparacao();
  if (cached.length) {
    renderKanbanPreparacao(cached);
    enableDragAndDrop(cached);
  }

    setupAddToggleSolicitar();   // habilita o “+”
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
  const col = colElem.closest('.kanban-column');
  if (!col) return;

  const btn   = col.querySelector('.add-btn');
  const input = col.querySelector('.add-search');
  btn.addEventListener('click', () => {
   collapseSearchPanel();                // fecha outros painéis primeiro
   col.classList.toggle('search-expand');
    if (col.classList.contains('search-expand')) {
      setTimeout(() => input.focus(), 100);
      buildTipo03Cache().catch(err =>
  console.error('[Tipo03] falha ao construir cache:', err)
);

    }
  });
}
