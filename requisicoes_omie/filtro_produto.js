// requisicoes_omie/filtro_produto.js

let allItems = [];
let lastFiltered = [];

// Filtros ativos (aplicados ao clicar em "Aplicar")
let activeFamilyValues    = [];
let activeTipoValues      = [];
let activeShowInactive    = false;
let activeSemEstoqueMin   = false;
let activeAbaixoEstoqueMin = false;
let activeAcimaEstoqueMin = false;
let activeProximoEstoqueMin = false;
let activeProximoEstoqueMinPercent = 10;
let activeEstoqueNegativo = false;
let activeHideObsolete    = false;
let activeHideEngineering = false;
let activeLocalValues     = [];
let activeOrigemValues    = [];
let activeCompraValues    = [];

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

let codeInput, familySelect, tipoItemSelect, filterBtn, filterOverlay, filterLocalSel, filterOrigemSel, filterCompraSel;
let filterShowInactiveCb, filterSemEstoqueMinCb, filterAbaixoEstoqueMinCb, filterAcimaEstoqueMinCb;
let filterProximoEstoqueMinCb, filterProximoEstoqueMinPercentInput, filterEstoqueNegativoCb, filterHideObsoleteCb, filterHideEngineeringCb;
let _onFiltered;

function getSelectedValues(select) {
  return select ? Array.from(select.selectedOptions, option => option.value).filter(Boolean) : [];
}

function setSelectedValues(select, values) {
  if (!select) return;
  const selecionados = new Set(Array.isArray(values) ? values : []);
  Array.from(select.options).forEach(option => {
    option.selected = selecionados.has(option.value);
  });
}

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

function extractOrigemFromCodigo(codigo) {
  const parts = String(codigo || '').split('.');
  const origem = String(parts[2] || '').toUpperCase();
  return origem === 'N' || origem === 'I' ? origem : null;
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
  filterAbaixoEstoqueMinCb = document.getElementById('filterAbaixoEstoqueMin');
  filterAcimaEstoqueMinCb = document.getElementById('filterAcimaEstoqueMin');
  filterProximoEstoqueMinCb = document.getElementById('filterProximoEstoqueMin');
  filterProximoEstoqueMinPercentInput = document.getElementById('filterProximoEstoqueMinPercent');
  filterEstoqueNegativoCb = document.getElementById('filterEstoqueNegativo');
  filterHideObsoleteCb   = document.getElementById('filterHideObsolete');
  filterHideEngineeringCb = document.getElementById('filterHideEngineering');
  filterLocalSel           = document.getElementById('filterLocalSelect');
  filterOrigemSel          = document.getElementById('filterOrigemProduto');
  filterCompraSel          = document.getElementById('filterSituacaoCompra');
  _onFiltered    = onFiltered;

  const syncProximoPercentState = () => {
    if (!filterProximoEstoqueMinPercentInput) return;
    filterProximoEstoqueMinPercentInput.disabled = !filterProximoEstoqueMinCb?.checked;
    filterProximoEstoqueMinPercentInput.style.opacity = filterProximoEstoqueMinCb?.checked ? '1' : '.55';
  };
  filterProximoEstoqueMinCb?.addEventListener('change', syncProximoPercentState);
  syncProximoPercentState();

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
      setSelectedValues(familySelect, []);
      setSelectedValues(tipoItemSelect, []);
      activeFamilyValues    = [];
      activeTipoValues      = [];
      activeShowInactive    = false;
      activeSemEstoqueMin   = false;
      activeAbaixoEstoqueMin = false;
      activeAcimaEstoqueMin = false;
      activeProximoEstoqueMin = false;
      activeProximoEstoqueMinPercent = 10;
      activeEstoqueNegativo = false;
      activeHideObsolete    = false;
      activeHideEngineering = false;
      if (filterShowInactiveCb)    filterShowInactiveCb.checked    = false;
      if (filterSemEstoqueMinCb)   filterSemEstoqueMinCb.checked   = false;
      if (filterAbaixoEstoqueMinCb) filterAbaixoEstoqueMinCb.checked = false;
      if (filterAcimaEstoqueMinCb) filterAcimaEstoqueMinCb.checked = false;
      if (filterProximoEstoqueMinCb) filterProximoEstoqueMinCb.checked = false;
      if (filterProximoEstoqueMinPercentInput) {
        filterProximoEstoqueMinPercentInput.value = '10';
        filterProximoEstoqueMinPercentInput.disabled = true;
        filterProximoEstoqueMinPercentInput.style.opacity = '.55';
      }
      if (filterEstoqueNegativoCb) filterEstoqueNegativoCb.checked = false;
      if (filterHideObsoleteCb)    filterHideObsoleteCb.checked    = false;
      if (filterHideEngineeringCb) filterHideEngineeringCb.checked = false;
      setSelectedValues(filterLocalSel, []);
      setSelectedValues(filterOrigemSel, []);
      setSelectedValues(filterCompraSel, []);
      activeLocalValues = [];
      activeOrigemValues = [];
      activeCompraValues = [];
      fecharModalFiltro(true);
    });
  }

  // Botao Aplicar
  const aplicarBtn = document.getElementById('filterPanelAplicarBtn');
  if (aplicarBtn) {
    aplicarBtn.addEventListener('click', () => {
      activeFamilyValues    = getSelectedValues(familySelect);
      activeTipoValues      = getSelectedValues(tipoItemSelect);
      activeShowInactive    = filterShowInactiveCb?.checked    || false;
      activeSemEstoqueMin   = filterSemEstoqueMinCb?.checked   || false;
      activeAbaixoEstoqueMin = filterAbaixoEstoqueMinCb?.checked || false;
      activeAcimaEstoqueMin = filterAcimaEstoqueMinCb?.checked || false;
      activeProximoEstoqueMin = filterProximoEstoqueMinCb?.checked || false;
      activeProximoEstoqueMinPercent = Math.min(
        100,
        Math.max(1, Number(filterProximoEstoqueMinPercentInput?.value) || 10)
      );
      if (filterProximoEstoqueMinPercentInput) {
        filterProximoEstoqueMinPercentInput.value = String(activeProximoEstoqueMinPercent);
      }
      activeEstoqueNegativo = filterEstoqueNegativoCb?.checked || false;
      activeHideObsolete    = filterHideObsoleteCb?.checked    || false;
      activeHideEngineering = filterHideEngineeringCb?.checked || false;
      activeLocalValues     = getSelectedValues(filterLocalSel);
      activeOrigemValues    = getSelectedValues(filterOrigemSel);
      activeCompraValues    = getSelectedValues(filterCompraSel);
      fecharModalFiltro(true);
    });
  }
}

function abrirModalFiltro() {
  if (!filterOverlay) return;
  // Restaura selecoes ativas
  setSelectedValues(familySelect, activeFamilyValues);
  setSelectedValues(tipoItemSelect, activeTipoValues);
  if (filterShowInactiveCb)    filterShowInactiveCb.checked    = activeShowInactive;
  if (filterSemEstoqueMinCb)   filterSemEstoqueMinCb.checked   = activeSemEstoqueMin;
  if (filterAbaixoEstoqueMinCb) filterAbaixoEstoqueMinCb.checked = activeAbaixoEstoqueMin;
  if (filterAcimaEstoqueMinCb) filterAcimaEstoqueMinCb.checked = activeAcimaEstoqueMin;
  if (filterProximoEstoqueMinCb) filterProximoEstoqueMinCb.checked = activeProximoEstoqueMin;
  if (filterProximoEstoqueMinPercentInput) {
    filterProximoEstoqueMinPercentInput.value = String(activeProximoEstoqueMinPercent);
    filterProximoEstoqueMinPercentInput.disabled = !activeProximoEstoqueMin;
    filterProximoEstoqueMinPercentInput.style.opacity = activeProximoEstoqueMin ? '1' : '.55';
  }
  if (filterEstoqueNegativoCb) filterEstoqueNegativoCb.checked = activeEstoqueNegativo;
  if (filterHideObsoleteCb)    filterHideObsoleteCb.checked    = activeHideObsolete;
  if (filterHideEngineeringCb) filterHideEngineeringCb.checked = activeHideEngineering;
  setSelectedValues(filterLocalSel, activeLocalValues);
  setSelectedValues(filterOrigemSel, activeOrigemValues);
  setSelectedValues(filterCompraSel, activeCompraValues);
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
  const selecoesAtuais = getSelectedValues(familySelect);
  familySelect.innerHTML = '';

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

  setSelectedValues(familySelect, selecoesAtuais);
}

/**
 * Popula Tipo de Item extraindo os 2 chars apos o primeiro ponto do codigo.
 * Ex.: "04.MP.N.90557" -> "MP"
 * Produtos que nao seguem o padrao sao agrupados como "Outros"
 */
function popularTipoItem() {
  if (!tipoItemSelect) return;
  const selecoesAtuais = getSelectedValues(tipoItemSelect);
  tipoItemSelect.innerHTML = '';

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

  setSelectedValues(tipoItemSelect, selecoesAtuais);
}

/**
 * Popula o select de locais buscando do endpoint /api/logistica/locais-inventario.
 * Mostra apenas armazens com saldo positivo e a contagem de produtos distintos.
 */
async function popularLocais() {
  if (!filterLocalSel) return;
  const selecoesAtuais = getSelectedValues(filterLocalSel);

  const mapa = await getLocaisInventario();
  filterLocalSel.innerHTML = '';

  Object.entries(mapa)
    .sort(([, a], [, b]) => a.local_nome.localeCompare(b.local_nome))
    .forEach(([codigo, { local_nome, total }]) => {
      const o = document.createElement('option');
      o.value = codigo;
      o.textContent = local_nome + ' (' + total + ')';
      filterLocalSel.appendChild(o);
    });

  setSelectedValues(filterLocalSel, selecoesAtuais);
}

/**
 * Define o cache completo e reaplica os filtros ativos (família, busca, etc.).
 * Antes só fazia `lastFiltered = items`, o que apagava o filtro aplicado na tela.
 */
export function setCache(items) {
  if (!Array.isArray(items)) {
    console.warn('[filtro_produto] setCache recebeu valor invalido:', items);
    allItems     = [];
    lastFiltered = [];
    return;
  }
  allItems = items;
  applyFilters();
}

/** Reaplica filtros ativos e devolve a lista filtrada atual. */
export function reapplyFilters() {
  applyFilters();
  return lastFiltered;
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
      return terms.every(t => `${codigo} ${descricao}`.includes(t));
    });
  }

  // Filtro de Familia (por descricao_familia)
  if (activeFamilyValues.length) {
    filtered = filtered.filter(i =>
      activeFamilyValues.includes((i.descricao_familia || '').trim())
    );
  }

  // Filtro de Tipo de Item (extraido do codigo)
  if (activeTipoValues.length) {
    filtered = filtered.filter(i => {
      const tipo = extractTipoFromCodigo(i.codigo);
      return activeTipoValues.includes(tipo || '__outros__');
    });
  }

  if (activeOrigemValues.length) {
    filtered = filtered.filter(i => activeOrigemValues.includes(extractOrigemFromCodigo(i.codigo)));
  }

  // Filtro por local de estoque (produto deve ter saldo > 0 naquele local)
  if (activeLocalValues.length && _locaisCache) {
    const codigosNosLocais = activeLocalValues
      .map(codigo => _locaisCache[codigo]?.codigos)
      .filter(Boolean);
    filtered = filtered.filter(i => codigosNosLocais.some(codigos => codigos.has(i.codigo)));
  }

  // Inativos: por padrão oculta produtos com inativo='S'
  if (!activeShowInactive) {
    filtered = filtered.filter(i => i.inativo !== 'S');
  }

  // Apenas produtos sem estoque mínimo definido
  if (activeSemEstoqueMin) {
    filtered = filtered.filter(i => {
      const minimo = Number(String(i.estoque_minimo ?? '').trim().replace(',', '.'));
      const limitado = i.item_limitado === true || i.item_limitado === 'true';
      return (!Number.isFinite(minimo) || minimo <= 0) && !limitado;
    });
  }

  if (activeAbaixoEstoqueMin || activeAcimaEstoqueMin || activeProximoEstoqueMin) {
    filtered = filtered.filter(i => {
      const minimo = Number(String(i.estoque_minimo ?? '').trim().replace(',', '.'));
      const saldoAlmox = Number(String(i.saldo_almox ?? '').trim().replace(',', '.'));
      if (!Number.isFinite(minimo) || minimo <= 0 || !Number.isFinite(saldoAlmox)) return false;

      const abaixo = saldoAlmox < minimo;
      const acima = saldoAlmox >= minimo;
      const limiteProximo = minimo * (1 + activeProximoEstoqueMinPercent / 100);
      const proximo = saldoAlmox >= minimo && saldoAlmox <= limiteProximo;

      return (activeAbaixoEstoqueMin && abaixo)
        || (activeAcimaEstoqueMin && acima)
        || (activeProximoEstoqueMin && proximo);
    });
  }

  if (activeCompraValues.length === 1) {
    const somenteEmCompra = activeCompraValues[0] === 'em_compra';
    filtered = filtered.filter(i => {
      const emCompra = i.em_compra === true || i.em_compra === 'true';
      return somenteEmCompra ? emCompra : !emCompra;
    });
  }

  if (activeEstoqueNegativo) {
    filtered = filtered.filter(i => i.estoque_negativo === true || i.estoque_negativo === 'true');
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
