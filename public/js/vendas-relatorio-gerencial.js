// Relatório Gerencial Vendas — layout espelhado do Relatório AT
(function () {
  let _init = false;
  let _data = null;
  let _textos = null;
  let _secao = 'executivo';
  const _charts = {};
  const _chartsRendered = new Set();

  const CORES = ['#1e3a5f', '#38bdf8', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
  const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const QTD = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

  const SECOES = [
    { id: 'executivo', label: 'Dashboard Executivo', icon: 'fa-gauge-high', pg: 1 },
    { id: 'geografico', label: 'Distribuição Geográfica', icon: 'fa-map-location-dot', pg: 2 },
    { id: 'familias', label: 'Famílias de Produto', icon: 'fa-boxes-stacked', pg: 3 },
    { id: 'clientes', label: 'Clientes', icon: 'fa-users', pg: 4 },
    { id: 'evolucao', label: 'Evolução', icon: 'fa-chart-column', pg: 5 },
    { id: 'pareto', label: 'Pareto 80/20', icon: 'fa-chart-line', pg: 6 },
    { id: 'financeiro', label: 'Análise Financeira', icon: 'fa-coins', pg: 7 },
    { id: 'itens', label: 'Análise de Itens', icon: 'fa-layer-group', pg: 8 },
    { id: 'plano', label: 'Plano de Ação', icon: 'fa-list-check', pg: 9 },
    { id: 'conclusao', label: 'Conclusão Executiva', icon: 'fa-flag-checkered', pg: 10 },
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

  function _linhasParaLista(text) {
    return String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
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
    const kpis = data.kpis || {};
    const topFam = (data.por_familia || []).slice(0, 3);
    const topEst = (data.por_estado || []).slice(0, 3);
    const topCli = (data.por_cliente || []).slice(0, 3);
    const famTxt = topFam.map(r => `${r.familia} (${MOEDA.format(r.valor_total || 0)})`).join(', ') || '—';
    const estTxt = topEst.map(r => `${r.estado} (${MOEDA.format(r.valor_total || 0)})`).join(', ') || '—';
    const cliTxt = topCli.map(r => `${r.cliente} (${MOEDA.format(r.valor_total || 0)})`).join(', ') || '—';

    const plano_acao = topFam.slice(0, 3).map((r, i) => ({
      acao: `Ação ${i + 1}`,
      descricao: `Reforçar estratégia comercial para família "${r.familia}" (${MOEDA.format(r.valor_total || 0)})`,
      responsavel: '',
      prazo: '',
      prioridade: i === 0 ? 'alta' : (i === 1 ? 'media' : 'baixa'),
    }));
    if (!plano_acao.length) {
      plano_acao.push({ acao: '', descricao: '', responsavel: '', prazo: '', prioridade: 'media' });
    }

    return {
      plano_acao,
      conclusao_resumo: `No período ${data.periodo || ''} (${data.etapa || 'Entregues'}) foram registrados ${kpis.total_pedidos || 0} pedido(s), com faturamento de ${MOEDA.format(kpis.valor_total || 0)} e ticket médio de ${MOEDA.format(kpis.ticket_medio || 0)}.`,
      conclusao_pontos_criticos: [
        `Famílias com maior faturamento: ${famTxt}`,
        `Estados com maior volume: ${estTxt}`,
        `Principais clientes: ${cliTxt}`,
      ].join('\n'),
      conclusao_oportunidades: [
        'Expandir presença nos estados com maior potencial de crescimento',
        'Acompanhar mix de famílias no Pareto 80/20',
        'Revisar pedidos de alto valor na análise financeira',
      ].join('\n'),
    };
  }

  function _resolverTextos(data) {
    const padrao = _gerarTextosPadrao(data);
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
    return { ...padrao, editado_por: null, editado_em: null };
  }

  function _headerHtml(periodo, etapa) {
    const etapaTxt = etapa ? ` · ${_esc(etapa)}` : '';
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
            <div class="at-rel-ger-report-type">Relatório Gerencial de Vendas</div>
            <div class="at-rel-ger-periodo">${_esc(periodo)}${etapaTxt}</div>
          </div>
          <div class="at-rel-ger-meta">
            <div><span>Departamento:</span> Comercial / Vendas</div>
            <div><span>Data:</span> ${_esc(_fmtDataGeracao())}</div>
            <div><span>Versão:</span> 1.0</div>
          </div>
        </div>
        <div class="at-rel-ger-header-bar"></div>
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
    const nav = document.getElementById('vendRelGerNav');
    const pagesWrap = document.getElementById('vendRelGerPages');
    if (!nav || !pagesWrap) return;

    nav.innerHTML = `<div class="at-rel-ger-nav-title">Páginas do relatório</div>${SECOES.map(s => `
      <button type="button" class="at-rel-ger-nav-btn${s.id === _secao ? ' is-active' : ''}" data-sec="${s.id}">
        <span class="pg-num">${s.pg}</span>
        <i class="fa-solid ${s.icon}"></i>
        <span>${s.label}</span>
      </button>`).join('')}`;

    const periodo = _data?.periodo || '—';
    const etapa = _data?.etapa || '';
    const hdr = () => _headerHtml(periodo, etapa);

    pagesWrap.innerHTML = `
      <div class="at-rel-ger-page${_secao === 'executivo' ? ' is-active' : ''}" data-sec="executivo">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-gauge-high"></i> Dashboard Executivo</div>
        <div class="at-rel-ger-body">
          <div id="vendRelGerKpis" class="at-rel-ger-kpis"></div>
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Pedidos por Etapa</h4><div class="at-rel-ger-chart sm"><canvas id="vendRelGerChartEtapa"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Valor por Estado</h4><div class="at-rel-ger-chart sm"><canvas id="vendRelGerChartValorEstado"></canvas></div></div>
          </div>
        </div>
        ${_footerHtml(1)}
      </div>
      <div class="at-rel-ger-page${_secao === 'geografico' ? ' is-active' : ''}" data-sec="geografico">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-map-location-dot"></i> Distribuição Geográfica</div>
        <div class="at-rel-ger-body">
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Valor por Estado</h4><div class="at-rel-ger-chart"><canvas id="vendRelGerChartEstado"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Participação por Estado (%)</h4><div class="at-rel-ger-chart"><canvas id="vendRelGerChartEstadoDonut"></canvas></div></div>
          </div>
        </div>
        ${_footerHtml(2)}
      </div>
      <div class="at-rel-ger-page${_secao === 'familias' ? ' is-active' : ''}" data-sec="familias">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-boxes-stacked"></i> Famílias de Produto</div>
        <div class="at-rel-ger-body">
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Faturamento por Família</h4><div class="at-rel-ger-chart lg"><canvas id="vendRelGerChartFamilia"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Tabela — Família × Valor</h4>
              <div style="overflow:auto;max-height:300px;"><table class="at-rel-ger-tbl"><thead><tr><th>Família</th><th class="r">Qtd</th><th class="r">Valor</th></tr></thead><tbody id="vendRelGerFamiliaBody"></tbody></table></div>
            </div>
          </div>
        </div>
        ${_footerHtml(3)}
      </div>
      <div class="at-rel-ger-page${_secao === 'clientes' ? ' is-active' : ''}" data-sec="clientes">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-users"></i> Principais Clientes</div>
        <div class="at-rel-ger-body">
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Top Clientes por Valor</h4><div class="at-rel-ger-chart lg"><canvas id="vendRelGerChartCliente"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Tabela — Cliente × Valor</h4>
              <div style="overflow:auto;max-height:300px;"><table class="at-rel-ger-tbl"><thead><tr><th>Cliente</th><th class="r">Pedidos</th><th class="r">Valor</th></tr></thead><tbody id="vendRelGerClienteBody"></tbody></table></div>
            </div>
          </div>
        </div>
        ${_footerHtml(4)}
      </div>
      <div class="at-rel-ger-page${_secao === 'evolucao' ? ' is-active' : ''}" data-sec="evolucao">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-chart-column"></i> Evolução no Período</div>
        <div class="at-rel-ger-body">
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4 id="vendRelGerEvolTitulo">Evolução</h4><div class="at-rel-ger-chart lg"><canvas id="vendRelGerChartEvol"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Pedidos no Período</h4><div class="at-rel-ger-chart lg"><canvas id="vendRelGerChartEvolPedidos"></canvas></div></div>
          </div>
        </div>
        ${_footerHtml(5)}
      </div>
      <div class="at-rel-ger-page${_secao === 'pareto' ? ' is-active' : ''}" data-sec="pareto">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-chart-line"></i> Pareto 80/20 — Famílias</div>
        <div class="at-rel-ger-body">
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Pareto por Faturamento</h4><div class="at-rel-ger-chart lg"><canvas id="vendRelGerChartPareto"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Tabela Pareto</h4>
              <div style="overflow:auto;max-height:300px;"><table class="at-rel-ger-tbl"><thead><tr><th>Família</th><th class="r">Valor</th><th class="r">%</th><th class="r">% Acum.</th></tr></thead><tbody id="vendRelGerParetoBody"></tbody></table></div>
            </div>
          </div>
        </div>
        ${_footerHtml(6)}
      </div>
      <div class="at-rel-ger-page${_secao === 'financeiro' ? ' is-active' : ''}" data-sec="financeiro">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-coins"></i> Análise Financeira</div>
        <div class="at-rel-ger-body">
          <div class="at-rel-ger-card">
            <h4>Top Pedidos por Valor</h4>
            <div style="overflow:auto;max-height:360px;">
              <table class="at-rel-ger-tbl"><thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Data</th><th class="r">Valor</th></tr></thead><tbody id="vendRelGerFinanceiroBody"></tbody></table>
            </div>
          </div>
        </div>
        ${_footerHtml(7)}
      </div>
      <div class="at-rel-ger-page${_secao === 'itens' ? ' is-active' : ''}" data-sec="itens">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-layer-group"></i> Análise de Itens</div>
        <div class="at-rel-ger-body">
          <p id="vendRelGerItensInfo" style="font-size:12px;color:#64748b;margin:0 0 12px;"></p>
          <div class="at-rel-ger-card">
            <h4 id="vendRelGerItensChartTitle">Itens por mês de NF e família</h4>
            <div class="at-rel-ger-chart lg"><canvas id="vendRelGerChartItens"></canvas></div>
          </div>
          <div id="vendRelGerItensResumo" style="margin-top:12px;font-size:12px;color:#475569;"></div>
        </div>
        ${_footerHtml(8)}
      </div>
      <div class="at-rel-ger-page${_secao === 'plano' ? ' is-active' : ''}" data-sec="plano">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-list-check"></i> Plano de Ação</div>
        <div class="at-rel-ger-body">
          <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
            <button type="button" id="vendRelGerPlanoAdd" class="at-rel-ger-btn"><i class="fa-solid fa-plus"></i> Adicionar ação</button>
            <button type="button" id="vendRelGerPlanoSalvar" class="at-rel-ger-btn primary"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
            <span id="vendRelGerPlanoStatus" style="font-size:12px;color:#64748b;align-self:center;"></span>
          </div>
          <div style="overflow:auto;"><table class="at-rel-ger-tbl"><thead><tr><th>Ação</th><th>Descrição</th><th>Responsável</th><th>Prazo</th><th>Prioridade</th><th></th></tr></thead><tbody id="vendRelGerPlanoBody"></tbody></table></div>
        </div>
        ${_footerHtml(9)}
      </div>
      <div class="at-rel-ger-page${_secao === 'conclusao' ? ' is-active' : ''}" data-sec="conclusao">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-flag-checkered"></i> Conclusão Executiva</div>
        <div class="at-rel-ger-body">
          <div style="display:flex;gap:8px;margin-bottom:10px;"><button type="button" id="vendRelGerConcSalvar" class="at-rel-ger-btn primary"><i class="fa-solid fa-floppy-disk"></i> Salvar</button><span id="vendRelGerConcStatus" style="font-size:12px;color:#64748b;align-self:center;"></span></div>
          <label style="font-size:12px;font-weight:700;color:#1e3a5f;">Resumo executivo</label>
          <textarea id="vendRelGerConcResumo" rows="4" style="width:100%;margin:6px 0 12px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;"></textarea>
          <div class="at-rel-ger-grid-2">
            <div><label style="font-size:12px;font-weight:700;color:#1e3a5f;">Pontos críticos</label><textarea id="vendRelGerConcCriticos" rows="5" style="width:100%;margin-top:6px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;"></textarea></div>
            <div><label style="font-size:12px;font-weight:700;color:#1e3a5f;">Oportunidades</label><textarea id="vendRelGerConcOportunidades" rows="5" style="width:100%;margin-top:6px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;"></textarea></div>
          </div>
        </div>
        ${_footerHtml(10)}
      </div>`;

    nav.querySelectorAll('.at-rel-ger-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => _trocarSecao(btn.dataset.sec));
    });
    document.getElementById('vendRelGerPlanoAdd')?.addEventListener('click', _planoAdd);
    document.getElementById('vendRelGerPlanoSalvar')?.addEventListener('click', () => _salvarTextos('plano'));
    document.getElementById('vendRelGerConcSalvar')?.addEventListener('click', () => _salvarTextos('conclusao'));
  }

  function _trocarSecao(sec) {
    if (!sec) return;
    _secao = sec;
    document.querySelectorAll('#vendRelGerNav .at-rel-ger-nav-btn').forEach(b => b.classList.toggle('is-active', b.dataset.sec === sec));
    document.querySelectorAll('#vendRelGerPages .at-rel-ger-page').forEach(p => p.classList.toggle('is-active', p.dataset.sec === sec));
    if (_data && !_chartsRendered.has(sec)) _renderChartsSecao(sec, _data);
  }

  function _renderKpis(kpis) {
    const wrap = document.getElementById('vendRelGerKpis');
    if (!wrap) return;
    const cards = [
      { label: 'Pedidos', value: kpis.total_pedidos, cor: '#1e3a5f' },
      { label: 'Faturamento', value: MOEDA.format(kpis.valor_total || 0), cor: '#38bdf8' },
      { label: 'Ticket médio', value: MOEDA.format(kpis.ticket_medio || 0), cor: '#10b981' },
      { label: 'Clientes', value: kpis.clientes, cor: '#f59e0b' },
      { label: 'Estados', value: kpis.estados_atendidos, cor: '#8b5cf6' },
      { label: 'Qtd. itens', value: QTD.format(kpis.quantidade_itens || 0), cor: '#06b6d4' },
    ];
    wrap.innerHTML = cards.map(c => `<div class="at-rel-ger-kpi" style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${c.value}</div></div>`).join('');
  }

  function _chartOptsBarH() {
    return { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { color: '#64748b' }, grid: { color: '#e2e8f0' } }, y: { ticks: { color: '#334155', font: { size: 11 } }, grid: { display: false } } } };
  }

  function _chartOptsBarV() {
    return { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: '#334155' }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: '#64748b' }, grid: { color: '#e2e8f0' } } } };
  }

  function _renderBar(canvasId, key, labels, values, cor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    _destroyChart(key);
    _charts[key] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: `${cor || CORES[0]}cc`, borderColor: cor || CORES[0], borderWidth: 1, borderRadius: 4 }] },
      options: labels.length > 6 ? _chartOptsBarH() : _chartOptsBarV(),
    });
  }

  function _renderDonut(canvasId, key, labels, values) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    _destroyChart(key);
    _charts[key] = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: labels.map((_, i) => CORES[i % CORES.length]), borderColor: '#fff', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 10 } } } } },
    });
  }

  function _dadosParetoStacked(data) {
    const rows = data.familia_por_estado || [];
    const familias = [...new Set((data.pareto || []).slice(0, 8).map(r => r.familia))];
    const labels = familias;
    const estados = [...new Set(rows.map(r => r.estado))].slice(0, 8);
    const datasets = estados.map((estado, i) => ({
      label: estado,
      data: familias.map(f => {
        const row = rows.find(r => r.familia === f && r.estado === estado);
        return row?.valor_total || 0;
      }),
      backgroundColor: `${CORES[i % CORES.length]}cc`,
      borderColor: CORES[i % CORES.length],
      borderWidth: 1,
    }));
    return { labels, datasets };
  }

  function _buildItensStacked(rows) {
    const mesesOrd = [...new Set(rows.map(r => r.mes))].sort();
    const mesLabels = mesesOrd.map(m => rows.find(r => r.mes === m)?.label || m);
    const famTotals = {};
    rows.forEach(r => { famTotals[r.familia] = (famTotals[r.familia] || 0) + (r.quantidade || 0); });
    const topFam = Object.entries(famTotals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f]) => f);
    const datasets = topFam.map((familia, i) => ({
      label: familia,
      data: mesesOrd.map(m => rows.find(r => r.mes === m && r.familia === familia)?.quantidade || 0),
      backgroundColor: `${CORES[i % CORES.length]}cc`,
      borderColor: CORES[i % CORES.length],
      borderWidth: 1,
      borderRadius: 4,
    }));
    return { labels: mesLabels, datasets, mesesOrd, topFam };
  }

  function _renderChartsSecao(sec, data) {
    if (_chartsRendered.has(sec)) return;
    const est = (data.por_estado || []).slice(0, 12);
    const fam = (data.por_familia || []).slice(0, 10);
    const cli = (data.por_cliente || []).slice(0, 10);
    const etapas = data.por_etapa || [];

    if (sec === 'executivo') {
      _renderBar('vendRelGerChartEtapa', 'etapa', etapas.map(r => r.etapa_descricao), etapas.map(r => r.total), '#38bdf8');
      _renderBar('vendRelGerChartValorEstado', 'valorEstado', est.slice(0, 8).map(r => r.estado), est.slice(0, 8).map(r => r.valor_total), '#1e3a5f');
    }
    if (sec === 'geografico') {
      _renderBar('vendRelGerChartEstado', 'estado', est.map(r => r.estado), est.map(r => r.valor_total), '#1e3a5f');
      _renderDonut('vendRelGerChartEstadoDonut', 'estadoDonut', est.map(r => r.estado), est.map(r => r.valor_total));
    }
    if (sec === 'familias') {
      _renderBar('vendRelGerChartFamilia', 'familia', fam.map(r => r.familia), fam.map(r => r.valor_total), '#10b981');
    }
    if (sec === 'clientes') {
      _renderBar('vendRelGerChartCliente', 'cliente', cli.map(r => r.cliente), cli.map(r => r.valor_total), '#f59e0b');
    }
    if (sec === 'evolucao') {
      const multi = data.evolucao_tipo === 'mes';
      const titulo = document.getElementById('vendRelGerEvolTitulo');
      if (titulo) titulo.textContent = multi ? 'Faturamento mensal' : 'Faturamento semanal';
      const rows = multi ? (data.evolucao_mensal || []) : (data.evolucao_semanal || []);
      const labels = multi ? rows.map(r => r.label) : rows.map(r => r.semana);
      _renderBar('vendRelGerChartEvol', 'evol', labels, rows.map(r => r.valor_total), '#38bdf8');
      _renderBar('vendRelGerChartEvolPedidos', 'evolPed', labels, rows.map(r => r.total_pedidos), '#8b5cf6');
    }
    if (sec === 'pareto') {
      const pareto = data.pareto || [];
      const canvas = document.getElementById('vendRelGerChartPareto');
      if (canvas && typeof Chart !== 'undefined') {
        _destroyChart('pareto');
        const stacked = _dadosParetoStacked(data);
        _charts.pareto = new Chart(canvas.getContext('2d'), {
          type: 'bar',
          data: { labels: stacked.labels, datasets: stacked.datasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } },
            scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
          },
        });
      }
    }
    if (sec === 'itens') {
      const rows = data.analise_itens?.por_mes_familia || [];
      const stacked = _buildItensStacked(rows);
      const canvas = document.getElementById('vendRelGerChartItens');
      if (canvas && typeof Chart !== 'undefined') {
        _destroyChart('itens');
        _charts.itens = new Chart(canvas.getContext('2d'), {
          type: 'bar',
          data: { labels: stacked.labels, datasets: stacked.datasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } },
            scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } },
          },
        });
      }
      const janela = data.analise_itens?.janela || {};
      const info = document.getElementById('vendRelGerItensInfo');
      const resumo = document.getElementById('vendRelGerItensResumo');
      if (info) info.textContent = `Pedidos no período ${data.periodo || '—'} · ${janela.total_itens || 0} item(ns) com NF no gráfico por mês de emissão`;
      if (resumo) {
        const totalQtd = rows.reduce((s, r) => s + (r.quantidade || 0), 0);
        resumo.innerHTML = `<strong>${totalQtd}</strong> unidade(s) em <strong>${stacked.mesesOrd.length}</strong> mês(es) de NF e <strong>${stacked.topFam.length}</strong> família(s) no gráfico.`;
      }
    }
    _chartsRendered.add(sec);
  }

  function _renderTabelas(data) {
    const famBody = document.getElementById('vendRelGerFamiliaBody');
    if (famBody) {
      const rows = data.por_familia || [];
      famBody.innerHTML = rows.length
        ? rows.map(r => `<tr><td>${_esc(r.familia)}</td><td class="r">${QTD.format(r.quantidade || 0)}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`).join('')
        : '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">Nenhuma família no período.</td></tr>';
    }
    const cliBody = document.getElementById('vendRelGerClienteBody');
    if (cliBody) {
      const rows = data.por_cliente || [];
      cliBody.innerHTML = rows.length
        ? rows.map(r => `<tr><td>${_esc(r.cliente)}</td><td class="r">${r.total}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`).join('')
        : '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">Nenhum cliente no período.</td></tr>';
    }
    const parBody = document.getElementById('vendRelGerParetoBody');
    if (parBody) {
      const rows = data.pareto || [];
      parBody.innerHTML = rows.length
        ? rows.map(r => `<tr><td>${_esc(r.familia)}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td><td class="r">${r.pct}%</td><td class="r">${r.pct_acum}%</td></tr>`).join('')
        : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Sem dados.</td></tr>';
    }
    const finBody = document.getElementById('vendRelGerFinanceiroBody');
    if (finBody) {
      const rows = data.financeiro || [];
      finBody.innerHTML = rows.length
        ? rows.map(r => `<tr><td>${_esc(r.numero_pedido || r.codigo_pedido)}</td><td>${_esc(r.cliente)}</td><td>${_esc(r.estado)}</td><td>${_fmtData(r.data)}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`).join('')
        : '<tr><td colspan="5" style="text-align:center;color:#94a3b8;">Nenhum pedido no período.</td></tr>';
    }
  }

  function _renderPlanoTabela() {
    const body = document.getElementById('vendRelGerPlanoBody');
    if (!body || !_textos) return;
    const rows = _textos.plano_acao || [];
    body.innerHTML = rows.map((r, idx) => `
      <tr data-idx="${idx}">
        <td><input class="plano-acao" type="text" value="${_esc(r.acao || '')}"></td>
        <td><input class="plano-desc" type="text" value="${_esc(r.descricao || '')}"></td>
        <td><input class="plano-resp" type="text" value="${_esc(r.responsavel || '')}"></td>
        <td><input class="plano-prazo" type="text" value="${_esc(r.prazo || '')}"></td>
        <td><select class="plano-prio"><option value="alta"${r.prioridade === 'alta' ? ' selected' : ''}>ALTA</option><option value="media"${!r.prioridade || r.prioridade === 'media' ? ' selected' : ''}>MÉDIA</option><option value="baixa"${r.prioridade === 'baixa' ? ' selected' : ''}>BAIXA</option></select></td>
        <td><button type="button" class="at-rel-ger-btn-icon plano-rem"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">Nenhuma ação.</td></tr>';
    body.querySelectorAll('.plano-rem').forEach(btn => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const idx = parseInt(tr?.dataset.idx, 10);
        if (!Number.isNaN(idx)) {
          _textos.plano_acao.splice(idx, 1);
          _renderPlanoTabela();
        }
      });
    });
  }

  function _renderTextos() {
    if (!_textos) return;
    const r = document.getElementById('vendRelGerConcResumo');
    const c = document.getElementById('vendRelGerConcCriticos');
    const o = document.getElementById('vendRelGerConcOportunidades');
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
    document.querySelectorAll('#vendRelGerPlanoBody tr').forEach(tr => {
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
      conclusao_resumo: document.getElementById('vendRelGerConcResumo')?.value?.trim() || '',
      conclusao_pontos_criticos: document.getElementById('vendRelGerConcCriticos')?.value?.trim() || '',
      conclusao_oportunidades: document.getElementById('vendRelGerConcOportunidades')?.value?.trim() || '',
    };
  }

  async function _salvarTextos(origem) {
    const statusEl = document.getElementById(origem === 'plano' ? 'vendRelGerPlanoStatus' : 'vendRelGerConcStatus');
    if (!_data?.mes) return;
    const payload = { mes: _data.mes, ..._coletarTextosForm() };
    if (statusEl) statusEl.textContent = 'Salvando...';
    try {
      const resp = await fetch('/api/sac/vendas/relatorio-gerencial/textos', {
        method: 'PUT',
        credentials: 'include',
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
    const modo = document.getElementById('vendRelGerModo')?.value || 'mes';
    const etapa = document.getElementById('vendRelGerEtapa')?.value || 'entregue';
    const statusEl = document.getElementById('vendRelGerStatus');
    const erroEl = document.getElementById('vendRelGerErro');
    const conteudoEl = document.getElementById('vendRelGerConteudo');

    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Carregando relatório...'; }
    if (erroEl) erroEl.style.display = 'none';
    if (conteudoEl) conteudoEl.style.display = 'none';

    try {
      const qs = new URLSearchParams({ modo, etapa });
      const resp = await fetch(`/api/sac/vendas/relatorio-gerencial?${qs}`, { credentials: 'include' });
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

  window._iniciarRelatorioGerencialVendas = function () {
    if (!_init) {
      _init = true;
      document.getElementById('vendRelGerModo')?.addEventListener('change', _carregar);
      document.getElementById('vendRelGerEtapa')?.addEventListener('change', _carregar);
      document.getElementById('vendRelGerAtualizarBtn')?.addEventListener('click', _carregar);
      document.getElementById('vendRelGerPdfBtn')?.addEventListener('click', () => window.print());
    }
    _carregar();
  };
})();
