/**
 * Combobox de Tipo de falha (catálogo sac.tipo_falha).
 * - Só mostra o combo com opções cadastradas.
 * - × em cada tipo exclui do catálogo.
 * - "+ Inserir" abre campo para cadastrar novo; depois volta ao combo.
 * Usado no MASP (D2) e no modal Editar OS → Fechamento.
 */
(function (global) {
  const API = '/api/sac/at/tipos-falha';
  let _cache = null;
  let _cacheAt = 0;
  const CACHE_MS = 5000;

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function norm(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  const SLUG_MAP = {
    producao: 'Produção',
    engenharia: 'Engenharia',
    cliente: 'Cliente',
    comercial: 'Comercial',
  };

  function displayName(valor) {
    const v = String(valor || '').trim();
    if (!v) return '';
    return SLUG_MAP[norm(v)] || v;
  }

  async function list(force) {
    const now = Date.now();
    if (!force && _cache && now - _cacheAt < CACHE_MS) return _cache.slice();
    const resp = await fetch(API, { credentials: 'include' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || 'Falha ao listar tipos de falha.');
    _cache = Array.isArray(data.tipos) ? data.tipos : [];
    _cacheAt = now;
    return _cache.slice();
  }

  function invalidate() {
    _cache = null;
    _cacheAt = 0;
  }

  async function create(nome) {
    const n = String(nome || '').trim().slice(0, 120);
    if (!n) throw new Error('Informe o nome do tipo.');
    const resp = await fetch(API, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: n }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || 'Falha ao criar tipo.');
    invalidate();
    return data.tipo || { id: data.id, nome: n };
  }

  async function remove(id) {
    const resp = await fetch(`${API}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || 'Falha ao excluir tipo.');
    invalidate();
    return true;
  }

  function mount(el, opts = {}) {
    if (!el) return null;
    let value = displayName(opts.value || '');
    let modoInserir = false;
    let aberto = false;
    let salvando = false;

    el.className = `at-tipo-falha-combo ${opts.className || ''}`.trim();
    el.innerHTML = '';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'at-tipo-falha-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');

    const menu = document.createElement('div');
    menu.className = 'at-tipo-falha-menu';
    menu.hidden = true;

    const livreWrap = document.createElement('div');
    livreWrap.className = 'at-tipo-falha-livre-wrap';
    livreWrap.innerHTML = `
      <input type="text" class="at-tipo-falha-livre" maxlength="120" placeholder="Novo tipo de falha...">
      <button type="button" class="at-tipo-falha-cancelar" title="Cancelar">✕</button>`;
    const livreInp = livreWrap.querySelector('input');
    const cancelBtn = livreWrap.querySelector('.at-tipo-falha-cancelar');

    el.appendChild(trigger);
    el.appendChild(menu);
    el.appendChild(livreWrap);

    function syncTrigger() {
      trigger.textContent = value || '— selecionar —';
      trigger.classList.toggle('is-empty', !value);
    }

    function mostrarCombo() {
      modoInserir = false;
      el.classList.remove('is-inserindo');
      trigger.style.display = '';
      livreWrap.style.display = 'none';
      menu.hidden = true;
      aberto = false;
      syncTrigger();
    }

    function mostrarInserir() {
      modoInserir = true;
      el.classList.add('is-inserindo');
      trigger.style.display = 'none';
      menu.hidden = true;
      aberto = false;
      livreWrap.style.display = 'flex';
      livreInp.value = '';
      setTimeout(() => livreInp.focus(), 0);
    }

    function fecharMenu() {
      aberto = false;
      menu.hidden = true;
    }

    async function emitir(novo) {
      value = displayName(novo);
      syncTrigger();
      if (typeof opts.onChange === 'function') {
        await opts.onChange(value);
      }
    }

    async function renderMenu() {
      let tipos = [];
      try {
        tipos = await list(true);
      } catch (err) {
        menu.innerHTML = `<div class="at-tipo-falha-item disabled">${esc(err.message || err)}</div>`;
        return;
      }
      const parts = [];
      if (!tipos.length) {
        parts.push('<div class="at-tipo-falha-item disabled">Nenhum tipo cadastrado</div>');
      }
      for (const t of tipos) {
        const sel = norm(t.nome) === norm(value) ? ' is-selected' : '';
        parts.push(`
          <div class="at-tipo-falha-item${sel}" data-nome="${esc(t.nome)}">
            <span class="at-tipo-falha-nome">${esc(t.nome)}</span>
            <button type="button" class="at-tipo-falha-del" data-id="${t.id}" data-nome="${esc(t.nome)}" title="Excluir tipo do catálogo">×</button>
          </div>`);
      }
      parts.push(`
        <div class="at-tipo-falha-item at-tipo-falha-inserir" data-acao="inserir">
          <span>+ Inserir</span>
        </div>`);
      menu.innerHTML = parts.join('');

      menu.querySelectorAll('.at-tipo-falha-item[data-nome]').forEach((item) => {
        item.addEventListener('mousedown', async (e) => {
          if (e.target.closest('.at-tipo-falha-del')) return;
          e.preventDefault();
          fecharMenu();
          try {
            await emitir(item.dataset.nome || '');
          } catch (err) {
            alert(err.message || err);
          }
        });
      });

      menu.querySelectorAll('.at-tipo-falha-del').forEach((btn) => {
        btn.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const nome = btn.dataset.nome || '';
          if (!confirm(`Excluir definitivamente o tipo "${nome}" do catálogo?`)) return;
          try {
            await remove(btn.dataset.id);
            if (norm(value) === norm(nome)) await emitir('');
            await renderMenu();
          } catch (err) {
            alert(err.message || err);
          }
        });
      });

      menu.querySelector('[data-acao="inserir"]')?.addEventListener('mousedown', (e) => {
        e.preventDefault();
        mostrarInserir();
      });
    }

    trigger.addEventListener('click', async () => {
      if (aberto) {
        fecharMenu();
        return;
      }
      aberto = true;
      menu.hidden = false;
      menu.innerHTML = '<div class="at-tipo-falha-item disabled">Carregando...</div>';
      await renderMenu();
    });

    async function confirmarInserir() {
      if (salvando) return;
      const n = String(livreInp.value || '').trim();
      if (!n) {
        mostrarCombo();
        return;
      }
      salvando = true;
      try {
        await create(n);
        mostrarCombo();
        await emitir(n);
      } catch (err) {
        alert(err.message || err);
        livreInp.focus();
      } finally {
        salvando = false;
      }
    }

    livreInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmarInserir();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        mostrarCombo();
      }
    });
    livreInp.addEventListener('blur', () => {
      setTimeout(() => {
        if (!modoInserir || salvando) return;
        if (document.activeElement === cancelBtn) return;
        // Sem texto: só cancela. Com texto: grava.
        if (!String(livreInp.value || '').trim()) mostrarCombo();
        else confirmarInserir();
      }, 120);
    });
    cancelBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      mostrarCombo();
    });

    document.addEventListener('mousedown', (e) => {
      if (!el.contains(e.target)) fecharMenu();
    });

    mostrarCombo();

    return {
      getValue: () => value,
      setValue: (v) => {
        value = displayName(v);
        mostrarCombo();
      },
      refresh: () => invalidate(),
    };
  }

  global.__AtTipoFalha = {
    list,
    create,
    remove,
    invalidate,
    displayName,
    mount,
  };
})(typeof window !== 'undefined' ? window : globalThis);
