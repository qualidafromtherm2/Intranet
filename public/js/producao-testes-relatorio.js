// Relatório de Testes de Produção — bombas de calor (testes.relatorios + testes.leituras)
(function () {
  'use strict';

  let _init = false;
  let _charts = {};
  let _resumo = null;
  let _view = 'lista'; // lista | detalhe
  let _filtroModelo = '';
  let _searchTimer = null;

  const CORES = {
    cop: '#34d399',
    consumo: '#f59e0b',
    aquecimento: '#38bdf8',
    amb: '#94a3b8',
    entrada: '#60a5fa',
    saida: '#f472b6',
    delta: '#a78bfa',
    pAlta: '#ef4444',
    pBaixa: '#22d3ee',
    vazao: '#2dd4bf',
  };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtNum(v, dig = 1) {
    if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: dig, maximumFractionDigits: dig });
  }

  function fmtData(raw) {
    if (!raw) return '—';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw).slice(0, 16);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function veredictoMeta(v) {
    if (v === 'aprovado') return { label: 'Aprovado', color: '#22c55e', bg: 'rgba(34,197,94,.14)', border: 'rgba(34,197,94,.35)' };
    if (v === 'reprovado') return { label: 'Atenção crítica', color: '#ef4444', bg: 'rgba(239,68,68,.14)', border: 'rgba(239,68,68,.4)' };
    return { label: 'Requer atenção', color: '#f59e0b', bg: 'rgba(245,158,11,.14)', border: 'rgba(245,158,11,.4)' };
  }

  function destroyCharts() {
    Object.keys(_charts).forEach((k) => {
      try { _charts[k]?.destroy?.(); } catch (_) {}
      _charts[k] = null;
    });
    _charts = {};
  }

  function chartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(148,163,184,.15)';
    Chart.defaults.font.family = 'inherit';
  }

  async function apiGet(url) {
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro HTTP ${res.status}`);
    return data;
  }

  function ensureStyles() {
    if ($('prodTestesStyles')) return;
    const style = document.createElement('style');
    style.id = 'prodTestesStyles';
    style.textContent = `
      #producaoTestesPane .pt-shell { display:flex; flex-direction:column; gap:14px; }
      #producaoTestesPane .pt-hero {
        display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;
        padding:16px 18px; border-radius:12px;
        background:linear-gradient(135deg, rgba(15,23,42,.96), rgba(6,78,59,.35));
        border:1px solid rgba(52,211,153,.22);
      }
      #producaoTestesPane .pt-hero h2 { margin:0; color:#f8fafc; font-size:20px; display:flex; align-items:center; gap:10px; }
      #producaoTestesPane .pt-hero p { margin:6px 0 0; color:#94a3b8; font-size:13px; max-width:640px; line-height:1.45; }
      #producaoTestesPane .pt-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; }
      #producaoTestesPane .pt-kpi {
        padding:12px 14px; border-radius:10px; border:1px solid rgba(148,163,184,.18);
        background:rgba(15,23,42,.7);
      }
      #producaoTestesPane .pt-kpi span { display:block; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:#64748b; }
      #producaoTestesPane .pt-kpi strong { display:block; margin-top:4px; font-size:22px; color:#f8fafc; line-height:1.1; }
      #producaoTestesPane .pt-kpi em { display:block; margin-top:4px; font-style:normal; font-size:11px; color:#94a3b8; }
      #producaoTestesPane .pt-toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      #producaoTestesPane .pt-search {
        position:relative; flex:1; min-width:220px; max-width:420px;
      }
      #producaoTestesPane .pt-search i.fa-magnifying-glass {
        position:absolute; left:12px; top:50%; transform:translateY(-50%); color:#64748b; pointer-events:none;
      }
      #producaoTestesPane .pt-search input {
        width:100%; height:40px; padding:0 36px 0 36px; border-radius:8px;
        border:1px solid rgba(148,163,184,.24); background:rgba(15,23,42,.68); color:#e2e8f0; font-size:13px; outline:none;
      }
      #producaoTestesPane .pt-search input:focus { border-color:rgba(52,211,153,.5); }
      #producaoTestesPane .pt-btn {
        height:40px; padding:0 14px; border-radius:8px; border:1px solid rgba(148,163,184,.24);
        background:rgba(255,255,255,.04); color:#e2e8f0; font-size:13px; font-weight:600; cursor:pointer;
        display:inline-flex; align-items:center; gap:8px;
      }
      #producaoTestesPane .pt-btn-primary {
        background:linear-gradient(135deg,#059669,#047857); border-color:transparent; color:#fff;
      }
      #producaoTestesPane .pt-btn:hover { filter:brightness(1.08); }
      #producaoTestesPane .pt-machines {
        display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px;
      }
      #producaoTestesPane .pt-machine {
        text-align:left; cursor:pointer; padding:14px; border-radius:12px;
        border:1px solid rgba(148,163,184,.2); background:rgba(15,23,42,.75);
        transition:border-color .15s, transform .15s;
      }
      #producaoTestesPane .pt-machine:hover { border-color:rgba(52,211,153,.45); transform:translateY(-1px); }
      #producaoTestesPane .pt-machine.active { border-color:#34d399; box-shadow:0 0 0 1px rgba(52,211,153,.35); }
      #producaoTestesPane .pt-machine h4 { margin:0; color:#f8fafc; font-size:15px; }
      #producaoTestesPane .pt-machine .pt-linha { margin-top:4px; color:#94a3b8; font-size:12px; }
      #producaoTestesPane .pt-machine .pt-metrics {
        display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-top:12px;
      }
      #producaoTestesPane .pt-machine .pt-metrics div {
        padding:8px; border-radius:8px; background:rgba(255,255,255,.03); border:1px solid rgba(148,163,184,.1);
      }
      #producaoTestesPane .pt-machine .pt-metrics span { display:block; font-size:10px; color:#64748b; text-transform:uppercase; font-weight:700; }
      #producaoTestesPane .pt-machine .pt-metrics strong { display:block; margin-top:2px; color:#e2e8f0; font-size:14px; }
      #producaoTestesPane .pt-table-wrap {
        overflow:auto; border-radius:12px; border:1px solid rgba(148,163,184,.18); background:rgba(15,23,42,.55);
      }
      #producaoTestesPane .pt-table { width:100%; border-collapse:collapse; font-size:13px; }
      #producaoTestesPane .pt-table th {
        text-align:left; padding:10px 12px; color:#94a3b8; font-size:11px; text-transform:uppercase;
        letter-spacing:.04em; border-bottom:1px solid rgba(148,163,184,.15); white-space:nowrap;
        position:sticky; top:0; background:#0f172a; z-index:1;
      }
      #producaoTestesPane .pt-table td {
        padding:10px 12px; color:#e2e8f0; border-bottom:1px solid rgba(148,163,184,.08); white-space:nowrap;
      }
      #producaoTestesPane .pt-table tr { cursor:pointer; }
      #producaoTestesPane .pt-table tbody tr:hover { background:rgba(52,211,153,.06); }
      #producaoTestesPane .pt-badge {
        display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px;
        font-size:11px; font-weight:700;
      }
      #producaoTestesPane .pt-charts {
        display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px;
      }
      #producaoTestesPane .pt-chart-card {
        padding:14px; border-radius:12px; border:1px solid rgba(148,163,184,.18); background:rgba(15,23,42,.65);
        min-height:280px;
      }
      #producaoTestesPane .pt-chart-card h4 { margin:0 0 10px; color:#e2e8f0; font-size:13px; display:flex; align-items:center; gap:8px; }
      #producaoTestesPane .pt-chart-card canvas { width:100% !important; max-height:240px; }
      #producaoTestesPane .pt-diag {
        display:grid; grid-template-columns:1fr; gap:10px;
      }
      #producaoTestesPane .pt-diag-item {
        padding:12px 14px; border-radius:10px; border:1px solid rgba(148,163,184,.15); background:rgba(15,23,42,.5);
        font-size:13px; color:#e2e8f0; line-height:1.45;
      }
      #producaoTestesPane .pt-diag-ok { border-color:rgba(34,197,94,.3); }
      #producaoTestesPane .pt-diag-atencao { border-color:rgba(245,158,11,.35); }
      #producaoTestesPane .pt-diag-critico { border-color:rgba(239,68,68,.4); }
      #producaoTestesPane .pt-diag-info { border-color:rgba(56,189,248,.3); }
      #producaoTestesPane .pt-section-title {
        margin:8px 0 4px; color:#cbd5e1; font-size:14px; font-weight:700; display:flex; align-items:center; gap:8px;
      }
      #producaoTestesPane .pt-muted { color:#64748b; font-size:12px; }
      #producaoTestesPane .pt-empty { padding:28px; text-align:center; color:#94a3b8; font-size:13px; }
      #producaoTestesPane .pt-back { margin-bottom:4px; }
      #producaoTestesPane .pt-regime-dot {
        display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px;
      }
      @media (max-width: 960px) {
        #producaoTestesPane .pt-charts { grid-template-columns:1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  function setStatus(msg, isErr) {
    const el = $('prodTestesStatus');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.style.color = isErr ? '#f87171' : '#94a3b8';
    el.textContent = msg;
  }

  function renderListaShell() {
    const root = $('prodTestesRoot');
    if (!root) return;
    root.innerHTML = `
      <div class="pt-shell">
        <div class="pt-hero">
          <div>
            <h2><i class="fa-solid fa-flask" style="color:#34d399;"></i> Testes — Bombas de calor</h2>
            <p>Acompanhe os testes aplicados nas máquinas: COP, ΔT, pressões, potência e vazão. Pesquise por OP ou modelo e abra o relatório completo.</p>
          </div>
          <button type="button" class="pt-btn pt-btn-primary" id="prodTestesAtualizarBtn">
            <i class="fa-solid fa-rotate"></i> Atualizar
          </button>
        </div>
        <div class="pt-kpis" id="prodTestesKpis"></div>
        <div class="pt-toolbar">
          <div class="pt-search">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="search" id="prodTestesSearch" placeholder="Pesquisar OP, máquina, operador..." autocomplete="off">
          </div>
          <button type="button" class="pt-btn" id="prodTestesLimparFiltro" style="display:none;">
            <i class="fa-solid fa-xmark"></i> Limpar filtro
          </button>
        </div>
        <div class="pt-section-title"><i class="fa-solid fa-industry" style="color:#34d399;"></i> Máquinas testadas</div>
        <div class="pt-machines" id="prodTestesMachines"></div>
        <div class="pt-section-title"><i class="fa-solid fa-list" style="color:#38bdf8;"></i> Relatórios <span class="pt-muted" id="prodTestesRelCount"></span></div>
        <div class="pt-table-wrap" id="prodTestesTableWrap"></div>
      </div>
    `;

    $('prodTestesAtualizarBtn')?.addEventListener('click', () => loadResumo(true));
    $('prodTestesLimparFiltro')?.addEventListener('click', () => {
      _filtroModelo = '';
      const inp = $('prodTestesSearch');
      if (inp) inp.value = '';
      $('prodTestesLimparFiltro').style.display = 'none';
      renderMachines();
      loadRelatorios();
    });
    $('prodTestesSearch')?.addEventListener('input', (e) => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => loadRelatorios(e.target.value), 280);
    });
  }

  function renderKpis() {
    const box = $('prodTestesKpis');
    if (!box || !_resumo) return;
    const t = _resumo.totais || {};
    box.innerHTML = `
      <div class="pt-kpi"><span>Relatórios</span><strong>${fmtNum(t.total_relatorios, 0)}</strong></div>
      <div class="pt-kpi"><span>Leituras</span><strong>${fmtNum(t.total_leituras, 0)}</strong></div>
      <div class="pt-kpi"><span>Modelos</span><strong>${fmtNum(t.total_modelos, 0)}</strong></div>
      <div class="pt-kpi"><span>OPs testadas</span><strong>${fmtNum(t.total_ops, 0)}</strong></div>
      <div class="pt-kpi"><span>Último teste</span><strong style="font-size:15px;">${fmtData(t.ultimo_teste)}</strong></div>
    `;
  }

  function renderMachines() {
    const box = $('prodTestesMachines');
    if (!box || !_resumo) return;
    const list = (_resumo.maquinas || []).filter((m) => {
      if (!_filtroModelo) return true;
      return m.modelo === _filtroModelo;
    });
    if (!list.length) {
      box.innerHTML = '<div class="pt-empty">Nenhuma máquina encontrada.</div>';
      return;
    }
    box.innerHTML = list.map((m) => `
      <button type="button" class="pt-machine ${_filtroModelo === m.modelo ? 'active' : ''}" data-modelo="${esc(m.modelo)}">
        <h4>${esc(m.modelo)}</h4>
        <div class="pt-linha">${esc(m.linha || '—')}</div>
        <div class="pt-metrics">
          <div><span>COP</span><strong>${fmtNum(m.cop_medio, 1)}</strong></div>
          <div><span>ΔT</span><strong>${fmtNum(m.delta_t_medio, 1)}°</strong></div>
          <div><span>Testes</span><strong>${fmtNum(m.qtd_relatorios, 0)}</strong></div>
        </div>
        <div class="pt-muted" style="margin-top:8px;">Último: ${fmtData(m.ultimo_teste)} · ${fmtNum(m.kw_aq_medio, 1)} kW aq.</div>
      </button>
    `).join('');

    box.querySelectorAll('.pt-machine').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modelo = btn.getAttribute('data-modelo') || '';
        _filtroModelo = _filtroModelo === modelo ? '' : modelo;
        const limpar = $('prodTestesLimparFiltro');
        if (limpar) limpar.style.display = _filtroModelo ? 'inline-flex' : 'none';
        renderMachines();
        loadRelatorios($('prodTestesSearch')?.value || '');
      });
    });
  }

  function renderTabelaRelatorios(rows) {
    const wrap = $('prodTestesTableWrap');
    const cnt = $('prodTestesRelCount');
    if (cnt) cnt.textContent = rows?.length ? `(${rows.length})` : '';
    if (!wrap) return;
    if (!rows?.length) {
      wrap.innerHTML = '<div class="pt-empty">Nenhum relatório encontrado para a pesquisa.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="pt-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>OP</th>
            <th>Modelo</th>
            <th>Linha</th>
            <th>Operador</th>
            <th>Leituras</th>
            <th>COP méd.</th>
            <th>ΔT méd.</th>
            <th>kW aq.</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr data-id="${r.id}">
              <td>${fmtData(r.criado_em)}</td>
              <td><strong>${esc(r.num_op || '—')}</strong></td>
              <td>${esc(r.modelo || '—')}</td>
              <td>${esc(r.linha || '—')}</td>
              <td>${esc(r.operador || '—')}</td>
              <td>${fmtNum(r.leituras_count || r.total_registros, 0)}</td>
              <td>${fmtNum(r.cop_medio, 1)}</td>
              <td>${fmtNum(r.delta_t_medio, 1)}</td>
              <td>${fmtNum(r.kw_aq_medio, 1)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    wrap.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => openDetalhe(tr.getAttribute('data-id')));
    });
  }

  async function loadResumo(force) {
    try {
      setStatus('Carregando máquinas e testes...');
      _resumo = await apiGet('/api/testes/resumo');
      renderKpis();
      renderMachines();
      await loadRelatorios($('prodTestesSearch')?.value || '', force);
      setStatus('');
    } catch (err) {
      setStatus(err.message || 'Falha ao carregar', true);
    }
  }

  async function loadRelatorios(q) {
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (_filtroModelo) params.set('modelo', _filtroModelo);
      params.set('limit', '100');
      const data = await apiGet(`/api/testes/relatorios?${params}`);
      renderTabelaRelatorios(data.relatorios || []);
    } catch (err) {
      setStatus(err.message || 'Falha ao listar relatórios', true);
    }
  }

  function makeLineChart(canvasId, labels, datasets, opts = {}) {
    const canvas = $(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    destroyOne(canvasId);
    _charts[canvasId] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: opts.tooltipCallbacks || {} },
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 10 } } },
          y: { beginAtZero: opts.beginAtZero !== false, ticks: { font: { size: 10 } } },
          ...(opts.y1 ? {
            y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } } },
          } : {}),
        },
      },
    });
  }

  function destroyOne(key) {
    if (_charts[key]) {
      try { _charts[key].destroy(); } catch (_) {}
      _charts[key] = null;
    }
  }

  function ds(label, data, color, extra = {}) {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color + '33',
      borderWidth: 2,
      pointRadius: data.length > 40 ? 0 : 2,
      tension: 0.25,
      fill: false,
      ...extra,
    };
  }

  async function openDetalhe(id) {
    const root = $('prodTestesRoot');
    if (!root) return;
    _view = 'detalhe';
    destroyCharts();
    root.innerHTML = `<div class="pt-empty"><i class="fa-solid fa-spinner fa-spin"></i> Carregando relatório #${esc(id)}...</div>`;
    setStatus('');

    try {
      const data = await apiGet(`/api/testes/relatorios/${id}`);
      const r = data.relatorio || {};
      const st = data.stats || {};
      const diag = data.diagnostico || {};
      const leituras = data.leituras || [];
      const spec = data.spec;
      const ver = veredictoMeta(diag.veredicto);

      const labels = leituras.map((l, i) => {
        const dh = String(l.data_hora || '');
        const hora = dh.includes(' ') ? dh.split(' ')[1] : dh.slice(11, 19);
        return hora || `#${i + 1}`;
      });

      root.innerHTML = `
        <div class="pt-shell">
          <div class="pt-back">
            <button type="button" class="pt-btn" id="prodTestesVoltarBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
          </div>
          <div class="pt-hero">
            <div>
              <h2>
                <i class="fa-solid fa-file-waveform" style="color:#34d399;"></i>
                OP ${esc(r.num_op || '—')} · ${esc(r.modelo || '—')}
                <span class="pt-badge" style="background:${ver.bg};color:${ver.color};border:1px solid ${ver.border};margin-left:8px;">${ver.label}</span>
              </h2>
              <p>
                ${esc(r.linha || '')}
                · Operador: <strong style="color:#e2e8f0;">${esc(r.operador || '—')}</strong>
                · ${fmtData(r.criado_em)}
                · ${leituras.length} leituras
                ${r.arquivo_xlsx ? ` · <span class="pt-muted">${esc(r.arquivo_xlsx)}</span>` : ''}
              </p>
            </div>
          </div>

          <div class="pt-kpis">
            <div class="pt-kpi"><span>COP médio</span><strong>${fmtNum(st.cop?.media, 2)}</strong><em>máx ${fmtNum(st.cop?.max, 1)} · mín ${fmtNum(st.cop?.min, 1)}</em></div>
            <div class="pt-kpi"><span>ΔT médio</span><strong>${fmtNum(st.delta_t?.media, 2)}°</strong><em>entrada→saída</em></div>
            <div class="pt-kpi"><span>kW aquecimento</span><strong>${fmtNum(st.kw_aquecimento?.media, 1)}</strong><em>consumo ${fmtNum(st.kw_consumo?.media, 1)} kW</em></div>
            <div class="pt-kpi"><span>kcal/h</span><strong>${fmtNum(st.kcal_h?.media, 1)}</strong><em>capacidade térmica</em></div>
            <div class="pt-kpi"><span>Pressão A/B</span><strong style="font-size:16px;">${fmtNum(st.pressao_alta?.media, 0)} / ${fmtNum(st.pressao_baixa?.media, 0)}</strong><em>alta / baixa</em></div>
            <div class="pt-kpi"><span>Em regime</span><strong>${fmtNum(st.leituras_regime, 0)}</strong><em>de ${fmtNum(st.total_leituras, 0)} leituras</em></div>
          </div>

          ${spec ? `
            <div class="pt-section-title"><i class="fa-solid fa-book" style="color:#a78bfa;"></i> Catálogo / etiqueta</div>
            <div class="pt-table-wrap" style="padding:12px 14px;">
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;font-size:12px;color:#cbd5e1;">
                <div><span class="pt-muted">Modelo catálogo</span><br><strong>${esc(spec.modeloLabel || spec.modelo)}</strong></div>
                <div><span class="pt-muted">COP nominal</span><br><strong>${spec.cop?.min != null ? `${fmtNum(spec.cop.min,1)}–${fmtNum(spec.cop.max,1)}` : fmtNum(spec.cop, 1)}</strong></div>
                <div><span class="pt-muted">Capacidade kW</span><br><strong>${spec.capacidadekW?.min != null ? `${fmtNum(spec.capacidadekW.min,1)}–${fmtNum(spec.capacidadekW.max,1)}` : fmtNum(spec.capacidadekW, 1)}</strong></div>
                <div><span class="pt-muted">Vazão ideal</span><br><strong>${fmtNum(typeof spec.vazaoAguaIdeal === 'object' ? spec.vazaoAguaIdeal.mid : spec.vazaoAguaIdeal, 1)} m³/h</strong></div>
                <div><span class="pt-muted">Tensão</span><br><strong>${esc(spec.tensaoNominal || '—')}</strong></div>
                <div><span class="pt-muted">Fluido</span><br><strong>${esc(spec.fluido || '—')}</strong></div>
              </div>
            </div>
          ` : ''}

          <div class="pt-section-title"><i class="fa-solid fa-stethoscope" style="color:#f59e0b;"></i> Diagnóstico do teste</div>
          <div class="pt-diag" id="prodTestesDiag">
            ${(diag.alertas || []).map((a) => `
              <div class="pt-diag-item pt-diag-${esc(a.nivel)}">
                <i class="fa-solid ${a.nivel === 'critico' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation'}" style="color:${a.nivel === 'critico' ? '#ef4444' : '#f59e0b'};margin-right:6px;"></i>
                ${esc(a.texto)}
              </div>
            `).join('')}
            ${(diag.ok || []).map((t) => `
              <div class="pt-diag-item pt-diag-ok"><i class="fa-solid fa-circle-check" style="color:#22c55e;margin-right:6px;"></i>${esc(t)}</div>
            `).join('')}
            ${(diag.infos || []).map((t) => `
              <div class="pt-diag-item pt-diag-info"><i class="fa-solid fa-circle-info" style="color:#38bdf8;margin-right:6px;"></i>${esc(t)}</div>
            `).join('')}
          </div>

          <div class="pt-section-title"><i class="fa-solid fa-chart-line" style="color:#38bdf8;"></i> Evolução durante o teste</div>
          <div class="pt-charts">
            <div class="pt-chart-card"><h4><i class="fa-solid fa-gauge-high" style="color:${CORES.cop};"></i> COP (eficiência)</h4><div style="height:220px;"><canvas id="ptChartCop"></canvas></div></div>
            <div class="pt-chart-card"><h4><i class="fa-solid fa-temperature-half" style="color:${CORES.saida};"></i> Temperaturas (°C)</h4><div style="height:220px;"><canvas id="ptChartTemp"></canvas></div></div>
            <div class="pt-chart-card"><h4><i class="fa-solid fa-bolt" style="color:${CORES.aquecimento};"></i> Potência (kW)</h4><div style="height:220px;"><canvas id="ptChartKw"></canvas></div></div>
            <div class="pt-chart-card"><h4><i class="fa-solid fa-gauge" style="color:${CORES.pAlta};"></i> Pressões</h4><div style="height:220px;"><canvas id="ptChartPress"></canvas></div></div>
            <div class="pt-chart-card"><h4><i class="fa-solid fa-water" style="color:${CORES.vazao};"></i> Vazão</h4><div style="height:220px;"><canvas id="ptChartVazao"></canvas></div></div>
            <div class="pt-chart-card"><h4><i class="fa-solid fa-plug" style="color:#fbbf24;"></i> Elétrica (V / A)</h4><div style="height:220px;"><canvas id="ptChartElec"></canvas></div></div>
          </div>

          <div class="pt-section-title"><i class="fa-solid fa-table" style="color:#94a3b8;"></i> Leituras brutas
            <span class="pt-muted"> · ponto verde = em regime</span>
          </div>
          <div class="pt-table-wrap" style="max-height:420px;">
            <table class="pt-table">
              <thead>
                <tr>
                  <th></th><th>Data/hora</th><th>T amb</th><th>T ent</th><th>T sai</th><th>ΔT</th>
                  <th>COP</th><th>kW aq</th><th>kW cons</th><th>kcal/h</th>
                  <th>Vazão</th><th>P alta</th><th>P baixa</th><th>V</th><th>A</th>
                </tr>
              </thead>
              <tbody>
                ${leituras.map((l) => `
                  <tr style="${l.em_regime ? '' : 'opacity:.72;'}">
                    <td><span class="pt-regime-dot" style="background:${l.em_regime ? '#22c55e' : '#64748b'};"></span></td>
                    <td>${esc(l.data_hora || '—')}</td>
                    <td>${fmtNum(l.temp_ambiente, 1)}</td>
                    <td>${fmtNum(l.temp_entrada, 1)}</td>
                    <td>${fmtNum(l.temp_saida, 1)}</td>
                    <td>${fmtNum(l.temp_dif, 2)}</td>
                    <td><strong style="color:${Number(l.cop) >= 4 ? '#34d399' : Number(l.cop) >= 2.5 ? '#fbbf24' : '#f87171'};">${fmtNum(l.cop, 1)}</strong></td>
                    <td>${fmtNum(l.kw_aquecimento, 1)}</td>
                    <td>${fmtNum(l.kw_consumo, 1)}</td>
                    <td>${fmtNum(l.kcal_h, 1)}</td>
                    <td>${fmtNum(l.vazao, 0)}</td>
                    <td>${fmtNum(l.pressao_alta, 1)}</td>
                    <td>${fmtNum(l.pressao_baixa, 1)}</td>
                    <td>${fmtNum(l.tensao, 0)}</td>
                    <td>${fmtNum(l.corrente, 1)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          ${(data.comparativo_modelo || []).length ? `
            <div class="pt-section-title"><i class="fa-solid fa-code-compare" style="color:#a78bfa;"></i> Outros testes do modelo ${esc(r.modelo)}</div>
            <div class="pt-table-wrap">
              <table class="pt-table">
                <thead><tr><th>Data</th><th>OP</th><th>Operador</th><th>Leituras</th><th>COP</th><th>ΔT</th></tr></thead>
                <tbody>
                  ${data.comparativo_modelo.map((c) => `
                    <tr data-id="${c.id}">
                      <td>${fmtData(c.criado_em)}</td>
                      <td><strong>${esc(c.num_op || '—')}</strong></td>
                      <td>${esc(c.operador || '—')}</td>
                      <td>${fmtNum(c.total_registros, 0)}</td>
                      <td>${fmtNum(c.cop_medio, 1)}</td>
                      <td>${fmtNum(c.delta_t_medio, 1)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}
        </div>
      `;

      $('prodTestesVoltarBtn')?.addEventListener('click', () => {
        _view = 'lista';
        destroyCharts();
        renderListaShell();
        renderKpis();
        renderMachines();
        loadRelatorios($('prodTestesSearch')?.value || '');
      });

      root.querySelectorAll('tr[data-id]').forEach((tr) => {
        tr.addEventListener('click', () => openDetalhe(tr.getAttribute('data-id')));
      });

      chartDefaults();
      requestAnimationFrame(() => {
        makeLineChart('ptChartCop', labels, [
          ds('COP', leituras.map((l) => l.cop), CORES.cop),
        ]);
        makeLineChart('ptChartTemp', labels, [
          ds('Ambiente', leituras.map((l) => l.temp_ambiente), CORES.amb),
          ds('Entrada', leituras.map((l) => l.temp_entrada), CORES.entrada),
          ds('Saída', leituras.map((l) => l.temp_saida), CORES.saida),
          ds('ΔT', leituras.map((l) => l.temp_dif), CORES.delta),
        ], { beginAtZero: false });
        makeLineChart('ptChartKw', labels, [
          ds('Aquecimento', leituras.map((l) => l.kw_aquecimento), CORES.aquecimento),
          ds('Consumo', leituras.map((l) => l.kw_consumo), CORES.consumo),
        ]);
        makeLineChart('ptChartPress', labels, [
          ds('Alta', leituras.map((l) => l.pressao_alta), CORES.pAlta),
          ds('Baixa', leituras.map((l) => l.pressao_baixa), CORES.pBaixa),
        ], { beginAtZero: false });
        makeLineChart('ptChartVazao', labels, [
          ds('Vazão', leituras.map((l) => l.vazao), CORES.vazao),
        ], { beginAtZero: false });
        makeLineChart('ptChartElec', labels, [
          ds('Tensão (V)', leituras.map((l) => l.tensao), '#fbbf24', { yAxisID: 'y' }),
          ds('Corrente (A)', leituras.map((l) => l.corrente), '#fb7185', { yAxisID: 'y1' }),
        ], { beginAtZero: false, y1: true });
      });
    } catch (err) {
      root.innerHTML = `
        <div class="pt-shell">
          <button type="button" class="pt-btn" id="prodTestesVoltarBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
          <div class="pt-empty" style="color:#f87171;">${esc(err.message || 'Erro')}</div>
        </div>
      `;
      $('prodTestesVoltarBtn')?.addEventListener('click', () => {
        _view = 'lista';
        renderListaShell();
        loadResumo();
      });
    }
  }

  function init() {
    if (_init) return;
    const pane = $('producaoTestesPane');
    if (!pane) return;
    _init = true;
    ensureStyles();
    chartDefaults();
    renderListaShell();
  }

  function open() {
    init();
    if (_view !== 'lista') {
      _view = 'lista';
      destroyCharts();
      renderListaShell();
    }
    loadResumo();
  }

  window.producaoTestesRelatorio = { open, init };
})();
