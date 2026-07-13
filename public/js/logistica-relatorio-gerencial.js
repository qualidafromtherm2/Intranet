// Relatório Gerencial Logística — layout espelhado do Relatório AT / Vendas
(function () {
  let _init = false;
  let _data = null;
  let _textos = null;
  let _secao = 'executivo';
  const _charts = {};
  const _chartsRendered = new Set();

  const CORES = ['#065f46', '#10b981', '#38bdf8', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
  const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const QTD = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

  const SECOES = [
    { id: 'executivo', label: 'Dashboard Executivo', icon: 'fa-gauge-high', pg: 1 },
    { id: 'separacao', label: 'Separação / Solicitações', icon: 'fa-boxes-packing', pg: 2 },
    { id: 'transferencias', label: 'Transferências', icon: 'fa-arrow-right-arrow-left', pg: 3 },
    { id: 'ajustes', label: 'Ajustes de Estoque', icon: 'fa-pen-to-square', pg: 4 },
    { id: 'recebimentos', label: 'Recebimentos', icon: 'fa-truck-ramp-box', pg: 5 },
    { id: 'envios', label: 'Envio de Mercadoria', icon: 'fa-truck-fast', pg: 6 },
    { id: 'estoque', label: 'Estoque Mínimo', icon: 'fa-boxes-stacked', pg: 7 },
    { id: 'etiquetas', label: 'Etiquetas / Endereço', icon: 'fa-print', pg: 8 },
    { id: 'evolucao', label: 'Evolução', icon: 'fa-chart-column', pg: 9 },
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
    const topSep = (data.top_produtos_separacao || []).slice(0, 3);
    const topSepTxt = topSep.map(r => `${r.produto} (${r.total}x)`).join(', ') || '—';

    const plano_acao = [
      k.separacao_urgentes > 0 && {
        acao: 'Urgências na separação',
        descricao: `${k.separacao_urgentes} item(ns) urgente(s) aguardando tratamento`,
        responsavel: '', prazo: '', prioridade: 'alta',
      },
      k.transferencias_pendentes > 0 && {
        acao: 'Transferências pendentes',
        descricao: `${k.transferencias_pendentes} transferência(s) aguardando aprovação`,
        responsavel: '', prazo: '', prioridade: 'media',
      },
      k.estoque_abaixo_minimo > 0 && {
        acao: 'Reposição estoque mínimo',
        descricao: `${k.estoque_abaixo_minimo} SKU(s) abaixo do mínimo`,
        responsavel: '', prazo: '', prioridade: 'media',
      },
    ].filter(Boolean);

    if (!plano_acao.length) {
      plano_acao.push({ acao: '', descricao: '', responsavel: '', prazo: '', prioridade: 'media' });
    }

    return {
      plano_acao,
      conclusao_resumo: `No período ${data.periodo || ''} a logística registrou ${k.separacao_total || 0} item(ns) de separação, ${k.transferencias_executadas || 0} transferência(s) executada(s), ${k.recebimentos_total || 0} recebimento(s) de NF-e e ${k.envios_total || 0} envio(s) de mercadoria.`,
      conclusao_pontos_criticos: [
        `Itens de separação abertos: ${k.separacao_abertos || 0} (urgentes: ${k.separacao_urgentes || 0})`,
        `Transferências pendentes: ${k.transferencias_pendentes || 0} · Ajustes pendentes: ${k.ajustes_pendentes || 0}`,
        `Produtos mais solicitados: ${topSepTxt}`,
      ].join('\n'),
      conclusao_oportunidades: [
        'Reduzir lead time de separação nos itens urgentes',
        'Acompanhar envios pendentes na fila de expedição',
        'Revisar SKUs abaixo do estoque mínimo para reposição',
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
            <div class="at-rel-ger-report-type">Relatório Gerencial de Logística</div>
            <div class="at-rel-ger-periodo">${_esc(periodo)}</div>
          </div>
          <div class="at-rel-ger-meta">
            <div><span>Departamento:</span> Logística</div>
            <div><span>Data:</span> ${_esc(_fmtDataGeracao())}</div>
            <div><span>Versão:</span> 1.0</div>
          </div>
        </div>
        <div class="at-rel-ger-header-bar" style="background:linear-gradient(90deg,#065f46,#10b981);"></div>
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
    const nav = document.getElementById('logRelGerNav');
    const pagesWrap = document.getElementById('logRelGerPages');
    if (!nav || !pagesWrap) return;

    nav.innerHTML = `<div class="at-rel-ger-nav-title">Páginas do relatório</div>${SECOES.map(s => `
      <button type="button" class="at-rel-ger-nav-btn${s.id === _secao ? ' is-active' : ''}" data-sec="${s.id}">
        <span class="pg-num">${s.pg}</span>
        <i class="fa-solid ${s.icon}"></i>
        <span>${s.label}</span>
      </button>`).join('')}`;

    const periodo = _data?.periodo || '—';
    const hdr = () => _headerHtml(periodo);

    pagesWrap.innerHTML = SECOES.map((s) => {
      const active = s.id === _secao ? ' is-active' : '';
      const bodies = {
        executivo: `
          <div id="logRelGerKpis" class="at-rel-ger-kpis"></div>
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Separação por Status</h4><div class="at-rel-ger-chart sm"><canvas id="logRelGerChartSepStatus"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Envios por Status</h4><div class="at-rel-ger-chart sm"><canvas id="logRelGerChartEnvioStatus"></canvas></div></div>
          </div>`,
        separacao: `
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Itens por Status</h4><div class="at-rel-ger-chart lg"><canvas id="logRelGerChartSep"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Top Produtos Solicitados</h4>
              <div style="overflow:auto;max-height:300px;"><table class="at-rel-ger-tbl"><thead><tr><th>Produto</th><th class="r">Itens</th><th class="r">Qtd</th></tr></thead><tbody id="logRelGerTopSepBody"></tbody></table></div>
            </div>
          </div>`,
        transferencias: `
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Transferências por Status</h4><div class="at-rel-ger-chart"><canvas id="logRelGerChartTrf"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Rotas (origem → destino)</h4>
              <div style="overflow:auto;max-height:300px;"><table class="at-rel-ger-tbl"><thead><tr><th>Origem</th><th>Destino</th><th class="r">Qtd</th><th class="r">Itens</th></tr></thead><tbody id="logRelGerRotasBody"></tbody></table></div>
            </div>
          </div>`,
        ajustes: `
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Ajustes por Status</h4><div class="at-rel-ger-chart"><canvas id="logRelGerChartAjusteStatus"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>ENT vs SAI</h4><div class="at-rel-ger-chart"><canvas id="logRelGerChartAjusteTipo"></canvas></div></div>
          </div>`,
        recebimentos: `
          <div class="at-rel-ger-card"><h4>NF-e por Etapa</h4><div class="at-rel-ger-chart lg"><canvas id="logRelGerChartReceb"></canvas></div></div>
          <div style="overflow:auto;margin-top:14px;"><table class="at-rel-ger-tbl"><thead><tr><th>Etapa</th><th class="r">Qtd NF</th><th class="r">Valor</th></tr></thead><tbody id="logRelGerRecebBody"></tbody></table></div>`,
        envios: `
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Envios por Status</h4><div class="at-rel-ger-chart"><canvas id="logRelGerChartEnvio"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Por Método de Envio</h4><div class="at-rel-ger-chart"><canvas id="logRelGerChartEnvioMetodo"></canvas></div></div>
          </div>`,
        estoque: `
          <div id="logRelGerEstoqueKpis" class="at-rel-ger-kpis" style="margin-bottom:14px;"></div>
          <p style="font-size:13px;color:#64748b;margin:0;">Posição atual — produtos com saldo físico abaixo do estoque mínimo cadastrado.</p>`,
        etiquetas: `
          <div id="logRelGerEtqKpis" class="at-rel-ger-kpis" style="margin-bottom:14px;"></div>
          <p style="font-size:13px;color:#64748b;margin:0;">Indicadores de identificação de produto (etiquetas pendentes) e materiais sem endereço no armazém.</p>`,
        evolucao: `
          <div class="at-rel-ger-card"><h4 id="logRelGerEvolTitulo">Movimentações no período</h4><div class="at-rel-ger-chart lg"><canvas id="logRelGerChartEvol"></canvas></div></div>`,
        plano: `
          <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
            <button type="button" id="logRelGerPlanoAdd" class="at-rel-ger-btn"><i class="fa-solid fa-plus"></i> Adicionar ação</button>
            <button type="button" id="logRelGerPlanoSalvar" class="at-rel-ger-btn primary"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
            <span id="logRelGerPlanoStatus" style="font-size:12px;color:#64748b;align-self:center;"></span>
          </div>
          <div style="overflow:auto;"><table class="at-rel-ger-tbl"><thead><tr><th>Ação</th><th>Descrição</th><th>Responsável</th><th>Prazo</th><th>Prioridade</th><th></th></tr></thead><tbody id="logRelGerPlanoBody"></tbody></table></div>`,
        conclusao: `
          <div style="display:flex;gap:8px;margin-bottom:10px;"><button type="button" id="logRelGerConcSalvar" class="at-rel-ger-btn primary"><i class="fa-solid fa-floppy-disk"></i> Salvar</button><span id="logRelGerConcStatus" style="font-size:12px;color:#64748b;align-self:center;"></span></div>
          <label style="font-size:12px;font-weight:700;color:#065f46;">Resumo executivo</label>
          <textarea id="logRelGerConcResumo" rows="4" style="width:100%;margin:6px 0 12px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;"></textarea>
          <div class="at-rel-ger-grid-2">
            <div><label style="font-size:12px;font-weight:700;color:#065f46;">Pontos críticos</label><textarea id="logRelGerConcCriticos" rows="5" style="width:100%;margin-top:6px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;"></textarea></div>
            <div><label style="font-size:12px;font-weight:700;color:#065f46;">Oportunidades</label><textarea id="logRelGerConcOportunidades" rows="5" style="width:100%;margin-top:6px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;"></textarea></div>
          </div>`,
      };
      const icons = {
        executivo: 'fa-gauge-high', separacao: 'fa-boxes-packing', transferencias: 'fa-arrow-right-arrow-left',
        ajustes: 'fa-pen-to-square', recebimentos: 'fa-truck-ramp-box', envios: 'fa-truck-fast',
        estoque: 'fa-boxes-stacked', etiquetas: 'fa-print', evolucao: 'fa-chart-column',
        plano: 'fa-list-check', conclusao: 'fa-flag-checkered',
      };
      const titles = {
        executivo: 'Dashboard Executivo', separacao: 'Separação / Solicitações', transferencias: 'Transferências',
        ajustes: 'Ajustes de Estoque', recebimentos: 'Recebimentos de Materiais', envios: 'Envio de Mercadoria',
        estoque: 'Estoque Mínimo', etiquetas: 'Etiquetas e Endereçamento', evolucao: 'Evolução no Período',
        plano: 'Plano de Ação', conclusao: 'Conclusão Executiva',
      };
      return `
        <div class="at-rel-ger-page${active}" data-sec="${s.id}">
          ${hdr()}
          <div class="at-rel-ger-sec-title"><i class="fa-solid ${icons[s.id]}"></i> ${titles[s.id]}</div>
          <div class="at-rel-ger-body">${bodies[s.id] || ''}</div>
          ${_footerHtml(s.pg)}
        </div>`;
    }).join('');

    nav.querySelectorAll('.at-rel-ger-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => _trocarSecao(btn.dataset.sec));
    });
    document.getElementById('logRelGerPlanoAdd')?.addEventListener('click', _planoAdd);
    document.getElementById('logRelGerPlanoSalvar')?.addEventListener('click', () => _salvarTextos('plano'));
    document.getElementById('logRelGerConcSalvar')?.addEventListener('click', () => _salvarTextos('conclusao'));
  }

  function _trocarSecao(sec) {
    if (!sec) return;
    _secao = sec;
    document.querySelectorAll('#logRelGerNav .at-rel-ger-nav-btn').forEach(b => b.classList.toggle('is-active', b.dataset.sec === sec));
    document.querySelectorAll('#logRelGerPages .at-rel-ger-page').forEach(p => p.classList.toggle('is-active', p.dataset.sec === sec));
    if (_data && !_chartsRendered.has(sec)) _renderChartsSecao(sec, _data);
  }

  function _renderKpis(kpis) {
    const wrap = document.getElementById('logRelGerKpis');
    if (!wrap) return;
    const cards = [
      { label: 'Separação (itens)', value: kpis.separacao_total, cor: '#065f46' },
      { label: 'Sep. abertos', value: kpis.separacao_abertos, cor: '#f59e0b' },
      { label: 'Transfer. pendentes', value: kpis.transferencias_pendentes, cor: '#ef4444' },
      { label: 'Transfer. executadas', value: kpis.transferencias_executadas, cor: '#10b981' },
      { label: 'Ajustes pendentes', value: kpis.ajustes_pendentes, cor: '#8b5cf6' },
      { label: 'Recebimentos NF', value: kpis.recebimentos_total, cor: '#38bdf8' },
      { label: 'Valor recebido', value: MOEDA.format(kpis.recebimentos_valor || 0), cor: '#0ea5e9' },
      { label: 'Envios pendentes', value: kpis.envios_pendentes, cor: '#d97706' },
      { label: 'Abaixo mínimo', value: kpis.estoque_abaixo_minimo, cor: '#dc2626' },
    ];
    wrap.innerHTML = cards.map(c => `<div class="at-rel-ger-kpi" style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${c.value}</div></div>`).join('');
  }

  function _chartOptsBarH() {
    return { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true }, y: { ticks: { font: { size: 11 } } } } };
  }

  function _chartOptsBarV() {
    return { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } } };
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

  function _renderChartsSecao(sec, data) {
    if (_chartsRendered.has(sec)) return;
    const sep = data.por_status_separacao || [];
    const trf = data.por_status_transferencia || [];
    const ajuste = data.por_status_ajuste || [];
    const ajusteTipo = data.por_tipo_ajuste || [];
    const receb = data.por_etapa_recebimento || [];
    const envio = data.por_status_envio || [];
    const envMet = data.por_metodo_envio || [];
    const k = data.kpis || {};

    if (sec === 'executivo') {
      _renderBar('logRelGerChartSepStatus', 'sepExec', sep.slice(0, 8).map(r => r.status), sep.slice(0, 8).map(r => r.total), '#10b981');
      _renderBar('logRelGerChartEnvioStatus', 'envExec', envio.slice(0, 8).map(r => r.status), envio.slice(0, 8).map(r => r.total), '#38bdf8');
    }
    if (sec === 'separacao') {
      _renderBar('logRelGerChartSep', 'sep', sep.map(r => r.status), sep.map(r => r.total), '#065f46');
    }
    if (sec === 'transferencias') {
      _renderBar('logRelGerChartTrf', 'trf', trf.map(r => r.status), trf.map(r => r.total), '#10b981');
    }
    if (sec === 'ajustes') {
      _renderBar('logRelGerChartAjusteStatus', 'ajStatus', ajuste.map(r => r.status), ajuste.map(r => r.total), '#8b5cf6');
      _renderDonut('logRelGerChartAjusteTipo', 'ajTipo', ajusteTipo.map(r => r.tipo), ajusteTipo.map(r => r.total));
    }
    if (sec === 'recebimentos') {
      _renderBar('logRelGerChartReceb', 'receb', receb.map(r => r.etapa), receb.map(r => r.total), '#38bdf8');
    }
    if (sec === 'envios') {
      _renderBar('logRelGerChartEnvio', 'envio', envio.map(r => r.status), envio.map(r => r.total), '#0ea5e9');
      _renderBar('logRelGerChartEnvioMetodo', 'envMet', envMet.map(r => r.metodo), envMet.map(r => r.total), '#06b6d4');
    }
    if (sec === 'estoque') {
      const wrap = document.getElementById('logRelGerEstoqueKpis');
      if (wrap) {
        wrap.innerHTML = [
          { label: 'SKUs abaixo do mínimo', value: k.estoque_abaixo_minimo, cor: '#dc2626' },
          { label: 'Déficit total (un.)', value: QTD.format(k.estoque_deficit || 0), cor: '#f59e0b' },
        ].map(c => `<div class="at-rel-ger-kpi" style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${c.value}</div></div>`).join('');
      }
    }
    if (sec === 'etiquetas') {
      const wrap = document.getElementById('logRelGerEtqKpis');
      if (wrap) {
        wrap.innerHTML = [
          { label: 'Etiquetas pendentes', value: k.etiquetas_pendentes, cor: '#f59e0b' },
          { label: 'Materiais sem endereço', value: k.materiais_sem_endereco, cor: '#ef4444' },
        ].map(c => `<div class="at-rel-ger-kpi" style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${c.value}</div></div>`).join('');
      }
    }
    if (sec === 'evolucao') {
      const multi = data.evolucao_tipo === 'mes';
      const titulo = document.getElementById('logRelGerEvolTitulo');
      if (titulo) titulo.textContent = multi ? 'Movimentações mensais' : 'Movimentações semanais';
      const rows = multi ? (data.evolucao_mensal || []) : (data.evolucao_semanal || []);
      const labels = multi ? rows.map(r => r.label) : rows.map(r => r.semana);
      _renderBar('logRelGerChartEvol', 'evol', labels, rows.map(r => r.total), '#10b981');
    }
    _chartsRendered.add(sec);
  }

  function _renderTabelas(data) {
    const topBody = document.getElementById('logRelGerTopSepBody');
    if (topBody) {
      const rows = data.top_produtos_separacao || [];
      topBody.innerHTML = rows.length
        ? rows.map(r => `<tr><td>${_esc(r.produto)}</td><td class="r">${r.total}</td><td class="r">${QTD.format(r.qtd_solicitada || 0)}</td></tr>`).join('')
        : '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">Nenhum item no período.</td></tr>';
    }
    const rotasBody = document.getElementById('logRelGerRotasBody');
    if (rotasBody) {
      const rows = data.rotas_transferencia || [];
      rotasBody.innerHTML = rows.length
        ? rows.map(r => `<tr><td>${_esc(r.origem)}</td><td>${_esc(r.destino)}</td><td class="r">${QTD.format(r.qtd_total || 0)}</td><td class="r">${r.total}</td></tr>`).join('')
        : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Nenhuma rota no período.</td></tr>';
    }
    const recebBody = document.getElementById('logRelGerRecebBody');
    if (recebBody) {
      const rows = data.por_etapa_recebimento || [];
      recebBody.innerHTML = rows.length
        ? rows.map(r => `<tr><td>${_esc(r.etapa)}</td><td class="r">${r.total}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`).join('')
        : '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">Sem recebimentos no período.</td></tr>';
    }
  }

  function _renderPlanoTabela() {
    const body = document.getElementById('logRelGerPlanoBody');
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
        const idx = parseInt(btn.closest('tr')?.dataset.idx, 10);
        if (!Number.isNaN(idx)) { _textos.plano_acao.splice(idx, 1); _renderPlanoTabela(); }
      });
    });
  }

  function _renderTextos() {
    if (!_textos) return;
    const r = document.getElementById('logRelGerConcResumo');
    const c = document.getElementById('logRelGerConcCriticos');
    const o = document.getElementById('logRelGerConcOportunidades');
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
    document.querySelectorAll('#logRelGerPlanoBody tr').forEach(tr => {
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
      conclusao_resumo: document.getElementById('logRelGerConcResumo')?.value?.trim() || '',
      conclusao_pontos_criticos: document.getElementById('logRelGerConcCriticos')?.value?.trim() || '',
      conclusao_oportunidades: document.getElementById('logRelGerConcOportunidades')?.value?.trim() || '',
    };
  }

  async function _salvarTextos(origem) {
    const statusEl = document.getElementById(origem === 'plano' ? 'logRelGerPlanoStatus' : 'logRelGerConcStatus');
    if (!_data?.mes) return;
    const payload = { mes: _data.mes, ..._coletarTextosForm() };
    if (statusEl) statusEl.textContent = 'Salvando...';
    try {
      const resp = await fetch('/api/sac/logistica/relatorio-gerencial/textos', {
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
    const modo = document.getElementById('logRelGerModo')?.value || 'mes';
    const statusEl = document.getElementById('logRelGerStatus');
    const erroEl = document.getElementById('logRelGerErro');
    const conteudoEl = document.getElementById('logRelGerConteudo');

    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Carregando relatório...'; }
    if (erroEl) erroEl.style.display = 'none';
    if (conteudoEl) conteudoEl.style.display = 'none';

    try {
      const qs = new URLSearchParams({ modo });
      const resp = await fetch(`/api/sac/logistica/relatorio-gerencial?${qs}`, { credentials: 'include' });
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

  window._iniciarRelatorioGerencialLogistica = function () {
    if (!_init) {
      _init = true;
      document.getElementById('logRelGerModo')?.addEventListener('change', _carregar);
      document.getElementById('logRelGerAtualizarBtn')?.addEventListener('click', _carregar);
      document.getElementById('logRelGerPdfBtn')?.addEventListener('click', () => window.print());
    }
    _carregar();
  };
})();
