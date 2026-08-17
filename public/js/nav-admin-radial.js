// Admin — menu radial no menu lateral (long press)
(function () {
  'use strict';

  const LONG_PRESS_MS = 550;
  const API = '/api/nav/admin';

  let radialOverlay = null;
  let radialContext = null;
  let pressTimer = null;
  let reorderState = null;
  let visaoClienteAtiva = false;
  let botoesCache = [];

  function ehAdmin() {
    return typeof window.usuarioEhAdminSistema === 'function' && window.usuarioEhAdminSistema();
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtData(v) {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (_) {
      return String(v);
    }
  }

  function menuTargets() {
    const sel = [
      '.sidebar-content .menu-link[data-nav-key]',
      '.sidebar-content .side-menu > a[data-nav-key]',
      '.sidebar-content .shell-nav-button[data-mirror-nav]',
    ].join(',');
    return Array.from(document.querySelectorAll(sel));
  }

  function metaFromEl(el) {
    if (!el) return null;
    let navKey = el.dataset.navKey || '';
    let navLabel = el.dataset.navLabel || '';
    let navSelector = el.dataset.navSelector || '';

    if (!navKey && el.dataset.mirrorNav) {
      const mirror = document.querySelector(el.dataset.mirrorNav);
      if (mirror) {
        navKey = mirror.dataset.navKey || '';
        navLabel = mirror.dataset.navLabel || mirror.textContent.trim();
        navSelector = mirror.dataset.navSelector || el.dataset.mirrorNav;
      }
    }

    if (!navKey) {
      navKey = el.id ? `side:custom:${el.id}` : '';
    }
    if (!navLabel) {
      navLabel = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    }

    return navKey ? { el, navKey, navLabel, navSelector } : null;
  }

  function ensureRadialOverlay() {
    if (radialOverlay) return radialOverlay;
    radialOverlay = document.createElement('div');
    radialOverlay.className = 'nav-radial-overlay';
    radialOverlay.innerHTML = `
      <div class="nav-radial-backdrop"></div>
      <div class="nav-radial-hub"><i class="fa-solid fa-bars"></i></div>
    `;
    document.body.appendChild(radialOverlay);

    radialOverlay.querySelector('.nav-radial-backdrop').addEventListener('click', fecharRadial);

    const actions = [
      { id: 'chamado', icon: 'fa-headset', label: 'Abrir chamado', angle: -90 },
      { id: 'mover', icon: 'fa-arrows-up-down-left-right', label: 'Alterar posição', angle: -18 },
      { id: 'renomear', icon: 'fa-pen', label: 'Editar botão', angle: 54 },
      { id: 'historico', icon: 'fa-clock-rotate-left', label: 'Abrir histórico', angle: 126 },
      { id: 'visao', icon: 'fa-eye', label: 'Visão cliente', angle: 198 },
    ];

    const radius = 78;
    actions.forEach((act, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-radial-item';
      btn.dataset.action = act.id;
      btn.style.transitionDelay = `${idx * 0.03}s`;
      btn.innerHTML = `<i class="fa-solid ${act.icon}"></i><span class="nav-radial-item-label">${esc(act.label)}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        executarAcaoRadial(act.id);
      });
      radialOverlay.appendChild(btn);
      btn._angle = act.angle;
    });

    return radialOverlay;
  }

  function posicionarRadial(x, y) {
    const ov = ensureRadialOverlay();
    ov.style.left = '0';
    ov.style.top = '0';
    const hub = ov.querySelector('.nav-radial-hub');
    hub.style.left = `${x}px`;
    hub.style.top = `${y}px`;

    const radius = 78;
    ov.querySelectorAll('.nav-radial-item').forEach((btn) => {
      const rad = (btn._angle * Math.PI) / 180;
      const px = x + Math.cos(rad) * radius;
      const py = y + Math.sin(rad) * radius;
      btn.style.left = `${px}px`;
      btn.style.top = `${py}px`;
    });
  }

  function abrirRadial(ctx, x, y) {
    if (!ehAdmin()) return;
    radialContext = ctx;
    const ov = ensureRadialOverlay();
    posicionarRadial(x, y);
    ov.classList.add('is-active');
    requestAnimationFrame(() => ov.classList.add('is-open'));
  }

  function fecharRadial() {
    if (!radialOverlay) return;
    radialOverlay.classList.remove('is-open');
    setTimeout(() => {
      radialOverlay.classList.remove('is-active');
      radialContext = null;
    }, 180);
  }

  function executarAcaoRadial(actionId) {
    const ctx = radialContext;
    fecharRadial();
    if (!ctx) return;

    if (actionId === 'chamado') abrirChamadoDoBotao(ctx);
    else if (actionId === 'mover') iniciarModoReordenar(ctx);
    else if (actionId === 'renomear') abrirModalRenomear(ctx);
    else if (actionId === 'historico') abrirModalHistorico(ctx);
    else if (actionId === 'visao') abrirModalVisaoCliente();
  }

  async function carregarBotoes() {
    if (botoesCache.length) return botoesCache;
    try {
      const r = await fetch(`${API}/botoes`, { credentials: 'include' });
      const d = await r.json();
      if (r.ok && d.ok) botoesCache = d.botoes || [];
    } catch (_) {}
    return botoesCache;
  }

  function optionsBotoesSelect(selectedKey) {
    return botoesCache.map((b) => {
      const sel = b.key === selectedKey ? ' selected' : '';
      return `<option value="${esc(b.key)}" data-label="${esc(b.label)}"${sel}>${esc(b.label)} (${esc(b.key)})</option>`;
    }).join('');
  }

  async function abrirChamadoDoBotao(ctx) {
    await carregarBotoes();
    if (typeof window.abrirChamadoSuporteComBotao === 'function') {
      window.abrirChamadoSuporteComBotao({ nav_key: ctx.navKey, nav_label: ctx.navLabel });
      return;
    }
    alert('Modal de chamado indisponível.');
  }

  function criarModal(titulo, bodyHtml, footerHtml) {
    const overlay = document.createElement('div');
    overlay.className = 'nav-admin-modal-overlay';
    overlay.innerHTML = `
      <div class="nav-admin-modal" role="dialog" aria-modal="true">
        <header>
          <h3>${esc(titulo)}</h3>
          <button type="button" class="nav-admin-modal-fechar" aria-label="Fechar" style="background:none;border:none;color:#94a3b8;font-size:22px;cursor:pointer;">×</button>
        </header>
        <div class="nav-admin-modal-body">${bodyHtml}</div>
        ${footerHtml ? `<footer>${footerHtml}</footer>` : ''}
      </div>`;
    overlay.querySelector('.nav-admin-modal-fechar').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    return overlay;
  }

  function abrirModalRenomear(ctx) {
    const overlay = criarModal(
      'Editar botão',
      `<div class="nav-admin-field">
        <label for="navAdminRenameInput">Novo nome</label>
        <input id="navAdminRenameInput" type="text" maxlength="80" value="${esc(ctx.navLabel)}">
      </div>
      <div style="font-size:11px;color:#64748b;">Chave: ${esc(ctx.navKey)}</div>`,
      `<button type="button" class="nav-admin-btn nav-admin-btn-secondary nav-admin-cancelar">Cancelar</button>
       <button type="button" class="nav-admin-btn nav-admin-btn-primary nav-admin-salvar-rename">Salvar</button>`
    );

    overlay.querySelector('.nav-admin-cancelar').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.nav-admin-salvar-rename').addEventListener('click', async () => {
      const label = overlay.querySelector('#navAdminRenameInput').value.trim();
      if (!label) return alert('Informe o nome.');
      try {
        const r = await fetch(`${API}/renomear`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nav_key: ctx.navKey, label }),
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);

        ctx.el.dataset.navLabel = label;
        const labelNode = ctx.el.querySelector('i')
          ? Array.from(ctx.el.childNodes).find((n) => n.nodeType === 3 || (n.nodeType === 1 && n.tagName !== 'I'))
          : null;
        if (ctx.el.tagName === 'A' || ctx.el.tagName === 'BUTTON') {
          const icon = ctx.el.querySelector('i');
          ctx.el.textContent = '';
          if (icon) ctx.el.appendChild(icon);
          ctx.el.appendChild(document.createTextNode(' ' + label));
        }
        overlay.remove();
      } catch (err) {
        alert('Erro ao renomear: ' + err.message);
      }
    });
  }

  async function abrirModalHistorico(ctx) {
    const overlay = criarModal(
      `Histórico — ${ctx.navLabel}`,
      `<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
        <button type="button" class="nav-admin-btn nav-admin-btn-primary" id="navAdminHistChamado">
          <i class="fa-solid fa-plus"></i> Incluir atividade (chamado)
        </button>
      </div>
      <div id="navAdminHistConteudo" style="font-size:12px;color:#94a3b8;">Carregando...</div>`,
      ''
    );

    overlay.querySelector('#navAdminHistChamado').addEventListener('click', () => {
      overlay.remove();
      abrirChamadoDoBotao(ctx);
    });

    try {
      const r = await fetch(`${API}/historico/${encodeURIComponent(ctx.navKey)}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);

      const linhas = [];
      (d.chamados || []).forEach((c) => {
        linhas.push({
          quando: c.criado_em,
          tipo: 'Chamado',
          descricao: `#${c.id} — ${c.descricao || ''}`.slice(0, 120),
          quem: c.criado_por_nome || c.criado_por,
        });
      });
      (d.historico || []).forEach((h) => {
        linhas.push({
          quando: h.created_at,
          tipo: h.tipo,
          descricao: h.descricao || '—',
          quem: h.usuario_nome || h.usuario,
        });
      });
      linhas.sort((a, b) => new Date(b.quando) - new Date(a.quando));

      const tbody = linhas.length
        ? linhas.map((l) => `<tr>
            <td>${esc(fmtData(l.quando))}</td>
            <td>${esc(l.tipo)}</td>
            <td>${esc(l.descricao)}</td>
            <td>${esc(l.quem || '—')}</td>
          </tr>`).join('')
        : `<tr><td colspan="4" style="text-align:center;padding:16px;">Nenhum registro.</td></tr>`;

      overlay.querySelector('#navAdminHistConteudo').innerHTML = `
        <table class="nav-admin-table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Usuário</th></tr></thead>
          <tbody>${tbody}</tbody>
        </table>`;
    } catch (err) {
      overlay.querySelector('#navAdminHistConteudo').textContent = 'Erro: ' + err.message;
    }
  }

  function abrirModalVisaoCliente() {
    const overlay = criarModal(
      'Visão cliente',
      `<div class="nav-admin-field">
        <label for="navAdminVisaoUser">Usuário</label>
        <select id="navAdminVisaoUser"><option value="">Carregando...</option></select>
      </div>
      <p style="font-size:12px;color:#94a3b8;margin:0;">Mostra só os botões que o usuário selecionado enxerga.</p>`,
      `<button type="button" class="nav-admin-btn nav-admin-btn-secondary nav-admin-cancelar">Cancelar</button>
       <button type="button" class="nav-admin-btn nav-admin-btn-primary" id="navAdminVisaoAplicar">Aplicar visão</button>`
    );

    overlay.querySelector('.nav-admin-cancelar').addEventListener('click', () => overlay.remove());

    fetch(`${API}/usuarios`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const sel = overlay.querySelector('#navAdminVisaoUser');
        sel.innerHTML = (d.usuarios || []).map((u) =>
          `<option value="${esc(u.id)}">${esc(u.username)}${u.nome ? ' — ' + esc(u.nome) : ''}</option>`
        ).join('');
      })
      .catch(() => {});

    overlay.querySelector('#navAdminVisaoAplicar').addEventListener('click', async () => {
      const uid = overlay.querySelector('#navAdminVisaoUser').value;
      if (!uid) return;
      overlay.remove();
      await aplicarVisaoCliente(uid);
    });
  }

  async function aplicarVisaoCliente(userId) {
    try {
      const r = await fetch(`${API}/visao-cliente/${encodeURIComponent(userId)}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);

      if (typeof window.__applyNavPermissionTree === 'function') {
        window.__applyNavPermissionTree(d);
      }
      visaoClienteAtiva = true;
      mostrarBarraVisaoCliente(d);
    } catch (err) {
      alert('Erro ao aplicar visão: ' + err.message);
    }
  }

  function mostrarBarraVisaoCliente(data) {
    document.getElementById('navVisaoClienteBar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'navVisaoClienteBar';
    bar.className = 'nav-visao-cliente-bar';
    bar.innerHTML = `
      <i class="fa-solid fa-eye"></i>
      <span>Visão cliente ativa (usuário #${esc(data.userId)})</span>
      <button type="button" id="navVisaoClienteFechar">Fechar visão cliente</button>`;
    document.body.appendChild(bar);
    bar.querySelector('#navVisaoClienteFechar').addEventListener('click', async () => {
      visaoClienteAtiva = false;
      bar.remove();
      if (typeof window.applyCurrentUserPermissionsToUI === 'function') {
        await window.applyCurrentUserPermissionsToUI();
      }
    });
  }

  function iniciarModoReordenar(ctx) {
    if (reorderState) cancelarReordenar();
    document.body.classList.add('nav-admin-reorder-mode');
    ctx.el.classList.add('nav-admin-target');
    ctx.el.setAttribute('draggable', 'true');

    const hint = document.createElement('div');
    hint.className = 'nav-admin-reorder-hint';
    hint.id = 'navAdminReorderHint';
    hint.innerHTML = `<span>Arraste <b>${esc(ctx.navLabel)}</b> para a nova posição</span>
      <button type="button" id="navAdminReorderCancel">Cancelar</button>`;
    document.body.appendChild(hint);
    hint.querySelector('#navAdminReorderCancel').addEventListener('click', cancelarReordenar);

    document.querySelectorAll('.sidebar-content .side-menu').forEach((menu) => {
      menu.classList.add('nav-drop-target');
    });

    reorderState = { ctx, hint };

    ctx.el.addEventListener('dragstart', onReorderDragStart);
    ctx.el.addEventListener('dragend', onReorderDragEnd);

    document.querySelectorAll('.sidebar-content .side-menu').forEach((menu) => {
      menu.addEventListener('dragover', onReorderDragOver);
      menu.addEventListener('drop', onReorderDrop);
    });
  }

  function onReorderDragStart(e) {
    if (!reorderState) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', reorderState.ctx.navKey);
  }

  function onReorderDragOver(e) {
    if (!reorderState) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  async function onReorderDrop(e) {
    if (!reorderState) return;
    e.preventDefault();
    const menu = e.currentTarget;
    const ctx = reorderState.ctx;
    const after = e.target.closest('a, button.shell-nav-button');
    if (after && after !== ctx.el && menu.contains(after)) {
      menu.insertBefore(ctx.el, after.nextSibling);
    } else if (!menu.contains(ctx.el)) {
      menu.appendChild(ctx.el);
    }

    await salvarOrdemMenu(menu, ctx);
    cancelarReordenar();
  }

  function onReorderDragEnd() {
    /* salvo no drop */
  }

  async function salvarOrdemMenu(menu, ctx) {
    const parentTitle = menu.closest('.side-wrapper')?.querySelector('.side-title[data-nav-key]');
    const parentKey = parentTitle?.dataset.navKey || ctx.el.dataset.navParent || null;

    const items = Array.from(menu.querySelectorAll('[data-nav-key], .shell-nav-button[data-mirror-nav]'))
      .map((el, idx) => {
        const meta = metaFromEl(el);
        return meta ? { key: meta.navKey, sort: (idx + 1) * 10, label: meta.navLabel } : null;
      })
      .filter(Boolean);

    if (!items.length) return;

    items.forEach((it, idx) => {
      const el = document.querySelector(`[data-nav-key="${CSS.escape(it.key)}"]`);
      if (el) el.dataset.navSort = String((idx + 1) * 10);
    });

    try {
      await fetch(`${API}/reordenar`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nav_key: ctx.navKey,
          parent_key: parentKey,
          items,
        }),
      });
      if (typeof window.syncNavNodes === 'function') window.syncNavNodes(true);
    } catch (err) {
      alert('Erro ao salvar posição: ' + err.message);
    }
  }

  function cancelarReordenar() {
    document.body.classList.remove('nav-admin-reorder-mode');
    document.getElementById('navAdminReorderHint')?.remove();
    if (reorderState?.ctx?.el) {
      reorderState.ctx.el.classList.remove('nav-admin-target');
      reorderState.ctx.el.removeAttribute('draggable');
    }
    document.querySelectorAll('.sidebar-content .side-menu').forEach((menu) => {
      menu.classList.remove('nav-drop-target');
      menu.replaceWith(menu.cloneNode(true));
    });
    reorderState = null;
  }

  async function aplicarOrdemSalva() {
    try {
      const r = await fetch(`${API}/ordem`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.ok || !Array.isArray(d.ordem)) return;

      const porParent = {};
      d.ordem.forEach((row) => {
        const pk = row.parent_key || '_root_';
        if (!porParent[pk]) porParent[pk] = [];
        porParent[pk].push(row);
      });

      Object.entries(porParent).forEach(([parentKey, rows]) => {
        rows.sort((a, b) => (a.sort || 0) - (b.sort || 0));
        let menu = null;
        if (parentKey === '_root_') return;
        const title = document.querySelector(`.side-title[data-nav-key="${CSS.escape(parentKey)}"]`);
        menu = title?.closest('.side-wrapper')?.querySelector('.side-menu');
        if (!menu) return;

        rows.forEach((row) => {
          const el = document.querySelector(`[data-nav-key="${CSS.escape(row.key)}"]`);
          if (el && el.parentElement !== menu) menu.appendChild(el);
          else if (el) menu.appendChild(el);
        });
      });
    } catch (_) {}
  }

  function cancelarPress() {
    clearTimeout(pressTimer);
    pressTimer = null;
  }

  function iniciarPress(e, el) {
    if (!ehAdmin() || visaoClienteAtiva) return;
    if (e.button != null && e.button !== 0) return;
    cancelarPress();
    const meta = metaFromEl(el);
    if (!meta) return;

    const x = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
    const y = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0;

    pressTimer = setTimeout(() => {
      pressTimer = null;
      abrirRadial(meta, x, y);
    }, LONG_PRESS_MS);
  }

  function bindLongPress() {
    menuTargets().forEach((el) => {
      if (el.dataset.navAdminBound === '1') return;
      el.dataset.navAdminBound = '1';

      el.addEventListener('mousedown', (e) => iniciarPress(e, el));
      el.addEventListener('touchstart', (e) => iniciarPress(e, el), { passive: true });
      el.addEventListener('mouseup', cancelarPress);
      el.addEventListener('mouseleave', cancelarPress);
      el.addEventListener('touchend', cancelarPress);
      el.addEventListener('touchcancel', cancelarPress);
      el.addEventListener('contextmenu', (e) => {
        if (!ehAdmin()) return;
        e.preventDefault();
        const meta = metaFromEl(el);
        if (meta) abrirRadial(meta, e.clientX, e.clientY);
      });
    });
  }

  function init() {
    if (!ehAdmin()) return;
    bindLongPress();
    aplicarOrdemSalva();
    carregarBotoes();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(init, 800);
  });

  window.addEventListener('auth:loggedIn', () => setTimeout(init, 400));
  window.addEventListener('auth:changed', () => setTimeout(init, 400));

  const sidebar = document.getElementById('sidebarContent');
  if (sidebar) {
    const obs = new MutationObserver(() => bindLongPress());
    obs.observe(sidebar, { childList: true, subtree: true });
  }

  window.__navAdminRecarregarBotoes = () => {
    botoesCache = [];
    return carregarBotoes();
  };
})();
