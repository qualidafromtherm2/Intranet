/**
 * Etiquetas de saída da SEP (código + ID + nº SEP).
 * Só imprime — não altera estoque / Omie / ETQ_rec_impresso.
 * Auto-conecta nos modais da SEP (botão + pergunta ao finalizar).
 */
(function (global) {
  'use strict';

  const STATUS_OK = new Set(['Separado', 'Aguardando retirada', 'Concluído']);
  const _ofereceuPorSep = new Set();

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nSolicDoModal(root) {
    if (!root) return '';
    const title = root.querySelector('#modalSeparacaoTitle')?.textContent || '';
    const m = String(title).match(/SEP-\d+(?:\.\d+)?/i);
    if (m) return m[0];
    const fromAttr = root.querySelector('[data-n-solic]')?.getAttribute('data-n-solic');
    return String(fromAttr || '').trim();
  }

  function nSolicAguardModal(modal) {
    const h = modal?.querySelector('span[style*="font-weight:700"]')?.textContent || '';
    const m = String(h).match(/SEP-\d+(?:\.\d+)?/i);
    return m ? m[0] : '';
  }

  function itensProntos(itens) {
    const list = Array.isArray(itens) ? itens : [];
    if (!list.length) return false;
    return list.every((it) => STATUS_OK.has(String(it.status || '')));
  }

  function modalSepItensTodosSeparados(modal) {
    if (!modal) return false;
    const rows = modal.querySelectorAll('[data-item-row]');
    if (!rows.length) return false;
    let algum = false;
    for (const row of rows) {
      const st = String(row.dataset.status || '').trim();
      if (!st) continue;
      algum = true;
      if (!STATUS_OK.has(st)) return false;
    }
    return algum;
  }

  async function oferecerImpressao(nSolic, itens, opts) {
    const options = opts || {};
    const n = String(nSolic || '').trim();
    if (!n) return;
    if (!options.force && itens && !itensProntos(itens)) return;
    if (!options.force && options.checkDom) {
      const modal = document.getElementById('modalSeparacaoLogistica');
      if (!modalSepItensTodosSeparados(modal)) return;
    }
    if (_ofereceuPorSep.has(n) && !options.force) return;
    _ofereceuPorSep.add(n);
    const ok = confirm(
      'Separação da ' + n + ' concluída.\n\n' +
      'Deseja imprimir as etiquetas de saída (código + SEP)?\n\n' +
      'Isso não altera o estoque — só identifica os itens.'
    );
    if (!ok) return;
    await abrirModal(n);
  }

  async function abrirModal(nSolic) {
    const n = String(nSolic || '').trim();
    if (!n) return;

    document.getElementById('modalImpressaoEtiquetasSep')?.remove();

    let itens = [];
    try {
      const r = await fetch('/api/logistica/sep/' + encodeURIComponent(n) + '/etiquetas-saida', {
        credentials: 'include'
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || ('Erro HTTP ' + r.status));
      itens = Array.isArray(d.itens) ? d.itens : [];
    } catch (err) {
      alert('Não foi possível carregar os itens para impressão: ' + (err.message || err));
      return;
    }
    if (!itens.length) {
      alert('Nenhum item elegível para etiqueta nesta SEP.');
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'modalImpressaoEtiquetasSep';
    modal.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.65);z-index:10080;' +
      'display:flex;align-items:center;justify-content:center;';
    modal.innerHTML =
      '<div style="background:#1c1c1c;border:1px solid #2a2a2a;border-radius:16px;width:min(720px,96vw);max-height:90vh;' +
      'display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6);">' +
      '<div style="display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid #2a2a2a;background:#171717;flex-shrink:0;">' +
      '<i class="fa-solid fa-print" style="color:#38bdf8;font-size:1.05rem;"></i>' +
      '<span style="font-weight:700;font-size:1rem;color:#f0f0f0;">Imprimir etiquetas — ' + esc(n) + '</span>' +
      '<button type="button" id="btnImpSepFecharX" style="margin-left:auto;background:none;border:none;color:#9ca3af;font-size:1.3rem;cursor:pointer;padding:2px 6px;line-height:1;">&#x2715;</button>' +
      '</div>' +
      '<div style="padding:10px 16px 0;font-size:.74rem;color:#9ca3af;">' +
      'Tire o item que não quiser etiqueta. Nos demais, ajuste a quantidade (padrão = qtd separada). Não altera estoque.' +
      '</div>' +
      '<div id="modalImpSepLista" style="overflow-y:auto;flex:1;padding:10px 12px 12px;"></div>' +
      '<div style="padding:12px 16px;border-top:1px solid #2a2a2a;display:flex;justify-content:flex-end;gap:8px;background:#171717;flex-shrink:0;">' +
      '<button type="button" id="btnImpSepCancelar" style="padding:7px 14px;border:1px solid #4b5563;border-radius:8px;background:transparent;color:#d1d5db;font-weight:700;font-size:.82rem;cursor:pointer;">Cancelar</button>' +
      '<button type="button" id="btnImpSepImprimir" style="padding:7px 14px;border:none;border-radius:8px;background:#0369a1;color:#e0f2fe;font-weight:700;font-size:.82rem;cursor:pointer;">' +
      '<i class="fa-solid fa-print" style="margin-right:4px;"></i>Imprimir selecionados</button>' +
      '</div></div>';
    document.body.appendChild(modal);

    const listaEl = modal.querySelector('#modalImpSepLista');
    const state = itens.map((it) => ({
      solic_id: it.solic_id,
      codigo: it.codigo_produto || '',
      descricao: it.descricao || '',
      qtd: Math.max(1, Math.round(Number(it.quantidade_default) || 1)),
      etq_ids: Array.isArray(it.etq_ids) ? it.etq_ids : [],
      ativo: true
    }));

    function renderLista() {
      if (!state.some((s) => s.ativo)) {
        listaEl.innerHTML =
          '<div style="padding:16px;color:#9ca3af;font-size:.8rem;">Nenhum item selecionado. Feche ou cancele.</div>';
        return;
      }
      listaEl.innerHTML = state.map((s, idx) => {
        if (!s.ativo) return '';
        const idsTxt = s.etq_ids.length
          ? 'ID(s): ' + s.etq_ids.join(', ')
          : 'Sem ID bipado (etiqueta só com código + SEP)';
        return (
          '<div data-imp-idx="' + idx + '" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;' +
          'padding:10px 12px;margin-bottom:8px;background:#171717;border:1px solid #2a2a2a;border-radius:10px;">' +
          '<div style="min-width:0;">' +
          '<div style="font-weight:700;font-size:.84rem;color:#f0f0f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
          esc(s.codigo) + '</div>' +
          '<div style="font-size:.72rem;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
          esc(s.descricao) + '</div>' +
          '<div style="font-size:.66rem;color:#64748b;margin-top:2px;">' + esc(idsTxt) + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">' +
          '<label style="display:flex;flex-direction:column;gap:2px;font-size:.65rem;color:#94a3b8;font-weight:700;">Qtd' +
          '<input type="number" class="imp-sep-qtd" min="1" max="500" step="1" value="' + s.qtd + '" ' +
          'style="width:72px;padding:6px 8px;border:1px solid #475569;border-radius:8px;background:#1f2937;color:#f8fafc;font-size:.85rem;font-weight:700;" />' +
          '</label>' +
          '<button type="button" class="imp-sep-tirar" title="Não imprimir este item" ' +
          'style="padding:6px 10px;border:1px solid #7f1d1d;border-radius:8px;background:transparent;color:#f87171;font-weight:700;font-size:.72rem;cursor:pointer;">Tirar</button>' +
          '</div></div>'
        );
      }).join('');
    }
    renderLista();

    const fechar = () => modal.remove();
    modal.querySelector('#btnImpSepFecharX')?.addEventListener('click', fechar);
    modal.querySelector('#btnImpSepCancelar')?.addEventListener('click', fechar);
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) fechar();
    });

    listaEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.imp-sep-tirar');
      if (!btn) return;
      const row = btn.closest('[data-imp-idx]');
      const idx = parseInt(row && row.dataset.impIdx, 10);
      if (!Number.isFinite(idx) || !state[idx]) return;
      state[idx].ativo = false;
      renderLista();
    });
    listaEl.addEventListener('change', (ev) => {
      const inp = ev.target.closest('.imp-sep-qtd');
      if (!inp) return;
      const row = inp.closest('[data-imp-idx]');
      const idx = parseInt(row && row.dataset.impIdx, 10);
      if (!Number.isFinite(idx) || !state[idx]) return;
      let v = Math.round(parseFloat(inp.value));
      if (!Number.isFinite(v) || v < 1) v = 1;
      if (v > 500) v = 500;
      state[idx].qtd = v;
      inp.value = String(v);
    });

    modal.querySelector('#btnImpSepImprimir')?.addEventListener('click', async () => {
      const selecionados = state.filter((s) => s.ativo).map((s) => ({
        solic_id: s.solic_id,
        quantidade: s.qtd
      }));
      if (!selecionados.length) {
        alert('Selecione ao menos um item.');
        return;
      }
      const btn = modal.querySelector('#btnImpSepImprimir');
      const htmlAntes = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
      try {
        const usuario = (document.getElementById('userNameDisplay')?.textContent || '').trim();
        const r = await fetch('/api/logistica/sep/' + encodeURIComponent(n) + '/imprimir-etiquetas-saida', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ itens: selecionados, usuario, via_fila: true })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) throw new Error(d.error || ('Erro HTTP ' + r.status));
        alert((d.quantidade || 0) + ' etiqueta(s) enviada(s) para a fila de impressão.');
        fechar();
      } catch (err) {
        alert('Falha ao imprimir: ' + (err.message || err));
        btn.disabled = false;
        btn.innerHTML = htmlAntes;
      }
    });
  }

  function ensureBtnImprimir(footer, nSolic, idBtn) {
    if (!footer || !nSolic) return;
    if (footer.querySelector('#' + idBtn)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = idBtn;
    btn.innerHTML = '<i class="fa-solid fa-print" style="margin-right:4px;"></i>Imprimir etiquetas';
    btn.style.cssText =
      'padding:7px 14px;border:none;border-radius:8px;background:#0369a1;color:#e0f2fe;' +
      'font-weight:700;font-size:.82rem;cursor:pointer;';
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      abrirModal(nSolic);
    });
    footer.appendChild(btn);
  }

  function wireModalSeparacao(modal) {
    if (!modal || modal.dataset.sepEtqWired === '1') return;
    modal.dataset.sepEtqWired = '1';
    const n = nSolicDoModal(modal);
    const footer = modal.querySelector('#modalSepFooterCancel') ||
      modal.querySelector('[style*="border-top"][style*="flex"]');
    if (n && footer) ensureBtnImprimir(footer, n, 'btnSepImprimirEtiquetas');
  }

  function wireModalAguard(modal) {
    if (!modal || modal.dataset.sepEtqWired === '1') return;
    const titulo = modal.querySelector('span[style*="font-weight:700"]')?.textContent || '';
    const colOk = /Separado|Aguardando retirada|Concluído/i.test(titulo);
    if (!colOk) return;
    modal.dataset.sepEtqWired = '1';
    const n = nSolicAguardModal(modal);
    const footer = modal.querySelector('div[style*="border-top"][style*="flex-shrink:0"]') ||
      modal.lastElementChild?.querySelector?.('div') ||
      Array.from(modal.querySelectorAll('div')).find((d) =>
        d.style && String(d.getAttribute('style') || '').includes('border-top')
      );
    const foot = modal.querySelector('div[style*="justify-content:space-between"][style*="border-top"]');
    const target = foot || footer;
    if (n && target) {
      const right = target.querySelector('div[style*="display:flex"][style*="gap"]') || target;
      ensureBtnImprimir(right, n, 'btnAguardImprimirEtiquetas');
    }
  }

  function scanModais() {
    const sep = document.getElementById('modalSeparacaoLogistica');
    if (sep) wireModalSeparacao(sep);
    const ag = document.getElementById('modalAguardandoRetiradaSep');
    if (ag) wireModalAguard(ag);
  }

  function instalarObserver() {
    const obs = new MutationObserver(() => {
      scanModais();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    scanModais();
  }

  function instalarFetchHook() {
    if (global.__sepEtqFetchHooked) return;
    global.__sepEtqFetchHooked = true;
    const orig = global.fetch.bind(global);
    global.fetch = async function sepEtqFetchWrapped(input, init) {
      const res = await orig(input, init);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const isSep =
          /\/api\/logistica\/itens_solicitados\/separar(?:-parcial)?(?:\?|$)/.test(url) ||
          /\/api\/logistica\/itens_solicitados\/separar$/.test(url);
        const isPatchSeparar = /\/api\/logistica\/itens_solicitados\/separar/.test(url);
        if (isPatchSeparar || isSep) {
          const clone = res.clone();
          const d = await clone.json().catch(() => null);
          if (d && d.ok) {
            setTimeout(() => {
              const modal = document.getElementById('modalSeparacaoLogistica');
              const n = nSolicDoModal(modal);
              if (n) {
                oferecerImpressao(n, null, { checkDom: true });
              }
            }, 450);
          }
        }
      } catch (_) { /* ignore */ }
      return res;
    };
  }

  function boot() {
    instalarFetchHook();
    instalarObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global._abrirModalImpressaoEtiquetasSep = abrirModal;
  global._solOferecerImpressaoEtiquetasSep = oferecerImpressao;
  global._solItensProntosEtiquetaSep = itensProntos;
})(typeof window !== 'undefined' ? window : globalThis);
