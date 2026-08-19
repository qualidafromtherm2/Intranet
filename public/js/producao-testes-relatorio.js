// Relatório de Testes — compara leituras entre si (início × pico × fim) + gráficos
(function () {
  'use strict';

  let _init = false;
  let _charts = {};
  let _resumo = null;
  let _view = 'lista';
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
    inicio: '#64748b',
    pico: '#34d399',
    fim: '#f59e0b',
  };

  const FASE_META = {
    partida: { label: 'Partida', color: '#94a3b8' },
    aquecimento: { label: 'Aquecimento', color: '#38bdf8' },
    regime: { label: 'Regime', color: '#22c55e' },
    desaceleracao: { label: 'Desaceleração', color: '#f59e0b' },
    transicao: { label: 'Transição', color: '#a78bfa' },
    parada: { label: 'Parada', color: '#64748b' },
  };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtNum(v, dig = 1) {
    if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: dig, maximumFractionDigits: dig });
  }

  function fmtDelta(v, dig = 2, suf = '') {
    if (v == null || Number.isNaN(Number(v))) return '—';
    const n = Number(v);
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toLocaleString('pt-BR', { minimumFractionDigits: dig, maximumFractionDigits: dig })}${suf}`;
  }

  function fmtData(raw) {
    if (!raw) return '—';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw).slice(0, 16);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const COLS_LEITURAS = [
    { k: 'id', label: 'ID', dig: 0 },
    { k: 'data_hora', label: 'Data/hora' },
    { k: 'temp_ambiente', label: 'T amb', dig: 1 },
    { k: 'temp_entrada', label: 'T ent', dig: 1 },
    { k: 'temp_saida', label: 'T sai', dig: 1 },
    { k: 'temp_dif', label: 'ΔT', dig: 2 },
    { k: 'tensao', label: 'Tensão', dig: 1 },
    { k: 'corrente', label: 'Corrente', dig: 1 },
    { k: 'vazao', label: 'Vazão', dig: 1 },
    { k: 'kcal_h', label: 'kcal/h', dig: 0 },
    { k: 'kw_aquecimento', label: 'kW aq', dig: 1 },
    { k: 'kw_consumo', label: 'kW cons', dig: 1 },
    { k: 'cop', label: 'COP', dig: 1 },
    { k: 'pressao_alta', label: 'P alta', dig: 1 },
    { k: 'pressao_baixa', label: 'P baixa', dig: 1 },
    { k: 'rpm_ventilador', label: 'RPM vent.', dig: 0 },
    { k: 'abertura_valvula', label: 'Válvula', dig: 0 },
    { k: 'hz_compressor', label: 'Hz comp.', dig: 1 },
    { k: 'corrente_compressor', label: 'A comp.', dig: 1 },
  ];

  const COLS_FTIBR = [
    { k: 'id', label: 'ID', dig: 0 },
    { k: 'perfil', label: 'Perfil' },
    { k: 'nome_maquina', label: 'Máquina' },
    { k: 'data_hora', label: 'Data/hora' },
    { k: 'temp_ambiente', label: 'T amb', dig: 1 },
    { k: 'temp_entrada', label: 'T ent', dig: 1 },
    { k: 'temp_saida', label: 'T sai', dig: 1 },
    { k: 'temp_dif', label: 'ΔT', dig: 2 },
    { k: 'temp_evaporador', label: 'T evap.', dig: 1 },
    { k: 'temp_meio_evaporador', label: 'T meio evap.', dig: 1 },
    { k: 'temp_descarga', label: 'T descarga', dig: 1 },
    { k: 'temp_succao', label: 'T sucção', dig: 1 },
    { k: 'temp_saida_condensador', label: 'T sai cond.', dig: 1 },
    { k: 'temp_dissipador', label: 'T dissipador', dig: 1 },
    { k: 'tensao_ac', label: 'V AC', dig: 1 },
    { k: 'tensao_cc', label: 'V CC', dig: 1 },
    { k: 'freq_sistema', label: 'Freq. sist.', dig: 1 },
    { k: 'corrente_maquina', label: 'A máq.', dig: 1 },
    { k: 'corrente_compressor', label: 'A comp.', dig: 1 },
    { k: 'rpm_ventilador', label: 'RPM vent.', dig: 0 },
    { k: 'hz_compressor', label: 'Hz comp.', dig: 1 },
    { k: 'abertura_valvula', label: 'Válvula', dig: 0 },
  ];

  function fmtCell(row, col) {
    const v = row?.[col.k];
    if (v == null || v === '') return '—';
    if (typeof v === 'number') return fmtNum(v, col.dig != null ? col.dig : 1);
    return esc(String(v));
  }

  function renderColsTable(cols, rows, rowClassFn) {
    if (!rows?.length) return '<div class="pt-empty">Nenhum registro.</div>';
    return `
      <table class="pt-table">
        <thead>
          <tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((row, i) => `
            <tr class="${rowClassFn ? (rowClassFn(row, i) || '') : ''}">
              ${cols.map((c) => `<td>${fmtCell(row, c)}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function closeFtibrModal() {
    $('ptFtibrModal')?.remove();
  }

  function showFtibrModal(relatorio, rows) {
    closeFtibrModal();
    const r = relatorio || {};
    const overlay = document.createElement('div');
    overlay.id = 'ptFtibrModal';
    overlay.className = 'pt-modal';
    overlay.innerHTML = `
      <div class="pt-modal-card" role="dialog" aria-label="Leituras FTIBR">
        <div class="pt-modal-head">
          <div>
            <h3><i class="fa-solid fa-microchip" style="color:#38bdf8;"></i> Leituras FTIBR</h3>
            <p>OP ${esc(r.num_op || '—')} · ${esc(r.modelo || '—')} · ${fmtNum(rows?.length || 0, 0)} registro(s) · todas as colunas</p>
          </div>
          <button type="button" class="pt-btn" id="ptFtibrFecharBtn"><i class="fa-solid fa-xmark"></i> Fechar</button>
        </div>
        <div class="pt-table-wrap" style="max-height:min(70vh,560px);">
          ${renderColsTable(COLS_FTIBR, rows || [])}
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeFtibrModal();
    });
    document.body.appendChild(overlay);
    $('ptFtibrFecharBtn')?.addEventListener('click', closeFtibrModal);
  }

  async function openFtibr(relatorioId, relatorioHint) {
    try {
      setStatus('Carregando leituras FTIBR...');
      const data = await apiGet(`/api/testes/relatorios/${relatorioId}/ftibr`);
      setStatus('');
      if (!data.leituras_ftibr?.length) {
        setStatus('Este relatório não tem registro FTIBR.', true);
        return;
      }
      showFtibrModal(data.relatorio || relatorioHint, data.leituras_ftibr);
    } catch (err) {
      setStatus(err.message || 'Falha ao abrir FTIBR', true);
    }
  }

  function veredictoMeta(v) {
    if (v === 'aprovado') return { label: 'Aprovado', color: '#22c55e', bg: 'rgba(34,197,94,.14)', border: 'rgba(34,197,94,.35)' };
    if (v === 'reprovado') return { label: 'Atenção crítica', color: '#ef4444', bg: 'rgba(239,68,68,.14)', border: 'rgba(239,68,68,.4)' };
    return { label: 'Requer atenção', color: '#f59e0b', bg: 'rgba(245,158,11,.14)', border: 'rgba(245,158,11,.4)' };
  }

  function destroyCharts() {
    Object.keys(_charts).forEach((k) => {
      try { _charts[k]?.destroy?.(); } catch (_) {}
    });
    _charts = {};
  }

  function destroyOne(key) {
    if (_charts[key]) {
      try { _charts[key].destroy(); } catch (_) {}
      _charts[key] = null;
    }
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
      #producaoTestesPane .pt-hero h2 { margin:0; color:#f8fafc; font-size:20px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      #producaoTestesPane .pt-hero p { margin:6px 0 0; color:#94a3b8; font-size:13px; max-width:720px; line-height:1.45; }
      #producaoTestesPane .pt-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; }
      #producaoTestesPane .pt-kpi {
        padding:12px 14px; border-radius:10px; border:1px solid rgba(148,163,184,.18);
        background:rgba(15,23,42,.7);
      }
      #producaoTestesPane .pt-kpi span { display:block; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:#64748b; }
      #producaoTestesPane .pt-kpi strong { display:block; margin-top:4px; font-size:22px; color:#f8fafc; line-height:1.1; }
      #producaoTestesPane .pt-kpi em { display:block; margin-top:4px; font-style:normal; font-size:11px; color:#94a3b8; }
      #producaoTestesPane .pt-toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      #producaoTestesPane .pt-search { position:relative; flex:1; min-width:220px; max-width:420px; }
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
      #producaoTestesPane .pt-table tr.clickable { cursor:pointer; }
      #producaoTestesPane .pt-table tbody tr.clickable:hover { background:rgba(52,211,153,.06); }
      #producaoTestesPane .pt-table tr.pt-row-key { background:rgba(52,211,153,.08); }
      #producaoTestesPane .pt-table tr.pt-row-pico { background:rgba(52,211,153,.14); }
      #producaoTestesPane .pt-badge {
        display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px;
        font-size:11px; font-weight:700;
      }
      #producaoTestesPane .pt-charts {
        display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px;
      }
      #producaoTestesPane .pt-chart-card {
        padding:14px; border-radius:12px; border:1px solid rgba(148,163,184,.18); background:rgba(15,23,42,.65);
      }
      #producaoTestesPane .pt-chart-card.wide { grid-column:1 / -1; }
      #producaoTestesPane .pt-chart-card h4 { margin:0 0 10px; color:#e2e8f0; font-size:13px; display:flex; align-items:center; gap:8px; }
      #producaoTestesPane .pt-chart-card .pt-chart-box { height:260px; position:relative; }
      #producaoTestesPane .pt-chart-card.wide .pt-chart-box { height:300px; }
      #producaoTestesPane .pt-chart-card canvas { width:100% !important; height:100% !important; }
      #producaoTestesPane .pt-compare-grid {
        display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px;
      }
      #producaoTestesPane .pt-compare-card {
        padding:14px; border-radius:12px; border:1px solid rgba(148,163,184,.2);
        background:rgba(15,23,42,.72); position:relative; overflow:hidden;
      }
      #producaoTestesPane .pt-compare-card:before {
        content:""; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--pt-accent,#34d399);
      }
      #producaoTestesPane .pt-compare-card h5 {
        margin:0 0 4px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#94a3b8;
      }
      #producaoTestesPane .pt-compare-card .pt-idx {
        font-size:11px; color:#64748b; margin-bottom:10px;
      }
      #producaoTestesPane .pt-compare-card .pt-big {
        font-size:28px; font-weight:800; color:#f8fafc; line-height:1;
      }
      #producaoTestesPane .pt-compare-card .pt-big small { font-size:13px; font-weight:600; color:#94a3b8; margin-left:4px; }
      #producaoTestesPane .pt-compare-metrics {
        display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px;
      }
      #producaoTestesPane .pt-compare-metrics div {
        padding:8px; border-radius:8px; background:rgba(255,255,255,.03);
      }
      #producaoTestesPane .pt-compare-metrics span { display:block; font-size:10px; color:#64748b; text-transform:uppercase; font-weight:700; }
      #producaoTestesPane .pt-compare-metrics strong { display:block; margin-top:2px; color:#e2e8f0; font-size:14px; }
      #producaoTestesPane .pt-delta-up { color:#34d399 !important; }
      #producaoTestesPane .pt-delta-down { color:#f87171 !important; }
      #producaoTestesPane .pt-narrativa {
        padding:14px 16px; border-radius:12px; border:1px solid rgba(56,189,248,.25);
        background:rgba(14,165,233,.08); color:#e2e8f0; font-size:13px; line-height:1.55;
      }
      #producaoTestesPane .pt-narrativa li { margin:6px 0; }
      #producaoTestesPane .pt-delta-table td.delta { font-weight:700; }
      #producaoTestesPane .pt-section-title {
        margin:8px 0 4px; color:#cbd5e1; font-size:14px; font-weight:700; display:flex; align-items:center; gap:8px;
      }
      #producaoTestesPane .pt-muted { color:#64748b; font-size:12px; }
      #producaoTestesPane .pt-empty { padding:28px; text-align:center; color:#94a3b8; font-size:13px; }
      #producaoTestesPane .pt-fase-pill {
        display:inline-flex; align-items:center; gap:5px; padding:2px 8px; border-radius:999px;
        font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.03em;
      }
      #producaoTestesPane .pt-ftibr-btn {
        width:34px; height:34px; border-radius:8px; border:1px solid rgba(56,189,248,.4);
        background:rgba(14,165,233,.16); color:#7dd3fc; cursor:pointer;
        display:inline-flex; align-items:center; justify-content:center; font-size:14px;
      }
      #producaoTestesPane .pt-ftibr-btn:hover { filter:brightness(1.15); }
      .pt-modal {
        position:fixed; inset:0; z-index:12000; background:rgba(2,6,23,.72);
        display:flex; align-items:center; justify-content:center; padding:18px;
      }
      .pt-modal .pt-modal-card {
        width:min(1180px,100%); max-height:90vh; overflow:auto;
        background:#0f172a; border:1px solid rgba(56,189,248,.3); border-radius:14px; padding:16px;
      }
      .pt-modal .pt-modal-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:12px; }
      .pt-modal .pt-modal-head h3 { margin:0; color:#f8fafc; font-size:18px; display:flex; align-items:center; gap:8px; }
      .pt-modal .pt-modal-head p { margin:6px 0 0; color:#94a3b8; font-size:13px; }
      .pt-modal .pt-table { width:100%; border-collapse:collapse; font-size:12px; }
      .pt-modal .pt-table th, .pt-modal .pt-table td {
        padding:8px 10px; border-bottom:1px solid rgba(148,163,184,.12); white-space:nowrap; color:#e2e8f0;
      }
      .pt-modal .pt-table th {
        text-align:left; color:#94a3b8; font-size:10px; text-transform:uppercase; letter-spacing:.04em;
        position:sticky; top:0; background:#0f172a;
      }
      .pt-modal .pt-table-wrap { overflow:auto; border-radius:10px; border:1px solid rgba(148,163,184,.18); }
      .pt-modal .pt-btn {
        height:36px; padding:0 12px; border-radius:8px; border:1px solid rgba(148,163,184,.24);
        background:rgba(255,255,255,.06); color:#e2e8f0; cursor:pointer; display:inline-flex; align-items:center; gap:8px;
      }
      @media (max-width: 960px) {
        #producaoTestesPane .pt-charts { grid-template-columns:1fr; }
        #producaoTestesPane .pt-chart-card.wide { grid-column:auto; }
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

  function fasePill(fase) {
    const m = FASE_META[fase] || FASE_META.transicao;
    return `<span class="pt-fase-pill" style="background:${m.color}22;color:${m.color};border:1px solid ${m.color}55;">${esc(m.label)}</span>`;
  }

  function deltaClass(v) {
    if (v == null || Number.isNaN(Number(v)) || Number(v) === 0) return '';
    return Number(v) > 0 ? 'pt-delta-up' : 'pt-delta-down';
  }

  function renderListaShell() {
    const root = $('prodTestesRoot');
    if (!root) return;
    root.innerHTML = `
      <div class="pt-shell">
        <div class="pt-hero">
          <div>
            <h2><i class="fa-solid fa-flask" style="color:#34d399;"></i> Testes — Bombas de calor</h2>
            <p>Escolha uma OP/máquina para ver o relatório comparando as leituras entre si (início → pico → fim), com gráficos de evolução.</p>
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
    const list = (_resumo.maquinas || []).filter((m) => !_filtroModelo || m.modelo === _filtroModelo);
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
        <div class="pt-muted" style="margin-top:8px;">Último: ${fmtData(m.ultimo_teste)}</div>
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
            <th>Data</th><th>OP</th><th>Modelo</th><th>Linha</th><th>Operador</th>
            <th>Arquivo</th><th>Leituras</th><th>COP méd.</th><th>COP máx.</th><th>ΔT méd.</th>
            <th>FTIBR</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr class="clickable" data-id="${r.id}">
              <td>${fmtData(r.criado_em)}</td>
              <td><strong>${esc(r.num_op || '—')}</strong></td>
              <td>${esc(r.modelo || '—')}</td>
              <td>${esc(r.linha || '—')}</td>
              <td>${esc(r.operador || '—')}</td>
              <td title="${esc(r.arquivo_xlsx || '')}">${esc(r.arquivo_xlsx || '—')}</td>
              <td>${fmtNum(r.leituras_count || r.total_registros, 0)}</td>
              <td>${fmtNum(r.cop_medio, 1)}</td>
              <td>${fmtNum(r.cop_max, 1)}</td>
              <td>${fmtNum(r.delta_t_medio, 1)}</td>
              <td>
                ${Number(r.ftibr_count) > 0
                  ? `<button type="button" class="pt-ftibr-btn" data-ftibr-id="${r.id}" title="Abrir ${fmtNum(r.ftibr_count, 0)} leitura(s) FTIBR">
                       <i class="fa-solid fa-microchip"></i>
                     </button>`
                  : '<span class="pt-muted">—</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    wrap.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => openDetalhe(tr.getAttribute('data-id')));
    });
    wrap.querySelectorAll('[data-ftibr-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFtibr(btn.getAttribute('data-ftibr-id'));
      });
    });
  }

  async function loadResumo() {
    try {
      setStatus('Carregando máquinas e testes...');
      _resumo = await apiGet('/api/testes/resumo');
      renderKpis();
      renderMachines();
      await loadRelatorios($('prodTestesSearch')?.value || '');
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

  function makeChart(canvasId, config) {
    const canvas = $(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    destroyOne(canvasId);
    _charts[canvasId] = new Chart(canvas.getContext('2d'), config);
  }

  function ds(label, data, color, extra = {}) {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color + '33',
      borderWidth: 2,
      pointRadius: Array.isArray(data) && data.length > 40 ? 0 : 3,
      tension: 0.25,
      fill: false,
      ...extra,
    };
  }

  function cardMomento(titulo, ponto, accent, destaque) {
    if (!ponto) return '';
    return `
      <div class="pt-compare-card" style="--pt-accent:${accent};">
        <h5>${esc(titulo)}</h5>
        <div class="pt-idx">Leitura #${ponto.indice} · ${esc(ponto.data_hora || '')} · ${fasePill(ponto.fase)}</div>
        <div class="pt-big">${fmtNum(ponto.cop, 2)}<small>COP</small></div>
        <div class="pt-compare-metrics">
          <div><span>ΔT</span><strong>${fmtNum(ponto.temp_dif, 2)} °C</strong></div>
          <div><span>kW aq.</span><strong>${fmtNum(ponto.kw_aquecimento, 1)}</strong></div>
          <div><span>T saída</span><strong>${fmtNum(ponto.temp_saida, 1)} °C</strong></div>
          <div><span>Consumo</span><strong>${fmtNum(ponto.kw_consumo, 1)} kW</strong></div>
          <div><span>P alta/baixa</span><strong>${fmtNum(ponto.pressao_alta, 0)} / ${fmtNum(ponto.pressao_baixa, 0)}</strong></div>
          <div><span>Corrente</span><strong>${fmtNum(ponto.corrente, 1)} A</strong></div>
        </div>
        ${destaque ? `<div class="pt-muted" style="margin-top:10px;">${esc(destaque)}</div>` : ''}
      </div>
    `;
  }

  async function openDetalhe(id) {
    const root = $('prodTestesRoot');
    if (!root) return;
    _view = 'detalhe';
    destroyCharts();
    root.innerHTML = `<div class="pt-empty"><i class="fa-solid fa-spinner fa-spin"></i> Analisando leituras do relatório #${esc(id)}...</div>`;
    setStatus('');

    try {
      const data = await apiGet(`/api/testes/relatorios/${id}`);
      const r = data.relatorio || {};
      const cmp = data.comparativo || {};
      const pontos = cmp.pontos_chave || {};
      const comp = cmp.comparacao || {};
      const barras = cmp.barras_comparativas || {};
      const leituras = data.leituras || [];
      const leiturasFtibr = data.leituras_ftibr || [];
      const diag = data.diagnostico || {};
      const ver = veredictoMeta(diag.veredicto);
      const keyIds = new Set(
        [pontos.inicio, pontos.pico_cop, pontos.pico_potencia, pontos.fim_regime]
          .filter(Boolean)
          .map((p) => p.id)
      );

      const labels = leituras.map((l, i) => {
        const dh = String(l.data_hora || '');
        const hora = dh.includes(' ') ? dh.split(' ')[1] : dh.slice(11, 19);
        return hora || `#${i + 1}`;
      });

      // Pontos anotados no gráfico (índices 0-based)
      const annIndices = {
        inicio: pontos.inicio ? pontos.inicio.indice - 1 : null,
        pico: pontos.pico_cop ? pontos.pico_cop.indice - 1 : null,
        fim: pontos.fim_regime ? pontos.fim_regime.indice - 1 : null,
      };

      root.innerHTML = `
        <div class="pt-shell">
          <div class="pt-back">
            <button type="button" class="pt-btn" id="prodTestesVoltarBtn"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
          </div>

          <div class="pt-hero">
            <div>
              <h2>
                <i class="fa-solid fa-chart-line" style="color:#34d399;"></i>
                OP ${esc(r.num_op || '—')} · ${esc(r.modelo || '—')}
                <span class="pt-badge" style="background:${ver.bg};color:${ver.color};border:1px solid ${ver.border};">${ver.label}</span>
              </h2>
              <p>
                Comparativo entre <strong style="color:#e2e8f0;">${leituras.length} leituras</strong>
                · ${esc(r.linha || '')}
                · Operador ${esc(r.operador || '—')}
                · ${fmtData(r.criado_em)}
                ${r.arquivo_xlsx ? `· ${esc(r.arquivo_xlsx)}` : ''}
              </p>
            </div>
            ${leiturasFtibr.length ? `
              <button type="button" class="pt-btn pt-btn-primary" id="prodTestesFtibrBtn">
                <i class="fa-solid fa-microchip"></i> FTIBR (${fmtNum(leiturasFtibr.length, 0)})
              </button>
            ` : ''}
          </div>

          ${(cmp.narrativa || []).length ? `
            <div class="pt-narrativa">
              <strong style="color:#7dd3fc;"><i class="fa-solid fa-book-open"></i> O que as leituras mostram</strong>
              <ul style="margin:8px 0 0;padding-left:18px;">
                ${cmp.narrativa.map((t) => `<li>${esc(t)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          <div class="pt-section-title"><i class="fa-solid fa-code-compare" style="color:#34d399;"></i> Comparar momentos do teste</div>
          <div class="pt-compare-grid">
            ${cardMomento('1. Início', pontos.inicio, CORES.inicio, 'Primeira leitura ativa')}
            ${cardMomento('2. Pico de COP', pontos.pico_cop, CORES.pico, 'Melhor eficiência registrada')}
            ${cardMomento('3. Fim do regime', pontos.fim_regime, CORES.fim, 'Última leitura estável antes da parada')}
            ${pontos.pico_potencia && pontos.pico_cop && pontos.pico_potencia.id !== pontos.pico_cop.id
              ? cardMomento('Pico de potência', pontos.pico_potencia, CORES.aquecimento, 'Maior kW de aquecimento')
              : ''}
          </div>

          <div class="pt-section-title"><i class="fa-solid fa-arrow-right-arrow-left" style="color:#a78bfa;"></i> Diferença entre as leituras</div>
          <div class="pt-table-wrap">
            <table class="pt-table pt-delta-table">
              <thead>
                <tr>
                  <th>Grandeza</th>
                  <th>Início → Pico</th>
                  <th>Pico → Fim</th>
                  <th>Início → Fim</th>
                </tr>
              </thead>
              <tbody>
                ${[
                  { k: 'cop', label: 'COP', dig: 2 },
                  { k: 'temp_dif', label: 'ΔT (°C)', dig: 2 },
                  { k: 'kw_aquecimento', label: 'kW aquecimento', dig: 2 },
                  { k: 'kw_consumo', label: 'kW consumo', dig: 2 },
                  { k: 'temp_saida', label: 'T saída (°C)', dig: 2 },
                  { k: 'corrente', label: 'Corrente (A)', dig: 1 },
                  { k: 'pressao_alta', label: 'Pressão alta', dig: 1 },
                ].map((row) => `
                  <tr>
                    <td>${esc(row.label)}</td>
                    <td class="delta ${deltaClass(comp.inicio_para_pico?.[row.k])}">${fmtDelta(comp.inicio_para_pico?.[row.k], row.dig)}</td>
                    <td class="delta ${deltaClass(comp.pico_para_fim?.[row.k])}">${fmtDelta(comp.pico_para_fim?.[row.k], row.dig)}</td>
                    <td class="delta ${deltaClass(comp.inicio_para_fim?.[row.k])}">${fmtDelta(comp.inicio_para_fim?.[row.k], row.dig)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div class="pt-section-title"><i class="fa-solid fa-chart-column" style="color:#38bdf8;"></i> Gráficos — evolução e comparação</div>
          <div class="pt-charts">
            <div class="pt-chart-card wide">
              <h4><i class="fa-solid fa-timeline" style="color:#34d399;"></i> Evolução das leituras (COP × ΔT × T saída)</h4>
              <div class="pt-chart-box"><canvas id="ptChartEvolucao"></canvas></div>
            </div>
            <div class="pt-chart-card">
              <h4><i class="fa-solid fa-chart-simple" style="color:#a78bfa;"></i> Início × Pico × Fim</h4>
              <div class="pt-chart-box"><canvas id="ptChartBarras"></canvas></div>
            </div>
            <div class="pt-chart-card">
              <h4><i class="fa-solid fa-bolt" style="color:#f59e0b;"></i> Potência ao longo do teste</h4>
              <div class="pt-chart-box"><canvas id="ptChartKw"></canvas></div>
            </div>
            <div class="pt-chart-card">
              <h4><i class="fa-solid fa-gauge" style="color:#ef4444;"></i> Pressões (alta × baixa)</h4>
              <div class="pt-chart-box"><canvas id="ptChartPress"></canvas></div>
            </div>
            <div class="pt-chart-card">
              <h4><i class="fa-solid fa-circle-nodes" style="color:#22d3ee;"></i> Relação COP × ΔT (cada ponto = 1 leitura)</h4>
              <div class="pt-chart-box"><canvas id="ptChartScatter"></canvas></div>
            </div>
          </div>

          <div class="pt-section-title"><i class="fa-solid fa-table" style="color:#94a3b8;"></i> Todas as leituras
            <span class="pt-muted"> · todas as colunas · destacadas = momentos-chave</span>
          </div>
          <div class="pt-table-wrap" style="max-height:420px;">
            <table class="pt-table">
              <thead>
                <tr>
                  <th>#</th><th>Fase</th>
                  ${COLS_LEITURAS.map((c) => `<th>${esc(c.label)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${leituras.map((l, i) => {
                  const isPico = pontos.pico_cop && l.id === pontos.pico_cop.id;
                  const isKey = keyIds.has(l.id);
                  return `
                    <tr class="${isPico ? 'pt-row-pico' : isKey ? 'pt-row-key' : ''}" style="${l.fase === 'parada' ? 'opacity:.65;' : ''}">
                      <td><strong>${i + 1}</strong></td>
                      <td>${fasePill(l.fase)}</td>
                      ${COLS_LEITURAS.map((c) => {
                        if (c.k === 'cop') {
                          const color = Number(l.cop) >= 4 ? '#34d399' : Number(l.cop) >= 2.5 ? '#fbbf24' : '#f87171';
                          return `<td><strong style="color:${color};">${fmtCell(l, c)}</strong></td>`;
                        }
                        return `<td>${fmtCell(l, c)}</td>`;
                      }).join('')}
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>

          ${(data.comparativo_modelo || []).length ? `
            <div class="pt-section-title"><i class="fa-solid fa-layer-group" style="color:#a78bfa;"></i> Outros testes do modelo ${esc(r.modelo)}</div>
            <div class="pt-table-wrap">
              <table class="pt-table">
                <thead><tr><th>Data</th><th>OP</th><th>Operador</th><th>Leituras</th><th>COP méd</th><th>COP máx</th><th>ΔT</th></tr></thead>
                <tbody>
                  ${data.comparativo_modelo.map((c) => `
                    <tr class="clickable" data-id="${c.id}">
                      <td>${fmtData(c.criado_em)}</td>
                      <td><strong>${esc(c.num_op || '—')}</strong></td>
                      <td>${esc(c.operador || '—')}</td>
                      <td>${fmtNum(c.total_registros, 0)}</td>
                      <td>${fmtNum(c.cop_medio, 1)}</td>
                      <td>${fmtNum(c.cop_max, 1)}</td>
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
        closeFtibrModal();
        renderListaShell();
        renderKpis();
        renderMachines();
        loadRelatorios($('prodTestesSearch')?.value || '');
      });

      $('prodTestesFtibrBtn')?.addEventListener('click', () => {
        showFtibrModal(r, leiturasFtibr);
      });

      root.querySelectorAll('tr.clickable[data-id]').forEach((tr) => {
        tr.addEventListener('click', () => openDetalhe(tr.getAttribute('data-id')));
      });

      chartDefaults();
      requestAnimationFrame(() => {
        // 1) Evolução principal com pontos-chave maiores
        const pointRadius = leituras.map((_, i) => (
          i === annIndices.inicio || i === annIndices.pico || i === annIndices.fim ? 6 : (leituras.length > 40 ? 0 : 2)
        ));
        makeChart('ptChartEvolucao', {
          type: 'line',
          data: {
            labels,
            datasets: [
              ds('COP', leituras.map((l) => l.cop), CORES.cop, { yAxisID: 'y', pointRadius, pointHoverRadius: 7 }),
              ds('ΔT (°C)', leituras.map((l) => l.temp_dif), CORES.delta, { yAxisID: 'y1', pointRadius: 0 }),
              ds('T saída (°C)', leituras.map((l) => l.temp_saida), CORES.saida, { yAxisID: 'y1', pointRadius: 0, borderDash: [4, 3] }),
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
              tooltip: {
                callbacks: {
                  afterBody(items) {
                    const i = items?.[0]?.dataIndex;
                    if (i == null) return '';
                    const tags = [];
                    if (i === annIndices.inicio) tags.push('→ INÍCIO');
                    if (i === annIndices.pico) tags.push('→ PICO COP');
                    if (i === annIndices.fim) tags.push('→ FIM REGIME');
                    const fase = leituras[i]?.fase;
                    if (fase) tags.push(`Fase: ${FASE_META[fase]?.label || fase}`);
                    return tags;
                  },
                },
              },
            },
            scales: {
              x: { ticks: { maxTicksLimit: 10, font: { size: 10 } } },
              y: { title: { display: true, text: 'COP', color: CORES.cop }, beginAtZero: true, ticks: { font: { size: 10 } } },
              y1: {
                position: 'right',
                title: { display: true, text: '°C', color: CORES.delta },
                grid: { drawOnChartArea: false },
                ticks: { font: { size: 10 } },
              },
            },
          },
        });

        // 2) Barras comparativas início/pico/fim
        if (barras.labels?.length) {
          makeChart('ptChartBarras', {
            type: 'bar',
            data: {
              labels: barras.labels,
              datasets: [
                { label: 'COP', data: barras.cop, backgroundColor: CORES.cop + 'cc', borderRadius: 6 },
                { label: 'ΔT (°C)', data: barras.delta_t, backgroundColor: CORES.delta + 'cc', borderRadius: 6 },
                { label: 'kW aq.', data: barras.kw_aquecimento, backgroundColor: CORES.aquecimento + 'cc', borderRadius: 6 },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
              scales: {
                x: { ticks: { font: { size: 10 } } },
                y: { beginAtZero: true, ticks: { font: { size: 10 } } },
              },
            },
          });
        }

        // 3) Potência
        makeChart('ptChartKw', {
          type: 'line',
          data: {
            labels,
            datasets: [
              ds('Aquecimento', leituras.map((l) => l.kw_aquecimento), CORES.aquecimento),
              ds('Consumo', leituras.map((l) => l.kw_consumo), CORES.consumo),
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
            scales: {
              x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } },
              y: { beginAtZero: true, ticks: { font: { size: 10 } } },
            },
          },
        });

        // 4) Pressões
        makeChart('ptChartPress', {
          type: 'line',
          data: {
            labels,
            datasets: [
              ds('Alta', leituras.map((l) => l.pressao_alta), CORES.pAlta),
              ds('Baixa', leituras.map((l) => l.pressao_baixa), CORES.pBaixa),
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
            scales: {
              x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } },
              y: { beginAtZero: false, ticks: { font: { size: 10 } } },
            },
          },
        });

        // 5) Scatter COP × ΔT
        const scatterPts = leituras
          .filter((l) => l.fase !== 'parada' && numOk(l.cop) && numOk(l.temp_dif))
          .map((l) => ({
            x: Number(l.temp_dif),
            y: Number(l.cop),
            label: l.data_hora,
            fase: l.fase,
          }));
        makeChart('ptChartScatter', {
          type: 'scatter',
          data: {
            datasets: [{
              label: 'Leituras',
              data: scatterPts,
              backgroundColor: scatterPts.map((p) => (FASE_META[p.fase]?.color || '#94a3b8') + 'cc'),
              borderColor: scatterPts.map((p) => FASE_META[p.fase]?.color || '#94a3b8'),
              pointRadius: 5,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label(ctx) {
                    const p = ctx.raw || {};
                    return `ΔT ${p.x} °C · COP ${p.y} · ${FASE_META[p.fase]?.label || ''}`;
                  },
                },
              },
            },
            scales: {
              x: { title: { display: true, text: 'ΔT (°C)' }, ticks: { font: { size: 10 } } },
              y: { title: { display: true, text: 'COP' }, beginAtZero: true, ticks: { font: { size: 10 } } },
            },
          },
        });
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

  function numOk(v) {
    return v != null && !Number.isNaN(Number(v));
  }

  function init() {
    if (_init) return;
    if (!$('producaoTestesPane')) return;
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
