// requisicoes_omie/filtro_produto.js

let allItems = [];
let lastFiltered = [];

// Filtros ativos (aplicados ao clicar em "Aplicar")
let activeFamilyValue = '';
let activeTipoValue   = '';

let codeInput, familySelect, tipoItemSelect, filterBtn, filterOverlay;
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
  filterOverlay  = document.getElementById('filterPanelOverlay');
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
      activeFamilyValue = '';
      activeTipoValue   = '';
      fecharModalFiltro(true);
    });
  }

  // Botao Aplicar
  const aplicarBtn = document.getElementById('filterPanelAplicarBtn');
  if (aplicarBtn) {
    aplicarBtn.addEventListener('click', () => {
      activeFamilyValue = familySelect?.value   || '';
      activeTipoValue   = tipoItemSelect?.value || '';
      fecharModalFiltro(true);
    });
  }
}

function abrirModalFiltro() {
  if (!filterOverlay) return;
  // Restaura selecoes ativas
  if (familySelect)   familySelect.value   = activeFamilyValue;
  if (tipoItemSelect) tipoItemSelect.value = activeTipoValue;
  // Carrega opcoes
  popularFamilias();
  popularTipoItem();
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

  lastFiltered = filtered;
}

// Mantido para compatibilidade com chamadas existentes
export function populateFilters() {}
