/**
 * Campo "Cadastrar estoque mínimo" no modal Quantidade para separação/compra.
 * Só aparece quando o produto ainda não tem estoque mínimo (> 0).
 * Grava no Confirmar, junto com a quantidade.
 */
(function () {
  if (window.__modalQtdEstoqueMinimoInstalado) return;
  window.__modalQtdEstoqueMinimoInstalado = true;

  const ROW_ID = 'modalAcoesQtdMinimoRow';
  const INPUT_ID = 'modalAcoesQtdMinimoInput';
  let _ctx = { codigo: '', codigo_produto: '', descricao: '' };
  let _bound = false;
  let _salvando = false;

  function $(id) {
    return document.getElementById(id);
  }

  function podeEditarProduto() {
    if (typeof window.usuarioTemPermissaoSistema !== 'function') return true;
    return window.usuarioTemPermissaoSistema('top:produto')
      || window.usuarioTemPermissaoSistema('side:rh:epi');
  }

  function setErro(msg) {
    const erro = $('modalAcoesQtdErro');
    if (!erro) return;
    erro.textContent = msg || '';
    erro.style.display = msg ? 'block' : 'none';
  }

  function garantirCampo() {
    if ($(ROW_ID)) return;
    const multiploRow = $('modalAcoesQtdMultiploRow');
    const erro = $('modalAcoesQtdErro');
    const host = multiploRow || erro;
    if (!host) return;

    const row = document.createElement('div');
    row.id = ROW_ID;
    row.style.cssText = 'display:none;flex-direction:column;gap:6px;padding:10px 12px;border-radius:10px;border:1px solid #fdba74;background:#fff7ed;';
    row.innerHTML = `
      <label for="${INPUT_ID}" style="font-size:12px;font-weight:700;color:#9a3412;">
        <i class="fa-solid fa-pen-to-square" style="margin-right:6px;"></i>Cadastrar estoque mínimo
      </label>
      <input id="${INPUT_ID}" type="number" min="0.001" step="0.001" inputmode="decimal" autocomplete="off" placeholder="Informe o estoque mínimo" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #fdba74;border-radius:8px;font-size:16px;font-weight:700;color:#9a3412;background:#fff;" />
    `;
    host.parentNode.insertBefore(row, erro || host.nextSibling);
  }

  function ocultarCampo() {
    const row = $(ROW_ID);
    const input = $(INPUT_ID);
    if (row) row.style.display = 'none';
    if (input) input.value = '';
  }

  function mostrarCampo() {
    const row = $(ROW_ID);
    if (!row) return;
    row.style.display = 'flex';
    const input = $(INPUT_ID);
    if (input) input.value = '';
  }

  function atualizarCaches(minimo) {
    const codigo = _ctx.codigo;
    const itemCache = (window.produtosCatalogoOmie || []).find((p) => p.codigo === codigo);
    if (itemCache) itemCache.estoque_minimo = minimo;
    const itemLista = (window.__omieFullCache || []).find((p) => p.codigo === codigo);
    if (itemLista) {
      itemLista.estoque_minimo = minimo;
      itemLista.abaixo_minimo = minimo > 0 && Number(itemLista.saldo_almox || 0) < minimo;
    }
    if (window.__estoqueMinimoCache && window.__estoqueMinimoCache[codigo]) {
      window.__estoqueMinimoCache[codigo].min = minimo;
    }
  }

  async function carregarVisibilidade() {
    garantirCampo();
    ocultarCampo();
    if (!podeEditarProduto() || !_ctx.codigo) return;
    try {
      const resp = await fetch('/api/produtos/' + encodeURIComponent(_ctx.codigo), { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return;
      const minimo = Number(data.estoque_minimo ?? 0);
      const limitado = data.item_limitado === true || data.item_limitado === 'true';
      if (limitado) return;
      if (Number.isFinite(minimo) && minimo > 0) return;
      mostrarCampo();
    } catch (err) {
      console.warn('[estoque-minimo-qtd] falha ao consultar produto:', err);
    }
  }

  async function gravarSeInformado() {
    const row = $(ROW_ID);
    const input = $(INPUT_ID);
    if (!row || row.style.display === 'none') return true;
    const raw = String(input?.value || '').trim().replace(',', '.');
    if (!raw) return true;

    const minimo = Number(raw);
    if (!Number.isFinite(minimo) || minimo <= 0) {
      setErro('Informe um estoque mínimo maior que zero, ou deixe em branco.');
      input?.focus({ preventScroll: true });
      return false;
    }

    const idProd = Number(_ctx.codigo_produto);
    if (!Number.isFinite(idProd) || idProd <= 0) {
      setErro('Produto sem ID da Omie. Use Editar produto para cadastrar o estoque mínimo.');
      return false;
    }

    const minimoResp = await fetch('/api/omie/estoque/minimo-produto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id_prod: idProd, codigo: _ctx.codigo, quan_min: minimo })
    });
    const minimoData = await minimoResp.json().catch(() => ({}));
    if (!minimoResp.ok || !minimoData.ok) {
      throw new Error(minimoData.error || 'Falha ao alterar estoque mínimo na Omie.');
    }

    const localResp = await fetch('/api/produtos/' + encodeURIComponent(_ctx.codigo) + '/estoque-minimo', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ estoque_minimo: minimo })
    });
    const localData = await localResp.json().catch(() => ({}));
    if (!localResp.ok || !localData.ok) {
      throw new Error(localData.error || 'Alterado na Omie, mas falhou ao atualizar o cadastro local.');
    }

    atualizarCaches(minimo);
    try { await window.carregarEstoqueCards?.({ force: true, codigos: [_ctx.codigo] }); } catch (_) {}
    ocultarCampo();
    return true;
  }

  function interceptarConfirmacao() {
    if (_bound) return;
    const overlay = $('modalAcoesQtdOverlay');
    const btn = $('modalAcoesQtdConfirmar');
    const qtdInput = $('modalAcoesQtdInput');
    if (!overlay || !btn) return;
    _bound = true;

    const tentarGravarAntes = async (event) => {
      const row = $(ROW_ID);
      if (!row || row.style.display === 'none') return;
      const raw = String($(INPUT_ID)?.value || '').trim();
      if (!raw) return;
      if (_salvando) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      _salvando = true;
      btn.disabled = true;
      setErro('');
      try {
        const ok = await gravarSeInformado();
        if (!ok) return;
        btn.disabled = false;
        _salvando = false;
        btn.click();
      } catch (err) {
        setErro(err.message || 'Erro ao gravar estoque mínimo.');
      } finally {
        _salvando = false;
        btn.disabled = false;
      }
    };

    btn.addEventListener('click', tentarGravarAntes, true);
    qtdInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') tentarGravarAntes(event);
    }, true);
  }

  function observarOverlay() {
    const overlay = $('modalAcoesQtdOverlay');
    if (!overlay) return false;
    garantirCampo();
    interceptarConfirmacao();
    let visivelAntes = false;
    const sync = () => {
      const visivel = overlay.style.display === 'flex';
      if (visivel && !visivelAntes) void carregarVisibilidade();
      if (!visivel) ocultarCampo();
      visivelAntes = visivel;
    };
    new MutationObserver(sync).observe(overlay, { attributes: true, attributeFilter: ['style'] });
    sync();
    return true;
  }

  function envolverAberturaAcoes() {
    const orig = window.abrirModalAcoesProduto;
    if (typeof orig !== 'function' || orig.__estoqueMinimoQtdWrapped) return typeof orig === 'function';
    const wrapped = function (codigo, codigoProduto, descricao, unidade, saldoAlmox, saldoEnderecado, divergente) {
      _ctx = {
        codigo: String(codigo || '').trim(),
        codigo_produto: codigoProduto,
        descricao: descricao || ''
      };
      return orig.apply(this, arguments);
    };
    wrapped.__estoqueMinimoQtdWrapped = true;
    window.abrirModalAcoesProduto = wrapped;
    return true;
  }

  function iniciar() {
    envolverAberturaAcoes();
    if (observarOverlay()) return;
    const obs = new MutationObserver(() => {
      envolverAberturaAcoes();
      if (observarOverlay()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
