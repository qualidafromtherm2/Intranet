// requisicoes_omie/filtro_produto.js

let allItems = [];
let lastFiltered = [];

// Filtros ativos (aplicados ao clicar em "Aplicar")
let activeFamilyValue     = '';
let activeTipoValue       = '';
let activeShowInactive    = false;
let activeSemEstoqueMin   = false;
let activeHideObsolete    = false;
let activeHideEngineering = false;
let activeLocalValue      = '';

// Cache dos locais com saldo positivo: Map<local_codigo, Set<codigo_produto>>
let _locaisCache = null;
let _locaisCachePromise = null;

async function getLocaisInventario() {
  if (_locaisCache) return _locaisCache;
  if (_locaisCachePromise) return _locaisCachePromise;
  _locaisCachePromise = fetch('/api/logistica/locais-inventario')
    .then(r => r.json())
    .then(data => {
      _locaisCache = {};
      (data.locais || []).forEach(l => {
        _locaisCache[l.local_codigo] = {
          local_nome: l.local_nome,
          codigos: new Set(Array.isArray(l.codigos) ? l.codigos : []),
          total: Number(l.total || 0)
        };
      });
      _locaisCachePromise = null;
      return _locaisCache;
    })
    .catch(() => { _locaisCachePromise = null; return {}; });
  return _locaisCachePromise;
}

let codeInput, familySelect, tipoItemSelect, filterBtn, filterOverlay, filterLocalSel;
let filterShowInactiveCb, filterSemEstoqueMinCb, filterHideObsoleteCb, filterHideEngineeringCb;
let _onFiltered;

/**
 * Extrai os 2 caracteres apos o primeiro ponto do codigo do produto.
 * Ex.: "04.MP.N.90557" -> "MP"
 * Retorna null se o codigo nao seguir o padrao xx.XX...
 */
function extractTipoFromCodigo(codigo) {
  if (!codigo) return null;
  const parts = String(codigo).split('.');
  if (parts.length >= 2 && /^[A-Za-z]{2}$/.test(parts[1])) {
    return parts[1].toUpperCase();
  }
  return null;
}

/**
 * Inicializa os filtros e liga eventos
 */
export function initFiltros({
  _codeInput,
  _familySelect,
  _tipoItemSelect,
  _caracteristicaSelect,
  _conteudoLabel,
  _conteudoSelect,
  _filterBtn,
  _filterPanel,
  onFiltered
}) {
  codeInput      = _codeInput;
  familySelect   = _familySelect;
  tipoItemSelect = _tipoItemSelect;
  filterBtn      = _filterBtn;
  filterOverlay         = document.getElementById('filterPanelOverlay');
  filterShowInactiveCb   = document.getElementById('filterShowInactive');
  filterSemEstoqueMinCb  = document.getElementById('filterSemEstoqueMin');
  filterHideObsoleteCb   = document.getElementById('filterHideObsolete');
  filterHideEngineeringCb = document.getElementById('filterHideEngineering');
  filterLocalSel           = document.getElementById('filterLocalSelect');
  _onFiltered    = onFiltered;

  if (!codeInput) {
    console.error('[filtro_produto] codeInput nao encontrado!');
    return;
  }

  // Busca ao digitar (sem abrir modal)
  let dbSearch;
  codeInput.addEventListener('input', () => {
    clearTimeout(dbSearch);
    dbSearch = setTimeout(() => { applyFilters(); _onFiltered(lastFiltered); }, 200);
  });

  // Botao do funil -> abre overlay modal
  filterBtn.addEventListener('click', () => {
    abrirModalFiltro();
  });

  // Fechar ao clicar no overlay (fora do painel)
  if (filterOverlay) {
    filterOverlay.addEventListener('click', (e) => {
      if (e.target === filterOverlay) fecharModalFiltro(false);
    });
  }

  // Botao X dentro do modal
  const closeBtn = document.getElementById('filterPanelCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => fecharModalFiltro(false));
  }

  // Botao Limpar
  const limparBtn = document.getElementById('filterPanelLimparBtn');
  if (limparBtn) {
    limparBtn.addEventListener('click', () => {
      if (familySelect)   familySelect.value   = '';
      if (tipoItemSelect) tipoItemSelect.value = '';
      activeFamilyValue     = '';
      activeTipoValue       = '';
      activeShowInactive    = false;
      activeSemEstoqueMin   = false;
      activeHideObsolete    = false;
      activeHideEngineering = false;
      if (filterShowInactiveCb)    filterShowInactiveCb.checked    = false;
      if (filterSemEstoqueMinCb)   filterSemEstoqueMinCb.checked   = false;
      if (filterHideObsoleteCb)    filterHideObsoleteCb.checked    = false;
      if (filterHideEngineeringCb) filterHideEngineeringCb.checked = false;
      if (filterLocalSel)          filterLocalSel.value            = '';
      activeLocalValue = '';
      fecharModalFiltro(true);
    });
  }

  // Botao Aplicar
  const aplicarBtn = document.getElementById('filterPanelAplicarBtn');
  if (aplicarBtn) {
    aplicarBtn.addEventListener('click', () => {
      activeFamilyValue     = familySelect?.value   || '';
      activeTipoValue       = tipoItemSelect?.value || '';
      activeShowInactive    = filterShowInactiveCb?.checked    || false;
      activeSemEstoqueMin   = filterSemEstoqueMinCb?.checked   || false;
      activeHideObsolete    = filterHideObsoleteCb?.checked    || false;
      activeHideEngineering = filterHideEngineeringCb?.checked || false;
      activeLocalValue      = filterLocalSel?.value            || '';
      fecharModalFiltro(true);
    });
  }
}

function abrirModalFiltro() {
  if (!filterOverlay) return;
  // Restaura selecoes ativas
  if (familySelect)   familySelect.value   = activeFamilyValue;
  if (tipoItemSelect) tipoItemSelect.value = activeTipoValue;
  if (filterShowInactiveCb)    filterShowInactiveCb.checked    = activeShowInactive;
  if (filterSemEstoqueMinCb)   filterSemEstoqueMinCb.checked   = activeSemEstoqueMin;
  if (filterHideObsoleteCb)    filterHideObsoleteCb.checked    = activeHideObsolete;
  if (filterHideEngineeringCb) filterHideEngineeringCb.checked = activeHideEngineering;
  if (filterLocalSel)          filterLocalSel.value            = activeLocalValue;
  // Carrega opcoes
  popularFamilias();
  popularTipoItem();
  popularLocais();
  filterOverlay.style.display = 'flex';
}

function fecharModalFiltro(aplicar) {
  if (!filterOverlay) return;
  filterOverlay.style.display = 'none';
  if (aplicar) {
    applyFilters();
    if (_onFiltered) _onFiltered(lastFiltered);
  }
}

/**
 * Popula familias usando os valores distintos de descricao_familia
 * ja presentes no cache de produtos (allItems)
 */
function popularFamilias() {
  if (!familySelect) return;
  const selAtual = familySelect.value;
  familySelect.innerHTML = '<option value="">-- todas --</option>';

  // Coleta familias distintas e conta produtos por familia
  const famMap = new Map();
  allItems.forEach(i => {
    const nome = (i.descricao_familia || '').trim();
    if (!nome) return;
    famMap.set(nome, (famMap.get(nome) || 0) + 1);
  });

  Array.from(famMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([nome, count]) => {
      const o = document.createElement('option');
      o.value = nome;
      o.textContent = nome + ' (' + count + ')';
      familySelect.appendChild(o);
    });

  if (familySelect.querySelector('option[value="' + selAtual + '"]')) {
    familySelect.value = selAtual;
  }
}

/**
 * Popula Tipo de Item extraindo os 2 chars apos o primeiro ponto do codigo.
 * Ex.: "04.MP.N.90557" -> "MP"
 * Produtos que nao seguem o padrao sao agrupados como "Outros"
 */
function popularTipoItem() {
  if (!tipoItemSelect) return;
  const selAtual = tipoItemSelect.value;
  tipoItemSelect.innerHTML = '<option value="">-- todos --</option>';

  const tiposMap = new Map();
  let outrosCount = 0;

  allItems.forEach(i => {
    const tipo = extractTipoFromCodigo(i.codigo);
    if (tipo) {
      tiposMap.set(tipo, (tiposMap.get(tipo) || 0) + 1);
    } else {
      outrosCount++;
    }
  });

  Array.from(tiposMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([tipo, count]) => {
      const o = document.createElement('option');
      o.value = tipo;
      o.textContent = tipo + ' (' + count + ')';
      tipoItemSelect.appendChild(o);
    });

  if (outrosCount > 0) {
    const o = document.createElement('option');
    o.value = '__outros__';
    o.textContent = 'Outros (' + outrosCount + ')';
    tipoItemSelect.appendChild(o);
  }

  if (tipoItemSelect.querySelector('option[value="' + selAtual + '"]')) {
    tipoItemSelect.value = selAtual;
  }
}

/**
 * Popula o select de locais buscando do endpoint /api/logistica/locais-inventario.
 * Mostra apenas armazens com saldo positivo e a contagem de produtos distintos.
 */
async function popularLocais() {
  if (!filterLocalSel) return;
  const selAtual = filterLocalSel.value;

  const mapa = await getLocaisInventario();
  filterLocalSel.innerHTML = '<option value="">– todos –</option>';

  Object.entries(mapa)
    .sort(([, a], [, b]) => a.local_nome.localeCompare(b.local_nome))
    .forEach(([codigo, { local_nome, total }]) => {
      const o = document.createElement('option');
      o.value = codigo;
      o.textContent = local_nome + ' (' + total + ')';
      filterLocalSel.appendChild(o);
    });

  if (filterLocalSel.querySelector('option[value="' + selAtual + '"]')) {
    filterLocalSel.value = selAtual;
  }
}

/**
 * Define o cache completo
 */
export function setCache(items) {
  if (!Array.isArray(items)) {
    console.warn('[filtro_produto] setCache recebeu valor invalido:', items);
    allItems     = [];
    lastFiltered = [];
    return;
  }
  allItems     = items;
  lastFiltered = items.slice();
}

/** Retorna lista filtrada */
export function getFiltered() {
  return lastFiltered;
}

function applyFilters() {
  let filtered = allItems.slice();

  // Busca unificada - procura tanto em codigo quanto em descricao
  const searchTerm = codeInput?.value.trim().toLowerCase() || '';
  if (searchTerm) {
    const terms = searchTerm.split(/\s+/).filter(t => t);
    filtered = filtered.filter(i => {
      const codigo    = (i.codigo   || '').toLowerCase();
      const descricao = (i.descricao || '').toLowerCase();
      return codigo.includes(searchTerm) || terms.every(t => descricao.includes(t));
    });
  }

  // Filtro de Familia (por descricao_familia)
  if (activeFamilyValue) {
    filtered = filtered.filter(i =>
      (i.descricao_familia || '').trim() === activeFamilyValue
    );
  }

  // Filtro de Tipo de Item (extraido do codigo)
  if (activeTipoValue) {
    if (activeTipoValue === '__outros__') {
      filtered = filtered.filter(i => extractTipoFromCodigo(i.codigo) === null);
    } else {
      filtered = filtered.filter(i =>
        extractTipoFromCodigo(i.codigo) === activeTipoValue
      );
    }
  }

  // Filtro por local de estoque (produto deve ter saldo > 0 naquele local)
  if (activeLocalValue && _locaisCache && _locaisCache[activeLocalValue]) {
    const codigosNoLocal = _locaisCache[activeLocalValue].codigos;
    filtered = filtered.filter(i => codigosNoLocal.has(i.codigo));
  }

  // Inativos: por padrão oculta produtos com inativo='S'
  if (!activeShowInactive) {
    filtered = filtered.filter(i => i.inativo !== 'S');
  }

  // Apenas produtos sem estoque mínimo definido
  if (activeSemEstoqueMin) {
    filtered = filtered.filter(i => !i.estoque_minimo || Number(i.estoque_minimo) === 0);
  }

  // Ocultar produtos com prefixo OBSOLETO
  if (activeHideObsolete) {
    filtered = filtered.filter(i => !(i.descricao || '').toUpperCase().startsWith('OBSOLETO'));
  }

  // Ocultar produtos com prefixo ENGENHARIA
  if (activeHideEngineering) {
    filtered = filtered.filter(i => !(i.descricao || '').toUpperCase().startsWith('ENGENHARIA'));
  }

  lastFiltered = filtered;
}

// Mantido para compatibilidade com chamadas existentes
export function populateFilters() {}
