// Engenharia — Gerados de graficos
(function () {
  'use strict';

  const PREF_CHAVE = 'engenharia_gerador_graficos';
  const PANE_VERSION = '5';
  const MAX_GRUPOS = 5;
  const CORES = ['#ef4444', '#22c55e', '#a855f7', '#f59e0b', '#06b6d4'];
  const DEFAULTS = {
    nomeAgua: 'Temperatura da água',
    nomeParametros: 'Parâmetros',
    nomePressao: 'Parâmetros de pressão',
    tituloGrafico: '',
    aguaMax: 40,
    aguaMin: 16,
    aguaTick: 2,
    paMin: 180,
    paMax: 300,
    paTick: 10,
    registros: [],
  };

  let chartAlta = null;
  let bound = false;
  let saveTimer = null;
  let prefsCarregadas = false;
  let grupos = gruposPadrao();
  let pontosLinha = [];
  let dragLinha = null;
  let skipClickLinha = false;

  function gruposPadrao() {
    return [
      { id: 'e1', nome: '3~380', max: 15.5, min: 9.5, tick: 0.5 },
      { id: 'e2', nome: '3~220', max: 28.5, min: 22.5, tick: 0.5 },
      { id: 'e3', nome: '1~220v', max: 22, min: 16, tick: 0.5 },
    ];
  }

  function $(id) { return document.getElementById(id); }

  function num(id, fallback) {
    const n = Number($(id) && $(id).value);
    return Number.isFinite(n) ? n : fallback;
  }

  function txt(id, fallback) {
    const v = String($(id)?.value || '').trim();
    return v || fallback;
  }

  function linspace(a, b, n) {
    if (n <= 1) return [a];
    const out = [];
    for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
    return out;
  }

  function novoIdGrupo() {
    return `g${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  }

  function migrarGrupos(cfg) {
    if (Array.isArray(cfg?.grupos) && cfg.grupos.length) {
      return cfg.grupos.slice(0, MAX_GRUPOS).map((g, i) => ({
        id: String(g.id || `e${i + 1}`),
        nome: String(g.nome || `Grupo ${i + 1}`).trim() || `Grupo ${i + 1}`,
        max: Number(g.max),
        min: Number(g.min),
        tick: Number(g.tick),
      })).map((g) => ({
        id: g.id,
        nome: g.nome,
        max: Number.isFinite(g.max) ? g.max : 10,
        min: Number.isFinite(g.min) ? g.min : 0,
        tick: Number.isFinite(g.tick) && g.tick > 0 ? g.tick : 0.5,
      }));
    }
    return [
      { id: 'e1', nome: cfg?.eixo1 || '3~380', max: cfg?.e1Max ?? 15.5, min: cfg?.e1Min ?? 9.5, tick: cfg?.e1Tick ?? 0.5 },
      { id: 'e2', nome: cfg?.eixo2 || '3~220', max: cfg?.e2Max ?? 28.5, min: cfg?.e2Min ?? 22.5, tick: cfg?.e2Tick ?? 0.5 },
      { id: 'e3', nome: cfg?.eixo3 || '1~220v', max: cfg?.e3Max ?? 22, min: cfg?.e3Min ?? 16, tick: cfg?.e3Tick ?? 0.5 },
    ];
  }

  function lerGruposDoDom() {
    const wrap = $('ggGrupos');
    if (!wrap) return grupos;
    const lidos = [];
    wrap.querySelectorAll('[data-gg-grupo]').forEach((el) => {
      lidos.push({
        id: el.getAttribute('data-gg-grupo'),
        nome: String(el.querySelector('[data-gg-nome]')?.value || '').trim() || 'Grupo',
        max: Number(el.querySelector('[data-gg-max]')?.value),
        min: Number(el.querySelector('[data-gg-min]')?.value),
        tick: Number(el.querySelector('[data-gg-tick]')?.value),
      });
    });
    return lidos.map((g) => ({
      id: g.id,
      nome: g.nome,
      max: Number.isFinite(g.max) ? g.max : 10,
      min: Number.isFinite(g.min) ? g.min : 0,
      tick: Number.isFinite(g.tick) && g.tick > 0 ? g.tick : 0.5,
    }));
  }

  function estadoAtual() {
    grupos = lerGruposDoDom();
    return {
      nomeAgua: txt('ggNomeAgua', DEFAULTS.nomeAgua),
      nomeParametros: txt('ggNomeParametros', DEFAULTS.nomeParametros),
      nomePressao: txt('ggNomePressao', DEFAULTS.nomePressao),
      tituloGrafico: String($('ggTituloGrafico')?.value || '').trim(),
      aguaMax: num('ggAguaMax', DEFAULTS.aguaMax),
      aguaMin: num('ggAguaMin', DEFAULTS.aguaMin),
      aguaTick: num('ggAguaTick', DEFAULTS.aguaTick),
      paMin: num('ggPaMin', DEFAULTS.paMin),
      paMax: num('ggPaMax', DEFAULTS.paMax),
      paTick: num('ggPaTick', DEFAULTS.paTick),
      grupos,
      pontosLinha,
      registros: loadRegs(),
    };
  }

  function loadRegs() {
    try {
      const parsed = $('ggRegsJson')?.value ? JSON.parse($('ggRegsJson').value) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveRegs(regs) {
    const el = $('ggRegsJson');
    if (el) el.value = JSON.stringify(regs);
    salvarPrefs();
  }

  function aplicarEstado(cfg) {
    const c = Object.assign({}, DEFAULTS, cfg || {});
    const set = (id, v) => { const el = $(id); if (el != null && v != null) el.value = v; };
    set('ggNomeAgua', c.nomeAgua);
    set('ggNomeParametros', c.nomeParametros);
    set('ggNomePressao', c.nomePressao);
    set('ggTituloGrafico', c.tituloGrafico || '');
    set('ggAguaMax', c.aguaMax);
    set('ggAguaMin', c.aguaMin);
    set('ggAguaTick', c.aguaTick);
    set('ggPaMin', c.paMin);
    set('ggPaMax', c.paMax);
    set('ggPaTick', c.paTick);
    set('ggRegsJson', JSON.stringify(Array.isArray(c.registros) ? c.registros : []));
    grupos = migrarGrupos(c);
    pontosLinha = Array.isArray(c.pontosLinha) ? c.pontosLinha.map((p) => ({
      x: Number(p.x), y: Number(p.y), curvo: !!p.curvo,
    })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
    renderGrupos();
    atualizarRotulos();
  }

  function salvarPrefs() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fetch('/api/usuario/preferencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ chave: PREF_CHAVE, valor: JSON.stringify(estadoAtual()) }),
      }).catch(() => {});
    }, 350);
  }

  async function carregarPrefs() {
    try {
      const r = await fetch(`/api/usuario/preferencias/${encodeURIComponent(PREF_CHAVE)}`, { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      if (d?.valor == null || d.valor === '') return;
      const parsed = typeof d.valor === 'string' ? JSON.parse(d.valor) : d.valor;
      if (parsed && typeof parsed === 'object') aplicarEstado(parsed);
    } catch (_) { /* padrão */ }
  }

  function tituloAutomatico() {
    const nomes = grupos.map((g) => g.nome).filter(Boolean);
    const agua = txt('ggNomeAgua', DEFAULTS.nomeAgua);
    if (!nomes.length) return agua;
    return `${agua} com escalas para ${nomes.join(', ')}`;
  }

  function atualizarRotulos() {
    grupos = lerGruposDoDom();
    const sel = $('ggModelo');
    if (sel) {
      const atual = sel.value;
      sel.innerHTML = grupos.map((g) => `<option value="${g.id}">${g.nome}</option>`).join('');
      if (grupos.some((g) => g.id === atual)) sel.value = atual;
    }
    const sub = $('ggSubtitulo');
    if (sub) {
      sub.textContent = `${txt('ggNomeAgua', DEFAULTS.nomeAgua)} × ${txt('ggNomePressao', DEFAULTS.nomePressao)}`;
    }
    const btnAdd = $('ggBtnAddGrupo');
    if (btnAdd) btnAdd.disabled = grupos.length >= MAX_GRUPOS;
  }

  function escAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function renderGrupos() {
    const wrap = $('ggGrupos');
    if (!wrap) return;
    wrap.innerHTML = grupos.map((g) => `
      <div class="gg-grupo" data-gg-grupo="${escAttr(g.id)}">
        <div class="gg-grupo-topo">
          <input class="gg-nome gg-eixo-nome" data-gg-nome value="${escAttr(g.nome)}" title="Nome do grupo">
          <button type="button" class="gg-btn-excluir" data-gg-excluir title="Excluir grupo" ${grupos.length <= 1 ? 'disabled' : ''}>
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
        <label><span data-gg-cap="max">${escAttr(g.nome)} — Máximo</span> <input data-gg-max type="number" step="0.1" value="${g.max}"></label>
        <label><span data-gg-cap="min">${escAttr(g.nome)} — Mínimo</span> <input data-gg-min type="number" step="0.1" value="${g.min}"></label>
        <label><span data-gg-cap="tick">${escAttr(g.nome)} — Intervalo</span> <input data-gg-tick type="number" step="0.1" value="${g.tick}"></label>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-gg-nome]').forEach((inp) => {
      const syncCaps = () => {
        const card = inp.closest('[data-gg-grupo]');
        const nome = inp.value.trim() || 'Grupo';
        const cap = (k, suf) => { const el = card?.querySelector(`[data-gg-cap="${k}"]`); if (el) el.textContent = `${nome} — ${suf}`; };
        cap('max', 'Máximo');
        cap('min', 'Mínimo');
        cap('tick', 'Intervalo');
      };
      inp.addEventListener('input', syncCaps);
      inp.addEventListener('change', () => { atualizarRotulos(); salvarPrefs(); desenhar(); });
    });
    wrap.querySelectorAll('[data-gg-max],[data-gg-min],[data-gg-tick]').forEach((inp) => {
      inp.addEventListener('change', () => { atualizarRotulos(); salvarPrefs(); desenhar(); });
    });
    wrap.querySelectorAll('[data-gg-excluir]').forEach((btn) => {
      btn.addEventListener('click', () => {
        grupos = lerGruposDoDom();
        if (grupos.length <= 1) return;
        const id = btn.closest('[data-gg-grupo]')?.getAttribute('data-gg-grupo');
        grupos = grupos.filter((g) => g.id !== id);
        renderGrupos();
        atualizarRotulos();
        salvarPrefs();
        desenhar();
      });
    });
    atualizarRotulos();
  }

  function adicionarGrupo() {
    grupos = lerGruposDoDom();
    if (grupos.length >= MAX_GRUPOS) return;
    grupos.push({ id: novoIdGrupo(), nome: `Grupo ${grupos.length + 1}`, max: 10, min: 0, tick: 0.5 });
    renderGrupos();
    atualizarRotulos();
    salvarPrefs();
    desenhar();
  }

  function recolherMenuLateral() {
    document.getElementById('sidebarContent')?.classList.add('collapsed');
    document.getElementById('sidebarHamburger')?.classList.remove('active');
  }

  function injectCss() {
    let style = $('ggGraficoCss');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ggGraficoCss';
      document.head.appendChild(style);
    }
    style.textContent = `
      #engenhariaGeradorGraficosPane .gg-body { margin-top: 28px; }
      #engenhariaGeradorGraficosPane .gg-layout {
        display: grid;
        grid-template-columns: minmax(170px, 1fr) minmax(280px, 3fr) minmax(210px, 1.1fr);
        gap: 16px;
        align-items: start;
      }
      #engenhariaGeradorGraficosPane .gg-side,
      #engenhariaGeradorGraficosPane .gg-pressao-row,
      #engenhariaGeradorGraficosPane .gg-form-grid { display: grid; gap: 8px; }
      #engenhariaGeradorGraficosPane .gg-pressao-row,
      #engenhariaGeradorGraficosPane .gg-form-grid { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
      #engenhariaGeradorGraficosPane .gg-nome {
        width: 100%; font-weight: 700; font-size: 14px;
        color: var(--content-title-color, #e2e8f0);
        background: transparent; border: 1px dashed #475569;
        border-radius: 8px; padding: 6px 8px;
      }
      #engenhariaGeradorGraficosPane .gg-nome:focus { border-style: solid; border-color: #38bdf8; outline: none; }
      #engenhariaGeradorGraficosPane .gg-eixo-nome { font-weight: 600; font-size: 13px; }
      #engenhariaGeradorGraficosPane .gg-titulo-grafico { margin-bottom: 8px; color: #0f172a; background: #fff; border-color: #94a3b8; }
      #engenhariaGeradorGraficosPane label {
        display: flex; flex-direction: column; gap: 4px;
        font-size: 13px; color: var(--inactive-color);
      }
      #engenhariaGeradorGraficosPane input,
      #engenhariaGeradorGraficosPane select {
        background: #0f172a; color: #e2e8f0;
        border: 1px solid var(--border-color, #334155);
        border-radius: 8px; padding: 8px 10px;
      }
      #engenhariaGeradorGraficosPane .gg-chart-wrap { display: flex; flex-direction: column; gap: 8px; }
      #engenhariaGeradorGraficosPane .gg-chart-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      #engenhariaGeradorGraficosPane .gg-chart-box {
        background: #fff; border-radius: 12px; padding: 16px 10px 10px; min-height: 420px;
      }
      #engenhariaGeradorGraficosPane .gg-grupos-scroll {
        max-height: 380px; overflow-y: auto; padding-right: 6px; margin-top: 8px;
      }
      #engenhariaGeradorGraficosPane .gg-grupo {
        border: 1px solid #334155; border-radius: 10px;
        padding: 10px; margin-bottom: 10px; background: rgba(15,23,42,.45);
      }
      #engenhariaGeradorGraficosPane .gg-grupo-topo { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
      #engenhariaGeradorGraficosPane .gg-btn-excluir {
        flex: 0 0 auto; width: 34px; height: 34px; border: none; border-radius: 8px;
        background: #7f1d1d; color: #fecaca; cursor: pointer;
      }
      #engenhariaGeradorGraficosPane .gg-btn-excluir:disabled { opacity: .4; cursor: not-allowed; }
      #engenhariaGeradorGraficosPane .gg-dica {
        margin: 8px 0 0; font-size: 12px; color: #64748b; line-height: 1.4;
      }
      @media (max-width: 1100px) {
        #engenhariaGeradorGraficosPane .gg-layout { grid-template-columns: 1fr; }
      }
    `;
  }

  function eixoY(id, title, color, min, max, step, extra) {
    return Object.assign({
      type: 'linear', min, max,
      title: { display: true, text: title, color, font: { weight: 'bold' } },
      ticks: { color, stepSize: step || undefined },
      grid: { drawOnChartArea: id === 'yTemp' },
    }, extra || {});
  }

  function ticksEixo(min, max, step) {
    const s = Number(step) > 0 ? Number(step) : 1;
    const ini = Number(min);
    const fim = Number(max);
    if (!Number.isFinite(ini) || !Number.isFinite(fim) || fim < ini) return [ini];
    const out = [];
    let guard = 0;
    for (let v = ini; v <= fim + s * 1e-6 && guard < 400; v += s) {
      out.push(Number(v.toFixed(6)));
      guard += 1;
    }
    return out.length ? out : [ini, fim];
  }

  function yDiagonal(x, paMin, paMax, tMin, tMax) {
    if (paMax === paMin) return tMin;
    return tMin + ((x - paMin) / (paMax - paMin)) * (tMax - tMin);
  }

  function interpolarY(x, pts) {
    if (!pts.length) return null;
    const ord = pts.slice().sort((a, b) => a.x - b.x);
    if (x <= ord[0].x) return ord[0].y;
    if (x >= ord[ord.length - 1].x) return ord[ord.length - 1].y;
    for (let i = 0; i < ord.length - 1; i++) {
      if (x >= ord[i].x && x <= ord[i + 1].x) {
        const span = ord[i + 1].x - ord[i].x || 1;
        return ord[i].y + ((x - ord[i].x) / span) * (ord[i + 1].y - ord[i].y);
      }
    }
    return ord[ord.length - 1].y;
  }

  function garantirPontosNaGrade() {
    const paMin = num('ggPaMin', DEFAULTS.paMin);
    const paMax = num('ggPaMax', DEFAULTS.paMax);
    const paTick = num('ggPaTick', DEFAULTS.paTick);
    const tMin = num('ggAguaMin', DEFAULTS.aguaMin);
    const tMax = num('ggAguaMax', DEFAULTS.aguaMax);
    const xs = ticksEixo(paMin, paMax, paTick);
    const prev = pontosLinha.slice();
    pontosLinha = xs.map((x, i) => {
      const old = prev.find((p) => Math.abs(p.x - x) < 1e-6);
      const yPrev = old ? old.y : interpolarY(x, prev);
      return {
        x,
        y: Number.isFinite(yPrev) ? yPrev : yDiagonal(x, paMin, paMax, tMin, tMax),
        curvo: old ? !!old.curvo : !!(prev[i] && prev[i].curvo),
      };
    });
  }

  function pixelDoPonto(chart, p) {
    return {
      x: chart.scales.x.getPixelForValue(p.x),
      y: chart.scales.yTemp.getPixelForValue(p.y),
    };
  }

  function hitPontoLinha(chart, px, py) {
    if (!chart.scales.x || !chart.scales.yTemp) return -1;
    for (let i = 0; i < pontosLinha.length; i++) {
      const pt = pixelDoPonto(chart, pontosLinha[i]);
      if (Math.hypot(pt.x - px, pt.y - py) <= 12) return i;
    }
    return -1;
  }

  function distPontoSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function hitTrechoLinha(chart, px, py) {
    if (!chart.scales.x || !chart.scales.yTemp || pontosLinha.length < 2) return -1;
    let melhor = { i: -1, d: 14 };
    for (let i = 0; i < pontosLinha.length - 1; i++) {
      const a = pixelDoPonto(chart, pontosLinha[i]);
      const b = pixelDoPonto(chart, pontosLinha[i + 1]);
      let d;
      if (pontosLinha[i].curvo) {
        d = Infinity;
        const cpx = (a.x + b.x) / 2;
        const cpy = (a.y + b.y) / 2 - (b.x - a.x) * 0.22;
        for (let t = 0; t <= 1; t += 0.08) {
          const u = 1 - t;
          const qx = u * u * a.x + 2 * u * t * cpx + t * t * b.x;
          const qy = u * u * a.y + 2 * u * t * cpy + t * t * b.y;
          d = Math.min(d, Math.hypot(px - qx, py - qy));
        }
      } else {
        d = distPontoSeg(px, py, a.x, a.y, b.x, b.y);
      }
      if (d < melhor.d) melhor = { i, d };
    }
    return melhor.i;
  }

  function desenharLinhaAzul(chart) {
    const { ctx, scales } = chart;
    if (!scales.x || !scales.yTemp || pontosLinha.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2563eb';
    ctx.lineJoin = 'round';
    const p0 = pixelDoPonto(chart, pontosLinha[0]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 0; i < pontosLinha.length - 1; i++) {
      const a = pixelDoPonto(chart, pontosLinha[i]);
      const b = pixelDoPonto(chart, pontosLinha[i + 1]);
      if (pontosLinha[i].curvo) {
        const cpx = (a.x + b.x) / 2;
        const cpy = (a.y + b.y) / 2 - (b.x - a.x) * 0.22;
        ctx.quadraticCurveTo(cpx, cpy, b.x, b.y);
      } else {
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
    pontosLinha.forEach((p, i) => {
      const pt = pixelDoPonto(chart, p);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, dragLinha && dragLinha.idx === i ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = '#2563eb';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    });
    ctx.restore();
  }

  const pluginLinhaAzul = {
    id: 'ggLinhaAzul',
    afterDatasetsDraw(chart) {
      desenharLinhaAzul(chart);
    },
    afterEvent(chart, args) {
      const ev = args.event;
      if (!ev || args.replay || !chart.scales.x || !chart.scales.yTemp) return;
      const tipo = ev.type;
      const px = ev.x;
      const py = ev.y;
      if (tipo === 'mousedown') {
        const idx = hitPontoLinha(chart, px, py);
        if (idx >= 0) {
          dragLinha = { idx, moved: false };
          chart.canvas.style.cursor = 'grabbing';
          args.changed = true;
        }
        return;
      }
      if (tipo === 'mousemove' && dragLinha) {
        const tMin = num('ggAguaMin', DEFAULTS.aguaMin);
        const tMax = num('ggAguaMax', DEFAULTS.aguaMax);
        const paMin = num('ggPaMin', DEFAULTS.paMin);
        const paMax = num('ggPaMax', DEFAULTS.paMax);
        const i = dragLinha.idx;
        const prev = pontosLinha[i - 1];
        const next = pontosLinha[i + 1];
        let x = chart.scales.x.getValueForPixel(px);
        let y = chart.scales.yTemp.getValueForPixel(py);
        const lo = prev ? prev.x + 0.01 : paMin;
        const hi = next ? next.x - 0.01 : paMax;
        x = Math.max(lo, Math.min(hi, x));
        y = Math.max(Math.min(tMin, tMax), Math.min(Math.max(tMin, tMax), y));
        pontosLinha[i] = { x, y, curvo: pontosLinha[i].curvo };
        dragLinha.moved = true;
        args.changed = true;
        return;
      }
      if (tipo === 'mouseup') {
        if (dragLinha) {
          skipClickLinha = !!dragLinha.moved;
          dragLinha = null;
          salvarPrefs();
          chart.canvas.style.cursor = 'default';
          args.changed = true;
        }
        return;
      }
      if (tipo === 'mousemove' && !dragLinha) {
        const sobrePonto = hitPontoLinha(chart, px, py) >= 0;
        const sobreTrecho = hitTrechoLinha(chart, px, py) >= 0;
        chart.canvas.style.cursor = sobrePonto ? 'grab' : (sobreTrecho ? 'pointer' : 'default');
      }
      if (tipo === 'click' && !dragLinha) {
        if (skipClickLinha) {
          skipClickLinha = false;
          return;
        }
        const idx = hitPontoLinha(chart, px, py);
        if (idx < 0) {
          const trecho = hitTrechoLinha(chart, px, py);
          if (trecho >= 0) {
            pontosLinha[trecho].curvo = !pontosLinha[trecho].curvo;
            salvarPrefs();
            args.changed = true;
          }
        }
      }
    },
  };

  const pluginConectores = {
    id: 'ggConnectors',
    afterDatasetsDraw(chart) {
      const recs = chart.$ggRecs || [];
      const { ctx, scales } = chart;
      recs.forEach((reg) => {
        const scaleId = `yG_${reg.modelo}`;
        if (!scales.x || !scales.yTemp || !scales[scaleId]) return;
        const x = scales.x.getPixelForValue(reg.pressao);
        const y1 = scales.yTemp.getPixelForValue(reg.temp);
        const y2 = scales[scaleId].getPixelForValue(reg.valor);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, y1);
        ctx.lineTo(x, y2);
        ctx.strokeStyle = 'rgba(100,116,139,.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      });
    },
  };

  function normalizarModelo(modelo) {
    if (modelo === '3~380') return 'e1';
    if (modelo === '3~220') return 'e2';
    if (modelo === '1~220v') return 'e3';
    return modelo;
  }

  function desenhar() {
    const canvas = $('ggChartAlta');
    if (!canvas || typeof Chart === 'undefined') return;
    grupos = lerGruposDoDom();
    const nomeAgua = txt('ggNomeAgua', DEFAULTS.nomeAgua);
    const nomePressao = txt('ggNomePressao', DEFAULTS.nomePressao);
    const titulo = txt('ggTituloGrafico', tituloAutomatico());
    const paMin = num('ggPaMin', DEFAULTS.paMin);
    const paMax = num('ggPaMax', DEFAULTS.paMax);
    const paTick = num('ggPaTick', DEFAULTS.paTick);
    const tMin = num('ggAguaMin', DEFAULTS.aguaMin);
    const tMax = num('ggAguaMax', DEFAULTS.aguaMax);
    const tTick = num('ggAguaTick', DEFAULTS.aguaTick);
    garantirPontosNaGrade();
    const idsOk = new Set(grupos.map((g) => g.id));
    const recs = loadRegs().map((r) => Object.assign({}, r, { modelo: normalizarModelo(r.modelo) }))
      .filter((r) => idsOk.has(r.modelo));

    const datasets = [
      {
        type: 'scatter', label: 'Pontos',
        data: recs.map((r) => ({ x: r.pressao, y: r.temp })),
        backgroundColor: '#2563eb', pointRadius: 6, yAxisID: 'yTemp',
      },
    ];
    const scales = {
      x: {
        type: 'linear', min: paMin, max: paMax,
        title: { display: true, text: nomePressao, color: '#0f172a' },
        ticks: { stepSize: paTick || undefined, maxRotation: 90, minRotation: 90, color: '#334155' },
      },
      yTemp: eixoY('yTemp', nomeAgua, '#2563eb', tMin, tMax, tTick, { position: 'left' }),
    };
    grupos.forEach((g, i) => {
      const axisId = `yG_${g.id}`;
      datasets.push({
        type: 'scatter', label: g.nome,
        data: recs.filter((r) => r.modelo === g.id).map((r) => ({ x: r.pressao, y: r.valor })),
        backgroundColor: CORES[i % CORES.length], pointRadius: 6, yAxisID: axisId,
      });
      scales[axisId] = eixoY(axisId, g.nome, CORES[i % CORES.length], g.min, g.max, g.tick, {
        position: 'right',
        offset: i > 0,
        grid: { drawOnChartArea: false },
      });
    });

    if (chartAlta) chartAlta.destroy();
    chartAlta = new Chart(canvas, {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        events: ['mousemove', 'mouseout', 'click', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend'],
        plugins: {
          legend: { display: false },
          title: { display: true, text: titulo, color: '#0f172a' },
        },
        scales,
        layout: { padding: { right: 8, top: 8 } },
      },
      plugins: [pluginLinhaAzul, pluginConectores],
    });
    chartAlta.$ggRecs = recs;
  }

  function canvasDoGrafico() { return chartAlta?.canvas || $('ggChartAlta'); }

  function blobDoGrafico() {
    return new Promise((resolve, reject) => {
      const src = canvasDoGrafico();
      if (!src) return reject(new Error('Gráfico ainda não está pronto.'));
      const out = document.createElement('canvas');
      out.width = src.width;
      out.height = src.height;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, 0, 0);
      out.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível gerar a imagem.')), 'image/png');
    });
  }

  function baixarPng(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gerador-graficos.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function copiarGrafico() {
    try {
      const blob = await blobDoGrafico();
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        alert('Gráfico copiado. Cole no Word, e-mail ou WhatsApp.');
        return;
      }
      baixarPng(blob);
      alert('Este navegador não copia imagem. O arquivo foi baixado.');
    } catch (err) {
      alert(err?.message || 'Não foi possível copiar o gráfico.');
    }
  }

  async function exportarGrafico() {
    try { baixarPng(await blobDoGrafico()); }
    catch (err) { alert(err?.message || 'Não foi possível exportar o gráfico.'); }
  }

  function htmlPainel() {
    return `
      <div class="content-wrapper">
        <div class="content-wrapper-header">
          <div class="content-wrapper-context">
            <h3 class="img-content" style="display:flex;align-items:center;gap:10px;">
              <i class="fa-solid fa-chart-line" style="color:#38bdf8;"></i>
              <span>Gerados de graficos</span>
            </h3>
            <div class="content-text" id="ggSubtitulo">Temperatura da água × Parâmetros de pressão</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" id="ggBtnRegistro" class="content-button" style="background:linear-gradient(135deg,#0ea5e9 0%,#0369a1 100%);color:#fff;">
              <i class="fa-solid fa-plus"></i> Adicionar Registro
            </button>
            <button type="button" id="ggBtnLimpar" class="content-button" style="background:#334155;color:#fff;">Limpar pontos</button>
          </div>
        </div>
        <input type="hidden" id="ggRegsJson" value="[]">
        <div id="ggFormWrap" style="display:none;margin:28px 0 16px;padding:16px;border:1px solid var(--border-color);border-radius:12px;background:rgba(15,23,42,.35);">
          <div style="font-weight:700;margin-bottom:12px;">Novo Registro</div>
          <div class="gg-form-grid">
            <label>Temperatura <input id="ggTemp" type="number" step="0.1" value="30"></label>
            <label>Pressão <input id="ggPressao" type="number" step="1" value="250"></label>
            <label>Modelo <select id="ggModelo"></select></label>
            <label>Valor <input id="ggValor" type="number" step="0.1" value="12.4"></label>
          </div>
          <button type="button" id="ggBtnEnviar" class="content-button" style="margin-top:12px;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:#fff;">Enviar Registro</button>
        </div>
        <div class="gg-body">
          <div class="gg-layout">
            <div class="gg-side">
              <input id="ggNomeAgua" class="gg-nome" value="Temperatura da água" title="Clique para mudar o nome">
              <label>Máximo <input id="ggAguaMax" type="number" value="40"></label>
              <label>Mínimo <input id="ggAguaMin" type="number" value="16"></label>
              <label>Intervalo <input id="ggAguaTick" type="number" value="2"></label>
            </div>
            <div class="gg-chart-wrap">
              <div class="gg-chart-toolbar">
                <input id="ggTituloGrafico" class="gg-nome" placeholder="Título do gráfico — clique para editar" title="Título que aparece no gráfico" style="flex:1;min-width:180px;">
                <button type="button" id="ggBtnCopiar" class="content-button" style="background:#1d4ed8;color:#fff;">
                  <i class="fa-regular fa-copy"></i> Copiar gráfico
                </button>
                <button type="button" id="ggBtnExportar" class="content-button" style="background:linear-gradient(135deg,#22c55e 0%,#15803d 100%);color:#fff;">
                  <i class="fa-solid fa-image"></i> Exportar gráfico
                </button>
              </div>
              <div class="gg-chart-box">
                <canvas id="ggChartAlta"></canvas>
              </div>
              <p class="gg-dica">Arraste os pontos azuis para mudar a linha. Clique no trecho entre dois pontos para deixar <b>curvo</b> ou <b>reto</b>.</p>
            </div>
            <div class="gg-side">
              <input id="ggNomeParametros" class="gg-nome" value="Parâmetros" title="Clique para mudar o nome">
              <button type="button" id="ggBtnAddGrupo" class="content-button" style="background:#1e3a5f;color:#fff;margin-top:8px;">
                <i class="fa-solid fa-plus"></i> Adicionar grupo
              </button>
              <div id="ggGrupos" class="gg-grupos-scroll"></div>
            </div>
          </div>
          <input id="ggNomePressao" class="gg-nome" value="Parâmetros de pressão" title="Clique para mudar o nome" style="max-width:420px;margin:18px 0 8px;">
          <div class="gg-pressao-row">
            <label>Mínimo <input id="ggPaMin" type="number" value="180"></label>
            <label>Máximo <input id="ggPaMax" type="number" value="300"></label>
            <label>Intervalo <input id="ggPaTick" type="number" value="10"></label>
          </div>
        </div>
      </div>`;
  }

  function garantirUi() {
    const menuDesenho = $('menu-engenharia-desenho-tecnico');
    if (menuDesenho && !$('menu-engenharia-gerador-graficos')) {
      const a = document.createElement('a');
      a.href = '#';
      a.id = 'menu-engenharia-gerador-graficos';
      a.className = 'menu-link';
      a.setAttribute('data-nav-key', 'side:engenharia:gerador-graficos');
      a.setAttribute('data-nav-parent', 'side:engenharia');
      a.setAttribute('data-nav-pos', 'side');
      a.setAttribute('data-nav-label', 'Gerados de graficos');
      a.setAttribute('data-nav-selector', '#menu-engenharia-gerador-graficos');
      a.innerHTML = '<i class="fa-solid fa-chart-line" style="margin-right:8px;"></i> Gerados de graficos';
      const pir = $('menu-engenharia-pir-eng');
      (pir || menuDesenho).insertAdjacentElement('afterend', a);
    }

    let pane = $('engenhariaGeradorGraficosPane');
    if (!pane) {
      pane = document.createElement('div');
      pane.id = 'engenhariaGeradorGraficosPane';
      pane.className = 'tab-pane';
      pane.style.display = 'none';
      const after = $('engenhariaDesenhoTecnicoPane');
      if (after) after.insertAdjacentElement('afterend', pane);
      else document.querySelector('.main-container')?.appendChild(pane);
    }
    if (pane.dataset.ggVersion !== PANE_VERSION) {
      pane.innerHTML = htmlPainel();
      pane.dataset.ggVersion = PANE_VERSION;
      bound = false;
    }
  }

  function ligar() {
    if (bound) return;
    bound = true;
    garantirUi();
    injectCss();
    renderGrupos();
    ['ggAguaMax', 'ggAguaMin', 'ggAguaTick', 'ggPaMin', 'ggPaMax', 'ggPaTick'].forEach((id) => {
      $(id)?.addEventListener('change', () => { salvarPrefs(); desenhar(); });
    });
    ['ggNomeAgua', 'ggNomeParametros', 'ggNomePressao', 'ggTituloGrafico'].forEach((id) => {
      const fn = () => { atualizarRotulos(); salvarPrefs(); desenhar(); };
      $(id)?.addEventListener('change', fn);
      $(id)?.addEventListener('blur', fn);
    });
    $('ggBtnAddGrupo')?.addEventListener('click', adicionarGrupo);
    $('ggBtnRegistro')?.addEventListener('click', () => {
      const wrap = $('ggFormWrap');
      if (!wrap) return;
      wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
    });
    $('ggBtnEnviar')?.addEventListener('click', () => {
      grupos = lerGruposDoDom();
      const regs = loadRegs();
      regs.push({
        temp: num('ggTemp', 30),
        pressao: num('ggPressao', 250),
        modelo: $('ggModelo')?.value || grupos[0]?.id || 'e1',
        valor: num('ggValor', 12.4),
      });
      saveRegs(regs);
      $('ggFormWrap').style.display = 'none';
      desenhar();
    });
    $('ggBtnLimpar')?.addEventListener('click', () => {
      if (!confirm('Apagar todos os pontos marcados?')) return;
      saveRegs([]);
      desenhar();
    });
    $('ggBtnCopiar')?.addEventListener('click', copiarGrafico);
    $('ggBtnExportar')?.addEventListener('click', exportarGrafico);
  }

  async function abrir() {
    garantirUi();
    recolherMenuLateral();
    document.querySelectorAll('.left-side .side-menu a').forEach((a) => a.classList.remove('is-active'));
    $('menu-engenharia-gerador-graficos')?.classList.add('is-active');
    if (typeof window.showMainTab === 'function') {
      window.showMainTab('engenhariaGeradorGraficosPane');
    }
    ligar();
    if (!prefsCarregadas) {
      prefsCarregadas = true;
      await carregarPrefs();
    }
    atualizarRotulos();
    setTimeout(desenhar, 40);
  }

  window.abrirGeradorGraficosEngenharia = abrir;

  document.addEventListener('click', (e) => {
    const link = e.target?.closest?.('#menu-engenharia-gerador-graficos');
    if (!link) return;
    e.preventDefault();
    abrir();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', garantirUi);
  } else {
    garantirUi();
  }
})();
