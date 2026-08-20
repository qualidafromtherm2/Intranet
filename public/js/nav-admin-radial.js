// Admin — menu radial (botão direito)
(function () {
  'use strict';

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
  let reorderState = null;
  let visaoClienteAtiva = false;
  let visaoClienteUserId = null;
  let visaoClienteUsername = '';
  let botoesCache = [];
  let adminInicializado = false;
  let delegacaoAtiva = false;
  let pageDelegacaoAtiva = false;
  const ACTIONS_MENU = ['chamado', 'mover', 'renomear', 'historico', 'visao', 'permissoes'];
  const ACTIONS_PAGINA = ['chamado', 'historico', 'visao', 'permissoes'];
  const ACTION_DEFS = {
    chamado: { icon: 'fa-headset', label: 'Abrir chamado' },
    mover: { icon: 'fa-arrows-up-down-left-right', label: 'Alterar posição' },
    renomear: { icon: 'fa-pen', label: 'Editar botão' },
    historico: { icon: 'fa-clock-rotate-left', label: 'Abrir histórico' },
    visao: { icon: 'fa-eye', label: 'Visão cliente' },
    permissoes: { icon: 'fa-user-lock', label: 'Ver permissões' },
  };
  const OWNER_USERNAME = 'leandro.s';

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

  /** Mesma regra de "Permissões por botão": nome visível no menu, sem ícone. */
  function labelNavEl(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('i, svg, img, script, style, .chamado-badge, .badge, [hidden]').forEach((n) => n.remove());
    const visible = String(clone.textContent || '').replace(/\s+/g, ' ').trim();
    if (visible) return visible.slice(0, 80);
    const data = String(el.dataset.navLabel || '').trim();
    if (data) return data.slice(0, 80);
    return String(el.getAttribute('title') || el.getAttribute('aria-label') || '').trim().slice(0, 80);
  }

  function coletarBotoesMenuLateral(botoesApi) {
    const byKey = new Map((botoesApi || []).map((b) => [String(b.key), b]));
    const root = document.getElementById('sidebarContent') || document.querySelector('.left-side');
    if (!root) {
      return (botoesApi || []).filter((b) => b?.key && !NAV_KEYS_OBSOLETOS.includes(b.key));
    }

    const visto = new Set();
    const resultado = [];

    function pushEl(el, parentKey, parentLabel, parentSort, sort) {
      const meta = metaFromEl(el);
      if (!meta?.navKey || NAV_KEYS_OBSOLETOS.includes(meta.navKey) || visto.has(meta.navKey)) return;
      if (String(meta.navKey).startsWith('side:custom:') && !byKey.has(meta.navKey)) return;
      visto.add(meta.navKey);
      const fromApi = byKey.get(meta.navKey) || {};
      resultado.push({
        ...fromApi,
        key: meta.navKey,
        label: labelNavEl(el) || meta.navLabel || fromApi.label || meta.navKey,
        parent_key: el.dataset.navParent || parentKey || fromApi.parent_key || '',
        parent_label: parentLabel || fromApi.parent_label || '',
        parent_sort: parentSort,
        sort,
      });
    }

    Array.from(root.querySelectorAll('.side-wrapper')).forEach((wrap, gi) => {
      const title = wrap.querySelector(':scope > .side-title');
      const parentKey = title?.dataset?.navKey || '';
      const parentLabel = labelNavEl(title) || String(title?.textContent || '').replace(/\s+/g, ' ').trim();
      Array.from(wrap.querySelectorAll('.side-menu [data-nav-key], .side-menu .shell-nav-button[data-mirror-nav]'))
        .forEach((el, ii) => pushEl(el, parentKey, parentLabel, gi, ii));
    });

    return resultado.length ? resultado : (botoesApi || []).filter((b) => b?.key && !NAV_KEYS_OBSOLETOS.includes(b.key));
  }

  function agruparBotoesMenu(botoes) {
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
    gruposOrd.forEach((g) => {
      g.items.sort((a, b) => {
        const ds = (Number(a.sort) || 0) - (Number(b.sort) || 0);
        return ds || String(a.label).localeCompare(String(b.label), 'pt-BR');
      });
    });
    soltos.sort((a, b) => String(a.label).localeCompare(String(b.label), 'pt-BR'));
    return { gruposOrd, soltos };
  }

  function htmlListaBotoesComoPermissoes(botoes) {
    const { gruposOrd, soltos } = agruparBotoesMenu(botoes);
    if (!gruposOrd.length && !soltos.length) {
      return '<div class="nav-admin-perm-empty">Nenhum botão nesta lista.</div>';
    }
    let html = '<div class="nav-admin-perm-tree" id="navAdminVisaoBotaoLista">';
    gruposOrd.forEach((g) => {
      html += `<div class="nav-admin-perm-cat">
        <div class="nav-admin-perm-cat-label">${esc(g.label)}</div>
        <div class="nav-admin-perm-cat-items">`;
      g.items.forEach((b) => {
        const busca = `${g.label} ${b.label}`.toLowerCase();
        html += `<button type="button" class="nav-admin-perm-item" data-key="${esc(b.key)}" data-search="${esc(busca)}">${esc(b.label)}</button>`;
      });
      html += '</div></div>';
    });
    soltos.forEach((b) => {
      html += `<button type="button" class="nav-admin-perm-item" data-key="${esc(b.key)}" data-search="${esc(String(b.label).toLowerCase())}">${esc(b.label)}</button>`;
    });
    html += '</div>';
    return html;
  }

  function htmlSelectBotoesAgrupado(botoes, selectedKey) {
    const { gruposOrd, soltos } = agruparBotoesMenu(botoes);

    let html = '<option value="">— Selecione —</option>';
    gruposOrd.forEach((g) => {
      html += `<optgroup label="${esc(g.label)}">`;
      g.items.forEach((b) => {
        const sel = b.key === selectedKey ? ' selected' : '';
        html += `<option value="${esc(b.key)}" data-label="${esc(b.label)}"${sel}>${esc(b.label)}</option>`;
      });
      html += '</optgroup>';
    });

    soltos.forEach((b) => {
      const sel = b.key === selectedKey ? ' selected' : '';
      html += `<option value="${esc(b.key)}" data-label="${esc(b.label)}"${sel}>${esc(b.label)}</option>`;
    });

    return html;
  }

  function elementoEstaVisivel(el) {
    if (!(el instanceof Element)) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  function textoLimpoEl(el) {
    if (!(el instanceof Element)) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('i, svg, img, script, style, .badge, .lp-tab-count, .chamado-badge').forEach((n) => n.remove());
    return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function contextoDescricaoChamado(local, referencia) {
    return [
      `Local: ${local || 'Área da página'}`,
      `Referência: ${referencia || 'Página atual'}`,
      '',
      'Descreva abaixo o problema, sugestão ou o que deseja solicitar:',
      '',
    ].join('\n');
  }

  function paneVisivel() {
    return Array.from(document.querySelectorAll('.tab-pane, .kanban-page')).find(elementoEstaVisivel) || null;
  }

  function referenciaTelaAtual(el) {
    const lpRoot = el?.closest?.('#listaProdutos, #listaProdutosConteudo, #solicitacoesConteudo, #kanbanSolicitacoesConteudo');
    if (lpRoot) {
      const active = document.querySelector('#listaProdutos .lp-tab-btn.lp-tab-active');
      const t = textoLimpoEl(active);
      if (t) return t.slice(0, 80);
    }
    const pane = el?.closest?.('.tab-pane, .kanban-page') || paneVisivel();
    if (pane) {
      const lp = pane.querySelector('.lp-tab-btn.lp-tab-active');
      if (lp && elementoEstaVisivel(lp)) {
        const t = textoLimpoEl(lp);
        if (t) return t.slice(0, 80);
      }
      const title = Array.from(pane.querySelectorAll('.content-section-title, [data-nav-label]'))
        .find((n) => elementoEstaVisivel(n) && textoLimpoEl(n));
      if (title) {
        const t = title.dataset?.navLabel || textoLimpoEl(title);
        if (t) return String(t).replace(/\s+/g, ' ').trim().slice(0, 80);
      }
    }
    const header = document.querySelector('.main-header-link.is-active, .menu-link.active, .menu-link.is-active');
    if (header && elementoEstaVisivel(header)) {
      return (header.dataset?.navLabel || textoLimpoEl(header) || labelNavEl(header)).slice(0, 80);
    }
    const side = document.querySelector('.side-menu a.active, .side-menu .is-active, .side-menu [aria-current="page"]');
    if (side) return labelNavEl(side).slice(0, 80);
    return 'Página atual';
  }

  function navKeyDaTela(el) {
    const pane = el?.closest?.('.tab-pane, .kanban-page') || paneVisivel();
    if (pane?.id) {
      const sel = document.querySelector(
        `[data-nav-selector="#${CSS.escape(pane.id)}"], [data-target="${CSS.escape(pane.id)}"]`
      );
      const meta = metaFromEl(sel);
      if (meta?.navKey) return meta.navKey;
      const porId = {
        listaProdutos: 'side:produtos:lista',
        inicio: 'side:inicio',
      };
      if (porId[pane.id]) return porId[pane.id];
    }
    const lp = el?.closest?.('#listaProdutos, #listaProdutosConteudo');
    if (lp) return 'side:produtos:lista';
    return '';
  }

  function nomeLocalClicado(el) {
    if (!(el instanceof Element)) return 'Área da página';

    const card = el.closest('.produto-catalogo-card');
    if (card) {
      const codigo = String(card.dataset.productCode || '').trim();
      const desc = textoLimpoEl(card.querySelector('.produto-card-descricao'));
      let campo = 'Card do produto';
      if (el.tagName === 'IMG' || el.closest('img') || el.closest('[style*="height:140px"]')) campo = 'Foto do produto';
      else if (el.closest('.produto-card-descricao')) campo = 'Descrição';
      else if (el.closest('[id^="estoque-card-"], [id^="min-badge-"], [id^="compra-badge-"]')) campo = 'Estoque';
      else if (el.closest('button')) campo = textoLimpoEl(el.closest('button')) || 'Botão Ações';
      const prod = [codigo, desc].filter(Boolean).join(' — ');
      return (prod ? `${campo} (${prod})` : campo).slice(0, 160);
    }

    let cur = el;
    for (let i = 0; i < 10 && cur && cur !== document.body; i++) {
      const aria = String(cur.getAttribute?.('aria-label') || '').trim();
      if (aria) return aria.slice(0, 120);
      const title = String(cur.getAttribute?.('title') || '').trim();
      if (title && title.length < 90) return title.slice(0, 120);
      const dl = String(cur.dataset?.navLabel || cur.dataset?.label || cur.dataset?.campo || '').trim();
      if (dl) return dl.slice(0, 120);
      const ph = String(cur.getAttribute?.('placeholder') || '').trim();
      if (ph) return `Campo: ${ph}`.slice(0, 120);
      if (cur.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(cur.id)}"]`);
        const lt = textoLimpoEl(lab);
        if (lt) return lt.slice(0, 120);
      }
      cur = cur.parentElement;
    }

    const field = el.closest('label, th, dt, legend, .content-section-title');
    const ft = textoLimpoEl(field);
    if (ft && ft.length <= 80) return ft;

    const nearby = el.closest('[id]') ;
    if (nearby?.id && nearby.id.length > 2 && nearby.id.length < 40 && !/^(svg|bar)$/i.test(nearby.id)) {
      const pretty = nearby.id
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .trim();
      if (pretty) return pretty.slice(0, 80);
    }

    const txt = textoLimpoEl(el).slice(0, 80);
    if (txt) return txt;
    return 'Área da página';
  }

  function chaveMenuValida(navKey) {
    const k = String(navKey || '').trim();
    if (!k) return false;
    if (k.startsWith('page:')) return false;
    if (k.startsWith('side:custom:')) return false;
    return true;
  }

  function contextoPaginaFromTarget(targetEl) {
    const el = targetEl instanceof Element ? targetEl : null;
    const local = nomeLocalClicado(el);
    const referencia = referenciaTelaAtual(el);
    const navKey = navKeyDaTela(el);
    const navEl = navKey ? document.querySelector(`[data-nav-key="${CSS.escape(navKey)}"]`) : null;
    const navLabel = navEl ? (labelNavEl(navEl) || navEl.dataset?.navLabel || referencia) : referencia;

    return {
      modo: 'pagina',
      el: el || navEl,
      navKey: navKey || `page:${referencia}`,
      navLabel,
      paginaCodigo: navKey || referencia,
      contextoDescricao: contextoDescricaoChamado(local, referencia),
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
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return true;
    return false;
  }

  function angulosRadial(qtd) {
    const n = Math.max(1, Number(qtd) || 1);
    if (n === 1) return [-90];
    const step = 360 / n;
    return Array.from({ length: n }, (_, i) => -90 + i * step);
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

    const parentLabel = labelGrupoPai(el.dataset?.navParent || '', '');
    const contextoDescricao = contextoDescricaoChamado(navLabel, parentLabel || 'Menu lateral');
    return navKey ? { el, navKey, navLabel, navSelector, modo: 'menu', contextoDescricao } : null;
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
    const radius = ids.length > 5 ? 88 : 78;
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
    else if (actionId === 'permissoes') abrirPermissoesDoContexto(ctx);
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
      contexto_descricao: ctx.contextoDescricao || '',
      contexto_pagina_codigo: ctx.paginaCodigo || ctx.navKey || ctx.navLabel || '',
    };
    if (!chaveMenuValida(ctx.navKey)) {
      opts.nav_key = '';
    }
    window.abrirChamadoSuporteComBotao(opts);
  }

  function abrirHistoricoDoContexto(ctx) {
    const temChaveMenu = chaveMenuValida(ctx.navKey);
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

  function abrirPermissoesDoContexto(ctx) {
    if (!ehAdmin()) return;
    if (chaveMenuValida(ctx?.navKey)) {
      abrirModalPermissoes(ctx.navKey, ctx.navLabel);
      return;
    }
    abrirModalEscolherBotaoVisao('Permissões — escolha o botão', 'todos', async (navKey) => {
      await carregarBotoes();
      const b = botoesCache.find((x) => x.key === navKey);
      abrirModalPermissoes(navKey, b?.label || navKey);
    });
  }

  async function abrirModalPermissoes(navKey, navLabel) {
    const overlay = criarModal(
      `Permissões — ${navLabel || navKey}`,
      `<p class="nav-admin-perm-hint">Ative ou desative o acesso deste botão para cada usuário.</p>
       <input type="search" id="navAdminPermUserBusca" class="nav-admin-perm-busca" placeholder="Buscar usuário..." autocomplete="off">
       <div id="navAdminPermUserLista" class="nav-admin-perm-users">Carregando...</div>`,
      `<button type="button" class="nav-admin-btn nav-admin-btn-secondary nav-admin-cancelar">Fechar</button>`
    );
    overlay.querySelector('.nav-admin-modal')?.classList.add('nav-admin-modal-perm');
    overlay.querySelector('.nav-admin-cancelar').addEventListener('click', () => overlay.remove());

    const listaEl = overlay.querySelector('#navAdminPermUserLista');
    const buscaEl = overlay.querySelector('#navAdminPermUserBusca');

    function renderUsuarios(usuarios) {
      if (!usuarios.length) {
        listaEl.innerHTML = '<div class="nav-admin-perm-empty">Nenhum usuário encontrado.</div>';
        return;
      }
      listaEl.innerHTML = usuarios.map((u) => {
        const nome = u.nome && u.nome !== u.username ? `${u.username} — ${u.nome}` : u.username;
        const checked = u.allowed ? ' checked' : '';
        const disabled = u.protegido ? ' disabled' : '';
        const lock = u.protegido ? ' <span class="nav-admin-perm-lock">protegido</span>' : '';
        return `<label class="nav-admin-perm-user" data-search="${esc(String(nome).toLowerCase())}">
          <span class="nav-admin-perm-user-nome">${esc(nome)}${lock}</span>
          <input type="checkbox" class="nav-admin-perm-toggle" data-user-id="${esc(u.id)}"${checked}${disabled}>
        </label>`;
      }).join('');

      listaEl.querySelectorAll('.nav-admin-perm-toggle').forEach((chk) => {
        chk.addEventListener('change', async () => {
          const uid = chk.dataset.userId;
          const allow = chk.checked;
          chk.disabled = true;
          try {
            const r = await fetch(`${API}/visao-cliente/${encodeURIComponent(uid)}/permissao`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nav_key: navKey, allow }),
            });
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
          } catch (err) {
            chk.checked = !allow;
            alert('Não foi possível alterar: ' + (err.message || err));
          } finally {
            if (!chk.closest('.nav-admin-perm-user')?.querySelector('.nav-admin-perm-lock')) {
              chk.disabled = false;
            }
          }
        });
      });
    }

    buscaEl.addEventListener('input', () => {
      const q = String(buscaEl.value || '').trim().toLowerCase();
      listaEl.querySelectorAll('.nav-admin-perm-user').forEach((row) => {
        const hay = row.dataset.search || '';
        row.classList.toggle('is-hidden', !!q && !hay.includes(q));
      });
    });

    try {
      const r = await fetch(`${API}/permissoes/${encodeURIComponent(navKey)}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const titulo = overlay.querySelector('h3');
      if (titulo && d.nav_label) titulo.textContent = `Permissões — ${d.nav_label}`;
      renderUsuarios(d.usuarios || []);
    } catch (err) {
      listaEl.innerHTML = `<div class="nav-admin-perm-empty" style="color:#f87171;">Falha ao carregar: ${esc(err.message || err)}</div>`;
    }
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

  function clonarSessaoUser(u) {
    if (!u) return null;
    try { return JSON.parse(JSON.stringify(u)); } catch (_) { return { ...u }; }
  }

  function atualizarNomeHeaderSessao(user) {
    const el = document.getElementById('userNameDisplay');
    if (!el) return;
    if (!user) {
      el.textContent = '';
      return;
    }
    el.textContent = user.nome || user.username || user.login || '';
  }

  function montarUserVisaoCliente(d) {
    const base = d?.user && typeof d.user === 'object' ? d.user : {};
    const username = d.username || base.username || '';
    const nome = d.nome || base.nome || base.nome_completo || username;
    const roles = Array.isArray(d.roles) ? d.roles : (Array.isArray(base.roles) ? base.roles : []);
    const setor = d.setor || base.setor || null;
    const funcao = d.funcao || base.funcao || base.funcao_nome || null;
    return {
      id: String(d.userId || base.id || ''),
      username,
      nome,
      nome_completo: base.nome_completo || nome,
      email: base.email || null,
      roles,
      setor,
      sector: setor,
      sector_id: d.sector_id ?? base.sector_id ?? null,
      funcao,
      funcao_nome: funcao,
    };
  }

  /** Troca a identidade da tela para o usuário da visão (como se tivesse logado nele). */
  function aplicarIdentidadeVisaoCliente(user) {
    if (!window.__sessionUserReal) {
      window.__sessionUserReal = clonarSessaoUser(window.__sessionUser);
      window.__userRolesReal = window.userRoles;
    }
    window.__sessionUser = user;
    window.userRoles = user?.roles || [];
    atualizarNomeHeaderSessao(user);
  }

  function restaurarIdentidadeReal() {
    if (window.__sessionUserReal) {
      window.__sessionUser = window.__sessionUserReal;
      window.__sessionUserReal = null;
    }
    if (Object.prototype.hasOwnProperty.call(window, '__userRolesReal')) {
      window.userRoles = window.__userRolesReal;
      delete window.__userRolesReal;
    }
    atualizarNomeHeaderSessao(window.__sessionUser);
  }

  function publicarVisaoCliente(info) {
    window.__visaoCliente = info && info.ativa
      ? {
          ativa: true,
          userId: info.userId || null,
          username: info.username || '',
          roles: Array.isArray(info.roles) ? info.roles : String(info.roles || '').split(',').map((s) => s.trim()).filter(Boolean),
          setor: info.setor || '',
          sector_id: info.sector_id ?? null,
          funcao: info.funcao || '',
        }
      : { ativa: false };
    window.dispatchEvent(new CustomEvent('intranet:visao-cliente', { detail: window.__visaoCliente }));
  }

  async function aplicarVisaoCliente(userId, username) {
    try {
      const r = await fetch(`${API}/visao-cliente/${encodeURIComponent(userId)}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);

      visaoClienteAtiva = true;
      visaoClienteUserId = String(d.userId || userId);
      visaoClienteUsername = username || d.username || '';
      const userVisao = montarUserVisaoCliente(d);
      aplicarIdentidadeVisaoCliente(userVisao);
      publicarVisaoCliente({
        ativa: true,
        userId: visaoClienteUserId,
        username: visaoClienteUsername,
        roles: userVisao.roles,
        setor: userVisao.setor,
        sector_id: userVisao.sector_id,
        funcao: userVisao.funcao,
      });
      if (typeof window.__applyNavPermissionTree === 'function') {
        window.__applyNavPermissionTree(d);
      }
      if (typeof window.__refreshPermissoesSessao === 'function') {
        window.__refreshPermissoesSessao();
      }
      mostrarBarraVisaoCliente(d);
    } catch (err) {
      restaurarIdentidadeReal();
      visaoClienteAtiva = false;
      visaoClienteUserId = null;
      visaoClienteUsername = '';
      publicarVisaoCliente({ ativa: false });
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
    const permitidos = visaoClienteDataKeysPermitidos();
    const lista = coletarBotoesMenuLateral(botoesCache).filter((b) => {
      if (NAV_KEYS_OBSOLETOS.includes(b.key)) return false;
      if (filtro === 'permitidos') return permitidos.has(b.key);
      if (filtro === 'nao_permitidos') return !permitidos.has(b.key);
      return true;
    });

    const overlay = criarModal(
      titulo,
      `<div class="nav-admin-perm-picker">
        <input type="search" id="navAdminVisaoBotaoBusca" class="nav-admin-perm-busca" placeholder="Buscar permissão..." autocomplete="off">
        <input type="hidden" id="navAdminVisaoBotaoSel" value="">
        ${htmlListaBotoesComoPermissoes(lista)}
      </div>`,
      `<button type="button" class="nav-admin-btn nav-admin-btn-secondary nav-admin-cancelar">Cancelar</button>
       <button type="button" class="nav-admin-btn nav-admin-btn-primary" id="navAdminVisaoBotaoOk">Confirmar</button>`
    );
    overlay.querySelector('.nav-admin-modal')?.classList.add('nav-admin-modal-perm');

    const hidden = overlay.querySelector('#navAdminVisaoBotaoSel');
    const confirmar = async () => {
      const navKey = hidden.value;
      if (!navKey) return alert('Selecione um botão.');
      overlay.remove();
      try {
        await onEscolher(navKey);
      } catch (err) {
        alert(err.message || String(err));
      }
    };

    overlay.querySelector('.nav-admin-cancelar').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#navAdminVisaoBotaoOk').addEventListener('click', confirmar);

    overlay.querySelector('#navAdminVisaoBotaoLista')?.addEventListener('click', (e) => {
      const item = e.target.closest('.nav-admin-perm-item');
      if (!item) return;
      overlay.querySelectorAll('.nav-admin-perm-item.is-selected').forEach((el) => el.classList.remove('is-selected'));
      item.classList.add('is-selected');
      hidden.value = item.dataset.key || '';
    });
    overlay.querySelector('#navAdminVisaoBotaoLista')?.addEventListener('dblclick', (e) => {
      if (e.target.closest('.nav-admin-perm-item')) confirmar();
    });

    overlay.querySelector('#navAdminVisaoBotaoBusca')?.addEventListener('input', (e) => {
      const q = String(e.target.value || '').trim().toLowerCase();
      overlay.querySelectorAll('.nav-admin-perm-item').forEach((item) => {
        const ok = !q || String(item.dataset.search || '').includes(q);
        item.classList.toggle('is-hidden', !ok);
      });
      overlay.querySelectorAll('.nav-admin-perm-cat').forEach((cat) => {
        const any = Array.from(cat.querySelectorAll('.nav-admin-perm-item')).some((i) => !i.classList.contains('is-hidden'));
        cat.classList.toggle('is-hidden', !any);
      });
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
      restaurarIdentidadeReal();
      publicarVisaoCliente({ ativa: false });
      bar.remove();
      if (typeof window.applyCurrentUserPermissionsToUI === 'function') {
        await window.applyCurrentUserPermissionsToUI();
      }
      if (typeof window.__refreshPermissoesSessao === 'function') {
        window.__refreshPermissoesSessao();
      }
    });
  }

  function iniciarModoReordenar(ctx) {
    if (reorderState) cancelarReordenar();
    fecharRadial();
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

  function bindPressPagina() {
    if (!usuarioLogado() || pageDelegacaoAtiva) return;
    pageDelegacaoAtiva = true;

    document.addEventListener('contextmenu', (e) => {
      if (!usuarioLogado() || visaoClienteAtiva) return;
      if (reorderState || document.body.classList.contains('nav-admin-reorder-mode')) return;
      if (alvoMenuFromEvent(e)) return;
      if (deveIgnorarPressPagina(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const ctx = contextoPaginaFromTarget(e.target);
      abrirRadial(ctx, e.clientX, e.clientY, 'pagina');
    }, true);
  }

  function bindMenuDireito() {
    if (!usuarioLogado() || delegacaoAtiva) return;
    const root = document.getElementById('sidebarContent') || document.querySelector('.left-side');
    if (!root) return;
    delegacaoAtiva = true;

    root.addEventListener('contextmenu', (e) => {
      if (!usuarioLogado()) return;
      if (reorderState || document.body.classList.contains('nav-admin-reorder-mode')) return;
      const el = alvoMenuFromEvent(e);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const meta = metaFromEl(el);
      if (meta) abrirRadial(meta, e.clientX, e.clientY, 'menu');
    }, true);
  }

  function init() {
    if (!usuarioLogado()) return;
    if (ehAdmin()) removerBotoesObsoletosDom();
    bindMenuDireito();
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

  /** Abre o menu flutuante (botão direito) a partir de outro módulo — ex.: gráfico. */
  window.__abrirNavRadialPagina = (x, y, targetEl) => {
    if (!usuarioLogado() || visaoClienteAtiva) return false;
    if (reorderState || document.body.classList.contains('nav-admin-reorder-mode')) return false;
    const ctx = contextoPaginaFromTarget(targetEl || document.body);
    abrirRadial(ctx, Number(x) || 0, Number(y) || 0, 'pagina');
    return true;
  };

  if (!document.querySelector('script[data-chamado-aviso-diario]')) {
    const s = document.createElement('script');
    s.src = '/public/js/chamado-aviso-diario.js?v=20260819a';
    s.defer = true;
    s.dataset.chamadoAvisoDiario = '1';
    document.head.appendChild(s);
  }
})();
