// Engenharia — Gerados de graficos
(function () {
  'use strict';

  const PREF_CHAVE = 'engenharia_gerador_graficos';
  const PANE_VERSION = '2';
  const DEFAULTS = {
    nomeAgua: 'Temperatura da água',
    nomeParametros: 'Parâmetros',
    nomePressao: 'Parâmetros de pressão',
    eixo1: '3~380',
    eixo2: '3~220',
    eixo3: '1~220v',
    lblMax: 'Máximo',
    lblMin: 'Mínimo',
    lblTick: 'Intervalo',
    aguaMax: 40,
    aguaMin: 16,
    aguaTick: 2,
    e1Max: 15.5,
    e1Min: 9.5,
    e1Tick: 0.5,
    e2Max: 28.5,
    e2Min: 22.5,
    e2Tick: 0.5,
    e3Max: 22,
    e3Min: 16,
    e3Tick: 0.5,
    paMin: 180,
    paMax: 300,
    paTick: 10,
    registros: [],
  };

  let chartAlta = null;
  let bound = false;
  let saveTimer = null;
  let prefsCarregadas = false;

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

  function estadoAtual() {
    return {
      nomeAgua: txt('ggNomeAgua', DEFAULTS.nomeAgua),
      nomeParametros: txt('ggNomeParametros', DEFAULTS.nomeParametros),
      nomePressao: txt('ggNomePressao', DEFAULTS.nomePressao),
      eixo1: txt('ggEixo1', DEFAULTS.eixo1),
      eixo2: txt('ggEixo2', DEFAULTS.eixo2),
      eixo3: txt('ggEixo3', DEFAULTS.eixo3),
      lblMax: txt('ggLblMax', DEFAULTS.lblMax),
      lblMin: txt('ggLblMin', DEFAULTS.lblMin),
      lblTick: txt('ggLblTick', DEFAULTS.lblTick),
      aguaMax: num('ggAguaMax', DEFAULTS.aguaMax),
      aguaMin: num('ggAguaMin', DEFAULTS.aguaMin),
      aguaTick: num('ggAguaTick', DEFAULTS.aguaTick),
      e1Max: num('gg380Max', DEFAULTS.e1Max),
      e1Min: num('gg380Min', DEFAULTS.e1Min),
      e1Tick: num('gg380Tick', DEFAULTS.e1Tick),
      e2Max: num('gg220Max', DEFAULTS.e2Max),
      e2Min: num('gg220Min', DEFAULTS.e2Min),
      e2Tick: num('gg220Tick', DEFAULTS.e2Tick),
      e3Max: num('gg1220Max', DEFAULTS.e3Max),
      e3Min: num('gg1220Min', DEFAULTS.e3Min),
      e3Tick: num('gg1220Tick', DEFAULTS.e3Tick),
      paMin: num('ggPaMin', DEFAULTS.paMin),
      paMax: num('ggPaMax', DEFAULTS.paMax),
      paTick: num('ggPaTick', DEFAULTS.paTick),
      registros: loadRegs(),
    };
  }

  function loadRegs() {
    try {
      const raw = $('ggRegsJson')?.value;
      const parsed = raw ? JSON.parse(raw) : [];
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
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set('ggNomeAgua', c.nomeAgua);
    set('ggNomeParametros', c.nomeParametros);
    set('ggNomePressao', c.nomePressao);
    set('ggEixo1', c.eixo1);
    set('ggEixo2', c.eixo2);
    set('ggEixo3', c.eixo3);
    set('ggLblMax', c.lblMax);
    set('ggLblMin', c.lblMin);
    set('ggLblTick', c.lblTick);
    set('ggAguaMax', c.aguaMax);
    set('ggAguaMin', c.aguaMin);
    set('ggAguaTick', c.aguaTick);
    set('gg380Max', c.e1Max);
    set('gg380Min', c.e1Min);
    set('gg380Tick', c.e1Tick);
    set('gg220Max', c.e2Max);
    set('gg220Min', c.e2Min);
    set('gg220Tick', c.e2Tick);
    set('gg1220Max', c.e3Max);
    set('gg1220Min', c.e3Min);
    set('gg1220Tick', c.e3Tick);
    set('ggPaMin', c.paMin);
    set('ggPaMax', c.paMax);
    set('ggPaTick', c.paTick);
    set('ggRegsJson', JSON.stringify(Array.isArray(c.registros) ? c.registros : []));
    atualizarRotulos();
  }

  function salvarPrefs() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const valor = JSON.stringify(estadoAtual());
      fetch('/api/usuario/preferencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ chave: PREF_CHAVE, valor }),
      }).catch(() => {});
    }, 350);
  }

  async function carregarPrefs() {
    try {
      const r = await fetch(`/api/usuario/preferencias/${encodeURIComponent(PREF_CHAVE)}`, {
        credentials: 'include',
      });
      if (!r.ok) return;
      const d = await r.json();
      if (d?.valor == null || d.valor === '') return;
      const parsed = typeof d.valor === 'string' ? JSON.parse(d.valor) : d.valor;
      if (parsed && typeof parsed === 'object') aplicarEstado(parsed);
    } catch (_) { /* usa padrão */ }
  }

  function atualizarRotulos() {
    const e1 = txt('ggEixo1', DEFAULTS.eixo1);
    const e2 = txt('ggEixo2', DEFAULTS.eixo2);
    const e3 = txt('ggEixo3', DEFAULTS.eixo3);
    const mx = txt('ggLblMax', DEFAULTS.lblMax);
    const mn = txt('ggLblMin', DEFAULTS.lblMin);
    const tk = txt('ggLblTick', DEFAULTS.lblTick);
    const setT = (id, t) => { const el = $(id); if (el) el.textContent = t; };
    setT('ggAguaLblMax', mx);
    setT('ggAguaLblMin', mn);
    setT('ggAguaLblTick', tk);
    setT('ggPaLblMin', mn);
    setT('ggPaLblMax', mx);
    setT('ggPaLblTick', tk);
    setT('ggE1LblMax', `${e1} — ${mx}`);
    setT('ggE1LblMin', `${e1} — ${mn}`);
    setT('ggE1LblTick', `${e1} — ${tk}`);
    setT('ggE2LblMax', `${e2} — ${mx}`);
    setT('ggE2LblMin', `${e2} — ${mn}`);
    setT('ggE2LblTick', `${e2} — ${tk}`);
    setT('ggE3LblMax', `${e3} — ${mx}`);
    setT('ggE3LblMin', `${e3} — ${mn}`);
    setT('ggE3LblTick', `${e3} — ${tk}`);
    const sel = $('ggModelo');
    if (sel) {
      const atual = sel.value || 'e1';
      sel.innerHTML = `
        <option value="e1">${e1}</option>
        <option value="e2">${e2}</option>
        <option value="e3">${e3}</option>`;
      sel.value = atual;
    }
    const sub = $('ggSubtitulo');
    if (sub) {
      sub.textContent = `${txt('ggNomeAgua', DEFAULTS.nomeAgua)} × ${txt('ggNomePressao', DEFAULTS.nomePressao)} (com ${e1}, ${e2} e ${e3}).`;
    }
  }

  function injectCss() {
    if ($('ggGraficoCss')) return;
    const style = document.createElement('style');
    style.id = 'ggGraficoCss';
    style.textContent = `
      #engenhariaGeradorGraficosPane .gg-layout {
        display: grid;
        grid-template-columns: minmax(170px, 1fr) minmax(280px, 3fr) minmax(200px, 1.1fr);
        gap: 16px;
        align-items: start;
      }
      #engenhariaGeradorGraficosPane .gg-side,
      #engenhariaGeradorGraficosPane .gg-pressao-row,
      #engenhariaGeradorGraficosPane .gg-form-grid {
        display: grid;
        gap: 8px;
      }
      #engenhariaGeradorGraficosPane .gg-pressao-row,
      #engenhariaGeradorGraficosPane .gg-form-grid {
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      }
      #engenhariaGeradorGraficosPane .gg-nome {
        width: 100%;
        font-weight: 700;
        font-size: 14px;
        color: var(--content-title-color, #e2e8f0);
        background: transparent;
        border: 1px dashed #475569;
        border-radius: 8px;
        padding: 6px 8px;
      }
      #engenhariaGeradorGraficosPane .gg-nome:focus {
        border-style: solid;
        border-color: #38bdf8;
        outline: none;
      }
      #engenhariaGeradorGraficosPane .gg-eixo-nome {
        font-weight: 600;
        font-size: 13px;
        margin-top: 6px;
      }
      #engenhariaGeradorGraficosPane .gg-lbl-edit {
        width: 100%;
        font-size: 12px;
        color: var(--inactive-color, #94a3b8);
        background: transparent;
        border: 1px dashed #334155;
        border-radius: 6px;
        padding: 4px 6px;
        margin-bottom: 4px;
      }
      #engenhariaGeradorGraficosPane label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
        color: var(--inactive-color);
      }
      #engenhariaGeradorGraficosPane input,
      #engenhariaGeradorGraficosPane select {
        background: #0f172a;
        color: #e2e8f0;
        border: 1px solid var(--border-color, #334155);
        border-radius: 8px;
        padding: 8px 10px;
      }
      #engenhariaGeradorGraficosPane .gg-chart-wrap {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #engenhariaGeradorGraficosPane .gg-chart-toolbar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      #engenhariaGeradorGraficosPane .gg-chart-box {
        background: #fff;
        border-radius: 12px;
        padding: 10px;
        min-height: 420px;
      }
      @media (max-width: 1100px) {
        #engenhariaGeradorGraficosPane .gg-layout { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  function eixoY(id, title, color, min, max, step, extra) {
    return Object.assign({
      type: 'linear',
      min,
      max,
      title: { display: true, text: title, color, font: { weight: 'bold' } },
      ticks: { color, stepSize: step || undefined },
      grid: { drawOnChartArea: id === 'yTemp' },
    }, extra || {});
  }

  const pluginConectores = {
    id: 'ggConnectors',
    afterDatasetsDraw(chart) {
      const recs = chart.$ggRecs || [];
      const { ctx, scales } = chart;
      recs.forEach((reg) => {
        const scaleId = reg.modelo === 'e2' ? 'y220' : (reg.modelo === 'e3' ? 'y1220' : 'y380');
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

  function desenhar() {
    const canvas = $('ggChartAlta');
    if (!canvas || typeof Chart === 'undefined') return;
    const nomeAgua = txt('ggNomeAgua', DEFAULTS.nomeAgua);
    const nomePressao = txt('ggNomePressao', DEFAULTS.nomePressao);
    const e1 = txt('ggEixo1', DEFAULTS.eixo1);
    const e2 = txt('ggEixo2', DEFAULTS.eixo2);
    const e3 = txt('ggEixo3', DEFAULTS.eixo3);
    const paMin = num('ggPaMin', DEFAULTS.paMin);
    const paMax = num('ggPaMax', DEFAULTS.paMax);
    const paTick = num('ggPaTick', DEFAULTS.paTick);
    const tMin = num('ggAguaMin', DEFAULTS.aguaMin);
    const tMax = num('ggAguaMax', DEFAULTS.aguaMax);
    const tTick = num('ggAguaTick', DEFAULTS.aguaTick);
    const xs = linspace(paMin, paMax, 13);
    const ys = linspace(tMin, tMax, 13);
    const linha = xs.map((x, i) => ({ x, y: ys[i] }));
    const recs = loadRegs().map((r) => {
      let modelo = r.modelo;
      if (modelo === '3~380') modelo = 'e1';
      if (modelo === '3~220') modelo = 'e2';
      if (modelo === '1~220v') modelo = 'e3';
      if (modelo !== 'e1' && modelo !== 'e2' && modelo !== 'e3') modelo = 'e1';
      return Object.assign({}, r, { modelo });
    });

    if (chartAlta) chartAlta.destroy();
    chartAlta = new Chart(canvas, {
      type: 'scatter',
      data: {
        datasets: [
          {
            type: 'line',
            label: nomeAgua,
            data: linha,
            borderColor: '#2563eb',
            backgroundColor: '#2563eb',
            pointRadius: 0,
            yAxisID: 'yTemp',
            tension: 0,
          },
          {
            type: 'scatter',
            label: 'Pontos',
            data: recs.map((r) => ({ x: r.pressao, y: r.temp })),
            backgroundColor: '#2563eb',
            pointRadius: 6,
            yAxisID: 'yTemp',
          },
          {
            type: 'scatter',
            label: e1,
            data: recs.filter((r) => r.modelo === 'e1').map((r) => ({ x: r.pressao, y: r.valor })),
            backgroundColor: '#ef4444',
            pointRadius: 6,
            yAxisID: 'y380',
          },
          {
            type: 'scatter',
            label: e2,
            data: recs.filter((r) => r.modelo === 'e2').map((r) => ({ x: r.pressao, y: r.valor })),
            backgroundColor: '#22c55e',
            pointRadius: 6,
            yAxisID: 'y220',
          },
          {
            type: 'scatter',
            label: e3,
            data: recs.filter((r) => r.modelo === 'e3').map((r) => ({ x: r.pressao, y: r.valor })),
            backgroundColor: '#a855f7',
            pointRadius: 6,
            yAxisID: 'y1220',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        plugins: {
          legend: { position: 'bottom' },
          title: {
            display: true,
            text: `${nomeAgua} com escalas para ${e1}, ${e2} e ${e3}`,
            color: '#0f172a',
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: paMin,
            max: paMax,
            title: { display: true, text: nomePressao, color: '#0f172a' },
            ticks: { stepSize: paTick || undefined, maxRotation: 90, minRotation: 90, color: '#334155' },
          },
          yTemp: eixoY('yTemp', nomeAgua, '#2563eb', tMin, tMax, tTick, { position: 'left' }),
          y380: eixoY('y380', e1, '#ef4444', num('gg380Min', DEFAULTS.e1Min), num('gg380Max', DEFAULTS.e1Max), num('gg380Tick', DEFAULTS.e1Tick), {
            position: 'right',
            grid: { drawOnChartArea: false },
          }),
          y220: eixoY('y220', e2, '#22c55e', num('gg220Min', DEFAULTS.e2Min), num('gg220Max', DEFAULTS.e2Max), num('gg220Tick', DEFAULTS.e2Tick), {
            position: 'right',
            offset: true,
            grid: { drawOnChartArea: false },
          }),
          y1220: eixoY('y1220', e3, '#a855f7', num('gg1220Min', DEFAULTS.e3Min), num('gg1220Max', DEFAULTS.e3Max), num('gg1220Tick', DEFAULTS.e3Tick), {
            position: 'right',
            offset: true,
            grid: { drawOnChartArea: false },
          }),
        },
        layout: { padding: { right: 8 } },
      },
      plugins: [pluginConectores],
    });
    chartAlta.$ggRecs = recs;
  }

  function canvasDoGrafico() {
    return chartAlta?.canvas || $('ggChartAlta');
  }

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
      out.toBlob((blob) => {
        if (!blob) reject(new Error('Não foi possível gerar a imagem.'));
        else resolve(blob);
      }, 'image/png');
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
    try {
      const blob = await blobDoGrafico();
      baixarPng(blob);
    } catch (err) {
      alert(err?.message || 'Não foi possível exportar o gráfico.');
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
            <div class="content-text" id="ggSubtitulo">Temperatura da água × pressão alta.</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" id="ggBtnRegistro" class="content-button" style="background:linear-gradient(135deg,#0ea5e9 0%,#0369a1 100%);color:#fff;">
              <i class="fa-solid fa-plus"></i> Adicionar Registro
            </button>
            <button type="button" id="ggBtnLimpar" class="content-button" style="background:#334155;color:#fff;">Limpar pontos</button>
          </div>
        </div>
        <input type="hidden" id="ggRegsJson" value="[]">
        <div id="ggFormWrap" style="display:none;margin:0 0 16px;padding:16px;border:1px solid var(--border-color);border-radius:12px;background:rgba(15,23,42,.35);">
          <div style="font-weight:700;margin-bottom:12px;">Novo Registro</div>
          <div class="gg-form-grid">
            <label>Temperatura <input id="ggTemp" type="number" step="0.1" value="30"></label>
            <label>Pressão <input id="ggPressao" type="number" step="1" value="250"></label>
            <label id="ggModeloWrap">Modelo
              <select id="ggModelo">
                <option value="e1">3~380</option>
                <option value="e2">3~220</option>
                <option value="e3">1~220v</option>
              </select>
            </label>
            <label>Valor <input id="ggValor" type="number" step="0.1" value="12.4"></label>
          </div>
          <button type="button" id="ggBtnEnviar" class="content-button" style="margin-top:12px;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:#fff;">Enviar Registro</button>
        </div>
        <div class="gg-layout">
          <div class="gg-side">
            <input id="ggNomeAgua" class="gg-nome" value="Temperatura da água" title="Clique para mudar o nome">
            <label><span id="ggAguaLblMax">Máximo</span> <input id="ggAguaMax" type="number" value="40"></label>
            <label><span id="ggAguaLblMin">Mínimo</span> <input id="ggAguaMin" type="number" value="16"></label>
            <label><span id="ggAguaLblTick">Intervalo</span> <input id="ggAguaTick" type="number" value="2"></label>
          </div>
          <div class="gg-chart-wrap">
            <div class="gg-chart-toolbar">
              <button type="button" id="ggBtnCopiar" class="content-button" style="background:#1d4ed8;color:#fff;">
                <i class="fa-regular fa-copy"></i> Copiar gráfico
              </button>
              <button type="button" id="ggBtnExportar" class="content-button" style="background:linear-gradient(135deg,#22c55e 0%,#15803d 100%);color:#fff;">
                <i class="fa-solid fa-image"></i> Exportar gráfico
              </button>
            </div>
            <div class="gg-chart-box"><canvas id="ggChartAlta"></canvas></div>
          </div>
          <div class="gg-side">
            <input id="ggNomeParametros" class="gg-nome" value="Parâmetros" title="Clique para mudar o nome">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:4px 0 8px;">
              <input id="ggLblMax" class="gg-lbl-edit" value="Máximo" title="Nome do campo Máximo">
              <input id="ggLblMin" class="gg-lbl-edit" value="Mínimo" title="Nome do campo Mínimo">
              <input id="ggLblTick" class="gg-lbl-edit" value="Intervalo" title="Nome do campo Intervalo">
            </div>
            <input id="ggEixo1" class="gg-nome gg-eixo-nome" value="3~380" title="Nome da 1ª escala">
            <label><span id="ggE1LblMax">3~380 — Máximo</span> <input id="gg380Max" type="number" step="0.1" value="15.5"></label>
            <label><span id="ggE1LblMin">3~380 — Mínimo</span> <input id="gg380Min" type="number" step="0.1" value="9.5"></label>
            <label><span id="ggE1LblTick">3~380 — Intervalo</span> <input id="gg380Tick" type="number" step="0.1" value="0.5"></label>
            <input id="ggEixo2" class="gg-nome gg-eixo-nome" value="3~220" title="Nome da 2ª escala">
            <label><span id="ggE2LblMax">3~220 — Máximo</span> <input id="gg220Max" type="number" step="0.1" value="28.5"></label>
            <label><span id="ggE2LblMin">3~220 — Mínimo</span> <input id="gg220Min" type="number" step="0.1" value="22.5"></label>
            <label><span id="ggE2LblTick">3~220 — Intervalo</span> <input id="gg220Tick" type="number" step="0.1" value="0.5"></label>
            <input id="ggEixo3" class="gg-nome gg-eixo-nome" value="1~220v" title="Nome da 3ª escala">
            <label><span id="ggE3LblMax">1~220v — Máximo</span> <input id="gg1220Max" type="number" step="0.1" value="22"></label>
            <label><span id="ggE3LblMin">1~220v — Mínimo</span> <input id="gg1220Min" type="number" step="0.1" value="16"></label>
            <label><span id="ggE3LblTick">1~220v — Intervalo</span> <input id="gg1220Tick" type="number" step="0.1" value="0.5"></label>
          </div>
        </div>
        <input id="ggNomePressao" class="gg-nome" value="Parâmetros de pressão" title="Clique para mudar o nome" style="max-width:420px;margin:18px 0 8px;">
        <div class="gg-pressao-row">
          <label><span id="ggPaLblMin">Mínimo</span> <input id="ggPaMin" type="number" value="180"></label>
          <label><span id="ggPaLblMax">Máximo</span> <input id="ggPaMax" type="number" value="300"></label>
          <label><span id="ggPaLblTick">Intervalo</span> <input id="ggPaTick" type="number" value="10"></label>
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
    const idsNum = [
      'ggAguaMax', 'ggAguaMin', 'ggAguaTick',
      'gg380Max', 'gg380Min', 'gg380Tick',
      'gg220Max', 'gg220Min', 'gg220Tick',
      'gg1220Max', 'gg1220Min', 'gg1220Tick',
      'ggPaMin', 'ggPaMax', 'ggPaTick',
    ];
    idsNum.forEach((id) => {
      $(id)?.addEventListener('change', () => { salvarPrefs(); desenhar(); });
    });
    const idsNome = [
      'ggNomeAgua', 'ggNomeParametros', 'ggNomePressao',
      'ggEixo1', 'ggEixo2', 'ggEixo3',
      'ggLblMax', 'ggLblMin', 'ggLblTick',
    ];
    idsNome.forEach((id) => {
      const fn = () => { atualizarRotulos(); salvarPrefs(); desenhar(); };
      $(id)?.addEventListener('change', fn);
      $(id)?.addEventListener('blur', fn);
    });
    $('ggBtnRegistro')?.addEventListener('click', () => {
      const wrap = $('ggFormWrap');
      if (!wrap) return;
      wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
    });
    $('ggBtnEnviar')?.addEventListener('click', () => {
      const regs = loadRegs();
      regs.push({
        temp: num('ggTemp', 30),
        pressao: num('ggPressao', 250),
        modelo: $('ggModelo')?.value || 'e1',
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
