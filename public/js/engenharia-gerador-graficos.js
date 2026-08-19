// Engenharia — Gerados de graficos (port do gerador Streamlit)
(function () {
  'use strict';

  const STORAGE_KEY = 'engenharia_gerador_graficos_v1';
  let chartAlta = null;
  let chartBaixa = null;
  let bound = false;

  function num(id, fallback) {
    const el = document.getElementById(id);
    const n = Number(el && el.value);
    return Number.isFinite(n) ? n : fallback;
  }

  function linspace(a, b, n) {
    if (n <= 1) return [a];
    const out = [];
    for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
    return out;
  }

  function loadRegs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveRegs(regs) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(regs));
  }

  function injectCss() {
    if (document.getElementById('ggGraficoCss')) return;
    const style = document.createElement('style');
    style.id = 'ggGraficoCss';
    style.textContent = `
      #engenhariaGeradorGraficosPane .gg-layout {
        display: grid;
        grid-template-columns: minmax(160px, 1fr) minmax(280px, 3fr) minmax(180px, 1fr);
        gap: 16px;
        align-items: start;
      }
      #engenhariaGeradorGraficosPane .gg-layout-2 {
        grid-template-columns: minmax(160px, 1fr) minmax(280px, 3fr);
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
      #engenhariaGeradorGraficosPane .gg-side h4 {
        margin: 0 0 8px;
        color: var(--content-title-color);
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
      #engenhariaGeradorGraficosPane .gg-chart-box {
        background: #fff;
        border-radius: 12px;
        padding: 10px;
        min-height: 360px;
      }
      @media (max-width: 1100px) {
        #engenhariaGeradorGraficosPane .gg-layout,
        #engenhariaGeradorGraficosPane .gg-layout-2 {
          grid-template-columns: 1fr;
        }
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
      grid: { drawOnChartArea: id === 'yTemp' || id === 'yAmb' },
    }, extra || {});
  }

  const pluginConectores = {
    id: 'ggConnectors',
    afterDatasetsDraw(chart) {
      const recs = chart.$ggRecs || [];
      const { ctx, scales } = chart;
      recs.forEach((reg) => {
        const scaleId = reg.modelo === '3~380' ? 'y380' : (reg.modelo === '3~220' ? 'y220' : 'y1220');
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

  function destruir(chart) {
    if (chart) chart.destroy();
  }

  function desenharAlta() {
    const canvas = document.getElementById('ggChartAlta');
    if (!canvas || typeof Chart === 'undefined') return;
    const paMin = num('ggPaMin', 180);
    const paMax = num('ggPaMax', 300);
    const paTick = num('ggPaTick', 10);
    const tMin = num('ggAguaMin', 16);
    const tMax = num('ggAguaMax', 40);
    const tTick = num('ggAguaTick', 2);
    const xs = linspace(paMin, paMax, 13);
    const ys = linspace(tMin, tMax, 13);
    const linha = xs.map((x, i) => ({ x, y: ys[i] }));
    const recs = loadRegs().filter((r) => r.destino !== 'baixa');
    const corModelo = { '3~380': '#ef4444', '3~220': '#22c55e', '1~220v': '#a855f7' };

    destruir(chartAlta);
    chartAlta = new Chart(canvas, {
      type: 'scatter',
      data: {
        datasets: [
          {
            type: 'line',
            label: 'Temperatura da água',
            data: linha,
            borderColor: '#2563eb',
            backgroundColor: '#2563eb',
            pointRadius: 0,
            yAxisID: 'yTemp',
            tension: 0,
          },
          {
            type: 'scatter',
            label: 'Pontos água',
            data: recs.map((r) => ({ x: r.pressao, y: r.temp })),
            backgroundColor: '#2563eb',
            pointRadius: 6,
            yAxisID: 'yTemp',
          },
          {
            type: 'scatter',
            label: '3~380',
            data: recs.filter((r) => r.modelo === '3~380').map((r) => ({ x: r.pressao, y: r.valor })),
            backgroundColor: corModelo['3~380'],
            pointRadius: 6,
            yAxisID: 'y380',
          },
          {
            type: 'scatter',
            label: '3~220',
            data: recs.filter((r) => r.modelo === '3~220').map((r) => ({ x: r.pressao, y: r.valor })),
            backgroundColor: corModelo['3~220'],
            pointRadius: 6,
            yAxisID: 'y220',
          },
          {
            type: 'scatter',
            label: '1~220v',
            data: recs.filter((r) => r.modelo === '1~220v').map((r) => ({ x: r.pressao, y: r.valor })),
            backgroundColor: corModelo['1~220v'],
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
          title: { display: true, text: 'Temperatura da água com escalas para 3~380, 3~220 e 1~220v', color: '#0f172a' },
        },
        scales: {
          x: {
            type: 'linear',
            min: paMin,
            max: paMax,
            title: { display: true, text: 'Pressão alta', color: '#0f172a' },
            ticks: { stepSize: paTick || undefined, maxRotation: 90, minRotation: 90, color: '#334155' },
          },
          yTemp: eixoY('yTemp', 'Temperatura da água', '#2563eb', tMin, tMax, tTick, { position: 'left' }),
          y380: eixoY('y380', '3~380', '#ef4444', num('gg380Min', 9.5), num('gg380Max', 15.5), num('gg380Tick', 0.5), {
            position: 'right',
            grid: { drawOnChartArea: false },
          }),
          y220: eixoY('y220', '3~220', '#22c55e', num('gg220Min', 22.5), num('gg220Max', 28.5), num('gg220Tick', 0.5), {
            position: 'right',
            offset: true,
            grid: { drawOnChartArea: false },
          }),
          y1220: eixoY('y1220', '1~220v', '#a855f7', num('gg1220Min', 16), num('gg1220Max', 22), num('gg1220Tick', 0.5), {
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

  function desenharBaixa() {
    const canvas = document.getElementById('ggChartBaixa');
    if (!canvas || typeof Chart === 'undefined') return;
    const pbMin = num('ggPbMin', 26);
    const pbMax = num('ggPbMax', 95);
    const pbTick = num('ggPbTick', 10);
    const tMin = num('ggTaMin', 0);
    const tMax = num('ggTaMax', 40);
    const tTick = num('ggTaTick', 5);
    const xs = linspace(pbMin, pbMax, 13);
    const ys = linspace(tMin, tMax, 13);
    const linha = xs.map((x, i) => ({ x, y: ys[i] }));
    const recs = loadRegs().filter((r) => r.destino === 'baixa');

    destruir(chartBaixa);
    chartBaixa = new Chart(canvas, {
      type: 'scatter',
      data: {
        datasets: [
          {
            type: 'line',
            label: 'Temperatura Ambiente',
            data: linha,
            borderColor: '#2563eb',
            backgroundColor: '#2563eb',
            pointRadius: 3,
            yAxisID: 'yAmb',
            tension: 0,
          },
          {
            type: 'scatter',
            label: 'Pontos',
            data: recs.map((r) => ({ x: r.pressao, y: r.temp })),
            backgroundColor: '#2563eb',
            pointRadius: 6,
            yAxisID: 'yAmb',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Temperatura Ambiente x Pressão baixa', color: '#0f172a' },
        },
        scales: {
          x: {
            type: 'linear',
            min: pbMin,
            max: pbMax,
            title: { display: true, text: 'Pressão baixa', color: '#0f172a' },
            ticks: { stepSize: pbTick || undefined, maxRotation: 90, minRotation: 90, color: '#334155' },
          },
          yAmb: eixoY('yAmb', 'Temperatura Ambiente', '#2563eb', tMin, tMax, tTick, { position: 'left' }),
        },
      },
    });
  }

  function redesenhar() {
    desenharAlta();
    desenharBaixa();
  }

  function atualizarCamposForm() {
    const baixa = document.getElementById('ggDestino')?.value === 'baixa';
    const modelo = document.getElementById('ggModeloWrap');
    const valor = document.getElementById('ggValorWrap');
    if (modelo) modelo.style.display = baixa ? 'none' : '';
    if (valor) valor.style.display = baixa ? 'none' : '';
    const pressao = document.getElementById('ggPressao');
    const temp = document.getElementById('ggTemp');
    if (baixa) {
      if (pressao && Number(pressao.value) > 150) pressao.value = '50';
      if (temp && Number(temp.value) > 45) temp.value = '20';
    }
  }

  function garantirUi() {
    const menuDesenho = document.getElementById('menu-engenharia-desenho-tecnico');
    if (menuDesenho && !document.getElementById('menu-engenharia-gerador-graficos')) {
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
      const pir = document.getElementById('menu-engenharia-pir-eng');
      (pir || menuDesenho).insertAdjacentElement('afterend', a);
    }

    if (!document.getElementById('engenhariaGeradorGraficosPane')) {
      const pane = document.createElement('div');
      pane.id = 'engenhariaGeradorGraficosPane';
      pane.className = 'tab-pane';
      pane.style.display = 'none';
      pane.innerHTML = `
        <div class="content-wrapper">
          <div class="content-wrapper-header">
            <div class="content-wrapper-context">
              <h3 class="img-content" style="display:flex;align-items:center;gap:10px;">
                <i class="fa-solid fa-chart-line" style="color:#38bdf8;"></i>
                <span>Gerados de graficos</span>
              </h3>
              <div class="content-text">Temperatura da água × pressão alta (com 3~380, 3~220 e 1~220v) e temperatura ambiente × pressão baixa.</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" id="ggBtnRegistro" class="content-button" style="background:linear-gradient(135deg,#0ea5e9 0%,#0369a1 100%);color:#fff;">
                <i class="fa-solid fa-plus"></i> Adicionar Registro
              </button>
              <button type="button" id="ggBtnLimpar" class="content-button" style="background:#334155;color:#fff;">Limpar pontos</button>
            </div>
          </div>
          <div id="ggFormWrap" style="display:none;margin:0 0 16px;padding:16px;border:1px solid var(--border-color);border-radius:12px;background:rgba(15,23,42,.35);">
            <div style="font-weight:700;margin-bottom:12px;">Novo Registro</div>
            <div class="gg-form-grid">
              <label>Destino
                <select id="ggDestino">
                  <option value="alta">Gráfico 1 — Pressão alta</option>
                  <option value="baixa">Gráfico 2 — Pressão baixa</option>
                </select>
              </label>
              <label>Temperatura <input id="ggTemp" type="number" step="0.1" value="30"></label>
              <label>Pressão <input id="ggPressao" type="number" step="1" value="250"></label>
              <label id="ggModeloWrap">Modelo
                <select id="ggModelo">
                  <option value="3~380">3~380</option>
                  <option value="3~220">3~220</option>
                  <option value="1~220v">1~220v</option>
                </select>
              </label>
              <label id="ggValorWrap">Valor <input id="ggValor" type="number" step="0.1" value="12.4"></label>
            </div>
            <button type="button" id="ggBtnEnviar" class="content-button" style="margin-top:12px;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:#fff;">Enviar Registro</button>
          </div>
          <div class="gg-layout">
            <div class="gg-side">
              <h4>Temperatura da água</h4>
              <label>Máximo <input id="ggAguaMax" type="number" value="40"></label>
              <label>Mínimo <input id="ggAguaMin" type="number" value="16"></label>
              <label>Intervalo <input id="ggAguaTick" type="number" value="2"></label>
            </div>
            <div class="gg-chart-box"><canvas id="ggChartAlta"></canvas></div>
            <div class="gg-side">
              <h4>Parâmetros</h4>
              <label>3~380 — Máximo <input id="gg380Max" type="number" step="0.1" value="15.5"></label>
              <label>3~380 — Mínimo <input id="gg380Min" type="number" step="0.1" value="9.5"></label>
              <label>3~380 — Intervalo <input id="gg380Tick" type="number" step="0.1" value="0.5"></label>
              <label>3~220 — Máximo <input id="gg220Max" type="number" step="0.1" value="28.5"></label>
              <label>3~220 — Mínimo <input id="gg220Min" type="number" step="0.1" value="22.5"></label>
              <label>3~220 — Intervalo <input id="gg220Tick" type="number" step="0.1" value="0.5"></label>
              <label>1~220v — Máximo <input id="gg1220Max" type="number" step="0.1" value="22"></label>
              <label>1~220v — Mínimo <input id="gg1220Min" type="number" step="0.1" value="16"></label>
              <label>1~220v — Intervalo <input id="gg1220Tick" type="number" step="0.1" value="0.5"></label>
            </div>
          </div>
          <h4 style="margin:18px 0 8px;">Parâmetros de pressão</h4>
          <div class="gg-pressao-row">
            <label>Mínimo <input id="ggPaMin" type="number" value="180"></label>
            <label>Máximo <input id="ggPaMax" type="number" value="300"></label>
            <label>Intervalo <input id="ggPaTick" type="number" value="10"></label>
          </div>
          <hr style="border:none;border-top:1px solid var(--border-color);margin:24px 0;">
          <h3 class="img-content" style="font-size:18px;margin-bottom:12px;">Temperatura Ambiente × Pressão baixa</h3>
          <div class="gg-layout gg-layout-2">
            <div class="gg-side">
              <h4>Temperatura Ambiente</h4>
              <label>Máximo <input id="ggTaMax" type="number" value="40"></label>
              <label>Mínimo <input id="ggTaMin" type="number" value="0"></label>
              <label>Intervalo <input id="ggTaTick" type="number" value="5"></label>
            </div>
            <div class="gg-chart-box"><canvas id="ggChartBaixa"></canvas></div>
          </div>
          <h4 style="margin:18px 0 8px;">Configuração de Pressão baixa</h4>
          <div class="gg-pressao-row">
            <label>Mínimo <input id="ggPbMin" type="number" value="26"></label>
            <label>Máximo <input id="ggPbMax" type="number" value="95"></label>
            <label>Intervalo <input id="ggPbTick" type="number" value="10"></label>
          </div>
        </div>`;
      const after = document.getElementById('engenhariaDesenhoTecnicoPane');
      if (after) after.insertAdjacentElement('afterend', pane);
      else document.querySelector('.main-container')?.appendChild(pane);
    }
  }

  function ligar() {
    if (bound) return;
    bound = true;
    garantirUi();
    injectCss();
    const ids = [
      'ggAguaMax', 'ggAguaMin', 'ggAguaTick',
      'gg380Max', 'gg380Min', 'gg380Tick',
      'gg220Max', 'gg220Min', 'gg220Tick',
      'gg1220Max', 'gg1220Min', 'gg1220Tick',
      'ggPaMin', 'ggPaMax', 'ggPaTick',
      'ggTaMax', 'ggTaMin', 'ggTaTick',
      'ggPbMin', 'ggPbMax', 'ggPbTick',
    ];
    ids.forEach((id) => {
      document.getElementById(id)?.addEventListener('change', redesenhar);
    });
    document.getElementById('ggBtnRegistro')?.addEventListener('click', () => {
      const wrap = document.getElementById('ggFormWrap');
      if (!wrap) return;
      wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('ggDestino')?.addEventListener('change', atualizarCamposForm);
    document.getElementById('ggBtnEnviar')?.addEventListener('click', () => {
      const destino = document.getElementById('ggDestino')?.value || 'alta';
      const regs = loadRegs();
      regs.push({
        destino,
        temp: num('ggTemp', 30),
        pressao: num('ggPressao', destino === 'baixa' ? 50 : 250),
        modelo: document.getElementById('ggModelo')?.value || '3~380',
        valor: num('ggValor', 12.4),
      });
      saveRegs(regs);
      document.getElementById('ggFormWrap').style.display = 'none';
      redesenhar();
    });
    document.getElementById('ggBtnLimpar')?.addEventListener('click', () => {
      if (!confirm('Apagar todos os pontos marcados neste computador?')) return;
      saveRegs([]);
      redesenhar();
    });
  }

  function abrir() {
    garantirUi();
    document.querySelectorAll('.left-side .side-menu a').forEach((a) => a.classList.remove('is-active'));
    document.getElementById('menu-engenharia-gerador-graficos')?.classList.add('is-active');
    if (typeof window.showMainTab === 'function') {
      window.showMainTab('engenhariaGeradorGraficosPane');
    }
    ligar();
    setTimeout(redesenhar, 30);
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
