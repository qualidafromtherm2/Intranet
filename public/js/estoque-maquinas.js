// Logística — Estoque de máquinas (kanban)
(function () {
  'use strict';

  let _carregado = false;
  let _dados = { embalagem: [], estoque: [], pedidos: [] };
  let _filtro = '';
  let _gruposAbertos = new Set();

  function $(id) {
    return document.getElementById(id);
  }

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
      .replace(/\p{M}/gu, '');
  }

  function fmtQtde(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v ?? '—');
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
      .replace(/,?0+$/, '')
      .replace(/,$/, '') || String(n);
  }

  function fmtData(str) {
    if (!str) return '';
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  }

  function matchFiltro(...parts) {
    const termo = norm(_filtro);
    if (!termo) return true;
    return parts.some((p) => norm(p).includes(termo));
  }

  function setStatus(msg, isErro) {
    const el = $('maqEstoqueStatus');
    if (!el) return;
    if (!msg) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'block';
    el.textContent = msg;
    el.style.color = isErro ? '#fca5a5' : 'var(--inactive-color)';
  }

  function renderColunaVazia(colEl, cntEl, msg) {
    if (colEl) {
      colEl.innerHTML = `<div style="text-align:center;padding:24px 0;color:var(--inactive-color);font-size:12px;">${esc(msg)}</div>`;
    }
    if (cntEl) cntEl.textContent = '0';
  }

  function renderEmbalagem() {
    const colEl = $('maqKanbanEmbalagem');
    const cntEl = $('maqKanbanEmbalagemCount');
    const itens = (_dados.embalagem || []).filter((op) =>
      matchFiltro(op.codigo, op.descricao, op.identificacao, op.numero_pedido)
    );

    if (!itens.length) {
      renderColunaVazia(colEl, cntEl, _filtro
        ? `Nenhuma OP encontrada para "${_filtro}".`
        : 'Nenhuma OP em Embalagem.');
      return;
    }

    const grupos = {};
    for (const op of itens) {
      const key = op.codigo || String(op.id);
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(op);
    }

    colEl.innerHTML = Object.entries(grupos).map(([codigo, ops]) => {
      const qtde = ops.length;
      const desc = ops[0].descricao || '—';
      const opsHtml = ops.map((op) => `
        <div class="kanban-op-card" style="background:rgba(15,23,42,.35);border:1px solid rgba(52,211,153,.18);border-radius:8px;padding:8px 10px;">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
            <span style="font-size:10px;color:#475569;font-weight:600;">#${esc(op.id)}</span>
            <span style="font-size:13px;font-weight:700;color:#e2e8f0;">OP ${esc(op.identificacao || '—')}</span>
            ${op.numero_pedido
              ? `<span class="kanban-op-pedido-numero"><i class="fa-solid fa-link" style="font-size:9px;"></i>Ped. ${esc(op.numero_pedido)}</span>`
              : ''}
          </div>
          ${op.created_at ? `<div style="font-size:10px;color:#64748b;margin-top:4px;">Abertura: <b style="color:#94a3b8;">${esc(fmtData(op.created_at))}</b></div>` : ''}
        </div>
      `).join('');

      return `
        <div class="kanban-prod-grupo" style="background:var(--content-bg,#1e2233);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:12px;">
          <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;color:#f59e0b;letter-spacing:.3px;">${esc(codigo)}</div>
              <div style="font-size:12px;color:#e2e8f0;margin-top:2px;line-height:1.4;">${esc(desc)}</div>
              <div style="font-size:10px;color:#818cf8;font-weight:600;margin-top:4px;">${qtde} OP${qtde === 1 ? '' : 's'}</div>
            </div>
            <span style="flex-shrink:0;font-size:12px;font-weight:700;background:#065f46;color:#a7f3d0;padding:3px 10px;border-radius:12px;">QTD ${fmtQtde(qtde)}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">${opsHtml}</div>
        </div>
      `;
    }).join('');

    if (cntEl) cntEl.textContent = String(itens.length);
  }

  function renderEstoque() {
    const colEl = $('maqKanbanEstoque');
    const cntEl = $('maqKanbanEstoqueCount');
    const itens = (_dados.estoque || []).filter((it) => matchFiltro(it.codigo, it.descricao));

    if (!itens.length) {
      renderColunaVazia(colEl, cntEl, _filtro
        ? `Nenhum produto encontrado para "${_filtro}".`
        : 'Nenhum produto no estoque de máquinas.');
      return;
    }

    colEl.innerHTML = itens.map((it) => `
      <div class="kanban-prod-grupo" style="background:var(--content-bg,#1e2233);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:12px;">
        <div style="display:flex;align-items:flex-start;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;color:#f59e0b;letter-spacing:.3px;">${esc(it.codigo)}</div>
            <div style="font-size:12px;color:#e2e8f0;margin-top:2px;line-height:1.4;">${esc(it.descricao || '—')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:10px;color:#94a3b8;">
              <span>Físico: <b style="color:#e2e8f0;">${fmtQtde(it.fisico)}</b></span>
              <span>Reservado: <b style="color:#e2e8f0;">${fmtQtde(it.reservado)}</b></span>
            </div>
          </div>
          <span style="flex-shrink:0;font-size:12px;font-weight:700;background:#1e3a8a;color:#bfdbfe;padding:3px 10px;border-radius:12px;">QTD ${fmtQtde(it.saldo)}</span>
        </div>
      </div>
    `).join('');

    if (cntEl) cntEl.textContent = String(itens.length);
  }

  function renderPedidos() {
    const colEl = $('maqKanbanEnvio');
    const cntEl = $('maqKanbanEnvioCount');
    const itens = (_dados.pedidos || []).filter((it) => {
      const pedidosTxt = (it.pedidos_itens || [])
        .map((p) => [p.numero_pedido, p.cliente_nome, p.etapa_descricao].join(' '))
        .join(' ');
      return matchFiltro(it.codigo, it.descricao, pedidosTxt);
    });

    if (!itens.length) {
      renderColunaVazia(colEl, cntEl, _filtro
        ? `Nenhum produto encontrado para "${_filtro}".`
        : 'Nenhum produto em solicitação de envio.');
      return;
    }

    colEl.innerHTML = itens.map((it) => {
      const grupoKey = `envio::${it.codigo}`;
      const aberto = _gruposAbertos.has(grupoKey);
      const linhas = (it.pedidos_itens || []).map((p) => `
        <div style="background:rgba(15,23,42,.35);border:1px solid rgba(245,158,11,.18);border-radius:8px;padding:8px 10px;">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
            <span style="font-size:13px;font-weight:700;color:#e2e8f0;">Ped. ${esc(p.numero_pedido || p.codigo_pedido || '—')}</span>
            <span style="font-size:10px;font-weight:700;background:#78350f;color:#fde68a;padding:1px 6px;border-radius:4px;">${esc(p.etapa_descricao || '—')}</span>
            <span style="margin-left:auto;font-size:11px;color:#94a3b8;">Qtde: <b style="color:#f1f5f9;">${fmtQtde(p.quantidade)}</b></span>
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${esc(p.cliente_nome || '—')}</div>
          ${p.data_previsao ? `<div style="font-size:10px;color:#64748b;margin-top:2px;">Previsão: <b style="color:#a5f3fc;">${esc(fmtData(p.data_previsao))}</b></div>` : ''}
        </div>
      `).join('');

      return `
        <div class="kanban-prod-grupo kanban-prod-grupo--accordion${aberto ? ' is-open' : ''}" data-maq-grupo="${esc(grupoKey)}" style="background:var(--content-bg,#1e2233);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:12px;">
          <div class="maq-estoque-grupo-head" role="button" tabindex="0" data-maq-toggle="${esc(grupoKey)}" style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;">
            <i class="fa-solid fa-chevron-${aberto ? 'down' : 'right'}" style="margin-top:4px;color:#94a3b8;font-size:12px;width:14px;flex-shrink:0;"></i>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;color:#f59e0b;letter-spacing:.3px;">${esc(it.codigo)}</div>
              <div style="font-size:12px;color:#e2e8f0;margin-top:2px;line-height:1.4;">${esc(it.descricao || '—')}</div>
              <div style="font-size:10px;color:#fcd34d;font-weight:600;margin-top:4px;">${it.pedidos} pedido${it.pedidos === 1 ? '' : 's'}</div>
            </div>
            <span style="flex-shrink:0;font-size:12px;font-weight:700;background:#78350f;color:#fde68a;padding:3px 10px;border-radius:12px;">QTD ${fmtQtde(it.quantidade)}</span>
          </div>
          <div style="display:${aberto ? 'flex' : 'none'};flex-direction:column;gap:8px;margin-top:10px;">${linhas}</div>
        </div>
      `;
    }).join('');

    if (cntEl) cntEl.textContent = String(itens.length);
  }

  function renderKanban() {
    renderEmbalagem();
    renderEstoque();
    renderPedidos();
  }

  async function carregar() {
    const spinner = $('maqEstoqueSpinner');
    if (spinner) spinner.style.display = 'block';
    setStatus('');
    try {
      const resp = await fetch('/api/logistica/estoque-maquinas', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      _dados = {
        embalagem: Array.isArray(data.embalagem) ? data.embalagem : [],
        estoque: Array.isArray(data.estoque) ? data.estoque : [],
        pedidos: Array.isArray(data.pedidos) ? data.pedidos : [],
      };
      _carregado = true;
      renderKanban();
    } catch (err) {
      setStatus('Erro: ' + (err.message || 'Falha ao carregar estoque de máquinas.'), true);
      renderColunaVazia($('maqKanbanEmbalagem'), $('maqKanbanEmbalagemCount'), 'Erro ao carregar.');
      renderColunaVazia($('maqKanbanEstoque'), $('maqKanbanEstoqueCount'), 'Erro ao carregar.');
      renderColunaVazia($('maqKanbanEnvio'), $('maqKanbanEnvioCount'), 'Erro ao carregar.');
    } finally {
      if (spinner) spinner.style.display = 'none';
    }
  }

  function abrir() {
    document.querySelectorAll('.left-side .side-menu a').forEach((a) => a.classList.remove('is-active'));
    $('menu-estoque-maquinas')?.classList.add('is-active');
    window.showMainTab?.('estoqueMaquinasPane');
    if (!_carregado) carregar();
    else renderKanban();
  }

  function bind() {
    const menu = $('menu-estoque-maquinas');
    menu?.addEventListener('click', (e) => {
      e.preventDefault();
      abrir();
    });

    window.__atalhoAction = window.__atalhoAction || {};
    window.__atalhoAction['side:log:estoque-maquinas'] = abrir;

    $('maqEstoqueRecarregarBtn')?.addEventListener('click', () => carregar());

    const input = $('maqEstoquePesquisaInput');
    const limpar = $('maqEstoquePesquisaLimpar');
    input?.addEventListener('input', () => {
      _filtro = input.value || '';
      if (limpar) limpar.style.display = _filtro ? 'inline-flex' : 'none';
      renderKanban();
    });
    limpar?.addEventListener('click', () => {
      _filtro = '';
      if (input) input.value = '';
      limpar.style.display = 'none';
      renderKanban();
    });

    $('estoqueMaquinasPane')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-maq-toggle]');
      if (!btn) return;
      const key = btn.getAttribute('data-maq-toggle');
      if (!key) return;
      if (_gruposAbertos.has(key)) _gruposAbertos.delete(key);
      else _gruposAbertos.add(key);
      renderPedidos();
    });
  }

  document.addEventListener('DOMContentLoaded', bind);
  window.abrirEstoqueMaquinas = abrir;
})();
