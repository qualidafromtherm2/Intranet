// Admin — menu radial no menu lateral (long press)
(function () {
  'use strict';

  const LONG_PRESS_MS = 550;
  const API = '/api/nav/admin';
  const NAV_KEYS_OBSOLETOS = ['side:rh:constr18', 'side:produtos:constr3'];
  const NAV_TARGET_SEL = [
    '.side-menu > a[data-nav-key]',
    '.side-menu a[data-nav-key]',
    '.shell-nav-button[data-mirror-nav]',
    '.menu-link[data-nav-key]',
  ].join(',');

  let radialOverlay = null;
  let radialContext = null;
  let pressTimer = null;
  let pressTargetEl = null;
  let suppressClickUntil = 0;
  let reorderState = null;
  let visaoClienteAtiva = false;
  let visaoClienteUserId = null;
  let visaoClienteUsername = '';
  let botoesCache = [];
  let adminInicializado = false;
  let delegacaoAtiva = false;
  let pageDelegacaoAtiva = false;
  const ACTIONS_MENU = ['chamado', 'mover', 'renomear', 'historico', 'visao'];
  const ACTIONS_PAGINA = ['chamado', 'historico', 'visao'];
  const ACTION_DEFS = {
    chamado: { icon: 'fa-headset', label: 'Abrir chamado' },
    mover: { icon: 'fa-arrows-up-down-left-right', label: 'Alterar posição' },
    renomear: { icon: 'fa-pen', label: 'Editar botão' },
    historico: { icon: 'fa-clock-rotate-left', label: 'Abrir histórico' },
    visao: { icon: 'fa-eye', label: 'Visão cliente' },
  };

  let radialModo = 'menu';

  function ehAdmin() {
    if (typeof window.usuarioEhAdminSistema === 'function') {
      return window.usuarioEhAdminSistema();
    }
    const rawRoles = window.userRoles ?? window.__sessionUser?.roles ?? [];
    const roles = Array.isArray(rawRoles)
      ? rawRoles
      : String(rawRoles || '').split(',').map((s) => s.trim()).filter(Boolean);
    return roles.some((role) => String(role || '').trim().toLowerCase() === 'admin');
  }

  function usuarioLogado() {
    return !!window.__sessionUser;
  }

  function actionIdsForModo(modo) {
    if (!ehAdmin()) return ['chamado'];
    return modo === 'pagina' ? ACTIONS_PAGINA : ACTIONS_MENU;
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
    const root = document.getElementById('sidebarContent') || document.querySelector('.left-side');
    if (!root) return [];
    return Array.from(root.querySelectorAll(NAV_TARGET_SEL));
  }

  function alvoMenuFromEvent(e) {
    const root = document.getElementById('sidebarContent') || document.querySelector('.left-side');
    if (!root) return null;
    const el = e.target?.closest?.(NAV_TARGET_SEL);
    if (!el || !root.contains(el)) return null;
    return el;
  }

  function removerBotoesObsoletosDom() {
    NAV_KEYS_OBSOLETOS.forEach((key) => {
      document.querySelectorAll(`[data-nav-key="${CSS.escape(key)}"]`).forEach((el) => el.remove());
    });
  }

  function labelGrupoPai(parentKey, fallbackLabel) {
    if (fallbackLabel) return String(fallbackLabel).trim();
    if (!parentKey) return 'Outros';
    const el = document.querySelector(`.side-title[data-nav-key="${CSS.escape(parentKey)}"]`);
    return String(el?.dataset?.navLabel || el?.textContent || parentKey).trim().replace(/\s+/g, ' ').slice(0, 60)
      || parentKey.split(':').pop();
  }

  function htmlSelectBotoesAgrupado(botoes, selectedKey) {
    const lista = (botoes || []).filter((b) => b?.key && !NAV_KEYS_OBSOLETOS.includes(b.key));
    const grupos = new Map();
    const soltos = [];

    lista.forEach((b) => {
      const pk = b.parent_key || b.parentKey || '';
      if (!pk) {
        soltos.push(b);
        return;
      }
      if (!grupos.has(pk)) {
        grupos.set(pk, {
          key: pk,
          label: labelGrupoPai(pk, b.parent_label),
          sort: Number(b.parent_sort) || 0,
          items: [],
        });
      }
      grupos.get(pk).items.push(b);
    });

    const gruposOrd = Array.from(grupos.values()).sort((a, b) => {
      if (a.sort !== b.sort) return a.sort - b.sort;
      return a.label.localeCompare(b.label, 'pt-BR');
    });

    let html = '<option value="">— Selecione —</option>';
    gruposOrd.forEach((g) => {
      g.items.sort((a, b) => {
        const ds = (Number(a.sort) || 0) - (Number(b.sort) || 0);
        return ds || String(a.label).localeCompare(String(b.label), 'pt-BR');
      });
      html += `<optgroup label="${esc(g.label)}">`;
      g.items.forEach((b) => {
        const sel = b.key === selectedKey ? ' selected' : '';
        html += `<option value="${esc(b.key)}" data-label="${esc(b.label)}"${sel}>${esc(b.label)}</option>`;
      });
      html += '</optgroup>';
    });

    soltos.sort((a, b) => String(a.label).localeCompare(String(b.label), 'pt-BR'));
    soltos.forEach((b) => {
      const sel = b.key === selectedKey ? ' selected' : '';
      html += `<option value="${esc(b.key)}" data-label="${esc(b.label)}"${sel}>${esc(b.label)}</option>`;
    });

    return html;
  }

  function contextoPaginaFromTarget(targetEl) {
    const el = targetEl instanceof Element ? targetEl : null;
    const navEl = el?.closest?.('[data-nav-key]');
    const section = el?.closest?.(
      '.content-section, .pane, [role="tabpanel"], .main-content, .wrapper > div[id], section[id]'
    );
    const titulo = section?.querySelector?.('h1,h2,h3,.content-section-title,.lp-tab-btn.is-active,.main-header-link.is-active')
      || document.querySelector('.main-header-link.is-active, .lp-tab-btn.is-active, h1, h2');
    const tituloTxt = String(titulo?.textContent || document.title || 'Página')
      .trim().replace(/\s+/g, ' ').slice(0, 120);
    const hash = (location.hash || '').replace(/^#/, '') || 'inicio';
    const navKey = String(navEl?.dataset?.navKey || '').trim();
    const navLabel = String(navEl?.dataset?.navLabel || tituloTxt).trim();
    const codigoRef = navKey || section?.id || hash;
    const tag = el ? el.tagName.toLowerCase() : 'pagina';
    const elId = el?.id ? `#${el.id}` : '';
    const elCls = el?.className ? `.${String(el.className).split(/\s+/)[0]}` : '';

    const contextoDescricao = [
      '[Contexto automático — admin]',
      `Tela/área: ${tituloTxt}`,
      `Referência: ${codigoRef}`,
      `URL: ${location.pathname}${location.hash || ''}`,
      el ? `Clique em: ${tag}${elId}${elCls}` : '',
      '',
      'Descreva abaixo o problema, sugestão ou o que deseja solicitar:',
      '',
    ].filter(Boolean).join('\n');

    return {
      modo: 'pagina',
      el: navEl || el,
      navKey: navKey || `page:${hash}`,
      navLabel: tituloTxt,
      paginaCodigo: codigoRef,
      contextoDescricao,
    };
  }

  function deveIgnorarPressPagina(e) {
    if (!usuarioLogado() || visaoClienteAtiva) return true;
    if (reorderState || document.body.classList.contains('nav-admin-reorder-mode')) return true;
    if (radialOverlay?.classList.contains('is-active')) return true;
    if (alvoMenuFromEvent(e)) return true;
    const t = e.target;
    if (!(t instanceof Element)) return true;
    if (t.closest('.left-side, #sidebarContent, .nav-radial-overlay, .nav-admin-modal-overlay, .chamado-modal-overlay, .agenda-modal-overlay')) return true;
    if (t.closest('input, textarea, select, button, a, label, [contenteditable="true"]')) return true;
    return false;
  }

  function angulosRadial(qtd) {
    if (qtd === 1) return [-90];
    if (qtd === 3) return [-90, 18, 126];
    return [-90, -18, 54, 126, 198];
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

    return navKey ? { el, navKey, navLabel, navSelector, modo: 'menu' } : null;
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

    Object.entries(ACTION_DEFS).forEach(([id, def]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-radial-item';
      btn.dataset.action = id;
      btn.innerHTML = `<i class="fa-solid ${def.icon}"></i><span class="nav-radial-item-label">${esc(def.label)}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        executarAcaoRadial(id);
      });
      radialOverlay.appendChild(btn);
    });

    return radialOverlay;
  }

  function posicionarRadial(x, y, actionIds) {
    const ov = ensureRadialOverlay();
    ov.style.left = '0';
    ov.style.top = '0';
    const hub = ov.querySelector('.nav-radial-hub');
    hub.style.left = `${x}px`;
    hub.style.top = `${y}px`;

    const ids = actionIds || ACTIONS_MENU;
    const angles = angulosRadial(ids.length);
    const radius = 78;
    let idx = 0;

    ov.querySelectorAll('.nav-radial-item').forEach((btn) => {
      const actId = btn.dataset.action;
      const show = ids.includes(actId);
      btn.style.display = show ? '' : 'none';
      if (!show) return;
      const angle = angles[idx++];
      const rad = (angle * Math.PI) / 180;
      btn.style.left = `${x + Math.cos(rad) * radius}px`;
      btn.style.top = `${y + Math.sin(rad) * radius}px`;
      btn._angle = angle;
    });
  }

  function abrirRadial(ctx, x, y, modo) {
    if (!usuarioLogado()) return;
    radialContext = ctx;
    radialModo = modo === 'pagina' ? 'pagina' : 'menu';
    const ov = ensureRadialOverlay();
    const ids = actionIdsForModo(radialModo);
    posicionarRadial(x, y, ids);
    ov.classList.add('is-active');
    requestAnimationFrame(() => ov.classList.add('is-open'));
  }

  function fecharRadial() {
    if (!radialOverlay) return;
    radialOverlay.classList.remove('is-open');
    radialContext = null;
    setTimeout(() => {
      if (radialOverlay && !radialOverlay.classList.contains('is-open')) {
        radialOverlay.classList.remove('is-active');
      }
    }, 200);
  }

  function executarAcaoRadial(actionId) {
    const ctx = radialContext;
    fecharRadial();
    if (!ctx) return;
    if (!ehAdmin() && actionId !== 'chamado') return;

    if (actionId === 'chamado') abrirChamadoDoBotao(ctx);
    else if (actionId === 'mover' && ctx.modo !== 'pagina') iniciarModoReordenar(ctx);
    else if (actionId === 'renomear' && ctx.modo !== 'pagina') abrirModalRenomear(ctx);
    else if (actionId === 'historico') abrirHistoricoDoContexto(ctx);
    else if (actionId === 'visao') abrirModalVisaoCliente();
  }

  async function carregarBotoes() {
    if (botoesCache.length) return botoesCache;
    try {
      const r = await fetch(`${API}/botoes`, { credentials: 'include' });
      const d = await r.json();
      if (r.ok && d.ok) {
        botoesCache = (d.botoes || []).filter((b) => !NAV_KEYS_OBSOLETOS.includes(b.key));
      }
    } catch (_) {}
    return botoesCache;
  }

  async function abrirChamadoDoBotao(ctx) {
    await carregarBotoes();
    if (typeof window.abrirChamadoSuporteComBotao !== 'function') {
      alert('Modal de chamado indisponível.');
      return;
    }
    const opts = {
      nav_key: ctx.navKey,
      nav_label: ctx.navLabel,
      aba: 'novo',
    };
    if (ctx.modo === 'pagina') {
      opts.contexto_descricao = ctx.contextoDescricao || '';
      opts.contexto_pagina_codigo = ctx.paginaCodigo || ctx.navKey || '';
      if (String(ctx.navKey || '').startsWith('page:')) {
        opts.nav_key = '';
      }
    }
    window.abrirChamadoSuporteComBotao(opts);
  }

  function abrirHistoricoDoContexto(ctx) {
    const temChaveMenu = ctx.navKey && !String(ctx.navKey).startsWith('page:') && !String(ctx.navKey).startsWith('side:custom:');
    if (temChaveMenu) {
      abrirModalHistorico(ctx);
      return;
    }
    abrirModalEscolherBotaoVisao('Histórico — escolha o botão', 'todos', async (navKey) => {
      await carregarBotoes();
      const b = botoesCache.find((x) => x.key === navKey);
      abrirModalHistorico({ navKey, navLabel: b?.label || navKey, el: null });
    });
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
      <div class="nav-admin-meta-chave">Chave: ${esc(ctx.navKey)}</div>`,
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
      const sel = overlay.querySelector('#navAdminVisaoUser');
      const uid = sel.value;
      if (!uid) return;
      const username = sel.selectedOptions?.[0]?.textContent?.trim() || '';
      overlay.remove();
      await aplicarVisaoCliente(uid, username);
    });
  }

  async function aplicarVisaoCliente(userId, username) {
    try {
      const r = await fetch(`${API}/visao-cliente/${encodeURIComponent(userId)}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);

      if (typeof window.__applyNavPermissionTree === 'function') {
        window.__applyNavPermissionTree(d);
      }
      visaoClienteAtiva = true;
      visaoClienteUserId = String(d.userId || userId);
      visaoClienteUsername = username || '';
      mostrarBarraVisaoCliente(d);
    } catch (err) {
      alert('Erro ao aplicar visão: ' + err.message);
    }
  }

  async function alterarPermissaoVisaoCliente(navKey, allow) {
    if (!visaoClienteUserId) return;
    const r = await fetch(`${API}/visao-cliente/${encodeURIComponent(visaoClienteUserId)}/permissao`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nav_key: navKey, allow }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
    if (typeof window.__applyNavPermissionTree === 'function') {
      window.__applyNavPermissionTree(d);
    }
    return d;
  }

  async function abrirModalEscolherBotaoVisao(titulo, filtro, onEscolher) {
    await carregarBotoes();
    const lista = botoesCache.filter((b) => {
      if (NAV_KEYS_OBSOLETOS.includes(b.key)) return false;
      if (filtro === 'permitidos') return visaoClienteDataKeysPermitidos().has(b.key);
      if (filtro === 'nao_permitidos') return !visaoClienteDataKeysPermitidos().has(b.key);
      return true;
    });

    const overlay = criarModal(
      titulo,
      `<div class="nav-admin-field">
        <label>Botão do menu</label>
        <select id="navAdminVisaoBotaoSel">${htmlSelectBotoesAgrupado(lista, '')}</select>
      </div>`,
      `<button type="button" class="nav-admin-btn nav-admin-btn-secondary nav-admin-cancelar">Cancelar</button>
       <button type="button" class="nav-admin-btn nav-admin-btn-primary" id="navAdminVisaoBotaoOk">Confirmar</button>`
    );

    overlay.querySelector('.nav-admin-cancelar').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#navAdminVisaoBotaoOk').addEventListener('click', async () => {
      const navKey = overlay.querySelector('#navAdminVisaoBotaoSel').value;
      if (!navKey) return alert('Selecione um botão.');
      overlay.remove();
      try {
        await onEscolher(navKey);
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  }

  function visaoClienteDataKeysPermitidos() {
    const keys = new Set();
    if (window.__navPermissionsByKey) {
      Object.entries(window.__navPermissionsByKey).forEach(([k, v]) => {
        if (v) keys.add(k);
      });
    }
    return keys;
  }

  function mostrarBarraVisaoCliente(data) {
    document.getElementById('navVisaoClienteBar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'navVisaoClienteBar';
    bar.className = 'nav-visao-cliente-bar';
    const nomeUser = visaoClienteUsername ? ` (${esc(visaoClienteUsername)})` : '';
    bar.innerHTML = `
      <i class="fa-solid fa-eye"></i>
      <span>Visão cliente ativa${nomeUser}</span>
      <button type="button" id="navVisaoClienteAdd">Adicionar botão</button>
      <button type="button" id="navVisaoClienteRemove">Remover botão</button>
      <button type="button" id="navVisaoClienteFechar">Fechar visão cliente</button>`;
    document.body.appendChild(bar);

    bar.querySelector('#navVisaoClienteAdd').addEventListener('click', () => {
      abrirModalEscolherBotaoVisao('Liberar botão para o usuário', 'nao_permitidos', async (navKey) => {
        await alterarPermissaoVisaoCliente(navKey, true);
      });
    });

    bar.querySelector('#navVisaoClienteRemove').addEventListener('click', () => {
      abrirModalEscolherBotaoVisao('Remover botão deste usuário', 'permitidos', async (navKey) => {
        await alterarPermissaoVisaoCliente(navKey, false);
      });
    });

    bar.querySelector('#navVisaoClienteFechar').addEventListener('click', async () => {
      visaoClienteAtiva = false;
      visaoClienteUserId = null;
      visaoClienteUsername = '';
      bar.remove();
      if (typeof window.applyCurrentUserPermissionsToUI === 'function') {
        await window.applyCurrentUserPermissionsToUI();
      }
    });
  }

  function iniciarModoReordenar(ctx) {
    if (reorderState) cancelarReordenar();
    fecharRadial();
    cancelarPress();
    document.body.classList.add('nav-admin-reorder-mode');
    ctx.el.classList.add('nav-admin-target');
    ctx.el.setAttribute('draggable', 'true');

    const hint = document.createElement('div');
    hint.className = 'nav-admin-reorder-hint';
    hint.id = 'navAdminReorderHint';
    hint.innerHTML = `<span>Arraste <b>${esc(ctx.navLabel)}</b> para a nova posição (sem segurar — arraste direto)</span>
      <button type="button" id="navAdminReorderCancel">Cancelar</button>`;
    document.body.appendChild(hint);
    hint.querySelector('#navAdminReorderCancel').addEventListener('click', cancelarReordenar);

    document.querySelectorAll('.sidebar-content .side-menu, .left-side .side-menu').forEach((menu) => {
      menu.classList.add('nav-drop-target');
    });

    const menus = Array.from(document.querySelectorAll('.sidebar-content .side-menu, .left-side .side-menu'));
    menus.forEach((menu) => {
      menu.addEventListener('dragover', onReorderDragOver);
      menu.addEventListener('drop', onReorderDrop);
    });

    reorderState = { ctx, hint, menus };

    ctx.el.addEventListener('dragstart', onReorderDragStart);
    ctx.el.addEventListener('dragend', onReorderDragEnd);
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
      reorderState.ctx.el.removeEventListener('dragstart', onReorderDragStart);
      reorderState.ctx.el.removeEventListener('dragend', onReorderDragEnd);
    }
    if (reorderState?.menus) {
      reorderState.menus.forEach((menu) => {
        menu.classList.remove('nav-drop-target');
        menu.removeEventListener('dragover', onReorderDragOver);
        menu.removeEventListener('drop', onReorderDrop);
      });
    }
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
    if (!usuarioLogado() || visaoClienteAtiva) return;
    if (reorderState || document.body.classList.contains('nav-admin-reorder-mode')) return;
    if (radialOverlay?.classList.contains('is-active')) return;
    if (e.button != null && e.button !== 0) return;
    cancelarPress();
    const meta = metaFromEl(el);
    if (!meta) return;

    pressTargetEl = el;
    const x = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
    const y = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0;

    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressClickUntil = Date.now() + 900;
      abrirRadial(meta, x, y, 'menu');
    }, LONG_PRESS_MS);
  }

  function iniciarPressPagina(e) {
    if (deveIgnorarPressPagina(e)) return;
    if (e.button != null && e.button !== 0) return;
    cancelarPress();
    pressTargetEl = e.target;
    const x = e.clientX ?? 0;
    const y = e.clientY ?? 0;

    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressClickUntil = Date.now() + 900;
      const ctx = contextoPaginaFromTarget(pressTargetEl);
      abrirRadial(ctx, x, y, 'pagina');
    }, LONG_PRESS_MS);
  }

  function bindPressPagina() {
    if (!usuarioLogado() || pageDelegacaoAtiva) return;
    pageDelegacaoAtiva = true;

    document.addEventListener('mousedown', iniciarPressPagina, true);
    document.addEventListener('mouseup', finalizarPress, true);
    document.addEventListener('click', bloquearClickPosLongPress, true);

    document.addEventListener('contextmenu', (e) => {
      if (!usuarioLogado() || visaoClienteAtiva) return;
      if (reorderState || document.body.classList.contains('nav-admin-reorder-mode')) return;
      if (alvoMenuFromEvent(e)) return;
      if (deveIgnorarPressPagina(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const ctx = contextoPaginaFromTarget(e.target);
      suppressClickUntil = Date.now() + 900;
      abrirRadial(ctx, e.clientX, e.clientY, 'pagina');
    }, true);
  }

  function finalizarPress(e) {
    if (pressTimer) {
      cancelarPress();
      pressTargetEl = null;
      return;
    }
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }
    pressTargetEl = null;
  }

  function bloquearClickPosLongPress(e) {
    if (Date.now() >= suppressClickUntil) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  }

  function bindLongPress() {
    if (!usuarioLogado() || delegacaoAtiva) return;
    const root = document.getElementById('sidebarContent') || document.querySelector('.left-side');
    if (!root) return;
    delegacaoAtiva = true;

    root.addEventListener('mousedown', (e) => {
      const el = alvoMenuFromEvent(e);
      if (el) iniciarPress(e, el);
    });

    root.addEventListener('touchstart', (e) => {
      const el = alvoMenuFromEvent(e);
      if (el) iniciarPress(e, el);
    }, { passive: true });

    root.addEventListener('mouseup', finalizarPress, true);
    root.addEventListener('mouseleave', (e) => {
      if (pressTargetEl && !pressTargetEl.contains(e.relatedTarget)) cancelarPress();
    }, true);
    root.addEventListener('touchend', finalizarPress, true);
    root.addEventListener('touchcancel', cancelarPress, true);
    root.addEventListener('click', bloquearClickPosLongPress, true);

    root.addEventListener('contextmenu', (e) => {
      if (!usuarioLogado()) return;
      if (reorderState || document.body.classList.contains('nav-admin-reorder-mode')) return;
      const el = alvoMenuFromEvent(e);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const meta = metaFromEl(el);
      if (meta) {
        suppressClickUntil = Date.now() + 900;
        abrirRadial(meta, e.clientX, e.clientY, 'menu');
      }
    }, true);
  }

  function init() {
    if (!usuarioLogado()) return;
    if (ehAdmin()) removerBotoesObsoletosDom();
    bindLongPress();
    bindPressPagina();
    if (ehAdmin() && !adminInicializado) {
      adminInicializado = true;
      aplicarOrdemSalva();
      carregarBotoes();
    }
  }

  function tentarInit(tentativa) {
    if (usuarioLogado()) {
      init();
      return;
    }
    if (tentativa < 40) {
      setTimeout(() => tentarInit(tentativa + 1), 250);
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && radialOverlay?.classList.contains('is-active')) {
      fecharRadial();
    }
  });

  document.addEventListener('DOMContentLoaded', () => tentarInit(0));

  document.addEventListener('auth:loggedIn', () => setTimeout(init, 150));
  window.addEventListener('auth:changed', () => setTimeout(init, 150));

  window.__navAdminRecarregarBotoes = () => {
    botoesCache = [];
    return carregarBotoes();
  };

  window.__navAdminHtmlSelectBotoes = htmlSelectBotoesAgrupado;
})();
