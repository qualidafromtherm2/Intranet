// kanban/kanban_preparacao.js
import config from '../config.client.js';
import { enableDragAndDrop } from './kanban_base.js';

const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;
const API_BASE = window.location.origin;

/* ===========================================================
   Cache Management
   =========================================================== */
class CacheManager {
  constructor() {
    this.prodInfoCache = window._prodInfoCache || new Map();
    this.infoPorCodigoCache = window._infoPorCodigoCache || new Map();
    this.tipo03Cache = null;
    this.tipo03Ready = null;
    this.debugReqId = 0;
    
    // Garantir que os caches sejam globais
    window._prodInfoCache = this.prodInfoCache;
    window._infoPorCodigoCache = this.infoPorCodigoCache;
  }

  async fetchWithErrorHandling(url, options = {}) {
    const response = await fetch(url, { credentials: 'include', ...options });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async resolverInfoPorCodigoProduto(listaNumericos) {
    const faltantes = [...new Set(listaNumericos.map(String))]
      .filter(s => /^\d+$/.test(s))
      .filter(cp => !this.prodInfoCache.has(cp));
    
    if (!faltantes.length) return;

    const queryString = faltantes.map(cp => `cp=${encodeURIComponent(cp)}`).join('&');
    const data = await this.fetchWithErrorHandling(`/api/produtos/codigos?${queryString}`);
    
    if (data?.ok && data.data) {
      Object.entries(data.data).forEach(([cp, info]) => {
        this.prodInfoCache.set(String(cp), info || { codigo: null, descricao: null });
      });
    }
  }

  async resolverInfoPorCodigo(listaAlfas) {
    const faltantes = [...new Set(listaAlfas.map(String))]
      .filter(c => !this.infoPorCodigoCache.has(c));
    
    if (!faltantes.length) return;

    const queryString = faltantes.map(c => `c=${encodeURIComponent(c)}`).join('&');
    const data = await this.fetchWithErrorHandling(`/api/produtos/por-codigo?${queryString}`);
    
    if (data?.ok && data.data) {
      Object.entries(data.data).forEach(([c, info]) => {
        this.infoPorCodigoCache.set(String(c), info || { descricao: null });
      });
    }
  }

  rotuloProduto(codOuNumero) {
    const s = String(codOuNumero || '');
    return /^\d+$/.test(s) ? (this.prodInfoCache.get(s)?.codigo) || s : s;
  }

  descProduto(codOuNumero) {
    const s = String(codOuNumero || '');
    return /^\d+$/.test(s) 
      ? (this.prodInfoCache.get(s)?.descricao) || '' 
      : (this.infoPorCodigoCache.get(s)?.descricao) || '';
  }

  async buildTipo03Cache() {
    if (this.tipo03Ready) return this.tipo03Ready;

    this.tipo03Ready = this._buildTipo03CacheInternal();
    return this.tipo03Ready;
  }

  async _buildTipo03CacheInternal() {
    this.debugReqId += 1;
    const requestId = this.debugReqId;
    console.groupCollapsed(`[Tipo03] Req #${requestId} (descobrir total)`);

    try {
      const basePayload = {
        call: 'ListarProdutosResumido',
        param: [{
          pagina: 1,
          registros_por_pagina: 1,
          apenas_importado_api: 'N',
          filtrar_apenas_omiepdv: 'N',
          filtrar_apenas_tipo: '03'
        }],
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET
      };

      // Descobrir total de registros
      const firstResponse = await this.fetchWithErrorHandling(`${API_BASE}/api/omie/produtos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(basePayload)
      });

      const total = firstResponse.total_de_registros || 0;
      console.log(`[Tipo03] total_de_registros = ${total}`);

      // Buscar todos os registros
      const fullPayload = {
        ...basePayload,
        param: [{ ...basePayload.param[0], registros_por_pagina: total }]
      };

      const fullResponse = await this.fetchWithErrorHandling(`${API_BASE}/api/omie/produtos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullPayload)
      });

      this.tipo03Cache = Array.isArray(fullResponse.produto_servico_resumido)
        ? fullResponse.produto_servico_resumido
        : [];

      console.log(`[Tipo03] cache pronto – itens:`, this.tipo03Cache.length);
      return this.tipo03Cache;
    } finally {
      console.groupEnd();
    }
  }
}

/* ===========================================================
   Column Configuration
   =========================================================== */
const PREP_COLUMNS = {
  'A Produzir': 'coluna-prep-fila',
  'Produzindo': 'coluna-prep-em-producao',
  'Em produção': 'coluna-prep-em-producao',
  'Produzido': 'coluna-prep-concluido'
};

const getPrepUlId = name => PREP_COLUMNS[name];

/* ===========================================================
   Data Loading and Processing
   =========================================================== */
async function carregarKanbanPreparacao(fetcher) {
  const fetchJson = typeof fetcher === 'function'
    ? fetcher
    : (url, options) => new CacheManager().fetchWithErrorHandling(url, options);

  const prepRaw = await fetchJson('/api/preparacao/listar', { cache: 'no-store' }).catch(err => {
    console.error('[Preparação] Falha ao carregar lista base:', err);
    return null;
  });

  if (prepRaw?.mode === 'pg' && prepRaw.data) {
    return processarDadosKanban(prepRaw.data);
  }
  return [];
}

function processarDadosKanban(rawData = {}) {
  const perProd = new Map();

  Object.entries(rawData).forEach(([status, items]) => {
    const normalizedStatus = String(status || '').trim().toLowerCase();

    (items || []).forEach(item => {
      // chave SEMPRE string, aceita produto_codigo (numérico) ou alfa
      const codigo = String(item.produto || item.produto_codigo || item.codigo || '').trim();
      if (!codigo) return;

      const arr = perProd.get(codigo) || [];
      arr.push(`${status},${item.op || ''}`);
      perProd.set(codigo, arr);
    });
  });

  return [...perProd.entries()].map(([codigo, local]) => ({
    pedido: '',
    codigo,   // pode ser numérico aqui; será hidratado depois
    local
  }));
}


/* ===========================================================
   UI Rendering
   =========================================================== */
/* ===========================================================
   UI Rendering
   =========================================================== */
class KanbanRenderer {
  constructor(cacheManager) {
    this.cache = cacheManager;
  }

  limparColunas() {
    // PREP_COLUMNS deve existir no arquivo (ex.: {'A Produzir':'coluna-prep-fila', ...})
    Object.values(PREP_COLUMNS).forEach(id => {
      const ul = document.getElementById(id);
      if (ul) ul.innerHTML = '';
    });
  }

  renderKanbanPreparacao(items) {
    this.limparColunas();

    // items = [{ codigo (alfa ou cp), descricao, local:["Status,OP",...], _cp?, _cp_list? }, ...]
    items.forEach((item, index) => {
      const counts = this.calcularContagensPorColuna(item);
      this.renderCartoesParaItem(item, index, counts);
    });
  }

  // Converte rótulos variados da view para chaves do quadro
  normalizarStatus(s) {
    const t = String(s || '').trim().toLowerCase();
    if (t === 'a produzir' || t === 'fila de produção' || t === 'fila de producao') return 'A Produzir';
    if (t === 'produzindo' || t === 'em produção' || t === 'em producao')          return 'Produzindo';
    if (t === 'teste 1' || t === 'teste1')                                          return 'teste 1';
    if (t === 'teste final' || t === 'testefinal')                                  return 'teste final';
    if (t === 'produzido')                                                          return 'Produzido';
    if (t === 'concluido' || t === 'concluído')                                     return 'concluido';
    return null; // ignora o resto
  }

  calcularContagensPorColuna(item) {
    const counts = {
      'A Produzir': 0,
      'Produzindo': 0,
      'teste 1': 0,
      'teste final': 0,
      'Produzido': 0,
      'concluido': 0
    };

    const linhas = Array.isArray(item.local) ? item.local : [];
    // Evitar contar mesma OP duas vezes dentro da mesma coluna
    const vistosPorColuna = {
      'A Produzir': new Set(),
      'Produzindo': new Set(),
      'teste 1': new Set(),
      'teste final': new Set(),
      'Produzido': new Set(),
      'concluido': new Set()
    };

    for (const row of linhas) {
      const [st, opRaw] = String(row || '').split(',', 2);
      const col = this.normalizarStatus(st);
      const op  = (opRaw || '').trim();
      if (!col) continue;
      if (op && !vistosPorColuna[col].has(op)) {
        vistosPorColuna[col].add(op);
        counts[col] += 1;
      }
    }
    return counts;
  }

  renderCartoesParaItem(item, index, counts) {
    Object.entries(counts).forEach(([columnName, quantidade]) => {
      if (!quantidade) return;
      const ulId = getPrepUlId(columnName);          // função util presente no arquivo
      const ul   = document.getElementById(ulId);
      if (!ul) return;

      const li = this.criarCartao(item, index, columnName, quantidade);
      ul.appendChild(li);
    });
  }

  criarCartao(item, index, columnName, quantidade) {
    const li = document.createElement('li');

    // Título e descrição a partir do cache
    const titulo    = this.cache.rotuloProduto(item.codigo);
    const descFull  = item.descricao || this.cache.descProduto(item._cp || item.codigo) || '';
    const descricao = descFull ? ` - ${descFull}` : '';

    // 🔑 dataset.cp deve suportar múltiplos CPs → pega o 1º, senão cai no _cp simples
    const cpForDataset = Array.isArray(item._cp_list) ? (item._cp_list[0] || '') : (item._cp || '');

    li.classList.add('kanban-card');

    // dataset completo (inclui cp)
    Object.assign(li.dataset, {
      index,
      column: columnName,
      codigo: titulo,
      cp: cpForDataset
    });

    li.textContent = `${titulo}${descricao} (${quantidade})`;

    // Clique no cartão: seleciona e abre mini-kanban da aba Produto
    li.addEventListener('click', () => {
      try { window.__prepProdutoSelecionado = titulo; } catch {}
      const header = document.getElementById('produtoSelecionado');
      if (header) header.dataset.codigo = titulo;

      try { typeof window.ativarAbaProduto === 'function' && window.ativarAbaProduto(); } catch {}
      try { typeof window.renderMiniKanban === 'function' && window.renderMiniKanban(titulo, cpForDataset); } catch {}
    });

    return li;
  }
}


/* ===========================================================
   Search Functionality
   =========================================================== */
class ProductSearch {
  constructor(cacheManager) {
    this.cache = cacheManager;
    this.debounceTimeouts = new Map();
  }

  renderSearchResults(items, container) {
    container.innerHTML = '';
    items.forEach(produto => {
      const li = document.createElement('li');
      li.className = 'result-item';
      li.textContent = `${produto.codigo} — ${produto.descricao}`;
      Object.assign(li.dataset, {
        codigo: produto.codigo,
        desc: produto.descricao
      });
      container.appendChild(li);
    });
  }

  setupProductSearchByUl(ulId) {
    const ul = document.getElementById(ulId);
    const column = ul?.closest('.kanban-column');
    if (!column) return;

    const input = column.querySelector('.add-search');
    const list = column.querySelector('.add-results');
    if (!input || !list) return;

    input.addEventListener('input', () => this.handleSearchInput(input, list));
    list.addEventListener('click', e => this.handleResultClick(e, input, list));
  }

  handleSearchInput(input, list) {
    const timeoutKey = input;
    clearTimeout(this.debounceTimeouts.get(timeoutKey));
    
    const query = input.value.trim().toLowerCase();
    if (query.length < 3) {
      list.innerHTML = '';
      return;
    }

    const debounceId = setTimeout(async () => {
      await this.performSearch(query, list);
    }, 300);
    
    this.debounceTimeouts.set(timeoutKey, debounceId);
  }

async performSearch(query, list) {
  list.innerHTML = '<li>Carregando catálogo…</li>';
  try {
    const r = await fetch(`/api/produtos/search?q=${encodeURIComponent(query)}&limit=40`, {
      credentials: 'include'
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();

    // Normaliza para o formato esperado pelo renderizador
    const resultados = (j.data || j.items || []).map(p => ({
      codigo: p.codigo,
      descricao: p.descricao
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

    this.renderSearchResults(resultados, list);
  } catch (e) {
    console.error('[PCP buscar] erro:', e);
    list.innerHTML = '<li class="error">Erro ao buscar</li>';
  }
}


async handleResultClick(event, input, list) {
  const li = event.target.closest('.result-item');
  if (!li) return;
  event.preventDefault();
  event.stopPropagation();

  const codigo = String(li.dataset.codigo || '').trim();
  if (!codigo) return;

  // 1) Cabeçalho primeiro
  window.setPCPProdutoCodigo?.(codigo);

  // 2) Abre a aba PCP
  document
    .querySelector('#kanbanTabs .main-header-link[data-kanban-tab="pcp"]')
    ?.click();

  // 3) Carrega a estrutura desse código e AGUARDA o render
  await window.ensurePCPEstruturaAutoLoad?.(); // usa pcpCodigoAtual


  // UI da busca
  input.value = `${li.dataset.codigo} — ${li.dataset.desc}`;
  list.innerHTML = '';
}


}

/* ===========================================================
   UI Setup
   =========================================================== */
function setupAddToggleSolicitar() {
  const coluna = document.getElementById('coluna-prep-fila')?.closest('.kanban-column');
  if (!coluna) return;

  const botao = coluna.querySelector('.add-btn');
  const input = coluna.querySelector('.add-search');
  if (!botao || !input) return;

  botao.addEventListener('click', () => {
    if (typeof collapseSearchPanel === 'function') collapseSearchPanel();
    
    coluna.classList.toggle('search-expand');
    if (coluna.classList.contains('search-expand')) {
      setTimeout(() => input.focus(), 100);
      new CacheManager().buildTipo03Cache().catch(err =>
        console.error('[Tipo03] falha ao construir cache:', err)
      );
    }
  });
}

// Event listener para botões de adicionar
document.addEventListener('click', e => {
  if (!e.target.classList.contains('add-btn')) return;
  const coluna = e.target.closest('.kanban-column');
  const container = coluna.querySelector('.add-container');
  container?.classList.toggle('open');
});

/* ===========================================================
   Main Initialization
   =========================================================== */
export async function initPreparacaoKanban() {
  const cacheManager = new CacheManager();
  const renderer = new KanbanRenderer(cacheManager);
  const search = new ProductSearch(cacheManager);

  try {
    // Limpar colunas
    renderer.limparColunas();

    // Carregar dados
    const dadosBrutos = await carregarKanbanPreparacao(
      cacheManager.fetchWithErrorHandling.bind(cacheManager)
    );

    // Resolver informações dos produtos
    const numericos = dadosBrutos.map(it => String(it.codigo)).filter(s => /^\d+$/.test(s));
    const alfas = dadosBrutos.map(it => String(it.codigo)).filter(s => !/^\d+$/.test(s));

    await Promise.all([
      cacheManager.resolverInfoPorCodigoProduto(numericos),
      cacheManager.resolverInfoPorCodigo(alfas)
    ]);

    // Hidratar dados com informações completas
// Hidratar dados com informações completas
const dadosHidratados = dadosBrutos.map(item => {
  const cpOriginal = String(item.codigo);
  const codigo     = cacheManager.rotuloProduto(cpOriginal);         // ← alfa canônico
  const descricao  = item.descricao || cacheManager.descProduto(cpOriginal);
  return { ...item, codigo, _cp: cpOriginal, descricao };
});

/* 🔗 UNIFICAR por código alfanumérico (vários CPs → 1 cartão) */
const byAlpha = new Map();
for (const it of dadosHidratados) {
  const k = String(it.codigo).trim();         // alfa
  const acc = byAlpha.get(k) || { ...it, local: [], _cp_list: [] };
  acc.local.push(...it.local);                // junta TODAS as OPs
  if (it._cp && !acc._cp_list.includes(it._cp)) acc._cp_list.push(it._cp);
  byAlpha.set(k, acc);
}
const dadosUnificados = [...byAlpha.values()];

/* (opcional) deixar disponível ao mini-board */
window.prepUltimaLista = dadosUnificados;

/* Render + DnD usando a lista UNIFICADA */
renderer.renderKanbanPreparacao(dadosUnificados);
if (typeof enableDragAndDrop === 'function') {
  enableDragAndDrop(dadosUnificados);
}


    setupAddToggleSolicitar();
    search.setupProductSearchByUl('coluna-prep-fila');

  } catch (error) {
    console.error('Erro ao inicializar kanban de preparação:', error);
    throw error;
  }
}
