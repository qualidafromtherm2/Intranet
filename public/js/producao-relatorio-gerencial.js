// Relatório Gerencial Produção — layout espelhado do Relatório Logística / AT / Vendas
(function () {
  let _init = false;
  let _data = null;
  let _textos = null;
  let _secao = 'executivo';
  const _charts = {};
  const _chartsRendered = new Set();

  const CORES = ['#0f766e', '#14b8a6', '#38bdf8', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
  const ACCENT = '#0f766e';
  const ACCENT2 = '#14b8a6';

  const SECOES = [
    { id: 'executivo', label: 'Dashboard Executivo', icon: 'fa-gauge-high', pg: 1 },
    { id: 'maquinas', label: 'Máquinas produzidas', icon: 'fa-gears', pg: 2 },
    { id: 'postos', label: 'Tempo por Posto', icon: 'fa-industry', pg: 3 },
    { id: 'ri', label: 'Tempo de RI', icon: 'fa-clipboard-check', pg: 4 },
    { id: 'ops', label: 'Ciclo por OP', icon: 'fa-list-ol', pg: 5 },
    { id: 'detalhe', label: 'Detalhe dos Ciclos', icon: 'fa-clock', pg: 6 },
    { id: 'evolucao', label: 'Evolução', icon: 'fa-chart-column', pg: 7 },
    { id: 'plano', label: 'Plano de Ação', icon: 'fa-list-check', pg: 8 },
    { id: 'conclusao', label: 'Conclusão Executiva', icon: 'fa-flag-checkered', pg: 9 },
  ];

  function _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _fmtData(raw) {
    if (!raw) return '-';
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? String(raw).slice(0, 10) : d.toLocaleDateString('pt-BR');
  }

  function _fmtDataGeracao() {
    return new Date().toLocaleDateString('pt-BR');
  }

  function _fmtDuracaoHoras(h) {
    if (h == null || Number.isNaN(Number(h))) return '—';
    const abs = Math.abs(Number(h));
    if (abs < 1) return `${Math.max(1, Math.round(abs * 60))} min`;
    if (abs < 48) return `${abs.toFixed(1).replace('.', ',')} h`;
    const d = abs / 24;
    return `${d.toFixed(1).replace('.', ',')} dias`;
  }

  function _fmtDataHora(raw) {
    if (!raw) return '—';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function _destroyChart(key) {
    if (_charts[key]) {
      _charts[key].destroy();
      _charts[key] = null;
    }
  }

  function _destroyAllCharts() {
    Object.keys(_charts).forEach(_destroyChart);
    _chartsRendered.clear();
  }

  function _gerarTextosPadrao(data) {
    const k = data.kpis || {};
    const topPostos = (data.por_posto || []).slice(0, 3);
    const topTxt = topPostos.map((r) => `${r.posto} (${_fmtDuracaoHoras(r.media_h_posto)})`).join(', ') || '—';

    const plano_acao = [
      k.aguardando_ri > 0 && {
        acao: 'Liberar RIs pendentes',
        descricao: `${k.aguardando_ri} OP(s) aguardando liberação via RI`,
        responsavel: '', prazo: '', prioridade: 'alta',
      },
      (k.media_h_ri != null && k.media_h_ri > 4) && {
        acao: 'Reduzir tempo de espera de RI',
        descricao: `Média atual de espera RI: ${_fmtDuracaoHoras(k.media_h_ri)}`,
        responsavel: '', prazo: '', prioridade: 'media',
      },
      (k.media_h_posto != null && k.media_h_posto > 8) && {
        acao: 'Revisar gargalos por posto',
        descricao: `Tempo médio no posto: ${_fmtDuracaoHoras(k.media_h_posto)}. Maiores: ${topTxt}`,
        responsavel: '', prazo: '', prioridade: 'media',
      },
    ].filter(Boolean);

    if (!plano_acao.length) {
      plano_acao.push({ acao: '', descricao: '', responsavel: '', prazo: '', prioridade: 'media' });
    }

    return {
      plano_acao,
      conclusao_resumo: `No período ${data.periodo || ''} a produção registrou ${k.ops_com_tempo || 0} OP(s) com tempo controlado, ${k.ciclos_posto_fechados || 0} ciclo(s) de posto finalizado(s) e média de ${_fmtDuracaoHoras(k.media_h_ciclo_op)} por OP (tempo útil de posto).`,
      conclusao_pontos_criticos: [
        `Tempo médio por posto: ${_fmtDuracaoHoras(k.media_h_posto)} · RI: ${_fmtDuracaoHoras(k.media_h_ri)}`,
        `Em andamento no posto: ${k.em_andamento_posto || 0} · Aguardando RI: ${k.aguardando_ri || 0}`,
        `Postos com maior tempo médio: ${topTxt}`,
      ].join('\n'),
      conclusao_oportunidades: [
        'Padronizar tempo-alvo por posto (hermética, elétrica, teste, embalagem)',
        'Acompanhar fila de RI para reduzir espera entre finalização e liberação',
        'Usar o detalhe por OP para estudar equipamentos com ciclo acima da mediana',
      ].join('\n'),
    };
  }

  function _resolverTextos(data) {
    if (data.textos?.salvo) {
      const plano = Array.isArray(data.textos.plano_acao) ? data.textos.plano_acao : [];
      return {
        plano_acao: plano.length ? plano : [{ acao: '', descricao: '', responsavel: '', prazo: '', prioridade: 'media' }],
        conclusao_resumo: data.textos.conclusao_resumo || '',
        conclusao_pontos_criticos: data.textos.conclusao_pontos_criticos || '',
        conclusao_oportunidades: data.textos.conclusao_oportunidades || '',
        editado_por: data.textos.editado_por || null,
        editado_em: data.textos.editado_em || null,
      };
    }
    return { ..._gerarTextosPadrao(data), editado_por: null, editado_em: null };
  }

  function _headerHtml(periodo) {
    return `
      <div class="at-rel-ger-header">
        <div class="at-rel-ger-header-top">
          <div class="at-rel-ger-brand">
            <div class="at-rel-ger-logo">FT</div>
            <div>
              <div class="at-rel-ger-brand-name">FROMTHERM</div>
              <div class="at-rel-ger-brand-sub">BOMBAS DE CALOR</div>
            </div>
          </div>
          <div class="at-rel-ger-header-title">
            <div class="at-rel-ger-report-type">Relatório Gerencial de Produção</div>
            <div class="at-rel-ger-periodo">${_esc(periodo)}</div>
          </div>
          <div class="at-rel-ger-meta">
            <div><span>Departamento:</span> Produção</div>
            <div><span>Data:</span> ${_esc(_fmtDataGeracao())}</div>
            <div><span>Versão:</span> 1.0</div>
          </div>
        </div>
        <div class="at-rel-ger-header-bar" style="background:linear-gradient(90deg,${ACCENT},${ACCENT2});"></div>
      </div>`;
  }

  function _footerHtml(pg) {
    return `
      <div class="at-rel-ger-footer">
        <div class="slogan">Qualidade que transforma. Conforto que dura.</div>
        <div class="pagina">Página ${pg} de ${SECOES.length}</div>
      </div>`;
  }

  function _montarPaginas() {
    const nav = document.getElementById('prodRelGerNav');
    const pagesWrap = document.getElementById('prodRelGerPages');
    if (!nav || !pagesWrap) return;

    nav.innerHTML = `<div class="at-rel-ger-nav-title">Páginas do relatório</div>${SECOES.map((s) => `
      <button type="button" class="at-rel-ger-nav-btn${s.id === _secao ? ' is-active' : ''}" data-sec="${s.id}">
        <span class="pg-num">${s.pg}</span>
        <i class="fa-solid ${s.icon}"></i>
        <span>${s.label}</span>
      </button>`).join('')}`;

    const periodo = _data?.periodo || '—';
    const hdr = () => _headerHtml(periodo);

    const icons = {
      executivo: 'fa-gauge-high', maquinas: 'fa-gears', postos: 'fa-industry', ri: 'fa-clipboard-check',
      ops: 'fa-list-ol', detalhe: 'fa-clock', evolucao: 'fa-chart-column',
      plano: 'fa-list-check', conclusao: 'fa-flag-checkered',
    };
    const titles = {
      executivo: 'Dashboard Executivo', maquinas: 'Máquinas produzidas',
      postos: 'Tempo por Posto', ri: 'Tempo de RI',
      ops: 'Ciclo por Ordem de Produção', detalhe: 'Detalhe dos Ciclos',
      evolucao: 'Evolução no Período', plano: 'Plano de Ação', conclusao: 'Conclusão Executiva',
    };

    const bodies = {
      executivo: `
        <div id="prodRelGerKpis" class="at-rel-ger-kpis"></div>
        <p style="font-size:12px;color:#64748b;margin:0 0 12px;">
          Tempos em <strong>horas úteis</strong> (desconta café/refeição conforme Turno do dia).
          Se houver MO informada na linha, o tempo do posto é dividido pela quantidade de pessoas.
          Contagem inicia na impressão da etiqueta / entrada no posto e fecha ao finalizar a operação.
        </p>
        <div class="at-rel-ger-grid-2">
          <div class="at-rel-ger-card"><h4>Tempo médio por posto</h4><div class="at-rel-ger-chart sm"><canvas id="prodRelGerChartPostoExec"></canvas></div></div>
          <div class="at-rel-ger-card"><h4>Faixas de tempo no posto</h4><div class="at-rel-ger-chart sm"><canvas id="prodRelGerChartFaixasExec"></canvas></div></div>
        </div>`,
      maquinas: `
        <div id="prodRelGerProdKpis" class="at-rel-ger-kpis" style="margin-bottom:14px;"></div>
        <p style="font-size:12px;color:#64748b;margin:0 0 12px;">
          Conta a máquina no momento em que a <strong>RI da Inspeção final</strong> é registrada e a OP sai do kanban
          (entrada no estoque de máquinas). Máquinas ainda na coluna Inspeção final <strong>não</strong> entram neste total.
        </p>
        <div class="at-rel-ger-card">
          <h4>Máquinas produzidas por dia</h4>
          <p style="font-size:12px;color:#64748b;margin:0 0 8px;">Clique em uma barra para ver os modelos daquele dia.</p>
          <div class="at-rel-ger-chart lg"><canvas id="prodRelGerChartProdDia"></canvas></div>
          <div id="prodRelGerProdDiaDetalhe" style="display:none;margin-top:12px;"></div>
        </div>
        <div class="at-rel-ger-card" style="margin-top:14px;"><h4>Liberações da Inspeção final</h4>
          <div style="overflow:auto;max-height:420px;"><table class="at-rel-ger-tbl">
            <thead><tr><th>Data</th><th>OP</th><th>Modelo</th><th class="r">Qtd</th></tr></thead>
            <tbody id="prodRelGerProdLibBody"></tbody>
          </table></div>
        </div>`,
      postos: `
        <div id="prodRelGerPostoKpis" class="at-rel-ger-kpis" style="margin-bottom:14px;"></div>
        <div class="at-rel-ger-grid-2">
          <div class="at-rel-ger-card"><h4>Média útil por posto</h4><div class="at-rel-ger-chart lg"><canvas id="prodRelGerChartPosto"></canvas></div></div>
          <div class="at-rel-ger-card"><h4>Resumo por posto</h4>
            <div style="overflow:auto;max-height:320px;"><table class="at-rel-ger-tbl">
              <thead><tr><th>Posto</th><th class="r">Ciclos</th><th class="r">OPs</th><th class="r">Média posto</th><th class="r">Mediana</th></tr></thead>
              <tbody id="prodRelGerPostoBody"></tbody>
            </table></div>
          </div>
        </div>`,
      ri: `
        <div id="prodRelGerRiKpis" class="at-rel-ger-kpis" style="margin-bottom:14px;"></div>
        <p style="font-size:12px;color:#64748b;margin:0 0 12px;">
          Tempo desde a entrada no posto (início da fase RI) até a liberação da inspeção — antes do trabalho liberado e do avanço ao próximo posto.
        </p>
        <div class="at-rel-ger-grid-2">
          <div class="at-rel-ger-card"><h4>Tempo médio de RI por posto</h4><div class="at-rel-ger-chart lg"><canvas id="prodRelGerChartRi"></canvas></div></div>
          <div class="at-rel-ger-card"><h4>Últimas RIs concluídas</h4>
            <div style="overflow:auto;max-height:320px;"><table class="at-rel-ger-tbl">
              <thead><tr><th>OP</th><th>Posto</th><th>Início</th><th>Fim</th><th class="r">Tempo</th></tr></thead>
              <tbody id="prodRelGerRiBody"></tbody>
            </table></div>
          </div>
        </div>`,
      ops: `
        <p style="font-size:12px;color:#64748b;margin:0 0 12px;">
          Soma do tempo útil nos postos de cada OP no período (estudo de quanto a máquina leva para ser concluída).
        </p>
        <div style="overflow:auto;max-height:480px;"><table class="at-rel-ger-tbl">
          <thead><tr>
            <th>OP</th><th>Postos</th><th class="r">Ciclos</th>
            <th class="r">Tempo posto</th><th class="r">Tempo RI</th><th class="r">Trabalho</th><th class="r">Ciclo OP</th>
          </tr></thead>
          <tbody id="prodRelGerOpsBody"></tbody>
        </table></div>`,
      detalhe: `
        <div class="at-rel-ger-card"><h4>Ciclos de posto finalizados</h4>
          <div style="overflow:auto;max-height:420px;"><table class="at-rel-ger-tbl">
            <thead><tr>
              <th>OP</th><th>Posto</th><th>Início</th><th>Fim</th><th class="r">Tempo útil</th><th>Operador fim</th>
            </tr></thead>
            <tbody id="prodRelGerDetalheBody"></tbody>
          </table></div>
        </div>`,
      evolucao: `
        <div class="at-rel-ger-card"><h4 id="prodRelGerEvolTitulo">Máquinas produzidas no período</h4>
          <p style="font-size:12px;color:#64748b;margin:0 0 8px;">Total de máquinas liberadas na Inspeção final (RI registrada).</p>
          <div class="at-rel-ger-chart lg"><canvas id="prodRelGerChartEvol"></canvas></div>
        </div>`,
      plano: `
        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
          <button type="button" id="prodRelGerPlanoAdd" class="at-rel-ger-btn"><i class="fa-solid fa-plus"></i> Adicionar ação</button>
          <button type="button" id="prodRelGerPlanoSalvar" class="at-rel-ger-btn primary"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
          <span id="prodRelGerPlanoStatus" style="font-size:12px;color:#64748b;align-self:center;"></span>
        </div>
        <div style="overflow:auto;"><table class="at-rel-ger-tbl"><thead><tr><th>Ação</th><th>Descrição</th><th>Responsável</th><th>Prazo</th><th>Prioridade</th><th></th></tr></thead><tbody id="prodRelGerPlanoBody"></tbody></table></div>`,
      conclusao: `
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <button type="button" id="prodRelGerConcSalvar" class="at-rel-ger-btn primary"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
          <span id="prodRelGerConcStatus" style="font-size:12px;color:#64748b;align-self:center;"></span>
        </div>
        <label style="font-size:12px;font-weight:700;color:${ACCENT};">Resumo executivo</label>
        <textarea id="prodRelGerConcResumo" rows="4" style="width:100%;margin:6px 0 12px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;"></textarea>
        <div class="at-rel-ger-grid-2">
          <div><label style="font-size:12px;font-weight:700;color:${ACCENT};">Pontos críticos</label>
            <textarea id="prodRelGerConcCriticos" rows="5" style="width:100%;margin-top:6px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;"></textarea></div>
          <div><label style="font-size:12px;font-weight:700;color:${ACCENT};">Oportunidades</label>
            <textarea id="prodRelGerConcOportunidades" rows="5" style="width:100%;margin-top:6px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;"></textarea></div>
        </div>`,
    };

    pagesWrap.innerHTML = SECOES.map((s) => {
      const active = s.id === _secao ? ' is-active' : '';
      return `
        <div class="at-rel-ger-page${active}" data-sec="${s.id}">
          ${hdr()}
          <div class="at-rel-ger-sec-title"><i class="fa-solid ${icons[s.id]}"></i> ${titles[s.id]}</div>
          <div class="at-rel-ger-body">${bodies[s.id] || ''}</div>
          ${_footerHtml(s.pg)}
        </div>`;
    }).join('');

    nav.querySelectorAll('.at-rel-ger-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => _trocarSecao(btn.dataset.sec));
    });
    document.getElementById('prodRelGerPlanoAdd')?.addEventListener('click', _planoAdd);
    document.getElementById('prodRelGerPlanoSalvar')?.addEventListener('click', () => _salvarTextos('plano'));
    document.getElementById('prodRelGerConcSalvar')?.addEventListener('click', () => _salvarTextos('conclusao'));
  }

  function _trocarSecao(sec) {
    if (!sec) return;
    _secao = sec;
    document.querySelectorAll('#prodRelGerNav .at-rel-ger-nav-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.sec === sec));
    document.querySelectorAll('#prodRelGerPages .at-rel-ger-page').forEach((p) => p.classList.toggle('is-active', p.dataset.sec === sec));
    if (_data && !_chartsRendered.has(sec)) _renderChartsSecao(sec, _data);
  }

  function _renderKpis(kpis) {
    const wrap = document.getElementById('prodRelGerKpis');
    if (!wrap) return;
    const cards = [
      { label: 'Máquinas produzidas', value: kpis.maquinas_produzidas ?? 0, cor: '#0ea5e9' },
      { label: 'OPs com tempo', value: kpis.ops_com_tempo ?? 0, cor: ACCENT },
      { label: 'Ciclos de posto', value: kpis.ciclos_posto_fechados ?? 0, cor: ACCENT2 },
      { label: 'Média no posto', value: _fmtDuracaoHoras(kpis.media_h_posto), cor: '#0284c7' },
      { label: 'Média RI', value: _fmtDuracaoHoras(kpis.media_h_ri), cor: '#f59e0b' },
      { label: 'Média trabalho', value: _fmtDuracaoHoras(kpis.media_h_trabalho), cor: '#8b5cf6' },
      { label: 'Ciclo médio OP', value: _fmtDuracaoHoras(kpis.media_h_ciclo_op), cor: '#0ea5e9' },
      { label: 'Em andamento', value: kpis.em_andamento_posto ?? 0, cor: '#d97706' },
      { label: 'Aguardando RI', value: kpis.aguardando_ri ?? 0, cor: '#dc2626' },
    ];
    wrap.innerHTML = cards.map((c) => `<div class="at-rel-ger-kpi" style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${c.value}</div></div>`).join('');
  }

  function _fmtDiaLabel(ymd) {
    const s = String(ymd || '').slice(0, 10);
    if (s.length < 10) return s;
    const [y, m, d] = s.split('-');
    return `${d}/${m}`;
  }

  function _fmtDiaCompleto(ymd) {
    const s = String(ymd || '').slice(0, 10);
    if (s.length < 10) return s;
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }

  function _mostrarModelosDia(containerId, dia, modelos) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const rows = Array.isArray(modelos) ? modelos : [];
    if (!rows.length) {
      el.style.display = 'block';
      el.innerHTML = `<div style="font-size:13px;color:#64748b;">Nenhum modelo registrado em ${_esc(_fmtDiaCompleto(dia))}.</div>`;
      return;
    }
    const total = rows.reduce((s, r) => s + (Number(r.qtd) || 0), 0);
    el.style.display = 'block';
    el.innerHTML = `
      <h4 style="margin:0 0 8px;font-size:14px;">Modelos em ${_esc(_fmtDiaCompleto(dia))} · ${total} máquina(s)</h4>
      <div style="overflow:auto;"><table class="at-rel-ger-tbl">
        <thead><tr><th>Modelo</th><th class="r">Quantidade</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${_esc(r.modelo)}</td><td class="r">${r.qtd}</td></tr>`).join('')}
        </tbody>
      </table></div>`;
  }

  function _renderBarProducaoDia(canvasId, chartKey, detalheId, data) {
    const rows = data.producao_diaria || [];
    const labels = rows.map((r) => _fmtDiaLabel(r.data));
    const values = rows.map((r) => r.total || 0);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    _destroyChart(chartKey);
    _charts[chartKey] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: '#0ea5e9cc',
          borderColor: '#0ea5e9',
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        onHover: (evt, elements) => {
          if (evt?.native?.target) evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        },
        onClick: (_evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const row = rows[idx];
          if (!row) return;
          _mostrarModelosDia(detalheId, row.data, row.modelos);
        },
      },
    });
  }

  function _chartOptsBarH() {
    return {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true }, y: { ticks: { font: { size: 11 } } } },
    };
  }

  function _chartOptsBarV() {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    };
  }

  function _renderBar(canvasId, key, labels, values, cor, horizontal) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    _destroyChart(key);
    const useH = horizontal != null ? horizontal : labels.length > 5;
    _charts[key] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: `${cor || CORES[0]}cc`,
          borderColor: cor || CORES[0],
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: useH ? _chartOptsBarH() : _chartOptsBarV(),
    });
  }

  function _renderChartsSecao(sec, data) {
    if (_chartsRendered.has(sec)) return;
    const porPosto = data.por_posto || [];
    const faixas = data.faixas_posto || [];
    const k = data.kpis || {};

    if (sec === 'executivo') {
      _renderBar(
        'prodRelGerChartPostoExec', 'postoExec',
        porPosto.slice(0, 8).map((r) => r.posto),
        porPosto.slice(0, 8).map((r) => r.media_h_posto || 0),
        ACCENT2, true
      );
      _renderBar(
        'prodRelGerChartFaixasExec', 'faixasExec',
        faixas.map((r) => r.faixa),
        faixas.map((r) => r.total),
        '#38bdf8', false
      );
    }

    if (sec === 'maquinas') {
      const wrap = document.getElementById('prodRelGerProdKpis');
      if (wrap) {
        const diasComProd = (data.producao_diaria || []).filter((r) => (r.total || 0) > 0).length;
        wrap.innerHTML = [
          { label: 'Máquinas produzidas', value: k.maquinas_produzidas ?? 0, cor: '#0ea5e9' },
          { label: 'Dias com produção', value: diasComProd, cor: ACCENT },
          { label: 'Liberações (OPs)', value: (data.producao_liberacoes || []).length, cor: ACCENT2 },
        ].map((c) => `<div class="at-rel-ger-kpi" style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${c.value}</div></div>`).join('');
      }
      _renderBarProducaoDia('prodRelGerChartProdDia', 'prodDia', 'prodRelGerProdDiaDetalhe', data);
    }

    if (sec === 'postos') {
      const wrap = document.getElementById('prodRelGerPostoKpis');
      if (wrap) {
        wrap.innerHTML = [
          { label: 'Postos distintos', value: k.postos_distintos ?? 0, cor: ACCENT },
          { label: 'Média geral posto', value: _fmtDuracaoHoras(k.media_h_posto), cor: ACCENT2 },
          { label: 'Mediana posto', value: _fmtDuracaoHoras(k.mediana_h_posto), cor: '#0284c7' },
          { label: 'Ciclos fechados', value: k.ciclos_posto_fechados ?? 0, cor: '#64748b' },
        ].map((c) => `<div class="at-rel-ger-kpi" style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${c.value}</div></div>`).join('');
      }
      _renderBar(
        'prodRelGerChartPosto', 'posto',
        porPosto.map((r) => r.posto),
        porPosto.map((r) => r.media_h_posto || 0),
        ACCENT, true
      );
    }

    if (sec === 'ri') {
      const wrap = document.getElementById('prodRelGerRiKpis');
      if (wrap) {
        wrap.innerHTML = [
          { label: 'RIs concluídas', value: k.ciclos_ri_fechados ?? 0, cor: '#f59e0b' },
          { label: 'Média espera RI', value: _fmtDuracaoHoras(k.media_h_ri), cor: '#d97706' },
          { label: 'Mediana RI', value: _fmtDuracaoHoras(k.mediana_h_ri), cor: '#ea580c' },
          { label: 'Aguardando agora', value: k.aguardando_ri ?? 0, cor: '#dc2626' },
        ].map((c) => `<div class="at-rel-ger-kpi" style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${c.value}</div></div>`).join('');
      }
      _renderBar(
        'prodRelGerChartRi', 'ri',
        porPosto.map((r) => r.posto),
        porPosto.map((r) => r.media_h_ri || 0),
        '#f59e0b', true
      );
    }

    if (sec === 'evolucao') {
      const multi = data.evolucao_tipo === 'mes';
      const titulo = document.getElementById('prodRelGerEvolTitulo');
      if (titulo) titulo.textContent = multi ? 'Máquinas produzidas por mês' : 'Máquinas produzidas por semana';
      const rows = multi ? (data.evolucao_mensal || []) : (data.evolucao_semanal || []);
      const labels = multi ? rows.map((r) => r.label) : rows.map((r) => r.semana);
      _renderBar('prodRelGerChartEvol', 'evol', labels, rows.map((r) => r.total || 0), '#0ea5e9', false);
    }

    _chartsRendered.add(sec);
  }

  function _renderTabelas(data) {
    const postoBody = document.getElementById('prodRelGerPostoBody');
    if (postoBody) {
      const rows = data.por_posto || [];
      postoBody.innerHTML = rows.length
        ? rows.map((r) => `<tr>
            <td>${_esc(r.posto)}</td>
            <td class="r">${r.ciclos}</td>
            <td class="r">${r.ops}</td>
            <td class="r">${_esc(_fmtDuracaoHoras(r.media_h_posto))}</td>
            <td class="r">${_esc(_fmtDuracaoHoras(r.mediana_h_posto))}</td>
          </tr>`).join('')
        : '<tr><td colspan="5" style="text-align:center;color:#94a3b8;">Sem ciclos no período.</td></tr>';
    }

    const riBody = document.getElementById('prodRelGerRiBody');
    if (riBody) {
      const rows = data.detalhe_ri || [];
      riBody.innerHTML = rows.length
        ? rows.map((r) => `<tr>
            <td>${_esc(r.numero_op || '—')}</td>
            <td>${_esc(r.posto || '—')}</td>
            <td>${_esc(_fmtDataHora(r.inicio))}</td>
            <td>${_esc(_fmtDataHora(r.fim))}</td>
            <td class="r">${_esc(r.tempo_fmt || _fmtDuracaoHoras(r.h_util))}</td>
          </tr>`).join('')
        : '<tr><td colspan="5" style="text-align:center;color:#94a3b8;">Nenhuma RI concluída no período.</td></tr>';
    }

    const opsBody = document.getElementById('prodRelGerOpsBody');
    if (opsBody) {
      const rows = data.ciclos_por_op || [];
      opsBody.innerHTML = rows.length
        ? rows.map((r) => `<tr>
            <td>${_esc(r.numero_op || '—')}</td>
            <td>${_esc((r.postos || []).join(', ') || '—')}</td>
            <td class="r">${r.ciclos_posto || 0}</td>
            <td class="r">${_esc(r.tempo_posto_fmt || _fmtDuracaoHoras(r.h_posto))}</td>
            <td class="r">${_esc(r.tempo_ri_fmt || _fmtDuracaoHoras(r.h_ri))}</td>
            <td class="r">${_esc(r.tempo_trabalho_fmt || _fmtDuracaoHoras(r.h_trabalho))}</td>
            <td class="r">${_esc(r.tempo_ciclo_fmt || _fmtDuracaoHoras(r.h_ciclo))}</td>
          </tr>`).join('')
        : '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">Nenhuma OP com tempo no período.</td></tr>';
    }

    const detBody = document.getElementById('prodRelGerDetalheBody');
    if (detBody) {
      const rows = data.detalhe_postos || [];
      detBody.innerHTML = rows.length
        ? rows.map((r) => `<tr>
            <td>${_esc(r.numero_op || '—')}</td>
            <td>${_esc(r.posto || '—')}</td>
            <td>${_esc(_fmtDataHora(r.inicio))}</td>
            <td>${_esc(_fmtDataHora(r.fim))}</td>
            <td class="r">${_esc(r.tempo_fmt || _fmtDuracaoHoras(r.h_util))}</td>
            <td>${_esc(r.usuario_fim || '—')}</td>
          </tr>`).join('')
        : '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">Nenhum ciclo finalizado no período.</td></tr>';
    }

    const libBody = document.getElementById('prodRelGerProdLibBody');
    if (libBody) {
      const rows = data.producao_liberacoes || [];
      libBody.innerHTML = rows.length
        ? rows.map((r) => `<tr>
            <td>${_esc(_fmtDataHora(r.liberado_em))}</td>
            <td>${_esc(r.numero_op || '—')}</td>
            <td>${_esc(r.modelo || '—')}</td>
            <td class="r">${r.qtd || 1}</td>
          </tr>`).join('')
        : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Nenhuma máquina liberada na Inspeção final neste período.</td></tr>';
    }
  }

  function _renderPlanoTabela() {
    const body = document.getElementById('prodRelGerPlanoBody');
    if (!body || !_textos) return;
    const rows = _textos.plano_acao || [];
    body.innerHTML = rows.map((r, idx) => `
      <tr data-idx="${idx}">
        <td><input class="plano-acao" type="text" value="${_esc(r.acao || '')}"></td>
        <td><input class="plano-desc" type="text" value="${_esc(r.descricao || '')}"></td>
        <td><input class="plano-resp" type="text" value="${_esc(r.responsavel || '')}"></td>
        <td><input class="plano-prazo" type="text" value="${_esc(r.prazo || '')}"></td>
        <td><select class="plano-prio">
          <option value="alta"${r.prioridade === 'alta' ? ' selected' : ''}>ALTA</option>
          <option value="media"${!r.prioridade || r.prioridade === 'media' ? ' selected' : ''}>MÉDIA</option>
          <option value="baixa"${r.prioridade === 'baixa' ? ' selected' : ''}>BAIXA</option>
        </select></td>
        <td><button type="button" class="at-rel-ger-btn-icon plano-rem"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">Nenhuma ação.</td></tr>';
    body.querySelectorAll('.plano-rem').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.closest('tr')?.dataset.idx, 10);
        if (!Number.isNaN(idx)) {
          _textos.plano_acao.splice(idx, 1);
          _renderPlanoTabela();
        }
      });
    });
  }

  function _renderTextos() {
    if (!_textos) return;
    const r = document.getElementById('prodRelGerConcResumo');
    const c = document.getElementById('prodRelGerConcCriticos');
    const o = document.getElementById('prodRelGerConcOportunidades');
    if (r) r.value = _textos.conclusao_resumo || '';
    if (c) c.value = _textos.conclusao_pontos_criticos || '';
    if (o) o.value = _textos.conclusao_oportunidades || '';
    _renderPlanoTabela();
  }

  function _planoAdd() {
    if (!_textos) return;
    _textos.plano_acao.push({ acao: '', descricao: '', responsavel: '', prazo: '', prioridade: 'media' });
    _renderPlanoTabela();
  }

  function _coletarTextosForm() {
    const planoRows = [];
    document.querySelectorAll('#prodRelGerPlanoBody tr').forEach((tr) => {
      planoRows.push({
        acao: tr.querySelector('.plano-acao')?.value?.trim() || '',
        descricao: tr.querySelector('.plano-desc')?.value?.trim() || '',
        responsavel: tr.querySelector('.plano-resp')?.value?.trim() || '',
        prazo: tr.querySelector('.plano-prazo')?.value?.trim() || '',
        prioridade: tr.querySelector('.plano-prio')?.value || 'media',
      });
    });
    return {
      plano_acao: planoRows,
      conclusao_resumo: document.getElementById('prodRelGerConcResumo')?.value?.trim() || '',
      conclusao_pontos_criticos: document.getElementById('prodRelGerConcCriticos')?.value?.trim() || '',
      conclusao_oportunidades: document.getElementById('prodRelGerConcOportunidades')?.value?.trim() || '',
    };
  }

  async function _salvarTextos(origem) {
    const statusEl = document.getElementById(origem === 'plano' ? 'prodRelGerPlanoStatus' : 'prodRelGerConcStatus');
    if (!_data?.mes) return;
    const payload = { mes: _data.mes, ..._coletarTextosForm() };
    if (statusEl) statusEl.textContent = 'Salvando...';
    try {
      const resp = await fetch('/api/producao/relatorio-gerencial/textos', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json.ok === false) throw new Error(json.error || 'Erro ao salvar.');
      _textos = { ..._textos, ...json.textos };
      if (statusEl) statusEl.textContent = `Salvo em ${_fmtData(json.textos?.editado_em)}`;
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || 'Erro ao salvar.';
    }
  }

  async function _carregar() {
    const modo = document.getElementById('prodRelGerModo')?.value || 'mes';
    const statusEl = document.getElementById('prodRelGerStatus');
    const erroEl = document.getElementById('prodRelGerErro');
    const conteudoEl = document.getElementById('prodRelGerConteudo');

    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Carregando relatório...'; }
    if (erroEl) erroEl.style.display = 'none';
    if (conteudoEl) conteudoEl.style.display = 'none';

    try {
      const qs = new URLSearchParams({ modo });
      const resp = await fetch(`/api/producao/relatorio-gerencial?${qs}`, { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || 'Erro ao carregar relatório.');

      _destroyAllCharts();
      _data = data;
      _textos = _resolverTextos(data);
      _montarPaginas();
      _renderKpis(data.kpis || {});
      _renderTabelas(data);
      _renderTextos();
      _renderChartsSecao(_secao, data);

      if (statusEl) statusEl.style.display = 'none';
      if (conteudoEl) conteudoEl.style.display = 'block';
    } catch (err) {
      if (statusEl) statusEl.style.display = 'none';
      if (erroEl) { erroEl.style.display = 'block'; erroEl.textContent = err.message || 'Erro.'; }
    }
  }

  window._iniciarRelatorioGerencialProducao = function () {
    if (!_init) {
      _init = true;
      document.getElementById('prodRelGerModo')?.addEventListener('change', _carregar);
      document.getElementById('prodRelGerAtualizarBtn')?.addEventListener('click', _carregar);
      document.getElementById('prodRelGerPdfBtn')?.addEventListener('click', () => window.print());
    }
    _carregar();
  };
})();
