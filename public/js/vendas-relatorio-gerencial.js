// Relatório Gerencial Vendas — layout espelhado do Relatório AT
(function () {
  let _init = false;
  let _data = null;
  let _textos = null;
  let _carregarAbort = null;
  let _registrosAbort = null;
  let _registrosRows = [];
  let _familiasSelecionadas = new Set();
  let _familiasOpcoes = [];
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
    { id: 'vendedores', label: 'Vendedores', icon: 'fa-handshake', pg: 5 },
    { id: 'evolucao', label: 'Evolução', icon: 'fa-chart-column', pg: 6 },
    { id: 'pareto', label: 'Pareto 80/20', icon: 'fa-chart-line', pg: 7 },
    { id: 'financeiro', label: 'Análise Financeira', icon: 'fa-coins', pg: 8 },
    { id: 'itens', label: 'Análise de Itens', icon: 'fa-layer-group', pg: 9 },
    { id: 'plano', label: 'Plano de Ação', icon: 'fa-list-check', pg: 10 },
    { id: 'conclusao', label: 'Conclusão Executiva', icon: 'fa-flag-checkered', pg: 11 },
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
      <div class="at-rel-ger-page${_secao === 'vendedores' ? ' is-active' : ''}" data-sec="vendedores">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-handshake"></i> Vendedores</div>
        <div class="at-rel-ger-body">
          <div id="vendRelGerKpisVendedor" class="at-rel-ger-kpis"></div>
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Ranking por Faturamento</h4><div class="at-rel-ger-chart lg"><canvas id="vendRelGerChartVendedor"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Tabela — Vendedor × Valor</h4>
              <div style="overflow:auto;max-height:300px;"><table class="at-rel-ger-tbl"><thead><tr><th>Vendedor</th><th class="r">Pedidos</th><th class="r">Clientes</th><th class="r">Valor</th><th class="r">Ticket</th></tr></thead><tbody id="vendRelGerVendedorBody"></tbody></table></div>
            </div>
          </div>
        </div>
        ${_footerHtml(5)}
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
        ${_footerHtml(6)}
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
        ${_footerHtml(7)}
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
        ${_footerHtml(8)}
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
        ${_footerHtml(9)}
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
        ${_footerHtml(10)}
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
        ${_footerHtml(11)}
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
      { label: 'Pedidos', value: kpis.total_pedidos, cor: '#1e3a5f', kpi: 'pedidos' },
      { label: 'Faturamento', value: MOEDA.format(kpis.valor_total || 0), cor: '#38bdf8', kpi: 'faturamento' },
      { label: 'Ticket médio', value: MOEDA.format(kpis.ticket_medio || 0), cor: '#10b981' },
      { label: 'Clientes', value: kpis.clientes, cor: '#f59e0b' },
      { label: 'Estados', value: kpis.estados_atendidos, cor: '#8b5cf6' },
      { label: 'Qtd. itens', value: QTD.format(kpis.quantidade_itens || 0), cor: '#06b6d4' },
    ];
    wrap.innerHTML = cards.map(c => {
      const extra = c.kpi
        ? ` data-kpi="${c.kpi}" class="at-rel-ger-kpi is-clickable" title="Clique para ver a lista"`
        : ' class="at-rel-ger-kpi"';
      return `<div${extra} style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${c.value}</div></div>`;
    }).join('');
    wrap.querySelectorAll('[data-kpi]').forEach((el) => {
      el.addEventListener('click', () => _abrirModalRegistros(el.getAttribute('data-kpi')));
    });
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
    if (sec === 'vendedores') {
      const vend = (data.por_vendedor || []).slice(0, 12);
      _renderBar('vendRelGerChartVendedor', 'vendedor', vend.map(r => r.vendedor), vend.map(r => r.valor_total), '#6366f1');
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
    const vendBody = document.getElementById('vendRelGerVendedorBody');
    if (vendBody) {
      const rows = data.por_vendedor || [];
      vendBody.innerHTML = rows.length
        ? rows.map(r => `<tr><td>${_esc(r.vendedor)}</td><td class="r">${r.total_pedidos}</td><td class="r">${r.clientes}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td><td class="r">${MOEDA.format(r.ticket_medio || 0)}</td></tr>`).join('')
        : '<tr><td colspan="5" style="text-align:center;color:#94a3b8;">Nenhum vendedor no período.</td></tr>';
    }
    const vendKpis = document.getElementById('vendRelGerKpisVendedor');
    if (vendKpis) {
      const rows = data.por_vendedor || [];
      const totalV = rows.length;
      const fatV = rows.reduce((s, r) => s + (r.valor_total || 0), 0);
      const top = rows[0];
      const cards = [
        { label: 'Vendedores ativos', value: totalV, cor: '#6366f1' },
        { label: 'Faturamento (vendedores)', value: MOEDA.format(fatV), cor: '#38bdf8' },
        { label: 'Top vendedor', value: top ? _esc(top.vendedor) : '—', cor: '#10b981' },
        { label: 'Valor top', value: top ? MOEDA.format(top.valor_total || 0) : '—', cor: '#f59e0b' },
      ];
      vendKpis.innerHTML = cards.map(c => `<div class="at-rel-ger-kpi" style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${c.value}</div></div>`).join('');
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
    const statusEl = document.getElementById('vendRelGerStatus');
    const erroEl = document.getElementById('vendRelGerErro');
    const conteudoEl = document.getElementById('vendRelGerConteudo');
    const aplicarBtn = document.getElementById('vendRelGerAplicarBtn');

    if (_carregarAbort) _carregarAbort.abort();
    _carregarAbort = new AbortController();

    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Carregando relatório...'; }
    if (erroEl) erroEl.style.display = 'none';
    if (aplicarBtn) aplicarBtn.disabled = true;

    try {
      const qs = _filtrosQueryParams();
      const resp = await fetch(`/api/sac/vendas/relatorio-gerencial?${qs}`, {
        credentials: 'include',
        signal: _carregarAbort.signal,
      });
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
      if (err?.name === 'AbortError') return;
      if (statusEl) statusEl.style.display = 'none';
      if (erroEl) { erroEl.style.display = 'block'; erroEl.textContent = err.message || 'Erro.'; }
    } finally {
      if (aplicarBtn) aplicarBtn.disabled = false;
    }
  }

  function _preencherSelect(id, options, getVal, getLabel, todosLabel = 'Todos') {
    const el = document.getElementById(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = `<option value="">${todosLabel}</option>${(options || []).map((o) => {
      const v = getVal(o);
      return `<option value="${_esc(v)}">${_esc(getLabel(o))}</option>`;
    }).join('')}`;
    if (current && [...el.options].some((opt) => opt.value === current)) el.value = current;
  }

  function _pad2(n) { return String(n).padStart(2, '0'); }
  function _fmtYmd(d) {
    return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
  }
  function _setDatas(ini, fim) {
    const elI = document.getElementById('vendRelGerDataInicio');
    const elF = document.getElementById('vendRelGerDataFim');
    if (elI) elI.value = _fmtYmd(ini);
    if (elF) elF.value = _fmtYmd(fim);
  }
  function _aplicarMesAtualNasDatas() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    _setDatas(new Date(y, m, 1), new Date(y, m + 1, 0));
  }
  function _aplicarTrimestreNasDatas() {
    const tri = Number.parseInt(document.getElementById('vendRelGerTrimestre')?.value || '', 10);
    if (!Number.isFinite(tri) || tri < 1 || tri > 4) return;
    const ymd = document.getElementById('vendRelGerDataInicio')?.value || '';
    const y = Number.parseInt(ymd.slice(0, 4), 10) || new Date().getFullYear();
    const mesIni = (tri - 1) * 3;
    _setDatas(new Date(y, mesIni, 1), new Date(y, mesIni + 3, 0));
  }

  function _injetarEstilosFiltro() {
    if (document.getElementById('vendRelGerExtraCss')) return;
    const st = document.createElement('style');
    st.id = 'vendRelGerExtraCss';
    st.textContent = `
      .vend-rel-ger-modo-btn {
        padding: 6px 12px; border: none; background: transparent; color: #94a3b8;
        font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap;
      }
      .vend-rel-ger-modo-btn.is-active { background: #0ea5e9; color: #fff; }
      .vend-rel-ger-modo-btn:hover:not(.is-active) { background: rgba(255,255,255,.06); color: #e2e8f0; }
      #vendRelGerFiltroBtn.is-open {
        border-color: #0ea5e9 !important;
        background: rgba(14,165,233,.22) !important;
        color: #7dd3fc !important;
      }
      .at-rel-ger-kpi.is-clickable { cursor: pointer; transition: box-shadow .15s, transform .15s; }
      .at-rel-ger-kpi.is-clickable:hover { box-shadow: 0 4px 14px rgba(30,58,95,.18); transform: translateY(-1px); }
      #vendRelGerRegistrosModal .r { text-align: right; font-variant-numeric: tabular-nums; }
      #vendRelGerRegistrosModal tfoot td { font-weight: 800; background: #f1f5f9; }
      .vend-rel-ms { position: relative; min-width: 180px; max-width: 260px; }
      .vend-rel-ms-btn {
        width: 100%; padding: 5px 28px 5px 8px; border-radius: 8px; border: 1px solid #374151;
        background: #111827; color: #e5e7eb; font-size: 12px; text-align: left; cursor: pointer;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: relative;
      }
      .vend-rel-ms-btn::after {
        content: ''; position: absolute; right: 10px; top: 50%; width: 0; height: 0;
        border-left: 4px solid transparent; border-right: 4px solid transparent;
        border-top: 5px solid #94a3b8; transform: translateY(-40%);
      }
      .vend-rel-ms-btn.is-open { border-color: #0ea5e9; }
      .vend-rel-ms-panel {
        display: none; position: absolute; z-index: 80; top: calc(100% + 4px); left: 0;
        width: min(320px, 70vw); max-height: 280px; overflow: hidden;
        background: #0f172a; border: 1px solid #334155; border-radius: 10px;
        box-shadow: 0 12px 28px rgba(0,0,0,.35); flex-direction: column;
      }
      .vend-rel-ms-panel.is-open { display: flex; }
      .vend-rel-ms-panel input[type="search"] {
        margin: 8px; padding: 6px 8px; border-radius: 7px; border: 1px solid #334155;
        background: #111827; color: #e5e7eb; font-size: 12px; outline: none;
      }
      .vend-rel-ms-actions {
        display: flex; gap: 6px; padding: 0 8px 8px; flex-shrink: 0;
      }
      .vend-rel-ms-actions button {
        padding: 4px 8px; border-radius: 6px; border: 1px solid #334155;
        background: rgba(255,255,255,.04); color: #cbd5e1; font-size: 11px; cursor: pointer;
      }
      .vend-rel-ms-list { overflow: auto; padding: 0 6px 8px; flex: 1; min-height: 0; }
      .vend-rel-ms-item {
        display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px;
        border-radius: 7px; cursor: pointer; color: #e2e8f0; font-size: 12px; line-height: 1.3;
      }
      .vend-rel-ms-item:hover { background: rgba(56,189,248,.12); }
      .vend-rel-ms-item input {
        width: 14px !important; height: 14px !important; min-width: 14px !important;
        margin-top: 2px !important; flex: 0 0 14px !important; accent-color: #0ea5e9; cursor: pointer;
      }
    `;
    document.head.appendChild(st);
  }

  function _preencherAnos(anos) {
    const el = document.getElementById('vendRelGerAno');
    if (!el) return;
    const yNow = new Date().getFullYear();
    const set = new Set((anos || []).map(Number).filter((n) => Number.isFinite(n) && n >= 2000 && n <= 2100));
    set.add(yNow);
    const current = Number.parseInt(el.value, 10) || yNow;
    const list = [...set].sort((a, b) => b - a);
    el.innerHTML = list.map((y) => `<option value="${y}">${y}</option>`).join('');
    el.value = list.includes(current) ? String(current) : String(yNow);
  }

  function _atualizarLabelFamilia() {
    const btn = document.getElementById('vendRelGerFamiliaBtn');
    if (!btn) return;
    const n = _familiasSelecionadas.size;
    if (!n) {
      btn.textContent = 'Todos';
      btn.title = 'Todas as famílias';
      return;
    }
    const labels = _familiasOpcoes
      .filter((f) => _familiasSelecionadas.has(String(f.codigo)))
      .map((f) => f.descricao || f.codigo);
    const txt = n === 1 ? (labels[0] || '1 família') : `${n} famílias`;
    btn.textContent = txt;
    btn.title = labels.join(', ') || txt;
  }

  function _fecharFamiliaMs() {
    document.getElementById('vendRelGerFamiliaPanel')?.classList.remove('is-open');
    document.getElementById('vendRelGerFamiliaBtn')?.classList.remove('is-open');
  }

  function _toggleFamiliaMs(force) {
    const panel = document.getElementById('vendRelGerFamiliaPanel');
    const btn = document.getElementById('vendRelGerFamiliaBtn');
    if (!panel || !btn) return;
    const open = force === true ? true : (force === false ? false : !panel.classList.contains('is-open'));
    panel.classList.toggle('is-open', open);
    btn.classList.toggle('is-open', open);
  }

  function _renderFamiliaLista(filtro = '') {
    const list = document.getElementById('vendRelGerFamiliaLista');
    if (!list) return;
    const q = String(filtro || '').trim().toLowerCase();
    const rows = (_familiasOpcoes || []).filter((f) => {
      if (!q) return true;
      const blob = `${f.codigo || ''} ${f.descricao || ''}`.toLowerCase();
      return blob.includes(q);
    });
    if (!rows.length) {
      list.innerHTML = '<div style="padding:10px;color:#64748b;font-size:12px;">Nenhuma família.</div>';
      return;
    }
    list.innerHTML = rows.map((f) => {
      const cod = String(f.codigo ?? '');
      const id = `vendFamChk_${_esc(cod).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const checked = _familiasSelecionadas.has(cod) ? 'checked' : '';
      return `<label class="vend-rel-ms-item" for="${id}">
        <input type="checkbox" id="${id}" data-familia="${_esc(cod)}" ${checked}>
        <span>${_esc(f.descricao || f.codigo || '—')}</span>
      </label>`;
    }).join('');
    list.querySelectorAll('input[type="checkbox"][data-familia]').forEach((chk) => {
      chk.addEventListener('change', () => {
        const cod = chk.getAttribute('data-familia') || '';
        if (chk.checked) _familiasSelecionadas.add(cod);
        else _familiasSelecionadas.delete(cod);
        _atualizarLabelFamilia();
      });
    });
  }

  function _preencherFamiliaMulti(familias) {
    _familiasOpcoes = (familias || []).map((f) => ({
      codigo: String(f.codigo ?? ''),
      descricao: String(f.descricao || f.codigo || ''),
    })).filter((f) => f.codigo);
    // Mantém só códigos ainda existentes
    _familiasSelecionadas = new Set([..._familiasSelecionadas].filter((c) => _familiasOpcoes.some((f) => f.codigo === c)));
    _renderFamiliaLista(document.getElementById('vendRelGerFamiliaBusca')?.value || '');
    _atualizarLabelFamilia();
  }

  function _injetarFamiliaMulti() {
    if (document.getElementById('vendRelGerFamiliaMs')) return;
    const sel = document.getElementById('vendRelGerFamilia');
    if (!sel?.parentElement) return;
    const wrap = sel.parentElement;
    sel.style.display = 'none';
    sel.setAttribute('aria-hidden', 'true');
    const ms = document.createElement('div');
    ms.id = 'vendRelGerFamiliaMs';
    ms.className = 'vend-rel-ms';
    ms.innerHTML = `
      <button type="button" id="vendRelGerFamiliaBtn" class="vend-rel-ms-btn" title="Todas as famílias">Todos</button>
      <div id="vendRelGerFamiliaPanel" class="vend-rel-ms-panel" role="listbox" aria-multiselectable="true">
        <input id="vendRelGerFamiliaBusca" type="search" placeholder="Buscar família..." autocomplete="off">
        <div class="vend-rel-ms-actions">
          <button type="button" id="vendRelGerFamiliaSelTudo">Selecionar tudo</button>
          <button type="button" id="vendRelGerFamiliaLimpar">Limpar</button>
        </div>
        <div id="vendRelGerFamiliaLista" class="vend-rel-ms-list"></div>
      </div>`;
    wrap.appendChild(ms);

    document.getElementById('vendRelGerFamiliaBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleFamiliaMs();
    });
    document.getElementById('vendRelGerFamiliaPanel')?.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('vendRelGerFamiliaBusca')?.addEventListener('input', (e) => {
      _renderFamiliaLista(e.target.value);
    });
    document.getElementById('vendRelGerFamiliaSelTudo')?.addEventListener('click', () => {
      _familiasOpcoes.forEach((f) => _familiasSelecionadas.add(f.codigo));
      _renderFamiliaLista(document.getElementById('vendRelGerFamiliaBusca')?.value || '');
      _atualizarLabelFamilia();
    });
    document.getElementById('vendRelGerFamiliaLimpar')?.addEventListener('click', () => {
      _familiasSelecionadas.clear();
      _renderFamiliaLista(document.getElementById('vendRelGerFamiliaBusca')?.value || '');
      _atualizarLabelFamilia();
    });
    document.addEventListener('click', () => _fecharFamiliaMs());
  }

    function _trimestreAtual() {
    return Math.floor(new Date().getMonth() / 3) + 1;
  }

  function _injetarBotaoFiltro() {
    if (document.getElementById('vendRelGerFiltroBtn')) return;
    const cfg = document.getElementById('vendRelGerConfigBtn');
    if (!cfg?.parentElement) return;
    const btn = document.createElement('button');
    btn.id = 'vendRelGerFiltroBtn';
    btn.type = 'button';
    btn.title = 'Mostrar / ocultar filtros';
    btn.style.cssText = 'padding:6px 14px;border-radius:8px;border:1px solid #64748b;background:rgba(100,116,139,.15);color:#cbd5e1;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;';
    btn.innerHTML = '<i class="fa-solid fa-filter"></i> Filtro';
    cfg.parentElement.insertBefore(btn, cfg);
  }

  function _barraFiltrosEl() {
    return document.getElementById('vendRelGerFiltrosBar');
  }

  function _setBarraFiltrosVisivel(visivel) {
    const bar = _barraFiltrosEl();
    const btn = document.getElementById('vendRelGerFiltroBtn');
    if (bar) bar.style.display = visivel ? 'flex' : 'none';
    btn?.classList.toggle('is-open', !!visivel);
  }

  function _toggleBarraFiltros() {
    const bar = _barraFiltrosEl();
    const aberto = bar && bar.style.display !== 'none';
    _setBarraFiltrosVisivel(!aberto);
  }

  function _injetarUiFiltro() {
    if (document.getElementById('vendRelGerModoToggle')) return;
    const di = document.getElementById('vendRelGerDataInicio');
    const df = document.getElementById('vendRelGerDataFim');
    const tri = document.getElementById('vendRelGerTrimestre');
    if (!di || !df || !tri) return;
    const wrapDi = di.parentElement;
    const wrapDf = df.parentElement;
    const wrapTriOrig = tri.parentElement;
    const bar = wrapDi?.parentElement;
    if (!wrapDi || !wrapDf || !wrapTriOrig || !bar) return;

    bar.id = 'vendRelGerFiltrosBar';
    bar.style.display = 'none';

    _injetarBotaoFiltro();

    const toggle = document.createElement('div');
    toggle.id = 'vendRelGerModoToggle';
    toggle.style.cssText = 'display:flex;align-items:stretch;border-radius:8px;border:1px solid #374151;overflow:hidden;flex-shrink:0;';
    toggle.innerHTML = `
      <button type="button" id="vendRelGerModoMesAno" class="vend-rel-ger-modo-btn is-active" title="Filtrar por mês e ano">Mês e ano</button>
      <button type="button" id="vendRelGerModoTrimestre" class="vend-rel-ger-modo-btn" title="Filtrar por trimestre e ano">Trimestre</button>
      <button type="button" id="vendRelGerModoPeriodo" class="vend-rel-ger-modo-btn" title="Filtrar por data início e data fim">Período</button>`;
    bar.insertBefore(toggle, wrapDi);

    const wrapMes = document.createElement('div');
    wrapMes.id = 'vendRelGerWrapMes';
    wrapMes.style.cssText = 'display:flex;align-items:center;gap:6px;';
    wrapMes.innerHTML = `
      <label for="vendRelGerMes" style="font-size:11px;font-weight:600;color:#94a3b8;">Mês</label>
      <select id="vendRelGerMes" style="padding:5px 8px;border-radius:8px;border:1px solid #374151;background:#111827;color:#e5e7eb;font-size:12px;min-width:120px;">
        <option value="1">Janeiro</option><option value="2">Fevereiro</option><option value="3">Março</option>
        <option value="4">Abril</option><option value="5">Maio</option><option value="6">Junho</option>
        <option value="7">Julho</option><option value="8">Agosto</option><option value="9">Setembro</option>
        <option value="10">Outubro</option><option value="11">Novembro</option><option value="12">Dezembro</option>
      </select>`;
    bar.insertBefore(wrapMes, wrapDi);

    const wrapAno = document.createElement('div');
    wrapAno.id = 'vendRelGerWrapAno';
    wrapAno.style.cssText = 'display:flex;align-items:center;gap:6px;';
    wrapAno.innerHTML = `
      <label for="vendRelGerAno" style="font-size:11px;font-weight:600;color:#94a3b8;">Ano</label>
      <select id="vendRelGerAno" style="padding:5px 8px;border-radius:8px;border:1px solid #374151;background:#111827;color:#e5e7eb;font-size:12px;min-width:88px;"></select>`;
    bar.insertBefore(wrapAno, wrapDi);

    const wrapTri = document.createElement('div');
    wrapTri.id = 'vendRelGerWrapTrimestre';
    wrapTri.style.cssText = 'display:none;align-items:center;gap:6px;';
    bar.insertBefore(wrapTri, wrapDi);
    wrapTri.appendChild(wrapTriOrig);
    // No modo Trimestre o filtro é obrigatório (sem "Todos")
    const optTodos = [...tri.options].find((o) => o.value === '');
    if (optTodos) optTodos.remove();
    if (!tri.value) tri.value = String(_trimestreAtual());

    const wrapPer = document.createElement('div');
    wrapPer.id = 'vendRelGerWrapPeriodo';
    wrapPer.style.cssText = 'display:none;align-items:center;gap:8px;flex-wrap:wrap;';
    bar.insertBefore(wrapPer, wrapDi);
    wrapPer.appendChild(wrapDi);
    wrapPer.appendChild(wrapDf);

    const now = new Date();
    const mesEl = document.getElementById('vendRelGerMes');
    if (mesEl) mesEl.value = String(now.getMonth() + 1);
    _preencherAnos([now.getFullYear()]);
  }

  function _injetarModalRegistros() {
    if (document.getElementById('vendRelGerRegistrosModal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="vendRelGerRegistrosModal" class="at-rel-ger-lote-modal" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="vendRelGerRegistrosTitulo">
        <div class="at-rel-ger-lote-modal-card">
          <div class="at-rel-ger-lote-modal-head">
            <div>
              <div class="at-rel-ger-lote-modal-kicker" style="color:#0284c7;">Relatório Gerencial — Vendas</div>
              <h3 id="vendRelGerRegistrosTitulo">Pedidos</h3>
              <div id="vendRelGerRegistrosSub" class="at-rel-ger-lote-modal-sub"></div>
            </div>
            <button type="button" id="vendRelGerRegistrosFechar" class="at-rel-ger-lote-modal-close" title="Fechar" aria-label="Fechar">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div id="vendRelGerRegistrosStatus" class="at-rel-ger-lote-modal-status">Carregando...</div>
          <div class="at-rel-ger-lote-modal-toolbar">
            <input id="vendRelGerRegistrosBusca" type="search" placeholder="Pesquisar pedido, cliente, estado ou vendedor..." autocomplete="off">
            <span id="vendRelGerRegistrosQtd" class="at-rel-ger-lote-modal-qtd"></span>
          </div>
          <div class="at-rel-ger-lote-modal-body">
            <table class="at-rel-ger-lote-modal-tbl">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Estado</th>
                  <th>Data</th>
                  <th>Vendedor</th>
                  <th>Etapa</th>
                  <th class="r">Valor</th>
                </tr>
              </thead>
              <tbody id="vendRelGerRegistrosBody"></tbody>
              <tfoot id="vendRelGerRegistrosFoot"></tfoot>
            </table>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
  }

  function _modoAtual() {
    if (document.getElementById('vendRelGerModoPeriodo')?.classList.contains('is-active')) return 'periodo';
    if (document.getElementById('vendRelGerModoTrimestre')?.classList.contains('is-active')) return 'trimestre';
    return 'mes_ano';
  }

  function _setModoFiltro(modo) {
    const isMes = modo === 'mes_ano';
    const isTri = modo === 'trimestre';
    const isPeriodo = modo === 'periodo';
    document.getElementById('vendRelGerModoMesAno')?.classList.toggle('is-active', isMes);
    document.getElementById('vendRelGerModoTrimestre')?.classList.toggle('is-active', isTri);
    document.getElementById('vendRelGerModoPeriodo')?.classList.toggle('is-active', isPeriodo);

    const wrapMes = document.getElementById('vendRelGerWrapMes');
    const wrapAno = document.getElementById('vendRelGerWrapAno');
    const wrapTri = document.getElementById('vendRelGerWrapTrimestre');
    const wrapPer = document.getElementById('vendRelGerWrapPeriodo');
    // Compat com versão anterior (wrap único Mês+Ano)
    const wrapMesAnoLegado = document.getElementById('vendRelGerWrapMesAno');

    if (wrapMes) wrapMes.style.display = isMes ? 'flex' : 'none';
    if (wrapAno) wrapAno.style.display = (isMes || isTri) ? 'flex' : 'none';
    if (wrapTri) wrapTri.style.display = isTri ? 'flex' : 'none';
    if (wrapPer) wrapPer.style.display = isPeriodo ? 'flex' : 'none';
    if (wrapMesAnoLegado) wrapMesAnoLegado.style.display = isMes ? 'flex' : 'none';

    if (isTri) {
      const triEl = document.getElementById('vendRelGerTrimestre');
      if (triEl && !triEl.value) triEl.value = String(_trimestreAtual());
    }

    if (isPeriodo) {
      const di = document.getElementById('vendRelGerDataInicio');
      const df = document.getElementById('vendRelGerDataFim');
      if (!di?.value || !df?.value) {
        const ano = Number.parseInt(document.getElementById('vendRelGerAno')?.value, 10) || new Date().getFullYear();
        const mes = Number.parseInt(document.getElementById('vendRelGerMes')?.value, 10) || (new Date().getMonth() + 1);
        _setDatas(new Date(ano, mes - 1, 1), new Date(ano, mes, 0));
      }
    }

    if (isMes || isTri) {
      const di = document.getElementById('vendRelGerDataInicio')?.value || '';
      const y = Number.parseInt(di.slice(0, 4), 10);
      const m = Number.parseInt(di.slice(5, 7), 10);
      const mesEl = document.getElementById('vendRelGerMes');
      const anoEl = document.getElementById('vendRelGerAno');
      if (isMes && mesEl && m >= 1 && m <= 12) mesEl.value = String(m);
      if (anoEl && y >= 2000) {
        if (![...anoEl.options].some((o) => o.value === String(y))) {
          const opt = document.createElement('option');
          opt.value = String(y);
          opt.textContent = String(y);
          anoEl.appendChild(opt);
        }
        if (![...anoEl.options].some((o) => o.value === anoEl.value)) {
          anoEl.value = String(y);
        }
      }
    }
  }

  function _filtrarRegistrosVisiveis() {
    const q = (document.getElementById('vendRelGerRegistrosBusca')?.value || '').trim().toLowerCase();
    if (!q) return _registrosRows;
    return _registrosRows.filter((r) => {
      const blob = `${r.numero_pedido || ''} ${r.cliente || ''} ${r.estado || ''} ${r.vendedor || ''} ${r.etapa || ''}`.toLowerCase();
      return blob.includes(q);
    });
  }

  function _renderTabelaRegistros() {
    const body = document.getElementById('vendRelGerRegistrosBody');
    const foot = document.getElementById('vendRelGerRegistrosFoot');
    const qtdEl = document.getElementById('vendRelGerRegistrosQtd');
    if (!body) return;
    const rows = _filtrarRegistrosVisiveis();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">Nenhum registro neste filtro.</td></tr>';
      if (foot) foot.innerHTML = '';
      if (qtdEl) qtdEl.textContent = _registrosRows.length ? `0 de ${_registrosRows.length}` : '0 registro(s)';
      return;
    }
    body.innerHTML = rows.map((r) => `
      <tr>
        <td class="os-id">${_esc(r.numero_pedido || r.codigo_pedido || '—')}</td>
        <td>${_esc(r.cliente || '—')}</td>
        <td>${_esc(r.estado || '—')}</td>
        <td>${_esc(_fmtData(r.data))}</td>
        <td>${_esc(r.vendedor || '—')}</td>
        <td>${_esc(r.etapa || '—')}</td>
        <td class="r">${MOEDA.format(r.valor_total || 0)}</td>
      </tr>`).join('');
    const soma = rows.reduce((s, r) => s + (Number(r.valor_total) || 0), 0);
    if (foot) {
      foot.innerHTML = `<tr><td colspan="6">Total (${rows.length})</td><td class="r">${MOEDA.format(soma)}</td></tr>`;
    }
    if (qtdEl) {
      qtdEl.textContent = rows.length === _registrosRows.length
        ? `${rows.length} registro(s)`
        : `${rows.length} de ${_registrosRows.length}`;
    }
  }

  function _fecharModalRegistros() {
    const modal = document.getElementById('vendRelGerRegistrosModal');
    if (modal) modal.style.display = 'none';
    if (_registrosAbort) _registrosAbort.abort();
  }

  async function _abrirModalRegistros(tipo) {
    _injetarModalRegistros();
    const modal = document.getElementById('vendRelGerRegistrosModal');
    const titulo = document.getElementById('vendRelGerRegistrosTitulo');
    const sub = document.getElementById('vendRelGerRegistrosSub');
    const statusEl = document.getElementById('vendRelGerRegistrosStatus');
    const busca = document.getElementById('vendRelGerRegistrosBusca');
    if (!modal) return;
    const isFat = tipo === 'faturamento';
    if (titulo) titulo.textContent = isFat ? 'Faturamento' : 'Pedidos';
    if (sub) sub.textContent = _data?.periodo ? `Período: ${_data.periodo}` : 'Carregando...';
    if (busca) busca.value = '';
    _registrosRows = [];
    _renderTabelaRegistros();
    modal.style.display = 'flex';
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Carregando registros...'; }

    if (_registrosAbort) _registrosAbort.abort();
    _registrosAbort = new AbortController();
    try {
      const qs = _filtrosQueryParams();
      const resp = await fetch(`/api/sac/vendas/relatorio-gerencial/registros?${qs}`, {
        credentials: 'include',
        signal: _registrosAbort.signal,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || 'Erro ao carregar registros.');
      _registrosRows = data.registros || [];
      if (sub) {
        const extra = data.truncated ? ' · lista limitada aos 5.000 primeiros' : '';
        sub.textContent = `${data.periodo || _data?.periodo || '—'} · ${data.total_pedidos || 0} pedido(s) · ${MOEDA.format(data.valor_total || 0)}${extra}`;
      }
      _renderTabelaRegistros();
      if (statusEl) statusEl.style.display = 'none';
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = err.message || 'Erro.'; }
    }
  }

  function _filtrosQueryParams() {
    const qs = new URLSearchParams();
    qs.set('modo', 'mes');
    qs.set('etapa', 'entregue');
    const modo = _modoAtual();
    if (modo === 'periodo') {
      const di = document.getElementById('vendRelGerDataInicio')?.value?.trim();
      const df = document.getElementById('vendRelGerDataFim')?.value?.trim();
      if (di) qs.set('data_inicio', di);
      if (df) qs.set('data_fim', df);
    } else if (modo === 'trimestre') {
      const ano = document.getElementById('vendRelGerAno')?.value?.trim();
      const tri = document.getElementById('vendRelGerTrimestre')?.value?.trim() || String(_trimestreAtual());
      if (ano) qs.set('ano', ano);
      if (tri) qs.set('trimestre', tri);
    } else {
      const ano = document.getElementById('vendRelGerAno')?.value?.trim();
      const mes = document.getElementById('vendRelGerMes')?.value?.trim();
      if (ano) qs.set('ano', ano);
      if (mes) qs.set('mes', mes);
    }
    [
      ['vendRelGerVendedor', 'vendedor'],
      ['vendRelGerEstado', 'estado'],
      ['vendRelGerTipo', 'tipo'],
    ].forEach(([id, key]) => {
      const v = document.getElementById(id)?.value?.trim();
      if (v) qs.set(key, v);
    });
    if (_familiasSelecionadas.size) {
      qs.set('familia', [..._familiasSelecionadas].join(','));
    }
    return qs;
  }

  async function _carregarFiltrosOpcoes() {
    try {
      const resp = await fetch('/api/sac/vendas/relatorio-gerencial/filtros-opcoes', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) return;
      _preencherSelect('vendRelGerVendedor', data.vendedores || [], (v) => v.codigo, (v) => v.nome);
      _preencherFamiliaMulti(data.familias || []);
      _preencherSelect('vendRelGerEstado', data.estados || [], (e) => e, (e) => e);
      _preencherSelect('vendRelGerTipo', data.tipos || [], (t) => t.codigo, (t) => t.label);
      _preencherAnos(data.anos || []);
    } catch (_) { /* silencioso */ }
  }

  function _abrirModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
  }

  function _fecharModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function _atualizarContagemCfop() {
    const boxes = [...document.querySelectorAll('#vendRelGerCfopLista input[type="checkbox"][data-cfop]')];
    const marcados = boxes.filter((b) => b.checked).length;
    const el = document.getElementById('vendRelGerCfopContagem');
    if (el) el.textContent = `${marcados} de ${boxes.length} incluídos`;
  }

  function _renderListaCfop(cfops) {
    const wrap = document.getElementById('vendRelGerCfopLista');
    if (!wrap) return;
    if (!Array.isArray(cfops) || !cfops.length) {
      wrap.innerHTML = '<div style="color:#64748b;font-size:13px;">Nenhum CFOP encontrado nos pedidos.</div>';
      _atualizarContagemCfop();
      return;
    }
    wrap.innerHTML = cfops.map((c) => {
      const id = `vendCfopChk_${_esc(c.cfop)}`;
      const desc = c.descricao ? ` — ${_esc(c.descricao)}` : '';
      return `<label for="${id}" style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid #1e293b;margin-bottom:6px;cursor:pointer;background:rgba(255,255,255,.02);">
        <input type="checkbox" id="${id}" data-cfop="${_esc(c.cfop)}" class="vend-rel-cfop-chk" ${c.incluido !== false ? 'checked' : ''}>
        <span style="font-size:13px;color:#e2e8f0;line-height:1.35;">
          <strong style="font-variant-numeric:tabular-nums;">${_esc(c.cfop_exibicao || c.cfop)}</strong>
          <span style="color:#64748b;">${desc}</span>
        </span>
      </label>`;
    }).join('');
    wrap.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
      chk.addEventListener('change', _atualizarContagemCfop);
    });
    _atualizarContagemCfop();
  }

  async function _abrirConfigCfop() {
    _fecharModal('vendRelGerConfigModal');
    _abrirModal('vendRelGerCfopModal');
    const wrap = document.getElementById('vendRelGerCfopLista');
    const statusEl = document.getElementById('vendRelGerCfopStatus');
    if (wrap) wrap.innerHTML = '<div style="color:#64748b;font-size:13px;">Carregando CFOPs...</div>';
    if (statusEl) statusEl.textContent = '';
    try {
      const resp = await fetch('/api/sac/vendas/relatorio-gerencial/config/cfop', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || 'Erro ao carregar CFOPs.');
      _renderListaCfop(data.cfops || []);
    } catch (err) {
      if (wrap) wrap.innerHTML = `<div style="color:#f87171;font-size:13px;">${_esc(err.message || 'Erro')}</div>`;
    }
  }

  async function _salvarConfigCfop() {
    const statusEl = document.getElementById('vendRelGerCfopStatus');
    const boxes = [...document.querySelectorAll('#vendRelGerCfopLista input[type="checkbox"][data-cfop]')];
    const cfops = boxes.map((b) => ({
      cfop: b.getAttribute('data-cfop'),
      incluido: !!b.checked,
    }));
    if (statusEl) statusEl.textContent = 'Salvando...';
    try {
      const resp = await fetch('/api/sac/vendas/relatorio-gerencial/config/cfop', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cfops }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || 'Erro ao salvar.');
      if (statusEl) statusEl.textContent = 'Padrão salvo para todos.';
      _fecharModal('vendRelGerCfopModal');
      await _carregar();
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || 'Erro ao salvar.';
    }
  }

  function _atualizarContagemStatus() {
    const boxes = [...document.querySelectorAll('#vendRelGerStatusLista input[type="checkbox"][data-status]')];
    const marcados = boxes.filter((b) => b.checked).length;
    const el = document.getElementById('vendRelGerStatusContagem');
    if (el) el.textContent = `${marcados} de ${boxes.length} incluídos`;
  }

  function _renderListaStatus(statusList) {
    const wrap = document.getElementById('vendRelGerStatusLista');
    if (!wrap) return;
    if (!Array.isArray(statusList) || !statusList.length) {
      wrap.innerHTML = '<div style="color:#64748b;font-size:13px;">Nenhum status encontrado nas notas.</div>';
      _atualizarContagemStatus();
      return;
    }
    wrap.innerHTML = statusList.map((s) => {
      const id = `vendStatusChk_${_esc(s.status)}`;
      return `<label for="${id}" style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid #1e293b;margin-bottom:6px;cursor:pointer;background:rgba(255,255,255,.02);">
        <input type="checkbox" id="${id}" data-status="${_esc(s.status)}" class="vend-rel-status-chk" ${s.incluido !== false ? 'checked' : ''}>
        <span style="font-size:13px;color:#e2e8f0;line-height:1.35;"><strong>${_esc(s.status)}</strong></span>
      </label>`;
    }).join('');
    wrap.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
      chk.addEventListener('change', _atualizarContagemStatus);
    });
    _atualizarContagemStatus();
  }

  async function _abrirConfigStatus() {
    _fecharModal('vendRelGerConfigModal');
    _abrirModal('vendRelGerStatusModal');
    const wrap = document.getElementById('vendRelGerStatusLista');
    const statusEl = document.getElementById('vendRelGerStatusSaveStatus');
    if (wrap) wrap.innerHTML = '<div style="color:#64748b;font-size:13px;">Carregando status...</div>';
    if (statusEl) statusEl.textContent = '';
    try {
      const resp = await fetch('/api/sac/vendas/relatorio-gerencial/config/status', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || 'Erro ao carregar status.');
      _renderListaStatus(data.status_list || []);
    } catch (err) {
      if (wrap) wrap.innerHTML = `<div style="color:#f87171;font-size:13px;">${_esc(err.message || 'Erro')}</div>`;
    }
  }

  async function _salvarConfigStatus() {
    const statusEl = document.getElementById('vendRelGerStatusSaveStatus');
    const boxes = [...document.querySelectorAll('#vendRelGerStatusLista input[type="checkbox"][data-status]')];
    const status_list = boxes.map((b) => ({
      status: b.getAttribute('data-status'),
      incluido: !!b.checked,
    }));
    if (statusEl) statusEl.textContent = 'Salvando...';
    try {
      const resp = await fetch('/api/sac/vendas/relatorio-gerencial/config/status', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_list }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || 'Erro ao salvar.');
      if (statusEl) statusEl.textContent = 'Padrão salvo para todos.';
      _fecharModal('vendRelGerStatusModal');
      await _carregar();
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || 'Erro ao salvar.';
    }
  }

  const CHART_KEYS_POR_SECAO = {
    executivo: ['etapa', 'valorEstado'],
    geografico: ['estado', 'estadoDonut'],
    familias: ['familia'],
    clientes: ['cliente'],
    vendedores: ['vendedor'],
    evolucao: ['evol', 'evolPed'],
    pareto: ['pareto'],
    itens: ['itens'],
  };

  function _canvasParaImg(canvas) {
    if (!canvas) return '';
    try {
      const chartInst = typeof Chart !== 'undefined' ? Chart.getChart(canvas) : null;
      if (chartInst) {
        try {
          chartInst.options.animation = false;
          chartInst.resize();
          chartInst.update('none');
        } catch (_) { /* segue */ }
      }
      if (!canvas.width || !canvas.height) return '';
      return canvas.toDataURL('image/png');
    } catch (_) {
      return '';
    }
  }

  async function _prepararSecaoPdf(sec) {
    if (!sec || !_data) return;
    _secao = sec;
    document.querySelectorAll('#vendRelGerNav .at-rel-ger-nav-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.sec === sec);
    });
    document.querySelectorAll('#vendRelGerPages .at-rel-ger-page').forEach((p) => {
      p.classList.toggle('is-active', p.dataset.sec === sec);
    });
    (CHART_KEYS_POR_SECAO[sec] || []).forEach(_destroyChart);
    _chartsRendered.delete(sec);
    _renderChartsSecao(sec, _data);
    await new Promise((r) => setTimeout(r, 160));
  }

  function _pdfCss() {
    return `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Segoe UI, Arial, sans-serif; font-size: 10.5px; color: #1e293b; background: #fff; }
  .pdf-page { page-break-after: always; padding: 14px 22px 12px; display: flex; flex-direction: column; min-height: 100vh; }
  .pdf-page:last-child { page-break-after: auto; }
  .pdf-hdr { display: grid; grid-template-columns: 1fr 2fr 1fr; gap: 10px; align-items: center; margin-bottom: 6px; }
  .pdf-brand { display: flex; gap: 8px; align-items: center; }
  .pdf-logo { width: 32px; height: 32px; border-radius: 8px; background: #1e3a5f; color: #fff; font-weight: 900; display: flex; align-items: center; justify-content: center; font-size: 12px; }
  .pdf-name { font-size: 12px; font-weight: 800; color: #1e3a5f; }
  .pdf-sub { font-size: 7px; color: #64748b; letter-spacing: .06em; }
  .pdf-title { text-align: center; }
  .pdf-type { font-size: 9px; font-weight: 800; color: #1e3a5f; text-transform: uppercase; }
  .pdf-per { font-size: 14px; font-weight: 900; color: #0284c7; }
  .pdf-meta { font-size: 8px; color: #475569; text-align: right; line-height: 1.45; }
  .pdf-bar { height: 3px; background: linear-gradient(90deg,#1e3a5f,#0ea5e9,#38bdf8); border-radius: 2px; margin-bottom: 8px; }
  .sec { background: #1e3a5f; color: #fff; padding: 6px 10px; border-radius: 6px; font-weight: 800; font-size: 11px; margin: 8px 0; }
  .kpis { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; margin-bottom: 8px; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; background: #f8fafc; }
  .kpi .lbl { font-size: 7px; color: #64748b; text-transform: uppercase; font-weight: 700; }
  .kpi .val { font-size: 13px; font-weight: 900; color: #1e3a5f; margin-top: 1px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .box { flex: 1; min-width: 180px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; page-break-inside: avoid; }
  .box h3 { font-size: 10px; color: #1e3a5f; margin-bottom: 4px; }
  .chart-img { max-width: 100%; max-height: 200px; object-fit: contain; display: block; margin: 0 auto; }
  .chart-img.wide { max-height: 230px; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; margin-bottom: 6px; }
  th { background: #1e3a5f; color: #fff; padding: 4px 6px; text-align: left; }
  td { padding: 3px 6px; border-bottom: 1px solid #e2e8f0; }
  th.r, td.r { text-align: right; }
  ul { padding-left: 14px; margin: 6px 0; line-height: 1.45; }
  .pdf-ftr { margin-top: auto; padding-top: 8px; border-top: 2px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 8px; color: #64748b; }
  .pdf-slogan { font-style: italic; color: #1e3a5f; font-weight: 600; }
  .pdf-pg { font-weight: 700; color: #0284c7; }
  @page { size: A4; margin: 10mm 8mm; }
`;
  }

  function _pdfHeader(periodo, etapa) {
    const etapaTxt = etapa ? ` · ${_esc(etapa)}` : '';
    return `
      <div class="pdf-hdr">
        <div class="pdf-brand"><div class="pdf-logo">FT</div><div><div class="pdf-name">FROMTHERM</div><div class="pdf-sub">BOMBAS DE CALOR</div></div></div>
        <div class="pdf-title"><div class="pdf-type">Relatório Gerencial de Vendas</div><div class="pdf-per">${_esc(periodo)}${etapaTxt}</div></div>
        <div class="pdf-meta"><div><b>Departamento:</b> Comercial / Vendas</div><div><b>Data:</b> ${_esc(_fmtDataGeracao())}</div><div><b>Versão:</b> 1.0</div></div>
      </div>
      <div class="pdf-bar"></div>`;
  }

  function _pdfFooter(pg, total) {
    return `<div class="pdf-ftr"><div class="pdf-slogan">Qualidade que transforma. Conforto que dura.</div><div class="pdf-pg">Página ${pg} de ${total}</div></div>`;
  }

  function _imgBox(titulo, src, wide) {
    if (!src) return '';
    return `<div class="box"><h3>${_esc(titulo)}</h3><img class="chart-img${wide ? ' wide' : ''}" src="${src}"></div>`;
  }

  async function _exportarPdf() {
    if (!_data) {
      alert('Carregue o relatório antes de exportar.');
      return;
    }
    const btn = document.getElementById('vendRelGerPdfBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando...';
    }
    const secaoSalva = _secao;
    try {
      const d = _data;
      const kpis = d.kpis || {};
      const periodo = d.periodo || '—';
      const etapa = d.etapa || '';
      const hdr = () => _pdfHeader(periodo, etapa);
      const imgs = {};

      await _prepararSecaoPdf('executivo');
      imgs.etapa = _canvasParaImg(document.getElementById('vendRelGerChartEtapa'));
      imgs.valorEstado = _canvasParaImg(document.getElementById('vendRelGerChartValorEstado'));

      await _prepararSecaoPdf('geografico');
      imgs.estado = _canvasParaImg(document.getElementById('vendRelGerChartEstado'));
      imgs.estadoDonut = _canvasParaImg(document.getElementById('vendRelGerChartEstadoDonut'));

      await _prepararSecaoPdf('familias');
      imgs.familia = _canvasParaImg(document.getElementById('vendRelGerChartFamilia'));

      await _prepararSecaoPdf('clientes');
      imgs.cliente = _canvasParaImg(document.getElementById('vendRelGerChartCliente'));

      await _prepararSecaoPdf('vendedores');
      imgs.vendedor = _canvasParaImg(document.getElementById('vendRelGerChartVendedor'));

      await _prepararSecaoPdf('evolucao');
      imgs.evol = _canvasParaImg(document.getElementById('vendRelGerChartEvol'));
      imgs.evolPed = _canvasParaImg(document.getElementById('vendRelGerChartEvolPedidos'));

      await _prepararSecaoPdf('pareto');
      imgs.pareto = _canvasParaImg(document.getElementById('vendRelGerChartPareto'));

      await _prepararSecaoPdf('itens');
      imgs.itens = _canvasParaImg(document.getElementById('vendRelGerChartItens'));

      // Restaura seção que o usuário estava vendo
      _trocarSecao(secaoSalva);
      if (_data && !_chartsRendered.has(secaoSalva)) _renderChartsSecao(secaoSalva, _data);

      const kpiHtml = [
        ['Pedidos', kpis.total_pedidos],
        ['Faturamento', MOEDA.format(kpis.valor_total || 0)],
        ['Ticket médio', MOEDA.format(kpis.ticket_medio || 0)],
        ['Clientes', kpis.clientes],
        ['Estados', kpis.estados_atendidos],
        ['Qtd. itens', QTD.format(kpis.quantidade_itens || 0)],
      ].map(([l, v]) => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div></div>`).join('');

      const famTbl = (d.por_familia || []).slice(0, 15).map((r) =>
        `<tr><td>${_esc(r.familia)}</td><td class="r">${QTD.format(r.quantidade || 0)}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`
      ).join('') || '<tr><td colspan="3">—</td></tr>';
      const cliTbl = (d.por_cliente || []).slice(0, 15).map((r) =>
        `<tr><td>${_esc(r.cliente)}</td><td class="r">${r.total}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`
      ).join('') || '<tr><td colspan="3">—</td></tr>';
      const vendTbl = (d.por_vendedor || []).slice(0, 15).map((r) =>
        `<tr><td>${_esc(r.vendedor)}</td><td class="r">${r.total_pedidos}</td><td class="r">${r.clientes}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td><td class="r">${MOEDA.format(r.ticket_medio || 0)}</td></tr>`
      ).join('') || '<tr><td colspan="5">—</td></tr>';
      const paretoTbl = (d.pareto || []).slice(0, 15).map((r) =>
        `<tr><td>${_esc(r.familia)}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td><td class="r">${r.pct}%</td><td class="r">${r.pct_acum}%</td></tr>`
      ).join('') || '<tr><td colspan="4">—</td></tr>';
      const finTbl = (d.financeiro || []).slice(0, 20).map((r) =>
        `<tr><td>${_esc(r.numero_pedido || r.codigo_pedido)}</td><td>${_esc(r.cliente)}</td><td>${_esc(r.estado)}</td><td>${_fmtData(r.data)}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`
      ).join('') || '<tr><td colspan="5">—</td></tr>';

      const textos = _coletarTextosForm();
      const planoHtml = (textos.plano_acao || []).filter((r) => r.acao || r.descricao).map((r) =>
        `<tr><td>${_esc(r.acao)}</td><td>${_esc(r.descricao)}</td><td>${_esc(r.responsavel)}</td><td>${_esc(r.prazo)}</td><td>${_esc((r.prioridade || '').toUpperCase())}</td></tr>`
      ).join('') || '<tr><td colspan="5">Sem ações cadastradas.</td></tr>';
      const criticos = _linhasParaLista(textos.conclusao_pontos_criticos).map((l) => `<li>${_esc(l)}</li>`).join('') || '<li>—</li>';
      const oport = _linhasParaLista(textos.conclusao_oportunidades).map((l) => `<li>${_esc(l)}</li>`).join('') || '<li>—</li>';

      const TOTAL = 6;
      const pg = (n) => _pdfFooter(n, TOTAL);
      const pages = [
        `<div class="pdf-page">${hdr()}
          <div class="sec">Dashboard Executivo</div>
          <div class="kpis">${kpiHtml}</div>
          <div class="row">${_imgBox('Pedidos por Etapa', imgs.etapa)}${_imgBox('Valor por Estado', imgs.valorEstado)}</div>
          <div class="sec">Distribuição Geográfica</div>
          <div class="row">${_imgBox('Valor por Estado', imgs.estado)}${_imgBox('Participação por Estado', imgs.estadoDonut)}</div>
          ${pg(1)}</div>`,
        `<div class="pdf-page">${hdr()}
          <div class="sec">Famílias de Produto</div>
          <div class="row">${_imgBox('Faturamento por Família', imgs.familia)}<div class="box"><h3>Tabela</h3><table><thead><tr><th>Família</th><th class="r">Qtd</th><th class="r">Valor</th></tr></thead><tbody>${famTbl}</tbody></table></div></div>
          <div class="sec">Principais Clientes</div>
          <div class="row">${_imgBox('Top Clientes', imgs.cliente)}<div class="box"><h3>Tabela</h3><table><thead><tr><th>Cliente</th><th class="r">Pedidos</th><th class="r">Valor</th></tr></thead><tbody>${cliTbl}</tbody></table></div></div>
          ${pg(2)}</div>`,
        `<div class="pdf-page">${hdr()}
          <div class="sec">Vendedores</div>
          <div class="row">${_imgBox('Ranking por Faturamento', imgs.vendedor)}<div class="box"><h3>Tabela</h3><table><thead><tr><th>Vendedor</th><th class="r">Pedidos</th><th class="r">Clientes</th><th class="r">Valor</th><th class="r">Ticket</th></tr></thead><tbody>${vendTbl}</tbody></table></div></div>
          <div class="sec">Evolução no Período</div>
          <div class="row">${_imgBox('Faturamento', imgs.evol)}${_imgBox('Pedidos', imgs.evolPed)}</div>
          ${pg(3)}</div>`,
        `<div class="pdf-page">${hdr()}
          <div class="sec">Pareto 80/20 — Famílias</div>
          ${_imgBox('Pareto por Faturamento', imgs.pareto, true)}
          <table><thead><tr><th>Família</th><th class="r">Valor</th><th class="r">%</th><th class="r">% Acum.</th></tr></thead><tbody>${paretoTbl}</tbody></table>
          <div class="sec">Análise Financeira — Top Pedidos</div>
          <table><thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Data</th><th class="r">Valor</th></tr></thead><tbody>${finTbl}</tbody></table>
          ${pg(4)}</div>`,
        `<div class="pdf-page">${hdr()}
          <div class="sec">Análise de Itens</div>
          ${_imgBox('Itens por mês de NF e família', imgs.itens, true)}
          <p style="margin-top:8px;color:#64748b;font-size:10px;">Período ${ _esc(periodo) } · ${QTD.format(kpis.quantidade_itens || 0)} item(ns) no relatório.</p>
          ${pg(5)}</div>`,
        `<div class="pdf-page">${hdr()}
          <div class="sec">Plano de Ação</div>
          <table><thead><tr><th>Ação</th><th>Descrição</th><th>Responsável</th><th>Prazo</th><th>Prioridade</th></tr></thead><tbody>${planoHtml}</tbody></table>
          <div class="sec">Conclusão Executiva</div>
          <div class="box" style="margin-bottom:8px;"><h3>Resumo</h3><p>${_esc(textos.conclusao_resumo || '—')}</p></div>
          <div class="row">
            <div class="box"><h3>Pontos críticos</h3><ul>${criticos}</ul></div>
            <div class="box"><h3>Oportunidades</h3><ul>${oport}</ul></div>
          </div>
          ${pg(6)}</div>`,
      ].join('');

      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório Gerencial Vendas — ${_esc(periodo)}</title>
<style>${_pdfCss()}</style></head><body>${pages}
<script>window.onload=function(){setTimeout(function(){window.print();},500);};</script>
</body></html>`;

      const w = window.open('', '_blank');
      if (!w) throw new Error('Pop-up bloqueado. Permita pop-ups neste site para exportar o PDF.');
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (err) {
      alert('Erro ao exportar PDF: ' + (err.message || err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Exportar PDF';
      }
    }
  }

  window._iniciarRelatorioGerencialVendas = function () {
    if (!_init) {
      _init = true;
      _injetarEstilosFiltro();
      _injetarUiFiltro();
      _injetarFamiliaMulti();
      _injetarModalRegistros();
      _setModoFiltro('mes_ano');
      _setBarraFiltrosVisivel(false);
      document.getElementById('vendRelGerFiltroBtn')?.addEventListener('click', _toggleBarraFiltros);
      document.getElementById('vendRelGerModoMesAno')?.addEventListener('click', () => _setModoFiltro('mes_ano'));
      document.getElementById('vendRelGerModoTrimestre')?.addEventListener('click', () => _setModoFiltro('trimestre'));
      document.getElementById('vendRelGerModoPeriodo')?.addEventListener('click', () => _setModoFiltro('periodo'));
      document.getElementById('vendRelGerMes')?.addEventListener('change', () => {
        const tri = document.getElementById('vendRelGerTrimestre');
        if (tri && _modoAtual() !== 'trimestre') tri.value = '';
      });
      document.getElementById('vendRelGerAplicarBtn')?.addEventListener('click', _carregar);
      document.getElementById('vendRelGerAtualizarBtn')?.addEventListener('click', _carregar);
      document.getElementById('vendRelGerPdfBtn')?.addEventListener('click', () => { _exportarPdf(); });

      document.getElementById('vendRelGerRegistrosFechar')?.addEventListener('click', _fecharModalRegistros);
      document.getElementById('vendRelGerRegistrosModal')?.addEventListener('click', (e) => {
        if (e.target?.id === 'vendRelGerRegistrosModal') _fecharModalRegistros();
      });
      document.getElementById('vendRelGerRegistrosBusca')?.addEventListener('input', _renderTabelaRegistros);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('vendRelGerRegistrosModal')?.style.display === 'flex') {
          _fecharModalRegistros();
        }
      });

      document.getElementById('vendRelGerConfigBtn')?.addEventListener('click', () => _abrirModal('vendRelGerConfigModal'));
      document.getElementById('vendRelGerConfigFechar')?.addEventListener('click', () => _fecharModal('vendRelGerConfigModal'));
      document.getElementById('vendRelGerConfigCfopBtn')?.addEventListener('click', _abrirConfigCfop);
      document.getElementById('vendRelGerConfigStatusBtn')?.addEventListener('click', _abrirConfigStatus);
      document.getElementById('vendRelGerCfopFechar')?.addEventListener('click', () => _fecharModal('vendRelGerCfopModal'));
      document.getElementById('vendRelGerCfopCancelar')?.addEventListener('click', () => _fecharModal('vendRelGerCfopModal'));
      document.getElementById('vendRelGerCfopSelTudo')?.addEventListener('click', () => {
        document.querySelectorAll('#vendRelGerCfopLista input[type="checkbox"][data-cfop]').forEach((b) => { b.checked = true; });
        _atualizarContagemCfop();
      });
      document.getElementById('vendRelGerCfopDesmarcar')?.addEventListener('click', () => {
        document.querySelectorAll('#vendRelGerCfopLista input[type="checkbox"][data-cfop]').forEach((b) => { b.checked = false; });
        _atualizarContagemCfop();
      });
      document.getElementById('vendRelGerCfopSalvar')?.addEventListener('click', _salvarConfigCfop);

      document.getElementById('vendRelGerStatusFechar')?.addEventListener('click', () => _fecharModal('vendRelGerStatusModal'));
      document.getElementById('vendRelGerStatusCancelar')?.addEventListener('click', () => _fecharModal('vendRelGerStatusModal'));
      document.getElementById('vendRelGerStatusSelTudo')?.addEventListener('click', () => {
        document.querySelectorAll('#vendRelGerStatusLista input[type="checkbox"][data-status]').forEach((b) => { b.checked = true; });
        _atualizarContagemStatus();
      });
      document.getElementById('vendRelGerStatusDesmarcar')?.addEventListener('click', () => {
        document.querySelectorAll('#vendRelGerStatusLista input[type="checkbox"][data-status]').forEach((b) => { b.checked = false; });
        _atualizarContagemStatus();
      });
      document.getElementById('vendRelGerStatusSalvar')?.addEventListener('click', _salvarConfigStatus);

      document.getElementById('vendRelGerConfigModal')?.addEventListener('click', (e) => {
        if (e.target?.id === 'vendRelGerConfigModal') _fecharModal('vendRelGerConfigModal');
      });
      document.getElementById('vendRelGerCfopModal')?.addEventListener('click', (e) => {
        if (e.target?.id === 'vendRelGerCfopModal') _fecharModal('vendRelGerCfopModal');
      });
      document.getElementById('vendRelGerStatusModal')?.addEventListener('click', (e) => {
        if (e.target?.id === 'vendRelGerStatusModal') _fecharModal('vendRelGerStatusModal');
      });
    }
    if (!document.getElementById('vendRelGerDataInicio')?.value || !document.getElementById('vendRelGerDataFim')?.value) {
      _aplicarMesAtualNasDatas();
    }
    _carregarFiltrosOpcoes();
    _carregar();
  };
})();
