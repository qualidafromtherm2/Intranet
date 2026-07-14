// produtos/editar_em_massa.js — edição em massa na Lista de produtos
(function initEditarEmMassa() {
  const modal = document.getElementById('modalEditarEmMassa');
  const btnAbrir = document.getElementById('editarEmMassaBtn');
  const btnFechar = document.getElementById('modalEditarEmMassaFechar');
  const btnSelecionar = document.getElementById('emMassaBtnSelecionar');
  const btnSelecionarTexto = document.getElementById('emMassaBtnSelecionarTexto');
  const btnRegistrar = document.getElementById('emMassaBtnRegistrar');
  const btnLimpar = document.getElementById('emMassaBtnLimparExclusoes');
  const btnRecuperarHamburguer = document.getElementById('emMassaBtnRecuperarHamburguer');
  const contadorResumo = document.getElementById('emMassaContadorResumo');
  const contadorExtra = document.getElementById('emMassaContadorExtra');
  const navClone = document.getElementById('emMassaNavGridClone');
  const selectBar = document.getElementById('emMassaSelectBar');
  const selectBarTexto = document.getElementById('emMassaSelectBarTexto');
  const selectBarConcluir = document.getElementById('emMassaSelectBarConcluir');
  const listaPane = document.getElementById('listaProdutos');

  if (!modal || !btnAbrir) return;

  const state = {
    selectMode: false,
    excluded: new Set(),
    sessionAtiva: false,
  };

  function codigoDeProduto(p) {
    const cod = String(p?.codigo || '').trim();
    if (!cod || /^c[oó]digo(\s+do)?\s+produto$/i.test(cod)) return '';
    return cod;
  }

  function codigoOmieDeProduto(p) {
    const omie = String(p?.codigo_produto ?? '').trim();
    if (omie && omie !== 'null' && omie !== 'undefined' && !/^c[oó]digo/i.test(omie)) {
      return omie;
    }
    return codigoDeProduto(p);
  }

  function getVisiveis() {
    if (typeof window.__getListaProdutosVisiveis === 'function') {
      return window.__getListaProdutosVisiveis() || [];
    }
    return [];
  }

  function syncExternalFilter() {
    if (!state.excluded.size) {
      // Limpa exclusões sem resetar a sessão (não usar __clear… patched)
      window.__setListaProdutosExternalFilter?.(null, '');
      return;
    }
    window.__setListaProdutosExternalFilter?.(
      (p) => !state.excluded.has(codigoDeProduto(p)),
      `Em massa (−${state.excluded.size})`
    );
  }

  function atualizarContadores() {
    const visiveis = getVisiveis();
    const n = visiveis.length;
    if (contadorResumo) {
      contadorResumo.textContent = `${n} produto${n === 1 ? '' : 's'} pronto${n === 1 ? '' : 's'} para edição em massa.`;
    }
    if (contadorExtra) {
      const parts = [];
      if (state.excluded.size) parts.push(`${state.excluded.size} removido(s) pelo X`);
      if (state.selectMode) parts.push('modo seleção (X) ativo');
      contadorExtra.textContent = parts.join(' · ');
    }
    if (btnSelecionarTexto) {
      btnSelecionarTexto.textContent = state.selectMode
        ? 'Sair do modo X (manter lista refinada)'
        : 'Selecionar produtos (mostrar X)';
    }
    if (selectBarTexto) {
      selectBarTexto.textContent = `Modo seleção: clique no X para remover · ${n} restantes`;
    }
    if (btnAbrir) {
      btnAbrir.classList.toggle('active', state.sessionAtiva || state.selectMode);
    }
  }

  function setSelectMode(on) {
    state.selectMode = !!on;
    if (listaPane) listaPane.classList.toggle('lp-bulk-select-mode', state.selectMode);
    if (selectBar) selectBar.style.display = state.selectMode ? 'flex' : 'none';
    atualizarContadores();
    injetarBotoesX();
  }

  function fecharModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }

  function abrirModal() {
    state.sessionAtiva = true;
    if (state.selectMode) setSelectMode(false);
    atualizarContadores();
    montarCloneHamburguer();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function excluirCodigo(codigo) {
    const cod = String(codigo || '').trim();
    if (!cod) return;
    state.excluded.add(cod);
    syncExternalFilter();
    atualizarContadores();
  }

  function limparExclusoes() {
    state.excluded.clear();
    state.sessionAtiva = true;
    syncExternalFilter();
    atualizarContadores();
  }

  function criarBotaoX(codigo) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lp-bulk-x-btn';
    btn.title = 'Remover deste filtro de edição em massa';
    btn.setAttribute('aria-label', 'Remover produto');
    btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    btn.dataset.bulkCodigo = codigo;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      excluirCodigo(codigo);
    });
    return btn;
  }

  function injetarBotoesX() {
    const grid = document.getElementById('listaProdutosGrid');
    if (grid) {
      Array.from(grid.children).forEach((card) => {
        if (card.querySelector('.lp-bulk-x-btn')) return;
        const codigo =
          card.querySelector('[data-codigo]')?.getAttribute('data-codigo')
          || card.querySelector('div[style*="font-weight:700"]')?.textContent?.trim()
          || '';
        if (!codigo) return;
        if (getComputedStyle(card).position === 'static') {
          card.style.position = 'relative';
        }
        card.appendChild(criarBotaoX(codigo));
      });
    }

    const ul = document.getElementById('listaProdutosList');
    if (ul) {
      ul.querySelectorAll('.product-list-item').forEach((li) => {
        if (li.querySelector('.lp-bulk-x-btn')) return;
        const codigo = li.getAttribute('data-codigo') || li.querySelector('.products')?.textContent?.trim() || '';
        if (!codigo) return;
        li.appendChild(criarBotaoX(codigo));
      });
    }
  }

  window.__lpBulkOnListaRendered = function () {
    if (state.selectMode) injetarBotoesX();
    atualizarContadores();
  };

  function wrapRenderCatalogo() {
    if (window.__lpBulkRenderWrapped) return;
    const orig = window.renderizarCatalogoOmie;
    if (typeof orig !== 'function') return;
    window.__lpBulkRenderWrapped = true;
    window.renderizarCatalogoOmie = function (...args) {
      const result = orig.apply(this, args);
      try {
        if (state.selectMode) setTimeout(injetarBotoesX, 0);
      } catch (_) {}
      return result;
    };
  }

  function garantirProdutoParaAcaoPontual() {
    const codigoOmie = String(
      window.codigoOmieSelecionado
      || document.getElementById('codigo_produto')?.value
      || ''
    ).trim();
    const codigo = String(
      window.codigoSelecionado
      || document.getElementById('headerCodigo')?.textContent
      || ''
    ).trim();
    // Não usar #productTitle — placeholder da página é "Código do produto"
    const omieOk = codigoOmie && codigoOmie !== 'N/A' && !/^c[oó]digo/i.test(codigoOmie);
    const codigoOk = codigo && codigo !== 'N/A' && !/^c[oó]digo(\s+do)?\s+produto$/i.test(codigo);
    if (!omieOk && !codigoOk) {
      alert(
        'Para ação pontual do menu, abra um produto na lista (botão Ações).\n\n'
        + 'Para gravar a mesma alteração em todos os produtos do filtro, use o botão laranja '
        + '"Registrar alteração em massa".'
      );
      return false;
    }
    return true;
  }

  function montarCloneHamburguer() {
    if (!navClone) return;
    const origem = document.getElementById('productNavGrid');
    if (!origem) {
      navClone.innerHTML = '<div style="grid-column:1/-1;color:#9ca3af;font-size:12px;">Menu do produto não encontrado.</div>';
      return;
    }

    navClone.innerHTML = '';
    origem.querySelectorAll('.nav-card').forEach((card) => {
      const clone = document.createElement('div');
      clone.className = 'em-massa-nav-card';
      clone.title = card.title || card.querySelector('.nav-card-title')?.textContent || '';
      const icon = card.querySelector('.nav-card-icon');
      const title = card.querySelector('.nav-card-title');
      clone.innerHTML = `
        <div class="nav-card-icon" style="${icon?.getAttribute('style') || ''}">${icon?.innerHTML || '<i class="fa-solid fa-circle"></i>'}</div>
        <div class="nav-card-title">${title?.textContent || 'Item'}</div>
      `;
      clone.addEventListener('click', () => {
        if (!garantirProdutoParaAcaoPontual()) return;
        fecharModal();
        // Garante header/menu interno do produto visível
        const hdr = document.querySelector('#produtoTabs > .main-header') || document.querySelector('.main-header');
        if (hdr) hdr.style.display = 'flex';
        try { card.click(); } catch (_) {}
      });
      navClone.appendChild(clone);
    });
  }

  function recuperarHamburguerOriginal() {
    const hdr = document.querySelector('#produtoTabs > .main-header') || document.querySelector('.main-header');
    const hamburger = document.getElementById('navHamburger');
    const navGrid = document.getElementById('productNavGrid');
    if (!hdr || !hamburger) {
      alert('Menu hambúrguer não encontrado na página.');
      return;
    }
    if (!garantirProdutoParaAcaoPontual()) return;
    fecharModal();
    hdr.style.display = 'flex';
    if (navGrid) {
      navGrid.style.display = 'grid';
      hamburger.classList.add('active');
    }
    try { hamburger.focus(); } catch (_) {}
  }

  function abrirRegistroEmMassa() {
    if (state.selectMode) setSelectMode(false);
    const visiveis = getVisiveis();
    if (!visiveis.length) {
      alert('Nenhum produto no filtro atual. Refine a lista antes de registrar.');
      return;
    }

    const codigos = visiveis.map((p) => ({
      codigo: codigoDeProduto(p),
      codigo_omie: codigoOmieDeProduto(p),
    })).filter((p) => p.codigo_omie);

    if (!codigos.length) {
      alert('Não foi possível obter os códigos OMIE dos produtos filtrados. Recarregue a Lista de produtos (F5) e filtre de novo.');
      return;
    }

    // Usa o primeiro produto como contexto visual do modal existente
    const primeiro = codigos[0];
    window.codigoSelecionado = primeiro.codigo || window.codigoSelecionado;
    window.codigoOmieSelecionado = primeiro.codigo_omie;
    const listaCodigosOmie = codigos.map((c) => c.codigo_omie);
    window.__alteracaoEmMassaCodigos = listaCodigosOmie;

    fecharModal();
    if (typeof window.abrirModalAlteracaoProduto === 'function') {
      window.abrirModalAlteracaoProduto({
        emMassa: true,
        total: listaCodigosOmie.length,
        codigos: listaCodigosOmie,
      });
    } else {
      alert('Modal de alteração não carregou. Recarregue a página (F5).');
    }
  }

  btnAbrir.addEventListener('click', () => {
    wrapRenderCatalogo();
    state.sessionAtiva = true;
    abrirModal();
  });

  btnFechar?.addEventListener('click', fecharModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) fecharModal();
  });

  btnSelecionar?.addEventListener('click', () => {
    if (state.selectMode) {
      setSelectMode(false);
      atualizarContadores();
      return;
    }
    state.sessionAtiva = true;
    syncExternalFilter();
    fecharModal();
    setSelectMode(true);
    wrapRenderCatalogo();
    injetarBotoesX();
  });

  selectBarConcluir?.addEventListener('click', () => {
    setSelectMode(false);
    abrirModal();
  });

  btnRegistrar?.addEventListener('click', abrirRegistroEmMassa);
  btnLimpar?.addEventListener('click', () => {
    limparExclusoes();
    alert('Produtos removidos pelo X foram restaurados no filtro.');
  });
  btnRecuperarHamburguer?.addEventListener('click', recuperarHamburguerOriginal);

  // Se o usuário limpar filtro externo por outro caminho (ex.: menu Lista), sincroniza estado
  const clearOrig = window.__clearListaProdutosExternalFilter;
  if (typeof clearOrig === 'function' && !window.__lpBulkClearPatched) {
    window.__lpBulkClearPatched = true;
    window.__clearListaProdutosExternalFilter = function (...args) {
      state.excluded.clear();
      state.sessionAtiva = false;
      setSelectMode(false);
      atualizarContadores();
      return clearOrig.apply(this, args);
    };
  }

  atualizarContadores();
})();
