// Engenharia — Gerados de graficos
(function () {
  'use strict';

  const PREF_CHAVE = 'engenharia_gerador_graficos';
  const GG_API = '/api/engenharia/gerador-graficos';
  const PANE_VERSION = '14';
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
  let dragPan = null;
  let skipClickLinha = false;
  let overlayTeste = null;
  let vista = null;
  let vistaDinamica = null;
  let escalaModo = 'original';
  let salvosCache = [];
  let ggLeiturasCache = [];
  let ggRelatorioAtual = null;
  let ggColunasCache = null;

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
    set('ggRegsJson', '[]');
    grupos = migrarGrupos(c);
    pontosLinha = Array.isArray(c.pontosLinha) ? c.pontosLinha.map((p) => ({
      x: Number(p.x), y: Number(p.y), curva: curvaDoPonto(p),
    })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
    overlayTeste = null;
    vista = null;
    vistaDinamica = null;
    escalaModo = 'original';
    dragPan = null;
    renderGrupos();
    preencherSelectsEixos();
    atualizarRotulos();
    atualizarOverlayInfo();
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
    const agua = rotuloEixo(txt('ggNomeAgua', DEFAULTS.nomeAgua), DEFAULTS.nomeAgua);
    if (!nomes.length) return agua;
    return `${agua} com escalas para ${nomes.map((n) => rotuloEixo(n, n)).join(', ')}`;
  }

  function atualizarRotulos() {
    grupos = lerGruposDoDom();
    const sel = $('ggModelo');
    if (sel) {
      const atual = sel.value;
      sel.innerHTML = grupos.map((g) => `<option value="${g.id}">${escHtml(rotuloEixo(g.nome, g.nome))}</option>`).join('');
      if (grupos.some((g) => g.id === atual)) sel.value = atual;
    }
    const sub = $('ggSubtitulo');
    if (sub) {
      sub.textContent = `${rotuloEixo(txt('ggNomeAgua', DEFAULTS.nomeAgua), DEFAULTS.nomeAgua)} × ${rotuloEixo(txt('ggNomePressao', DEFAULTS.nomePressao), DEFAULTS.nomePressao)}`;
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

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function nomeColuna(c) {
    return String(c || '').replace(/_/g, ' ');
  }

  function rotuloEixo(valor, fallback) {
    const v = String(valor || '').trim() || fallback;
    if ((ggColunasCache || []).includes(v)) return nomeColuna(v);
    return v;
  }

  function valorParaColuna(valor, fallback) {
    const cols = ggColunasCache || [];
    const v = String(valor || '').trim();
    if (!v) return fallback || '';
    if (cols.includes(v)) return v;
    const slug = v.replace(/\s+/g, '_');
    if (cols.includes(slug)) return slug;
    const porNome = cols.find((c) => nomeColuna(c).toLowerCase() === v.toLowerCase());
    return porNome || fallback || '';
  }

  function htmlOptionsColunas(selecionada, incluirVazio, rotuloVazio) {
    const cols = ggColunasCache || [];
    let sel = String(selecionada || '').trim();
    if (sel && !cols.includes(sel)) {
      const resolved = valorParaColuna(sel, '');
      if (resolved) sel = resolved;
    }
    if (sel && !cols.includes(sel)) sel = '';
    let html = incluirVazio ? `<option value="">${escHtml(rotuloVazio || '— escolher —')}</option>` : '';
    cols.forEach((c) => {
      html += `<option value="${escAttr(c)}"${c === sel ? ' selected' : ''}>${escHtml(nomeColuna(c))}</option>`;
    });
    if (!html.replace(/<option[^>]*><\/option>/g, '').trim() && incluirVazio) {
      html = `<option value="">${escHtml(rotuloVazio || 'Carregando colunas…')}</option>`;
    }
    return html;
  }

  function preencherSelectsEixos() {
    const agua = $('ggNomeAgua');
    const pressao = $('ggNomePressao');
    if (agua) {
      const v = agua.value || valorParaColuna(DEFAULTS.nomeAgua, 'temp_ambiente') || 'temp_ambiente';
      agua.innerHTML = htmlOptionsColunas(v, false);
    }
    if (pressao) {
      const v = pressao.value || valorParaColuna(DEFAULTS.nomePressao, 'pressao_alta') || 'pressao_alta';
      pressao.innerHTML = htmlOptionsColunas(v, false);
    }
    document.querySelectorAll('[data-gg-nome]').forEach((sel) => {
      const card = sel.closest('[data-gg-grupo]');
      const v = sel.value || card?.getAttribute('data-gg-coluna') || '';
      sel.innerHTML = htmlOptionsColunas(v, true, '— escolher coluna —');
      const nome = rotuloEixo(sel.value, sel.value.trim() || 'Grupo');
      const cap = (k, suf) => { const el = card?.querySelector(`[data-gg-cap="${k}"]`); if (el) el.textContent = `${nome} — ${suf}`; };
      cap('max', 'Máximo');
      cap('min', 'Mínimo');
      cap('tick', 'Intervalo');
    });
  }

  async function carregarColunasTeste() {
    if (ggColunasCache && ggColunasCache.length) {
      preencherSelectsEixos();
      return;
    }
    try {
      const d = await ggApi('/testes/colunas');
      ggColunasCache = d.colunas || [];
      preencherSelectsEixos();
    } catch (err) {
      console.warn('[gerador-graficos] colunas:', err);
      ggColunasCache = ggColunasCache || [];
      preencherSelectsEixos();
    }
  }

  async function ggApi(path, opts) {
    const r = await fetch(GG_API + path, Object.assign({ credentials: 'include' }, opts || {}));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || d.message || `Erro ${r.status}`);
    return d;
  }

  function fmtData(v) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fmtNum(v, casas) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const c = casas == null ? (Math.abs(n) >= 100 ? 1 : 2) : casas;
    return String(Number(n.toFixed(c)));
  }

  function padRange(min, max) {
    let a = Number(min);
    let b = Number(max);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return { min: 0, max: 1 };
    if (b < a) { const t = a; a = b; b = t; }
    if (b === a) {
      const p = Math.abs(a) * 0.1 || 1;
      return { min: a - p, max: b + p };
    }
    const m = (b - a) * 0.08;
    return { min: a - m, max: b + m };
  }

  function vistaDaConfig() {
    grupos = lerGruposDoDom();
    const g = {};
    grupos.forEach((gr) => { g[gr.id] = { min: gr.min, max: gr.max }; });
    return {
      xMin: num('ggPaMin', DEFAULTS.paMin),
      xMax: num('ggPaMax', DEFAULTS.paMax),
      yMin: num('ggAguaMin', DEFAULTS.aguaMin),
      yMax: num('ggAguaMax', DEFAULTS.aguaMax),
      grupos: g,
    };
  }

  function cloneVista(v) {
    if (!v) return null;
    const gruposClone = {};
    Object.entries(v.grupos || {}).forEach(([k, g]) => {
      gruposClone[k] = { min: g.min, max: g.max };
    });
    return {
      xMin: v.xMin, xMax: v.xMax, yMin: v.yMin, yMax: v.yMax,
      grupos: gruposClone,
    };
  }

  function vistasIguais(a, b) {
    if (!a || !b) return false;
    const near = (x, y) => Math.abs(Number(x) - Number(y)) <= 1e-4 * (1 + Math.abs(Number(x)) + Math.abs(Number(y)));
    if (!near(a.xMin, b.xMin) || !near(a.xMax, b.xMax) || !near(a.yMin, b.yMin) || !near(a.yMax, b.yMax)) return false;
    const keys = new Set([...Object.keys(a.grupos || {}), ...Object.keys(b.grupos || {})]);
    for (const k of keys) {
      const ga = a.grupos?.[k];
      const gb = b.grupos?.[k];
      if (!ga || !gb || !near(ga.min, gb.min) || !near(ga.max, gb.max)) return false;
    }
    return true;
  }

  function vistaPadrao() {
    if (escalaModo === 'dinamica' && vistaDinamica) return cloneVista(vistaDinamica);
    return vistaDaConfig();
  }

  function vistaFoiAlterada() {
    const padrao = vistaPadrao();
    const atual = vista || (escalaModo === 'original' ? vistaDaConfig() : padrao);
    return !vistasIguais(atual, padrao);
  }

  function restaurarVistaPadrao() {
    if (escalaModo === 'dinamica' && vistaDinamica) vista = cloneVista(vistaDinamica);
    else vista = null;
    dragPan = null;
    desenhar();
    atualizarBotoesVista();
  }

  function atualizarBotoesVista() {
    const btn = $('ggBtnRestaurar');
    if (btn) btn.style.display = vistaFoiAlterada() ? '' : 'none';
    const btnEsc = $('ggBtnEscalaOrig');
    if (btnEsc) {
      btnEsc.textContent = escalaModo === 'original' ? 'Escala dinâmica' : 'Escala original';
      btnEsc.style.display = vistaDinamica ? '' : 'none';
    }
  }

  function resetEscalaParaParametros() {
    escalaModo = 'original';
    vista = null;
    vistaDinamica = null;
  }

  function extremosVisiveis() {
    const vis = vista || vistaPadrao();
    const xMin = Number(vis.xMin);
    const xMax = Number(vis.xMax);
    const yMin = Number(vis.yMin);
    const yMax = Number(vis.yMax);
    return {
      xMin: Math.min(xMin, xMax),
      xMax: Math.max(xMin, xMax),
      yMin: Math.min(yMin, yMax),
      yMax: Math.max(yMin, yMax),
    };
  }

  function ancorarExtremosLinha() {
    const vis = extremosVisiveis();
    if (pontosLinha.length < 2) {
      garantirPontosNaGrade();
      return;
    }
    const c0 = curvaDoPonto(pontosLinha[0]);
    const cN = curvaDoPonto(pontosLinha[pontosLinha.length - 1]);
    pontosLinha[0] = { x: vis.xMin, y: vis.yMin, curva: c0 };
    pontosLinha[pontosLinha.length - 1] = { x: vis.xMax, y: vis.yMax, curva: cN };
  }

  function aplicarVistaNoChart(chart) {
    if (!chart?.options?.scales || !vista) return;
    const sc = chart.options.scales;
    if (sc.x) { sc.x.min = vista.xMin; sc.x.max = vista.xMax; }
    if (sc.yTemp) { sc.yTemp.min = vista.yMin; sc.yTemp.max = vista.yMax; }
    grupos.forEach((gr) => {
      const axis = sc[`yG_${gr.id}`];
      const g = vista.grupos?.[gr.id];
      if (axis && g) { axis.min = g.min; axis.max = g.max; }
    });
    ancorarExtremosLinha();
    chart.update('none');
    atualizarBotoesVista();
  }

  function zoomAoRedor(min, max, centro, fator) {
    const left = centro - (centro - min) * fator;
    const right = centro + (max - centro) * fator;
    if (!Number.isFinite(left) || !Number.isFinite(right) || right === left) return { min, max };
    return { min: left, max: right };
  }

  function aplicarVistaIncluindoRecs(recs) {
    const base = vistaDaConfig();
    if (!recs?.length) {
      vista = null;
      vistaDinamica = null;
      escalaModo = 'original';
      return;
    }
    let xMin = base.xMin;
    let xMax = base.xMax;
    let yMin = base.yMin;
    let yMax = base.yMax;
    recs.forEach((r) => {
      if (Number.isFinite(r.pressao)) { xMin = Math.min(xMin, r.pressao); xMax = Math.max(xMax, r.pressao); }
      if (Number.isFinite(r.temp)) { yMin = Math.min(yMin, r.temp); yMax = Math.max(yMax, r.temp); }
    });
    const gVista = {};
    grupos.forEach((gr) => {
      let gmin = gr.min;
      let gmax = gr.max;
      recs.forEach((r) => {
        if (r.modelo === gr.id && Number.isFinite(r.valor)) {
          gmin = Math.min(gmin, r.valor);
          gmax = Math.max(gmax, r.valor);
        }
      });
      gVista[gr.id] = padRange(gmin, gmax);
    });
    const px = padRange(xMin, xMax);
    const py = padRange(yMin, yMax);
    vistaDinamica = {
      xMin: px.min,
      xMax: px.max,
      yMin: py.min,
      yMax: py.max,
      grupos: gVista,
    };
    vista = cloneVista(vistaDinamica);
    escalaModo = 'dinamica';
  }

  function recNoParametro(r) {
    const paMin = num('ggPaMin', DEFAULTS.paMin);
    const paMax = num('ggPaMax', DEFAULTS.paMax);
    const tMin = num('ggAguaMin', DEFAULTS.aguaMin);
    const tMax = num('ggAguaMax', DEFAULTS.aguaMax);
    const g = grupos.find((x) => x.id === r.modelo);
    const pressaoOk = r.pressao >= Math.min(paMin, paMax) && r.pressao <= Math.max(paMin, paMax);
    const tempOk = r.temp >= Math.min(tMin, tMax) && r.temp <= Math.max(tMin, tMax);
    let valorOk = true;
    if (g && Number.isFinite(r.valor)) {
      valorOk = r.valor >= Math.min(g.min, g.max) && r.valor <= Math.max(g.min, g.max);
    }
    return pressaoOk && tempOk && valorOk;
  }

  function onZoomRoda(e) {
    if (!chartAlta?.scales?.x || !chartAlta.scales.yTemp) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = chartAlta.scales.x;
    const sy = chartAlta.scales.yTemp;
    const rect = chartAlta.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const cx = sx.getValueForPixel(px);
    const cy = sy.getValueForPixel(py);
    const fator = e.deltaY > 0 ? 1.16 : 1 / 1.16;
    if (!vista) vista = cloneVista(vistaPadrao());
    const nx = zoomAoRedor(vista.xMin, vista.xMax, cx, fator);
    const ny = zoomAoRedor(vista.yMin, vista.yMax, cy, fator);
    vista.xMin = nx.min;
    vista.xMax = nx.max;
    vista.yMin = ny.min;
    vista.yMax = ny.max;
    grupos.forEach((gr) => {
      const sc = chartAlta.scales[`yG_${gr.id}`];
      const cur = vista.grupos?.[gr.id] || { min: gr.min, max: gr.max };
      const centro = sc ? sc.getValueForPixel(py) : (cur.min + cur.max) / 2;
      vista.grupos = vista.grupos || {};
      vista.grupos[gr.id] = zoomAoRedor(cur.min, cur.max, centro, fator);
    });
    aplicarVistaNoChart(chartAlta);
  }

  function onContextMenuGrafico(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window.__abrirNavRadialPagina === 'function') {
      window.__abrirNavRadialPagina(e.clientX, e.clientY, e.target);
    }
  }

  function ligarZoomRoda() {
    const box = document.querySelector('#engenhariaGeradorGraficosPane .gg-chart-box');
    if (!box || box.dataset.ggZoom === '1') return;
    box.dataset.ggZoom = '1';
    box.addEventListener('wheel', onZoomRoda, { passive: false });
    box.addEventListener('contextmenu', onContextMenuGrafico, true);
    box.addEventListener('dragstart', (ev) => ev.preventDefault());
  }

  function alternarEscalaOriginalDinamica() {
    if (!vistaDinamica) return;
    if (escalaModo === 'dinamica') {
      escalaModo = 'original';
      vista = null;
    } else {
      escalaModo = 'dinamica';
      vista = cloneVista(vistaDinamica);
    }
    desenhar();
    atualizarOverlayInfo();
  }

  function atualizarOverlayInfo() {
    const el = $('ggOverlayInfo');
    if (!el) return;
    if (!overlayTeste?.relatorio) {
      el.style.display = 'none';
      el.innerHTML = '';
      atualizarTabelaTeste([]);
      atualizarBotoesVista();
      return;
    }
    const r = overlayTeste.relatorio;
    const recs = overlayTeste.pontos || [];
    const fora = recs.filter((p) => !recNoParametro(p)).length;
    const cols = overlayTeste.colX
      ? `Campos: ${nomeColuna(overlayTeste.colY)} × ${nomeColuna(overlayTeste.colX)}`
      : '';
    const labelEscala = escalaModo === 'original' ? 'Escala dinâmica' : 'Escala original';
    const btnEscala = vistaDinamica
      ? `<button type="button" id="ggBtnEscalaOrig" class="content-button" style="background:#334155;color:#fff;">${escHtml(labelEscala)}</button>`
      : '';
    el.style.display = 'flex';
    el.innerHTML = `<span>Teste real: OP <b>${escHtml(r.num_op || '—')}</b> · ${escHtml(r.modelo || '')} · ${escHtml(recs.length)} pontos${fora ? ` · <b>${fora} fora da escala configurada</b> (a vista foi ampliada)` : ''}${cols ? `<br><small>${escHtml(cols)}</small>` : ''}</span>
      ${btnEscala}
      <button type="button" id="ggBtnLimparOverlay" class="content-button" style="background:#7c2d12;color:#fff;">Remover teste</button>`;
    $('ggBtnEscalaOrig')?.addEventListener('click', alternarEscalaOriginalDinamica);
    $('ggBtnLimparOverlay')?.addEventListener('click', () => {
      overlayTeste = null;
      vista = null;
      vistaDinamica = null;
      escalaModo = 'original';
      saveRegs(loadRegs().filter((x) => x.origem !== 'teste'));
      atualizarOverlayInfo();
      desenhar();
    });
    atualizarTabelaTeste(recs);
    atualizarBotoesVista();
  }

  function corValorGrupo(modeloId) {
    const idx = grupos.findIndex((x) => x.id === modeloId);
    if (idx < 0) return CORES[0];
    return CORES[idx % CORES.length];
  }

  function atualizarTabelaTeste(recs) {
    const wrap = $('ggTabelaTesteWrap');
    if (!wrap) return;
    const lista = recs || [];
    if (!lista.length) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }
    grupos = lerGruposDoDom();
    wrap.style.display = 'block';
    wrap.innerHTML = `<div class="gg-dica" style="margin:0 0 8px;">Valores do teste usados neste gráfico (confira se batem com a máquina). Scroll = zoom · arraste com a mãozinha para mover.</div>
      <div class="gg-tabela-teste-scroll">
        <table class="gg-tabela-teste">
          <thead><tr>
            <th>#</th>
            <th>${escHtml(nomeColuna(overlayTeste?.colX || 'pressao'))}</th>
            <th>${escHtml(nomeColuna(overlayTeste?.colY || 'temp'))}</th>
            <th>Eixo direita</th>
            <th>Valor</th>
            <th>Na escala configurada?</th>
          </tr></thead>
          <tbody>${lista.map((p, i) => {
            const g = grupos.find((x) => x.id === p.modelo);
            const ok = recNoParametro(p);
            const corV = corValorGrupo(p.modelo);
            return `<tr>
              <td>${i + 1}</td>
              <td class="gg-cor-x">${escHtml(fmtNum(p.pressao))}</td>
              <td class="gg-cor-y">${escHtml(fmtNum(p.temp))}</td>
              <td>${escHtml(g ? rotuloEixo(g.nome, g.nome) : '—')}</td>
              <td class="gg-cor-v" style="color:${escAttr(corV)};">${escHtml(Number.isFinite(p.valor) ? fmtNum(p.valor) : '—')}</td>
              <td class="${ok ? '' : 'is-fora'}">${ok ? 'Sim' : 'Não — fora'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  }

  function optionsColunas(colunas, selecionada) {
    return (colunas || []).map((c) =>
      `<option value="${escAttr(c)}"${c === selecionada ? ' selected' : ''}>${escHtml(nomeColuna(c))}</option>`
    ).join('');
  }

  function preencherFiltroUsuariosSalvos() {
    const sel = $('ggSalvosUserSelect');
    if (!sel) return;
    const users = [...new Set(salvosCache.map((it) => String(it.usuario || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const atual = sel.value;
    sel.innerHTML = '<option value="">— todos os usuários —</option>' + users.map((u) =>
      `<option value="${escAttr(u)}">${escHtml(u)}</option>`
    ).join('');
    if (atual && users.includes(atual)) sel.value = atual;
  }

  function renderSalvosSelect(selecionarId) {
    const sel = $('ggSalvosSelect');
    if (!sel) return;
    const user = String($('ggSalvosUserSelect')?.value || '').trim();
    const itens = user
      ? salvosCache.filter((it) => String(it.usuario || '') === user)
      : salvosCache;
    const atual = selecionarId != null ? String(selecionarId) : sel.value;
    sel.innerHTML = '<option value="">— gráficos gerados —</option>' + itens.map((it) =>
      `<option value="${escAttr(it.id)}">${escHtml(it.nome)}</option>`
    ).join('');
    if (atual && itens.some((it) => String(it.id) === String(atual))) sel.value = String(atual);
    else sel.value = '';
  }

  async function recarregarSalvos(selecionarId) {
    const sel = $('ggSalvosSelect');
    if (!sel) return;
    try {
      const d = await ggApi('/salvos');
      salvosCache = d.itens || [];
      preencherFiltroUsuariosSalvos();
      renderSalvosSelect(selecionarId);
    } catch (_) {
      salvosCache = [];
      sel.innerHTML = '<option value="">— não foi possível listar —</option>';
      const u = $('ggSalvosUserSelect');
      if (u) u.innerHTML = '<option value="">— todos os usuários —</option>';
    }
  }

  async function gravarSnapshot(opts) {
    const cfg = estadoAtual();
    const nomeLivre = String(opts?.nome || '').trim();
    const titulo = nomeLivre || cfg.tituloGrafico || tituloAutomatico();
    if (nomeLivre && $('ggTituloGrafico')) $('ggTituloGrafico').value = nomeLivre;
    const body = { titulo, config: nomeLivre ? Object.assign({}, cfg, { tituloGrafico: nomeLivre }) : cfg };
    if (nomeLivre) body.nome = nomeLivre;
    const d = await ggApi('/salvos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await recarregarSalvos(d.item?.id);
    return d.item;
  }

  async function aplicarSalvo(id) {
    if (!id) return;
    const d = await ggApi(`/salvos/${encodeURIComponent(id)}`);
    if (d.item?.config) aplicarEstado(d.item.config);
    if (d.item?.titulo && $('ggTituloGrafico') && !String($('ggTituloGrafico').value || '').trim()) {
      $('ggTituloGrafico').value = d.item.titulo;
    }
    desenhar();
  }

  function abrirModal(id) {
    const el = $(id);
    if (!el) return;
    document.body.appendChild(el);
    el.classList.add('is-open');
  }

  function fecharModais() {
    document.querySelectorAll('.gg-gerador-modal').forEach((el) => el.classList.remove('is-open'));
  }

  function colunasDoGrafico() {
    grupos = lerGruposDoDom();
    const colY = valorParaColuna($('ggNomeAgua')?.value, '');
    const colX = valorParaColuna($('ggNomePressao')?.value, '');
    const mapGrupos = {};
    grupos.forEach((g) => {
      const col = valorParaColuna(g.nome, '');
      if (col) mapGrupos[g.id] = col;
    });
    return { colX, colY, mapGrupos };
  }

  function leiturasParaRegistros(leituras, colX, colY, mapGrupos) {
    const ids = Object.keys(mapGrupos || {});
    const out = [];
    (leituras || []).forEach((l) => {
      const x = Number(l[colX]);
      const y = Number(l[colY]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (!ids.length) {
        out.push({ temp: y, pressao: x, origem: 'teste' });
        return;
      }
      ids.forEach((gid) => {
        const v = Number(l[mapGrupos[gid]]);
        if (!Number.isFinite(v)) return;
        out.push({ temp: y, pressao: x, modelo: gid, valor: v, origem: 'teste' });
      });
    });
    return out.slice(0, 400);
  }

  async function abrirTestesRegistrados() {
    abrirModal('ggModalTestes');
    const sel = $('ggTesteModelo');
    if (sel && sel.options.length <= 1) {
      try {
        const d = await ggApi('/testes/modelos');
        sel.innerHTML = '<option value="">— escolher modelo —</option>' + (d.modelos || []).map((m) =>
          `<option value="${escAttr(m.modelo)}">${escHtml(m.modelo)} (${m.qtd})</option>`
        ).join('');
      } catch (err) {
        sel.innerHTML = `<option value="">${escHtml(err.message || 'Erro ao listar modelos')}</option>`;
      }
    }
    const lista = $('ggTesteLista');
    if (lista && !lista.innerHTML.trim()) {
      lista.innerHTML = '<p class="gg-dica">Digite a OP e busque, ou escolha um modelo.</p>';
    }
  }

  function renderListaTestes(relatorios) {
    const lista = $('ggTesteLista');
    if (!lista) return;
    if (!relatorios.length) {
      lista.innerHTML = '<p class="gg-dica">Nenhum teste encontrado.</p>';
      return;
    }
    lista.innerHTML = `<table class="gg-table">
      <thead><tr><th>Data</th><th>OP</th><th>Modelo</th><th>Operador</th><th>Leituras</th></tr></thead>
      <tbody>${relatorios.map((r) => `<tr data-gg-rel="${escAttr(r.id)}">
        <td>${escHtml(fmtData(r.criado_em))}</td>
        <td>${escHtml(r.num_op || '')}</td>
        <td>${escHtml(r.modelo || '')}</td>
        <td>${escHtml(r.operador || '')}</td>
        <td>${escHtml(r.total_registros ?? '')}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    lista.querySelectorAll('[data-gg-rel]').forEach((tr) => {
      tr.addEventListener('click', () => {
        aplicarTesteEscolhido(tr.getAttribute('data-gg-rel')).catch((err) => {
          alert(err.message || 'Não foi possível marcar o teste no gráfico.');
        });
      });
    });
  }

  async function buscarTestes(tipo, q) {
    const lista = $('ggTesteLista');
    if (lista) lista.innerHTML = '<p class="gg-dica">Buscando…</p>';
    try {
      const d = await ggApi(`/testes/buscar?tipo=${encodeURIComponent(tipo)}&q=${encodeURIComponent(q)}`);
      renderListaTestes(d.relatorios || []);
    } catch (err) {
      if (lista) lista.innerHTML = `<p class="gg-dica">${escHtml(err.message)}</p>`;
    }
  }

  async function aplicarTesteEscolhido(id) {
    await carregarColunasTeste();
    const { colX, colY, mapGrupos } = colunasDoGrafico();
    if (!colX || !colY) {
      alert('Configure no gráfico o campo da esquerda e o da parte de baixo antes de escolher o teste.');
      return;
    }
    const leit = await ggApi(`/testes/${encodeURIComponent(id)}/leituras`);
    ggLeiturasCache = leit.leituras || [];
    ggRelatorioAtual = leit.relatorio || null;
    const novos = leiturasParaRegistros(ggLeiturasCache, colX, colY, mapGrupos);
    if (!novos.length) {
      alert('Esse teste não tem números nos campos já configurados neste gráfico (esquerda, baixo e grupos da direita).');
      return;
    }
    const manuais = loadRegs().filter((r) => r.origem !== 'teste');
    saveRegs(manuais.concat(novos));
    overlayTeste = {
      relatorio: ggRelatorioAtual,
      pontos: novos,
      colX,
      colY,
      mapGrupos,
    };
    aplicarVistaIncluindoRecs(novos);
    fecharModais();
    atualizarOverlayInfo();
    desenhar();
  }

  function renderGrupos() {
    const wrap = $('ggGrupos');
    if (!wrap) return;
    wrap.innerHTML = grupos.map((g) => `
      <div class="gg-grupo" data-gg-grupo="${escAttr(g.id)}" data-gg-coluna="${escAttr(g.nome)}">
        <div class="gg-grupo-topo">
          <select class="gg-nome gg-eixo-nome gg-select-eixo" data-gg-nome title="Coluna do teste (eixo direito)">
            ${htmlOptionsColunas(g.nome, true, '— escolher coluna —')}
          </select>
          <button type="button" class="gg-btn-excluir" data-gg-excluir title="Excluir grupo" ${grupos.length <= 1 ? 'disabled' : ''}>
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
        <label><span data-gg-cap="max">${escAttr(g.nome)} — Máximo</span> <input data-gg-max type="number" step="0.1" value="${g.max}"></label>
        <label><span data-gg-cap="min">${escAttr(g.nome)} — Mínimo</span> <input data-gg-min type="number" step="0.1" value="${g.min}"></label>
        <label><span data-gg-cap="tick">${escAttr(g.nome)} — Intervalo</span> <input data-gg-tick type="number" step="0.1" value="${g.tick}"></label>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-gg-nome]').forEach((sel) => {
      const syncCaps = () => {
        const card = sel.closest('[data-gg-grupo]');
        const nome = rotuloEixo(sel.value, sel.value.trim() || 'Grupo');
        const cap = (k, suf) => { const el = card?.querySelector(`[data-gg-cap="${k}"]`); if (el) el.textContent = `${nome} — ${suf}`; };
        cap('max', 'Máximo');
        cap('min', 'Mínimo');
        cap('tick', 'Intervalo');
      };
      syncCaps();
      sel.addEventListener('change', () => { syncCaps(); atualizarRotulos(); salvarPrefs(); desenhar(); });
    });
    wrap.querySelectorAll('[data-gg-max],[data-gg-min],[data-gg-tick]').forEach((inp) => {
      inp.addEventListener('change', () => {
        if (inp.hasAttribute('data-gg-max') || inp.hasAttribute('data-gg-min')) {
          resetEscalaParaParametros();
        }
        atualizarRotulos();
        salvarPrefs();
        desenhar();
      });
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
    preencherSelectsEixos();
    atualizarRotulos();
  }

  function adicionarGrupo() {
    grupos = lerGruposDoDom();
    if (grupos.length >= MAX_GRUPOS) return;
    grupos.push({ id: novoIdGrupo(), nome: '', max: 10, min: 0, tick: 0.5 });
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
      #engenhariaGeradorGraficosPane .gg-chart-toolbar { display: flex; justify-content: center; }
      #engenhariaGeradorGraficosPane .gg-titulo-edit {
        text-align: center; font-size: 16px; max-width: 100%;
      }
      #engenhariaGeradorGraficosPane .gg-chart-actions {
        display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 4px;
      }
      #engenhariaGeradorGraficosPane .gg-chart-box {
        background: #fff; border-radius: 12px; padding: 16px 10px 10px; min-height: 420px;
        cursor: grab; user-select: none; -webkit-user-select: none;
      }
      #engenhariaGeradorGraficosPane .gg-chart-box:active { cursor: grabbing; }
      #engenhariaGeradorGraficosPane .gg-chart-box canvas {
        -webkit-user-drag: none; user-select: none;
      }
      #engenhariaGeradorGraficosPane .gg-grupos-scroll {
        max-height: none; overflow: visible; padding-right: 6px; margin-top: 8px;
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
      #engenhariaGeradorGraficosPane .gg-param-topo {
        display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin-bottom:14px;
      }
      #engenhariaGeradorGraficosPane .gg-param-topo label { min-width: 220px; flex: 1; }
      #engenhariaGeradorGraficosPane .gg-overlay-info {
        display:none; gap:10px; flex-wrap:wrap; align-items:center;
        margin: 10px 0 0; padding: 8px 10px; border-radius: 8px;
        background: rgba(234,88,12,.15); color: #fdba74; font-size: 13px;
      }
      #engenhariaGeradorGraficosPane .gg-tabela-teste-wrap {
        margin-top: 10px; padding: 10px; border-radius: 10px;
        border: 1px solid #334155; background: rgba(15,23,42,.45);
      }
      #engenhariaGeradorGraficosPane .gg-tabela-teste-scroll {
        max-height: 220px; overflow: auto;
      }
      #engenhariaGeradorGraficosPane .gg-tabela-teste {
        width: 100%; border-collapse: collapse; font-size: 12px; color: #e2e8f0;
      }
      #engenhariaGeradorGraficosPane .gg-tabela-teste th,
      #engenhariaGeradorGraficosPane .gg-tabela-teste td {
        padding: 6px 8px; border-bottom: 1px solid #334155; text-align: left; white-space: nowrap;
      }
      #engenhariaGeradorGraficosPane .gg-tabela-teste td.gg-cor-x,
      #engenhariaGeradorGraficosPane .gg-tabela-teste td.gg-cor-y,
      #engenhariaGeradorGraficosPane .gg-tabela-teste td.gg-cor-v {
        background: #f8fafc; font-weight: 700;
      }
      #engenhariaGeradorGraficosPane .gg-tabela-teste td.gg-cor-x { color: #0f172a; }
      #engenhariaGeradorGraficosPane .gg-tabela-teste td.gg-cor-y { color: #2563eb; }
      #engenhariaGeradorGraficosPane .gg-tabela-teste td.is-fora { color: #fca5a5; }
      #engenhariaGeradorGraficosPane .gg-select-eixo { cursor: pointer; width: 100%; }
      .gg-gerador-modal {
        display: none; position: fixed; inset: 0; z-index: 99999;
        background: rgba(2,6,23,.72); align-items: center; justify-content: center; padding: 16px;
      }
      .gg-gerador-modal.is-open { display: flex; }
      .gg-gerador-modal .gg-modal-box {
        width: min(920px, 100%); max-height: 90vh; overflow: auto;
        background: #0f172a; border: 1px solid #334155; border-radius: 14px; padding: 18px;
        color: #e2e8f0;
      }
      .gg-gerador-modal .gg-modal-head {
        display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px;
      }
      .gg-gerador-modal label {
        display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #94a3b8;
      }
      .gg-gerador-modal input, .gg-gerador-modal select {
        background: #0f172a; color: #e2e8f0;
        border: 1px solid #334155; border-radius: 8px; padding: 8px 10px;
      }
      .gg-gerador-modal .gg-dica { margin: 8px 0 0; font-size: 12px; color: #64748b; line-height: 1.4; }
      .gg-gerador-modal .gg-form-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
      .gg-gerador-modal .gg-table { width:100%; border-collapse:collapse; font-size:13px; }
      .gg-gerador-modal .gg-table th, .gg-gerador-modal .gg-table td {
        padding:8px; border-bottom:1px solid #334155; text-align:left;
      }
      .gg-gerador-modal .gg-table tbody tr { cursor:pointer; }
      .gg-gerador-modal .gg-table tbody tr:hover { background: rgba(56,189,248,.12); }
      .gg-gerador-modal .gg-mapa-grid {
        display:grid; grid-template-columns: minmax(180px,1fr) minmax(180px,1.2fr) minmax(180px,1fr); gap:14px;
      }
      @media (max-width: 1100px) {
        #engenhariaGeradorGraficosPane .gg-layout { grid-template-columns: 1fr; }
        .gg-gerador-modal .gg-mapa-grid { grid-template-columns: 1fr; }
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

  function curvaDoPonto(p) {
    if (!p) return 0;
    const n = Number(p.curva);
    if (n === 1 || n === -1) return n;
    return p.curvo ? 1 : 0;
  }

  function ctrlCurva(a, b, dir) {
    const dx = Math.abs(b.x - a.x);
    return {
      cpx: (a.x + b.x) / 2,
      cpy: (a.y + b.y) / 2 - dir * dx * 0.22,
    };
  }

  function proximaCurva(pEsq, pDir) {
    const atual = curvaDoPonto(pEsq);
    const inicial = Number(pDir.y) > Number(pEsq.y) ? -1 : 1;
    if (!atual) return inicial;
    if (atual === inicial) return -inicial;
    return 0;
  }

  function garantirPontosNaGrade() {
    const vis = extremosVisiveis();
    const paMin = vis.xMin;
    const paMax = vis.xMax;
    const tMin = vis.yMin;
    const tMax = vis.yMax;
    const paTick = num('ggPaTick', DEFAULTS.paTick);
    let xs = ticksEixo(paMin, paMax, paTick);
    if (!xs.length) xs = [paMin, paMax];
    if (Math.abs(xs[0] - paMin) > 1e-9) xs = [paMin, ...xs];
    if (Math.abs(xs[xs.length - 1] - paMax) > 1e-9) xs = [...xs, paMax];
    const uniq = [];
    xs.forEach((x) => {
      if (!uniq.length || Math.abs(uniq[uniq.length - 1] - x) > 1e-9) uniq.push(x);
    });
    xs = uniq;
    const prev = pontosLinha.slice();
    pontosLinha = xs.map((x, i) => {
      const old = prev.find((p) => Math.abs(p.x - x) < 1e-6);
      const yPrev = old ? old.y : interpolarY(x, prev);
      return {
        x,
        y: Number.isFinite(yPrev) ? yPrev : yDiagonal(x, paMin, paMax, tMin, tMax),
        curva: old ? curvaDoPonto(old) : (prev[i] ? curvaDoPonto(prev[i]) : 0),
      };
    });
    if (pontosLinha.length === 1) {
      pontosLinha.push({ x: paMax, y: tMax, curva: 0 });
    }
    if (pontosLinha.length) {
      pontosLinha[0] = { x: paMin, y: tMin, curva: curvaDoPonto(pontosLinha[0]) };
      pontosLinha[pontosLinha.length - 1] = {
        x: paMax,
        y: tMax,
        curva: curvaDoPonto(pontosLinha[pontosLinha.length - 1]),
      };
    }
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
      const dir = curvaDoPonto(pontosLinha[i]);
      if (dir) {
        d = Infinity;
        const c = ctrlCurva(a, b, dir);
        for (let t = 0; t <= 1; t += 0.08) {
          const u = 1 - t;
          const qx = u * u * a.x + 2 * u * t * c.cpx + t * t * b.x;
          const qy = u * u * a.y + 2 * u * t * c.cpy + t * t * b.y;
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
      const dir = curvaDoPonto(pontosLinha[i]);
      if (dir) {
        const c = ctrlCurva(a, b, dir);
        ctx.quadraticCurveTo(c.cpx, c.cpy, b.x, b.y);
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
        // Pontos inicial/final ficam fixos nas estremidades da área visível.
        if (idx > 0 && idx < pontosLinha.length - 1) {
          dragLinha = { idx, moved: false };
          dragPan = null;
          chart.canvas.style.cursor = 'grabbing';
          args.changed = true;
          return;
        }
        dragPan = { lastX: px, lastY: py, moved: false };
        chart.canvas.style.cursor = 'grabbing';
        args.changed = true;
        return;
      }
      if (tipo === 'mousemove' && dragLinha) {
        const vis = extremosVisiveis();
        const tMin = vis.yMin;
        const tMax = vis.yMax;
        const i = dragLinha.idx;
        const prev = pontosLinha[i - 1];
        const next = pontosLinha[i + 1];
        let x = chart.scales.x.getValueForPixel(px);
        let y = chart.scales.yTemp.getValueForPixel(py);
        const lo = prev ? prev.x + 0.01 : vis.xMin;
        const hi = next ? next.x - 0.01 : vis.xMax;
        x = Math.max(lo, Math.min(hi, x));
        y = Math.max(tMin, Math.min(tMax, y));
        pontosLinha[i] = { x, y, curva: curvaDoPonto(pontosLinha[i]) };
        dragLinha.moved = true;
        args.changed = true;
        return;
      }
      if (tipo === 'mousemove' && dragPan) {
        const sx = chart.scales.x;
        const sy = chart.scales.yTemp;
        const dx = sx.getValueForPixel(dragPan.lastX) - sx.getValueForPixel(px);
        const dy = sy.getValueForPixel(dragPan.lastY) - sy.getValueForPixel(py);
        if (!vista) vista = cloneVista(vistaPadrao());
        vista.xMin += dx;
        vista.xMax += dx;
        vista.yMin += dy;
        vista.yMax += dy;
        grupos.forEach((gr) => {
          const sc = chart.scales[`yG_${gr.id}`];
          const cur = vista.grupos?.[gr.id] || { min: gr.min, max: gr.max };
          const dyg = sc
            ? sc.getValueForPixel(dragPan.lastY) - sc.getValueForPixel(py)
            : dy;
          vista.grupos = vista.grupos || {};
          vista.grupos[gr.id] = { min: cur.min + dyg, max: cur.max + dyg };
        });
        dragPan.lastX = px;
        dragPan.lastY = py;
        dragPan.moved = true;
        aplicarVistaNoChart(chart);
        return;
      }
      if (tipo === 'mouseup') {
        if (dragLinha) {
          skipClickLinha = !!dragLinha.moved;
          dragLinha = null;
          salvarPrefs();
          chart.canvas.style.cursor = 'grab';
          args.changed = true;
        }
        if (dragPan) {
          skipClickLinha = skipClickLinha || !!dragPan.moved;
          dragPan = null;
          chart.canvas.style.cursor = 'grab';
          atualizarBotoesVista();
          args.changed = true;
        }
        return;
      }
      if (tipo === 'mousemove' && !dragLinha && !dragPan) {
        const sobrePonto = hitPontoLinha(chart, px, py) >= 0;
        const sobreTrecho = hitTrechoLinha(chart, px, py) >= 0;
        chart.canvas.style.cursor = sobrePonto ? 'grab' : (sobreTrecho ? 'pointer' : 'grab');
      }
      if (tipo === 'click' && !dragLinha && !dragPan) {
        if (skipClickLinha) {
          skipClickLinha = false;
          return;
        }
        const idx = hitPontoLinha(chart, px, py);
        if (idx < 0) {
          const trecho = hitTrechoLinha(chart, px, py);
          if (trecho >= 0) {
            pontosLinha[trecho].curva = proximaCurva(pontosLinha[trecho], pontosLinha[trecho + 1]);
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
        if (!reg.modelo || !Number.isFinite(reg.valor) || !scales.x || !scales.yTemp || !scales[scaleId]) return;
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

  const pluginTituloCentro = {
    id: 'ggTituloCentro',
    afterDraw(chart) {
      const titulo = txt('ggTituloGrafico', tituloAutomatico());
      const area = chart.chartArea;
      if (!titulo || !area) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 16px system-ui, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(titulo), (area.left + area.right) / 2, Math.max(18, area.top - 8));
      ctx.restore();
    },
  };

  function desenhar() {
    const canvas = $('ggChartAlta');
    if (!canvas || typeof Chart === 'undefined') return;
    grupos = lerGruposDoDom();
    const nomeAgua = rotuloEixo(txt('ggNomeAgua', DEFAULTS.nomeAgua), DEFAULTS.nomeAgua);
    const nomePressao = rotuloEixo(txt('ggNomePressao', DEFAULTS.nomePressao), DEFAULTS.nomePressao);
    const paTick = num('ggPaTick', DEFAULTS.paTick);
    const tTick = num('ggAguaTick', DEFAULTS.aguaTick);
    garantirPontosNaGrade();
    const recs = loadRegs().map((r) => Object.assign({}, r, {
      modelo: r.modelo ? normalizarModelo(r.modelo) : '',
      pressao: Number(r.pressao),
      temp: Number(r.temp),
      valor: Number(r.valor),
    })).filter((r) => Number.isFinite(r.pressao) && Number.isFinite(r.temp));

    const vis = vista || vistaPadrao();
    const paMin = vis.xMin;
    const paMax = vis.xMax;
    const tMin = vis.yMin;
    const tMax = vis.yMax;

    const datasets = [
      {
        type: 'scatter', label: 'Pontos',
        data: recs.map((r) => ({ x: r.pressao, y: r.temp })),
        backgroundColor: '#2563eb',
        borderColor: '#ffffff',
        borderWidth: 1,
        pointRadius: 7,
        yAxisID: 'yTemp',
        clip: false,
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
      const gVis = vis.grupos?.[g.id] || { min: g.min, max: g.max };
      datasets.push({
        type: 'scatter', label: g.nome,
        data: recs.filter((r) => r.modelo === g.id && Number.isFinite(r.valor)).map((r) => ({ x: r.pressao, y: r.valor })),
        backgroundColor: CORES[i % CORES.length],
        borderColor: '#ffffff',
        borderWidth: 1,
        pointRadius: 7,
        yAxisID: axisId,
        clip: false,
      });
      scales[axisId] = eixoY(axisId, rotuloEixo(g.nome, g.nome), CORES[i % CORES.length], gVis.min, gVis.max, g.tick, {
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
        animation: false,
        events: ['mousemove', 'mouseout', 'click', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'wheel'],
        plugins: {
          legend: { display: false },
          title: { display: false },
        },
        scales,
        layout: { padding: { right: 8, top: 32 } },
      },
      plugins: [pluginTituloCentro, pluginLinhaAzul, pluginConectores],
    });
    chartAlta.$ggRecs = recs;
    chartAlta.canvas.style.cursor = 'grab';
    if (overlayTeste?.pontos?.length) atualizarTabelaTeste(overlayTeste.pontos);
    atualizarBotoesVista();
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

  function baixarPng(blob, nomeArquivo) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = String(nomeArquivo || 'gerador-graficos')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'gerador-graficos';
    a.download = `${base}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function copiarGrafico() {
    try {
      let avisoSave = '';
      try {
        const item = await gravarSnapshot();
        if (item?.nome) avisoSave = ` Gravado como ${item.nome}.`;
      } catch (err) {
        avisoSave = ` Não gravou no banco: ${err.message}.`;
      }
      const blob = await blobDoGrafico();
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        alert(`Gráfico copiado. Cole no Word, e-mail ou WhatsApp.${avisoSave}`);
        return;
      }
      baixarPng(blob);
      alert(`Este navegador não copia imagem. O arquivo foi baixado.${avisoSave}`);
    } catch (err) {
      alert(err?.message || 'Não foi possível copiar o gráfico.');
    }
  }

  async function exportarGrafico() {
    try {
      let avisoSave = '';
      try {
        const item = await gravarSnapshot();
        if (item?.nome) avisoSave = ` Gravado como ${item.nome}.`;
      } catch (err) {
        avisoSave = ` Não gravou no banco: ${err.message}.`;
      }
      baixarPng(await blobDoGrafico());
      if (avisoSave) alert(avisoSave.trim());
    } catch (err) {
      alert(err?.message || 'Não foi possível exportar o gráfico.');
    }
  }

  async function salvarGraficoComNome() {
    const nome = window.prompt('Nome do gráfico (como quer gravar):', String($('ggTituloGrafico')?.value || '').trim());
    if (nome == null) return;
    const nomeLimpo = String(nome).trim();
    if (!nomeLimpo) {
      alert('Informe um nome para o gráfico.');
      return;
    }
    try {
      let avisoSave = '';
      try {
        const item = await gravarSnapshot({ nome: nomeLimpo });
        if (item?.nome) avisoSave = ` Gravado como ${item.nome}.`;
      } catch (err) {
        avisoSave = ` Não gravou no banco: ${err.message}.`;
      }
      baixarPng(await blobDoGrafico(), nomeLimpo);
      desenhar();
      alert(`Gráfico salvo com o nome informado.${avisoSave}`);
    } catch (err) {
      alert(err?.message || 'Não foi possível salvar o gráfico.');
    }
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
              <i class="fa-solid fa-sliders"></i> Parâmetros
            </button>
            <button type="button" id="ggBtnLimpar" class="content-button" style="background:#334155;color:#fff;">Limpar pontos</button>
          </div>
        </div>
        <input type="hidden" id="ggRegsJson" value="[]">
        <div id="ggFormWrap" style="display:none;margin:28px 0 16px;padding:16px;border:1px solid var(--border-color);border-radius:12px;background:rgba(15,23,42,.35);">
          <div class="gg-param-topo">
            <label>Gráficos gerados
              <select id="ggSalvosSelect"></select>
            </label>
            <label>Gerados por usuário
              <select id="ggSalvosUserSelect"></select>
            </label>
            <button type="button" id="ggBtnTestes" class="content-button" style="background:linear-gradient(135deg,#f59e0b 0%,#b45309 100%);color:#fff;">
              <i class="fa-solid fa-flask"></i> Testes registrados
            </button>
          </div>
          <div style="font-weight:700;margin:12px 0;">Novo Registro</div>
          <p class="gg-dica" style="margin-top:0;">Marca um resultado neste gráfico (não fica salvo sozinho). Preencha os valores reais — os campos começam vazios.</p>
          <div class="gg-form-grid">
            <label>Temperatura <input id="ggTemp" type="number" step="0.1" placeholder="valor do teste"></label>
            <label>Pressão <input id="ggPressao" type="number" step="1" placeholder="valor do teste"></label>
            <label>Modelo <select id="ggModelo"></select></label>
            <label>Valor <input id="ggValor" type="number" step="0.1" placeholder="valor do eixo da direita"></label>
          </div>
          <button type="button" id="ggBtnEnviar" class="content-button" style="margin-top:12px;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:#fff;">Enviar Registro</button>
        </div>
        <div class="gg-body">
          <div class="gg-layout">
            <div class="gg-side">
              <select id="ggNomeAgua" class="gg-nome gg-select-eixo" title="Coluna do teste (eixo esquerdo)">
                <option value="temp_ambiente">temp ambiente</option>
              </select>
              <label>Máximo <input id="ggAguaMax" type="number" value="40"></label>
              <label>Mínimo <input id="ggAguaMin" type="number" value="16"></label>
              <label>Intervalo <input id="ggAguaTick" type="number" value="2"></label>
            </div>
            <div class="gg-chart-wrap">
              <div class="gg-chart-toolbar">
                <input id="ggTituloGrafico" class="gg-nome gg-titulo-edit" placeholder="Título do gráfico — clique para editar" title="Título centralizado no gráfico">
              </div>
              <div class="gg-chart-box">
                <canvas id="ggChartAlta"></canvas>
              </div>
              <div class="gg-chart-actions">
                <button type="button" id="ggBtnRestaurar" class="content-button" style="display:none;background:#475569;color:#fff;">
                  <i class="fa-solid fa-rotate-left"></i> Restaurar
                </button>
                <button type="button" id="ggBtnCopiar" class="content-button" style="background:#1d4ed8;color:#fff;">
                  <i class="fa-regular fa-copy"></i> Copiar gráfico
                </button>
                <button type="button" id="ggBtnExportar" class="content-button" style="background:linear-gradient(135deg,#22c55e 0%,#15803d 100%);color:#fff;">
                  <i class="fa-solid fa-image"></i> Exportar gráfico
                </button>
                <button type="button" id="ggBtnSalvar" class="content-button" style="background:linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%);color:#fff;">
                  <i class="fa-solid fa-floppy-disk"></i> Salvar gráfico
                </button>
              </div>
              <div id="ggOverlayInfo" class="gg-overlay-info"></div>
              <div id="ggTabelaTesteWrap" class="gg-tabela-teste-wrap" style="display:none;"></div>
              <p class="gg-dica">O 1º e o último ponto azul ficam nas estremidades do gráfico (também no zoom). Arraste os pontos do meio para mudar a linha. Clique no trecho: 1º curva para o lado oposto do ponto da direita, 2º o outro lado, 3º volta a ficar reta. Scroll = zoom · arraste com a mãozinha para mover o gráfico. Botão direito abre o menu flutuante (não copia a imagem).</p>
            </div>
            <div class="gg-side">
              <input id="ggNomeParametros" class="gg-nome" value="Parâmetros" title="Clique para mudar o nome">
              <button type="button" id="ggBtnAddGrupo" class="content-button" style="background:#1e3a5f;color:#fff;margin-top:8px;">
                <i class="fa-solid fa-plus"></i> Adicionar grupo
              </button>
              <div id="ggGrupos" class="gg-grupos-scroll"></div>
            </div>
          </div>
          <select id="ggNomePressao" class="gg-nome gg-select-eixo" title="Coluna do teste (eixo de baixo)" style="max-width:420px;margin:18px 0 8px;">
            <option value="pressao_alta">pressao alta</option>
          </select>
          <div class="gg-pressao-row">
            <label>Mínimo <input id="ggPaMin" type="number" value="180"></label>
            <label>Máximo <input id="ggPaMax" type="number" value="300"></label>
            <label>Intervalo <input id="ggPaTick" type="number" value="10"></label>
          </div>
        </div>
      </div>
      <div id="ggModalTestes" class="gg-gerador-modal">
        <div class="gg-modal-box">
          <div class="gg-modal-head">
            <h3 style="margin:0;">Testes registrados</h3>
            <button type="button" class="content-button gg-fechar-modal" style="background:#334155;color:#fff;">Fechar</button>
          </div>
          <p class="gg-dica" style="margin-top:0;">Digite a OP ou escolha o modelo e clique no teste. Os resultados entram no gráfico já configurado (mesmo jeito do Novo Registro: ponto da esquerda ligado ao ponto da direita).</p>
          <div class="gg-form-grid">
            <label>OP
              <input id="ggTesteOp" type="text" placeholder="Ex.: 12345">
            </label>
            <label>Modelo
              <select id="ggTesteModelo"><option value="">— escolher modelo —</option></select>
            </label>
          </div>
          <button type="button" id="ggBtnBuscarOp" class="content-button" style="margin-top:12px;background:#0369a1;color:#fff;">Buscar OP</button>
          <div id="ggTesteLista" style="margin-top:14px;"></div>
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
      const projetos = $('menu-engenharia-projetos');
      (projetos || pir || menuDesenho).insertAdjacentElement('afterend', a);
    }
    const desenhoVis = menuDesenho || $('menu-engenharia-desenho-tecnico');
    const geradorLink = $('menu-engenharia-gerador-graficos');
    if (desenhoVis && geradorLink) {
      geradorLink.classList.toggle('perm-hidden', desenhoVis.classList.contains('perm-hidden'));
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
    ligarZoomRoda();
    ['ggAguaMax', 'ggAguaMin', 'ggPaMin', 'ggPaMax'].forEach((id) => {
      $(id)?.addEventListener('change', () => {
        resetEscalaParaParametros();
        salvarPrefs();
        desenhar();
      });
    });
    ['ggAguaTick', 'ggPaTick'].forEach((id) => {
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
      if (wrap.style.display === 'block') recarregarSalvos();
    });
    $('ggSalvosSelect')?.addEventListener('change', () => {
      const id = $('ggSalvosSelect')?.value;
      if (!id) return;
      aplicarSalvo(id).catch((err) => alert(err.message || 'Não carregou o gráfico salvo.'));
    });
    $('ggSalvosUserSelect')?.addEventListener('change', () => {
      renderSalvosSelect('');
    });
    $('ggBtnTestes')?.addEventListener('click', () => {
      abrirTestesRegistrados().catch((err) => alert(err.message || 'Não abriu os testes.'));
    });
    $('ggBtnBuscarOp')?.addEventListener('click', () => {
      const q = String($('ggTesteOp')?.value || '').trim();
      if (!q) { alert('Digite a OP.'); return; }
      buscarTestes('op', q);
    });
    $('ggTesteOp')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('ggBtnBuscarOp')?.click();
      }
    });
    $('ggTesteModelo')?.addEventListener('change', () => {
      const q = String($('ggTesteModelo')?.value || '').trim();
      if (q) buscarTestes('modelo', q);
    });
    document.querySelectorAll('.gg-gerador-modal .gg-fechar-modal').forEach((btn) => {
      btn.addEventListener('click', fecharModais);
    });
    document.querySelectorAll('.gg-gerador-modal').forEach((el) => {
      el.addEventListener('click', (e) => { if (e.target === el) fecharModais(); });
    });
    $('ggBtnEnviar')?.addEventListener('click', () => {
      grupos = lerGruposDoDom();
      const temp = Number(String($('ggTemp')?.value || '').trim());
      const pressao = Number(String($('ggPressao')?.value || '').trim());
      const valor = Number(String($('ggValor')?.value || '').trim());
      if (!Number.isFinite(temp) || !Number.isFinite(pressao) || !Number.isFinite(valor)) {
        alert('Preencha temperatura, pressão e valor do eixo da direita.');
        return;
      }
      const regs = loadRegs();
      regs.push({
        temp,
        pressao,
        modelo: $('ggModelo')?.value || grupos[0]?.id || 'e1',
        valor,
        origem: 'manual',
      });
      saveRegs(regs);
      desenhar();
    });
    $('ggBtnLimpar')?.addEventListener('click', () => {
      if (!confirm('Apagar todos os pontos marcados?')) return;
      overlayTeste = null;
      vista = null;
      vistaDinamica = null;
      escalaModo = 'original';
      atualizarOverlayInfo();
      saveRegs([]);
      desenhar();
    });
    $('ggBtnRestaurar')?.addEventListener('click', restaurarVistaPadrao);
    $('ggBtnCopiar')?.addEventListener('click', copiarGrafico);
    $('ggBtnExportar')?.addEventListener('click', exportarGrafico);
    $('ggBtnSalvar')?.addEventListener('click', salvarGraficoComNome);
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
    recarregarSalvos();
    await carregarColunasTeste();
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
