// requisicoes_omie/filtro_produto.js
let onFilteredCallback;  // ← armazena quem revelou como “callback”

// mapeamento fixo de “Tipo de Item” para rótulo
export const TIPO_ITEM_MAP = {
    '00': '00 - Mercadoria para Revenda',
    '01': '01 - Matéria Prima',
    '02': '02 - Embalagem',
    '03': '03 - Produto em Processo',
    '04': '04 - Produto Acabado',
    '05': '05 - Subproduto',
    '06': '06 - Produto Intermediário',
    '07': '07 - Material de Uso e Consumo',
    '08': '08 - Ativo Imobilizado',
    '09': '09 - Serviços',
    '10': '10 - Outros Insumos',
    '99': '99 - Outras'
  };
  
  let allItems = [];
  let lastFiltered = [];
  
  let codeInput, descInput, familySelect,
      tipoItemSelect, caracteristicaSelect,
      conteudoLabel, conteudoSelect,
      filterBtn, filterPanel;
  
  /**
   * Inicializa os filtros e liga eventos
   */
  export function initFiltros({
    _codeInput, _descInput, _familySelect,
    _tipoItemSelect, _caracteristicaSelect,
    _conteudoLabel, _conteudoSelect,
    _filterBtn, _filterPanel,
    onFiltered
  }) {
    codeInput            = _codeInput;
    descInput            = _descInput;
    familySelect         = _familySelect;
    tipoItemSelect       = _tipoItemSelect;
    caracteristicaSelect = _caracteristicaSelect;
    conteudoLabel        = _conteudoLabel;
    conteudoSelect       = _conteudoSelect;
    filterBtn            = _filterBtn;
    filterPanel          = _filterPanel;
  
    // esconde campos de conteúdo
    conteudoLabel.style.display  = 'none';
    conteudoSelect.style.display = 'none';
  
    let dbCode, dbDesc;
    codeInput.addEventListener('input', () => {
      clearTimeout(dbCode);
      dbCode = setTimeout(() => { applyFilters(); onFiltered(lastFiltered); }, 200);
    });
    descInput.addEventListener('input', () => {
      clearTimeout(dbDesc);
      dbDesc = setTimeout(() => { applyFilters(); onFiltered(lastFiltered); }, 200);
    });
  
    familySelect.addEventListener('change', () => { applyFilters(); onFiltered(lastFiltered); });
    tipoItemSelect.addEventListener('change', () => { applyFilters(); onFiltered(lastFiltered); });
    caracteristicaSelect.addEventListener('change', () => {
      populateConteudoOptions(conteudoSelect.value);
      applyFilters();
      onFiltered(lastFiltered);
    });
    conteudoSelect.addEventListener('change', () => { applyFilters(); onFiltered(lastFiltered); });
  
    // Toggle do painel + reset ao fechar
    filterBtn.addEventListener('click', () => {
      const opening = filterPanel.classList.toggle('show');
      filterBtn.classList.toggle('active', opening);
  
      if (opening) {
        populateFilters();
      } else {
        // limpar todos os filtros
        codeInput.value =
        descInput.value =
        familySelect.value =
        tipoItemSelect.value =
        caracteristicaSelect.value =
        conteudoSelect.value = '';
        conteudoLabel.style.display  = 'none';
        conteudoSelect.style.display = 'none';
  
        applyFilters();
        onFiltered(lastFiltered);
      }
    });
  }
  
  /**
   * Define o cache completo e limpa filtros
   */
export function setCache(items) {
  if (!Array.isArray(items)) {
    console.warn('[filtro_produto] setCache recebeu valor inválido:', items);
    allItems     = [];
    lastFiltered = [];
  } else {
    allItems     = items;
    lastFiltered = items.slice();
  }
}


  
  /** Retorna lista filtrada */
  export function getFiltered() {
    return lastFiltered;
  }
  
  function applyFilters() {
    let filtered = allItems.slice();
  
    const codeTerm = codeInput.value.trim().toLowerCase();
    if (codeTerm) {
      filtered = filtered.filter(i => i.codigo.toLowerCase().includes(codeTerm));
    }
  
    const descRaw = descInput.value.trim().toLowerCase();
    if (descRaw) {
      const terms = descRaw.split(/\s+/).filter(t => t);
      filtered = filtered.filter(i =>
        terms.every(t => (i.descricao || '').toLowerCase().includes(t))
      );
    }
  
    if (familySelect.value) {
      filtered = filtered.filter(i => i.descricao_familia?.trim() === familySelect.value);
    }
    if (tipoItemSelect.value) {
      filtered = filtered.filter(i => i.tipoItem?.trim() === tipoItemSelect.value);
    }
    if (caracteristicaSelect.value) {
      filtered = filtered.filter(i =>
        Array.isArray(i.caracteristicas) &&
        i.caracteristicas.some(c => c.cNomeCaract === caracteristicaSelect.value)
      );
    }
    if (conteudoSelect.value) {
      filtered = filtered.filter(i =>
        Array.isArray(i.caracteristicas) &&
        i.caracteristicas.some(c =>
          c.cNomeCaract === caracteristicaSelect.value &&
          c.cConteudo   === conteudoSelect.value
        )
      );
    }
  
    lastFiltered = filtered;
  }
  
  export function populateFilters() {
    const selFam   = familySelect.value;
    const selTipo  = tipoItemSelect.value;
    const selCarac = caracteristicaSelect.value;
  
    familySelect.innerHTML         = '<option value="">– selecione –</option>';
    tipoItemSelect.innerHTML       = '<option value="">– selecione –</option>';
    caracteristicaSelect.innerHTML = '<option value="">– selecione –</option>';
  
    // Famílias
    Array.from(new Set(lastFiltered.map(i => i.descricao_familia?.trim()).filter(f => f)))
      .sort().forEach(f => {
        const o = document.createElement('option');
        o.value = f;
        o.textContent = `${f} (${ lastFiltered.filter(i => i.descricao_familia?.trim() === f).length })`;
        familySelect.appendChild(o);
      });
  
    // Tipo de Item
    Array.from(new Set(lastFiltered.map(i => i.tipoItem?.trim()).filter(t => t)))
      .sort().forEach(code => {
        const o = document.createElement('option');
        o.value = code;
        o.textContent = `${TIPO_ITEM_MAP[code] || code} (${ lastFiltered.filter(i => i.tipoItem?.trim() === code).length })`;
        tipoItemSelect.appendChild(o);
      });
  
    // Características
    Array.from(new Set(
      lastFiltered.flatMap(i =>
        Array.isArray(i.caracteristicas)
          ? i.caracteristicas.map(c => c.cNomeCaract)
          : []
      )
    )).sort().forEach(name => {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = `${name} (${ lastFiltered.filter(i =>
        Array.isArray(i.caracteristicas) &&
        i.caracteristicas.some(c => c.cNomeCaract === name)
      ).length })`;
      caracteristicaSelect.appendChild(o);
    });
  
    // restaura seleção
    if (familySelect.querySelector(`option[value="${selFam}"]`)) {
      familySelect.value = selFam;
    }
    if (tipoItemSelect.querySelector(`option[value="${selTipo}"]`)) {
      tipoItemSelect.value = selTipo;
    }
    if (caracteristicaSelect.querySelector(`option[value="${selCarac}"]`)) {
      caracteristicaSelect.value = selCarac;
      populateConteudoOptions(conteudoSelect.value);
    }
  }
  
  export function populateConteudoOptions(previous) {
    const name = caracteristicaSelect.value;
    if (!name) {
      conteudoLabel.style.display  = 'none';
      conteudoSelect.style.display = 'none';
      return;
    }
  
    const values = Array.from(new Set(
      lastFiltered.flatMap(i =>
        Array.isArray(i.caracteristicas)
          ? i.caracteristicas
              .filter(c => c.cNomeCaract === name)
              .map(c => c.cConteudo)
          : []
      )
    )).sort();
  
    conteudoSelect.innerHTML = '<option value="">– selecione –</option>';
    values.forEach(val => {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = `${val} (${ lastFiltered.filter(i =>
        Array.isArray(i.caracteristicas) &&
        i.caracteristicas.some(c => c.cNomeCaract === name && c.cConteudo === val)
      ).length })`;
      conteudoSelect.appendChild(o);
    });
  
    conteudoLabel.style.display  = '';
    conteudoSelect.style.display = '';
    if (previous && values.includes(previous)) {
      conteudoSelect.value = previous;
    }
  }
  