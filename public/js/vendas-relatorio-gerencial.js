// Relatório Gerencial Vendas — layout espelhado do Relatório AT
(function () {
  let _init = false;
  let _data = null;
  let _textos = null;
  let _carregarAbort = null;
  let _registrosAbort = null;
  let _registrosRows = [];
  let _itensAbort = null;
  let _familiasSelecionadas = new Set();
  let _familiasOpcoes = [];
  let _secao = 'executivo';
  const _charts = {};
  const _chartsRendered = new Set();
  let _dataB = null;
  // { tipo:'mes_ano'|'trimestre'|'periodo', label1, label2, mes1?, ano1?, mes2?, ano2?, tri1?, tri2?, data_inicio1?, data_fim1?, data_inicio2?, data_fim2? }
  let _comparacao = null;
  let _carregarGeracao = 0;
  let _drillSnapshot = null;
  const _drillExtra = { cliente: '', etapa_pedido: '', familia_nome: '' };
  const HTML_APLICAR = '<i class="fa-solid fa-filter"></i> Aplicar filtro';

  const CORES = ['#1e3a5f', '#38bdf8', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
  const COR_MES1 = '#38bdf8';
  const COR_MES2 = '#f59e0b';
  const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const QTD = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const MESES_ABREV = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const MESES_NOME = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

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

  function _emComparacao() {
    return !!( _comparacao && _dataB );
  }

  function _labelMesAno(mes, ano) {
    const m = Number(mes);
    const nome = MESES_ABREV[m - 1] || String(m).padStart(2, '0');
    return `${nome}/${ano}`;
  }

  function _labelTrimestre(tri, ano) {
    return `${Number(tri)}º tri/${ano}`;
  }

  function _labelPeriodoDatas(ini, fim) {
    const fmt = (ymd) => {
      const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return String(ymd || '—');
      return `${m[3]}/${m[2]}/${m[1]}`;
    };
    return `${fmt(ini)} a ${fmt(fim)}`;
  }

  function _chaveYm(ano, mes) {
    return (Number(ano) * 12) + Number(mes);
  }

  function _chaveYt(ano, tri) {
    return (Number(ano) * 4) + Number(tri);
  }

  function _ordenarCronologico(a, b) {
    if (_chaveYm(a.ano, a.mes) <= _chaveYm(b.ano, b.mes)) return [a, b];
    return [b, a];
  }

  function _ordenarCronologicoTri(a, b) {
    if (_chaveYt(a.ano, a.tri) <= _chaveYt(b.ano, b.tri)) return [a, b];
    return [b, a];
  }

  function _ordenarCronologicoPeriodo(a, b) {
    if (String(a.inicio) <= String(b.inicio)) return [a, b];
    return [b, a];
  }

  function _opcoesMesHtml(sel) {
    return MESES_NOME.map((nome, i) => {
      const v = String(i + 1);
      return `<option value="${v}"${String(sel) === v ? ' selected' : ''}>${nome}</option>`;
    }).join('');
  }

  function _opcoesTrimestreHtml(sel) {
    return [1, 2, 3, 4].map((t) => {
      const v = String(t);
      return `<option value="${v}"${String(sel) === v ? ' selected' : ''}>${t}º</option>`;
    }).join('');
  }

  function _unidadeComparacao() {
    const t = _comparacao?.tipo || 'mes_ano';
    if (t === 'trimestre') return 'trimestre';
    if (t === 'periodo') return 'período';
    return 'mês';
  }

  function _qsOverrideComparacao(lado) {
    if (!_comparacao) return {};
    const c = _comparacao;
    const tipo = c.tipo || 'mes_ano';
    if (tipo === 'trimestre') {
      return lado === 2
        ? { trimestre: c.tri2, ano: c.ano2 }
        : { trimestre: c.tri1, ano: c.ano1 };
    }
    if (tipo === 'periodo') {
      return lado === 2
        ? { data_inicio: c.data_inicio2, data_fim: c.data_fim2 }
        : { data_inicio: c.data_inicio1, data_fim: c.data_fim1 };
    }
    return lado === 2
      ? { mes: c.mes2, ano: c.ano2 }
      : { mes: c.mes1, ano: c.ano1 };
  }

  function _periodoTitulo(periodo, etapa) {
    const etapaTxt = etapa ? ` · ${_esc(etapa)}` : '';
    if (_comparacao) {
      return `${_esc(_comparacao.label1)}  ×  ${_esc(_comparacao.label2)}${etapaTxt}`;
    }
    return `${_esc(periodo || '—')}${etapaTxt}`;
  }

  function _deltaParts(n1, n2) {
    const a = Number(n1) || 0;
    const b = Number(n2) || 0;
    const diff = b - a;
    const cls = diff > 0.0001 ? 'up' : (diff < -0.0001 ? 'down' : 'flat');
    let pct = '0%';
    if (a === 0 && b === 0) pct = '0%';
    else if (a === 0) pct = '—';
    else {
      const p = Math.round((diff / Math.abs(a)) * 1000) / 10;
      pct = `${p > 0 ? '+' : ''}${String(p).replace('.', ',')}%`;
    }
    return { a, b, diff, cls, pct };
  }

  function _deltaHtml(n1, n2, money) {
    const { diff, cls, pct } = _deltaParts(n1, n2);
    let num = money ? MOEDA.format(diff) : QTD.format(diff);
    if (!money && diff > 0) num = `+${num}`;
    if (money && diff > 0) num = `+${num}`;
    return `<span class="vend-rel-delta ${cls}">${num} (${pct})</span>`;
  }

  function _mergePorChave(arrA, arrB, chave) {
    const mapA = new Map((arrA || []).map((r) => [r[chave], r]));
    const mapB = new Map((arrB || []).map((r) => [r[chave], r]));
    const keys = [...new Set([...mapA.keys(), ...mapB.keys()])];
    return keys.map((k) => ({ key: k, a: mapA.get(k) || {}, b: mapB.get(k) || {} }));
  }

  function _topMerge(arrA, arrB, chave, valorKey, limit) {
    const merged = _mergePorChave(arrA, arrB, chave);
    merged.sort((x, y) => {
      const vx = Math.max(Number(x.a[valorKey]) || 0, Number(x.b[valorKey]) || 0);
      const vy = Math.max(Number(y.a[valorKey]) || 0, Number(y.b[valorKey]) || 0);
      return vy - vx;
    });
    return merged.slice(0, limit);
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
            <div class="at-rel-ger-report-type">${_comparacao ? 'Comparativo Gerencial de Vendas' : 'Relatório Gerencial de Vendas'}</div>
            <div class="at-rel-ger-periodo">${_periodoTitulo(periodo, etapa)}</div>
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
    const cmp = _emComparacao();
    const l1 = cmp ? _esc(_comparacao.label1) : '';
    const l2 = cmp ? _esc(_comparacao.label2) : '';
    const thFam = cmp
      ? `<th>Família</th><th class="r">${l1}</th><th class="r">${l2}</th><th class="r">Var.</th>`
      : `<th>Família</th><th class="r">Qtd</th><th class="r">Valor</th>`;
    const thCli = cmp
      ? `<th>Cliente</th><th class="r">${l1}</th><th class="r">${l2}</th><th class="r">Var.</th>`
      : `<th>Cliente</th><th class="r">Pedidos</th><th class="r">Valor</th>`;
    const thVend = cmp
      ? `<th>Vendedor</th><th class="r">${l1}</th><th class="r">${l2}</th><th class="r">Var.</th>`
      : `<th>Vendedor</th><th class="r">Pedidos</th><th class="r">Clientes</th><th class="r">Valor</th><th class="r">Ticket</th>`;
    const thPar = cmp
      ? `<th>Família</th><th class="r">${l1}</th><th class="r">${l2}</th><th class="r">Var.</th>`
      : `<th>Família</th><th class="r">Valor</th><th class="r">%</th><th class="r">% Acum.</th>`;
    const und = _unidadeComparacao();
    const notaCmp = cmp
      ? `<p class="vend-rel-cmp-nota">Comparando <strong>${l1}</strong> (azul, mais antigo) com <strong>${l2}</strong> (amarelo, mais recente), na ordem do calendário. A variação é o ${und} novo menos o ${und} antigo.</p>`
      : '';

    pagesWrap.innerHTML = `
      <div class="at-rel-ger-page${_secao === 'executivo' ? ' is-active' : ''}" data-sec="executivo">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-gauge-high"></i> Dashboard Executivo</div>
        <div class="at-rel-ger-body">
          ${notaCmp}
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
          ${notaCmp}
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Valor por Estado</h4><div class="at-rel-ger-chart"><canvas id="vendRelGerChartEstado"></canvas></div></div>
            <div class="at-rel-ger-card"><h4 id="vendRelGerGeoDonutTitulo">Participação por Estado (%)</h4><div class="at-rel-ger-chart"><canvas id="vendRelGerChartEstadoDonut"></canvas></div></div>
          </div>
        </div>
        ${_footerHtml(2)}
      </div>
      <div class="at-rel-ger-page${_secao === 'familias' ? ' is-active' : ''}" data-sec="familias">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-boxes-stacked"></i> Famílias de Produto</div>
        <div class="at-rel-ger-body">
          ${notaCmp}
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Faturamento por Família</h4><div class="at-rel-ger-chart lg"><canvas id="vendRelGerChartFamilia"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Tabela — Família × Valor</h4>
              <div style="overflow:auto;max-height:300px;"><table class="at-rel-ger-tbl"><thead><tr>${thFam}</tr></thead><tbody id="vendRelGerFamiliaBody"></tbody></table></div>
            </div>
          </div>
        </div>
        ${_footerHtml(3)}
      </div>
      <div class="at-rel-ger-page${_secao === 'clientes' ? ' is-active' : ''}" data-sec="clientes">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-users"></i> Principais Clientes</div>
        <div class="at-rel-ger-body">
          ${notaCmp}
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Top Clientes por Valor</h4><div class="at-rel-ger-chart lg"><canvas id="vendRelGerChartCliente"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Tabela — Cliente × Valor</h4>
              <div style="overflow:auto;max-height:300px;"><table class="at-rel-ger-tbl"><thead><tr>${thCli}</tr></thead><tbody id="vendRelGerClienteBody"></tbody></table></div>
            </div>
          </div>
        </div>
        ${_footerHtml(4)}
      </div>
      <div class="at-rel-ger-page${_secao === 'vendedores' ? ' is-active' : ''}" data-sec="vendedores">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-handshake"></i> Vendedores</div>
        <div class="at-rel-ger-body">
          ${notaCmp}
          <div id="vendRelGerKpisVendedor" class="at-rel-ger-kpis"></div>
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Ranking por Faturamento</h4><div class="at-rel-ger-chart lg"><canvas id="vendRelGerChartVendedor"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Tabela — Vendedor × Valor</h4>
              <div style="overflow:auto;max-height:300px;"><table class="at-rel-ger-tbl"><thead><tr>${thVend}</tr></thead><tbody id="vendRelGerVendedorBody"></tbody></table></div>
            </div>
          </div>
        </div>
        ${_footerHtml(5)}
      </div>
      <div class="at-rel-ger-page${_secao === 'evolucao' ? ' is-active' : ''}" data-sec="evolucao">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-chart-column"></i> Evolução no Período</div>
        <div class="at-rel-ger-body">
          ${notaCmp}
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
          ${notaCmp}
          <div class="at-rel-ger-grid-2">
            <div class="at-rel-ger-card"><h4>Pareto por Faturamento</h4><div class="at-rel-ger-chart lg"><canvas id="vendRelGerChartPareto"></canvas></div></div>
            <div class="at-rel-ger-card"><h4>Tabela Pareto</h4>
              <div style="overflow:auto;max-height:300px;"><table class="at-rel-ger-tbl"><thead><tr>${thPar}</tr></thead><tbody id="vendRelGerParetoBody"></tbody></table></div>
            </div>
          </div>
        </div>
        ${_footerHtml(7)}
      </div>
      <div class="at-rel-ger-page${_secao === 'financeiro' ? ' is-active' : ''}" data-sec="financeiro">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-coins"></i> Análise Financeira</div>
        <div class="at-rel-ger-body">
          ${notaCmp}
          <div class="${cmp ? 'at-rel-ger-grid-2' : ''}">
            <div class="at-rel-ger-card">
              <h4 id="vendRelGerFinTituloA">Top Pedidos por Valor</h4>
              <div style="overflow:auto;max-height:360px;">
                <table class="at-rel-ger-tbl"><thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Data</th><th class="r">Valor</th></tr></thead><tbody id="vendRelGerFinanceiroBody"></tbody></table>
              </div>
            </div>
            <div class="at-rel-ger-card" id="vendRelGerFinCardB" style="${cmp ? '' : 'display:none;'}">
              <h4 id="vendRelGerFinTituloB">Top Pedidos — Mês 2</h4>
              <div style="overflow:auto;max-height:360px;">
                <table class="at-rel-ger-tbl"><thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Data</th><th class="r">Valor</th></tr></thead><tbody id="vendRelGerFinanceiroBodyB"></tbody></table>
              </div>
            </div>
          </div>
        </div>
        ${_footerHtml(8)}
      </div>
      <div class="at-rel-ger-page${_secao === 'itens' ? ' is-active' : ''}" data-sec="itens">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-layer-group"></i> Análise de Itens</div>
        <div class="at-rel-ger-body">
          ${notaCmp}
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
          <div id="vendRelGerCmpResumoPlano" class="vend-rel-cmp-resumo" style="${cmp ? '' : 'display:none;'}"></div>
          ${cmp ? `<p class="vend-rel-cmp-nota">O plano de ação fica gravado no período 1 (${l1}).</p>` : ''}
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
          <div id="vendRelGerCmpResumoConc" class="vend-rel-cmp-resumo" style="${cmp ? '' : 'display:none;'}"></div>
          ${cmp ? `<p class="vend-rel-cmp-nota">A conclusão fica gravada no Mês 1 (${l1}).</p>` : ''}
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

  function _renderKpis(kpis, kpisB) {
    const wrap = document.getElementById('vendRelGerKpis');
    if (!wrap) return;
    const cmp = !!(kpisB && _comparacao);
    const l1 = _comparacao?.label1 || 'Mês 1';
    const l2 = _comparacao?.label2 || 'Mês 2';
    const cards = [
      { label: 'Pedidos', key: 'total_pedidos', money: false, cor: '#1e3a5f', kpi: 'pedidos' },
      { label: 'Faturamento', key: 'valor_total', money: true, cor: '#38bdf8', kpi: 'faturamento' },
      { label: 'Ticket médio', key: 'ticket_medio', money: true, cor: '#10b981' },
      { label: 'Clientes', key: 'clientes', money: false, cor: '#f59e0b' },
      { label: 'Estados', key: 'estados_atendidos', money: false, cor: '#8b5cf6' },
      { label: 'Qtd. itens', key: 'quantidade_itens', money: false, cor: '#06b6d4' },
    ];
    wrap.classList.toggle('vend-rel-kpis-cmp', cmp);
    wrap.innerHTML = cards.map((c) => {
      const extra = c.kpi
        ? ` data-kpi="${c.kpi}" class="at-rel-ger-kpi is-clickable${cmp ? ' vend-rel-kpi-cmp' : ''}" title="Clique para ver a lista"`
        : ` class="at-rel-ger-kpi${cmp ? ' vend-rel-kpi-cmp' : ''}"`;
      const v1 = Number(kpis?.[c.key]) || 0;
      if (!cmp) {
        const shown = c.money ? MOEDA.format(v1) : (c.key === 'quantidade_itens' ? QTD.format(v1) : v1);
        return `<div${extra} style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${shown}</div></div>`;
      }
      const v2 = Number(kpisB?.[c.key]) || 0;
      const fmt = (n) => (c.money ? MOEDA.format(n) : QTD.format(n));
      return `<div${extra} style="--kpi-cor:${c.cor}">
        <div class="lbl">${c.label}</div>
        <div class="vend-rel-kpi-duo">
          <div><small>${_esc(l1)}</small><div class="val">${fmt(v1)}</div></div>
          <div><small>${_esc(l2)}</small><div class="val">${fmt(v2)}</div></div>
        </div>
        ${_deltaHtml(v1, v2, c.money)}
      </div>`;
    }).join('');
    wrap.querySelectorAll('[data-kpi]').forEach((el) => {
      el.addEventListener('click', () => _abrirModalRegistros(el.getAttribute('data-kpi')));
    });
  }

  function _codigoFamiliaPorLabel(label) {
    const n = String(label || '').trim().toLowerCase();
    if (!n) return '';
    const hit = (_familiasOpcoes || []).find((f) => String(f.descricao || '').trim().toLowerCase() === n);
    return hit ? String(hit.codigo) : '';
  }

  function _setSelectValor(id, valor, label) {
    const el = document.getElementById(id);
    if (!el) return false;
    const v = String(valor ?? '');
    if (v && ![...el.options].some((o) => o.value === v)) {
      el.appendChild(new Option(label || v, v, true, true));
    }
    el.value = v;
    return true;
  }

  function _drillChips() {
    const chips = [];
    const snap = _drillSnapshot || {};
    const est = document.getElementById('vendRelGerEstado')?.value || '';
    if (est && est !== (snap.estado || '')) chips.push({ t: 'Estado', v: est });
    const vendEl = document.getElementById('vendRelGerVendedor');
    const vend = vendEl?.value || '';
    if (vend && vend !== (snap.vendedor || '')) {
      const nome = vendEl.options[vendEl.selectedIndex]?.text || vend;
      chips.push({ t: 'Vendedor', v: nome });
    }
    const famNow = [..._familiasSelecionadas].sort().join(',');
    const famSnap = [...(snap.familias || [])].sort().join(',');
    if (famNow && famNow !== famSnap) {
      const labels = (_familiasOpcoes || [])
        .filter((f) => _familiasSelecionadas.has(String(f.codigo)))
        .map((f) => f.descricao || f.codigo);
      chips.push({ t: labels.length > 1 ? 'Famílias' : 'Família', v: labels.join(', ') || `${_familiasSelecionadas.size} família(s)` });
    }
    if (_drillExtra.cliente) chips.push({ t: 'Cliente', v: _drillExtra.cliente });
    if (_drillExtra.etapa_pedido) {
      const et = (_data?.por_etapa || []).find((r) => String(r.etapa) === String(_drillExtra.etapa_pedido));
      chips.push({ t: 'Etapa', v: et?.etapa_descricao || _drillExtra.etapa_pedido });
    }
    if (_drillExtra.familia_nome) chips.push({ t: 'Família', v: _drillExtra.familia_nome });
    const modo = (typeof _modoAtual === 'function') ? _modoAtual() : 'mes_ano';
    const mes = document.getElementById('vendRelGerMes')?.value || '';
    const ano = document.getElementById('vendRelGerAno')?.value || '';
    if (snap.modo && (modo !== snap.modo || mes !== (snap.mes || '') || ano !== (snap.ano || ''))) {
      const nomeMes = MESES_NOME[Number(mes) - 1] || mes;
      chips.push({ t: 'Período', v: `${nomeMes}/${ano}` });
    }
    return chips;
  }

  function _atualizarBarraDrill() {
    const bar = document.getElementById('vendRelGerDrillBar');
    const btn = document.getElementById('vendRelGerResetDrillBtn');
    const chips = _drillChips();
    const ativo = chips.length > 0;
    if (btn) btn.style.display = ativo ? 'flex' : 'none';
    if (!ativo) {
      _drillSnapshot = null;
      if (bar) {
        bar.style.display = 'none';
        bar.innerHTML = '';
      }
      return;
    }
    if (!bar) return;
    bar.style.display = 'flex';
    bar.innerHTML = `
      <span class="vend-rel-drill-label"><i class="fa-solid fa-filter"></i> Filtro do gráfico:</span>
      ${chips.map((c) => `<span class="vend-rel-drill-chip"><strong>${_esc(c.t)}:</strong> ${_esc(c.v)}</span>`).join('')}
      <button type="button" id="vendRelGerResetDrillBarBtn" class="vend-rel-drill-reset">
        <i class="fa-solid fa-rotate-left"></i> Resetar filtro
      </button>`;
    document.getElementById('vendRelGerResetDrillBarBtn')?.addEventListener('click', _resetarFiltroGrafico);
  }

  function _garantirSnapshotDrill() {
    if (_drillSnapshot) return;
    _drillSnapshot = {
      estado: document.getElementById('vendRelGerEstado')?.value || '',
      vendedor: document.getElementById('vendRelGerVendedor')?.value || '',
      tipo: document.getElementById('vendRelGerTipo')?.value || '',
      familias: [..._familiasSelecionadas],
      modo: _modoAtual(),
      mes: document.getElementById('vendRelGerMes')?.value || '',
      ano: document.getElementById('vendRelGerAno')?.value || '',
      trimestre: document.getElementById('vendRelGerTrimestre')?.value || '',
      data_inicio: document.getElementById('vendRelGerDataInicio')?.value || '',
      data_fim: document.getElementById('vendRelGerDataFim')?.value || '',
    };
  }

  function _toggleDimSelect(id, valor, label) {
    const el = document.getElementById(id);
    const v = String(valor ?? '');
    if (el && el.value === v) {
      _setSelectValor(id, '', '');
      return;
    }
    _setSelectValor(id, v, label);
  }

  function _aplicarFiltroGrafico(patch) {
    if (!patch || typeof patch !== 'object') return;
    _garantirSnapshotDrill();
    if (patch.estado != null && patch.estado !== '') {
      _toggleDimSelect('vendRelGerEstado', String(patch.estado).trim().toUpperCase(), patch.estado);
    }
    if (patch.vendedor != null && String(patch.vendedor).trim() !== '') {
      let v = String(patch.vendedor).trim();
      if (v && !/^\d+$/.test(v)) {
        const found = [...(_data?.por_vendedor || []), ...(_dataB?.por_vendedor || [])]
          .find((r) => String(r.vendedor || '').trim() === v);
        if (found?.codigo_vendedor) v = String(found.codigo_vendedor);
      }
      _toggleDimSelect('vendRelGerVendedor', v, patch.vendedorLabel || patch.vendedor);
    }
    if (patch.familia != null && String(patch.familia).trim() !== '') {
      const nome = String(patch.familia).trim();
      const cod = _codigoFamiliaPorLabel(nome);
      if (cod) {
        _drillExtra.familia_nome = '';
        if (!_familiasSelecionadas.size) {
          _familiasSelecionadas.add(cod);
        } else if (_familiasSelecionadas.has(cod)) {
          _familiasSelecionadas.delete(cod);
        } else {
          _familiasSelecionadas.add(cod);
        }
        _atualizarLabelFamilia();
        _renderFamiliaLista(document.getElementById('vendRelGerFamiliaBusca')?.value || '');
      } else {
        _drillExtra.familia_nome = (_drillExtra.familia_nome === nome) ? '' : nome;
      }
    }
    if (patch.cliente != null && String(patch.cliente).trim() !== '') {
      const v = String(patch.cliente).trim();
      _drillExtra.cliente = (_drillExtra.cliente === v) ? '' : v;
    }
    if (patch.etapa_pedido != null && String(patch.etapa_pedido).trim() !== '') {
      const v = String(patch.etapa_pedido).trim();
      _drillExtra.etapa_pedido = (_drillExtra.etapa_pedido === v) ? '' : v;
    }
    if (patch.mes_key) {
      const m = String(patch.mes_key).match(/^(\d{4})-(\d{2})$/);
      if (m) {
        _setModoFiltro('mes_ano');
        _setSelectValor('vendRelGerAno', m[1], m[1]);
        _setSelectValor('vendRelGerMes', String(Number(m[2])), MESES_NOME[Number(m[2]) - 1] || m[2]);
      }
    }
    _atualizarBarraDrill();
    _carregar();
  }

  function _resetarFiltroGrafico() {
    const snap = _drillSnapshot;
    _drillExtra.cliente = '';
    _drillExtra.etapa_pedido = '';
    _drillExtra.familia_nome = '';
    if (snap) {
      if (snap.modo) _setModoFiltro(snap.modo);
      _setSelectValor('vendRelGerEstado', snap.estado || '', snap.estado || '');
      _setSelectValor('vendRelGerVendedor', snap.vendedor || '', snap.vendedor || '');
      _setSelectValor('vendRelGerTipo', snap.tipo || '', snap.tipo || '');
      if (snap.mes) _setSelectValor('vendRelGerMes', snap.mes, snap.mes);
      if (snap.ano) _setSelectValor('vendRelGerAno', snap.ano, snap.ano);
      if (snap.trimestre) _setSelectValor('vendRelGerTrimestre', snap.trimestre, snap.trimestre);
      const di = document.getElementById('vendRelGerDataInicio');
      const df = document.getElementById('vendRelGerDataFim');
      if (di && snap.data_inicio != null) di.value = snap.data_inicio;
      if (df && snap.data_fim != null) df.value = snap.data_fim;
      _familiasSelecionadas = new Set(snap.familias || []);
      _atualizarLabelFamilia();
      _renderFamiliaLista(document.getElementById('vendRelGerFamiliaBusca')?.value || '');
    }
    _drillSnapshot = null;
    _atualizarBarraDrill();
    _carregar();
  }

  function _comClique(opts, dim, keys) {
    if (!dim) return opts;
    return {
      ...opts,
      onHover: (evt, els) => {
        if (evt?.native?.target) evt.native.target.style.cursor = els.length ? 'pointer' : 'default';
      },
      onClick: (_evt, els, chart) => {
        if (!els.length) return;
        const el = els[0];
        const labels = chart?.data?.labels || [];
        const valor = (keys && keys[el.index] != null) ? keys[el.index] : labels[el.index];
        if (valor == null || String(valor).trim() === '') return;
        const patch = {};
        if (dim === 'vendedor') {
          patch.vendedor = valor;
          patch.vendedorLabel = labels[el.index];
        } else if (dim === 'etapa_pedido') {
          patch.etapa_pedido = valor;
        } else if (dim === 'mes_key') {
          patch.mes_key = valor;
        } else {
          patch[dim] = valor;
        }
        _aplicarFiltroGrafico(patch);
      },
    };
  }

  function _optsStacked(tipo) {
    const yTicks = tipo === 'itens' ? { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } : { stacked: true, beginAtZero: true };
    return {
      responsive: true,
      maintainAspectRatio: false,
      onHover: (evt, els) => {
        if (evt?.native?.target) evt.native.target.style.cursor = els.length ? 'pointer' : 'default';
      },
      onClick: (_evt, els, chart) => {
        if (!els.length) return;
        const el = els[0];
        if (tipo === 'pareto') {
          _aplicarFiltroGrafico({
            familia: chart.data.labels[el.index],
            estado: chart.data.datasets[el.datasetIndex]?.label,
          });
          return;
        }
        _aplicarFiltroGrafico({ familia: chart.data.datasets[el.datasetIndex]?.label });
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 10 } },
          onClick: (_e, item) => {
            if (tipo === 'pareto') _aplicarFiltroGrafico({ estado: item.text });
            else _aplicarFiltroGrafico({ familia: item.text });
          },
        },
      },
      scales: { x: { stacked: true }, y: yTicks },
    };
  }

  function _chartOptsBarH() {
    return { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { color: '#64748b' }, grid: { color: '#e2e8f0' } }, y: { ticks: { color: '#334155', font: { size: 11 } }, grid: { display: false } } } };
  }

  function _chartOptsBarV() {
    return { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: '#334155' }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: '#64748b' }, grid: { color: '#e2e8f0' } } } };
  }

  function _renderBar(canvasId, key, labels, values, cor, dim, keys) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    canvas.title = 'Clique para filtrar o relatório com este valor';
    _destroyChart(key);
    const base = labels.length > 6 ? _chartOptsBarH() : _chartOptsBarV();
    _charts[key] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: `${cor || CORES[0]}cc`, borderColor: cor || CORES[0], borderWidth: 1, borderRadius: 4 }] },
      options: _comClique(base, dim, keys),
    });
  }

  function _renderBarCmp(canvasId, key, labels, valuesA, valuesB, dim, keys) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    canvas.title = 'Clique para filtrar o relatório com este valor';
    _destroyChart(key);
    const l1 = _comparacao?.label1 || 'Mês 1';
    const l2 = _comparacao?.label2 || 'Mês 2';
    const base = labels.length > 6 ? _chartOptsBarH() : _chartOptsBarV();
    _charts[key] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: l1, data: valuesA, backgroundColor: `${COR_MES1}cc`, borderColor: COR_MES1, borderWidth: 1, borderRadius: 4 },
          { label: l2, data: valuesB, backgroundColor: `${COR_MES2}cc`, borderColor: COR_MES2, borderWidth: 1, borderRadius: 4 },
        ],
      },
      options: _comClique({
        ...base,
        plugins: { ...base.plugins, legend: { display: true, position: 'bottom', labels: { font: { size: 10 } } } },
      }, dim, keys),
    });
  }

  function _renderDonut(canvasId, key, labels, values, dim, keys) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    canvas.title = 'Clique para filtrar o relatório com este valor';
    _destroyChart(key);
    const dimFiltro = dim || 'estado';
    const keysFiltro = keys || labels;
    _charts[key] = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: labels.map((_, i) => CORES[i % CORES.length]), borderColor: '#fff', borderWidth: 2 }] },
      options: _comClique({
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { font: { size: 10 } },
            onClick: (_e, item) => {
              const valor = (keysFiltro && keysFiltro[item.index] != null) ? keysFiltro[item.index] : labels[item.index];
              if (valor == null || String(valor).trim() === '') return;
              _aplicarFiltroGrafico({ [dimFiltro]: valor });
            },
          },
        },
      }, dimFiltro, keysFiltro),
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
    const dataB = _emComparacao() ? _dataB : null;
    const est = (data.por_estado || []).slice(0, 12);
    const fam = (data.por_familia || []).slice(0, 10);
    const cli = (data.por_cliente || []).slice(0, 10);
    const etapas = data.por_etapa || [];

    if (sec === 'executivo') {
      if (dataB) {
        const et = _topMerge(etapas, dataB.por_etapa || [], 'etapa_descricao', 'total', 12);
        _renderBarCmp('vendRelGerChartEtapa', 'etapa', et.map((r) => r.key), et.map((r) => r.a.total || 0), et.map((r) => r.b.total || 0), 'etapa_pedido', et.map((r) => r.a.etapa || r.b.etapa || r.key));
        const es = _topMerge(data.por_estado || [], dataB.por_estado || [], 'estado', 'valor_total', 8);
        _renderBarCmp('vendRelGerChartValorEstado', 'valorEstado', es.map((r) => r.key), es.map((r) => r.a.valor_total || 0), es.map((r) => r.b.valor_total || 0), 'estado');
      } else {
        _renderBar('vendRelGerChartEtapa', 'etapa', etapas.map(r => r.etapa_descricao), etapas.map(r => r.total), '#38bdf8', 'etapa_pedido', etapas.map(r => r.etapa));
        _renderBar('vendRelGerChartValorEstado', 'valorEstado', est.slice(0, 8).map(r => r.estado), est.slice(0, 8).map(r => r.valor_total), '#1e3a5f', 'estado');
      }
    }
    if (sec === 'geografico') {
      const donutTitulo = document.getElementById('vendRelGerGeoDonutTitulo');
      if (dataB) {
        const es = _topMerge(data.por_estado || [], dataB.por_estado || [], 'estado', 'valor_total', 12);
        const labs = es.map((r) => r.key);
        _renderBarCmp('vendRelGerChartEstado', 'estado', labs, es.map((r) => r.a.valor_total || 0), es.map((r) => r.b.valor_total || 0), 'estado');
        _renderBarCmp('vendRelGerChartEstadoDonut', 'estadoDonut', labs, es.map((r) => r.a.valor_total || 0), es.map((r) => r.b.valor_total || 0), 'estado');
        if (donutTitulo) donutTitulo.textContent = 'Comparativo por Estado';
      } else {
        _renderBar('vendRelGerChartEstado', 'estado', est.map(r => r.estado), est.map(r => r.valor_total), '#1e3a5f', 'estado');
        _renderDonut('vendRelGerChartEstadoDonut', 'estadoDonut', est.map(r => r.estado), est.map(r => r.valor_total), 'estado');
        if (donutTitulo) donutTitulo.textContent = 'Participação por Estado (%)';
      }
    }
    if (sec === 'familias') {
      if (dataB) {
        const rows = _topMerge(data.por_familia || [], dataB.por_familia || [], 'familia', 'valor_total', 10);
        _renderBarCmp('vendRelGerChartFamilia', 'familia', rows.map((r) => r.key), rows.map((r) => r.a.valor_total || 0), rows.map((r) => r.b.valor_total || 0), 'familia');
      } else {
        _renderBar('vendRelGerChartFamilia', 'familia', fam.map(r => r.familia), fam.map(r => r.valor_total), '#10b981', 'familia');
      }
    }
    if (sec === 'clientes') {
      if (dataB) {
        const rows = _topMerge(data.por_cliente || [], dataB.por_cliente || [], 'cliente', 'valor_total', 10);
        _renderBarCmp('vendRelGerChartCliente', 'cliente', rows.map((r) => r.key), rows.map((r) => r.a.valor_total || 0), rows.map((r) => r.b.valor_total || 0), 'cliente');
      } else {
        _renderBar('vendRelGerChartCliente', 'cliente', cli.map(r => r.cliente), cli.map(r => r.valor_total), '#f59e0b', 'cliente');
      }
    }
    if (sec === 'vendedores') {
      if (dataB) {
        const rows = _topMerge(data.por_vendedor || [], dataB.por_vendedor || [], 'codigo_vendedor', 'valor_total', 12);
        _renderBarCmp(
          'vendRelGerChartVendedor',
          'vendedor',
          rows.map((r) => r.a.vendedor || r.b.vendedor || r.key),
          rows.map((r) => r.a.valor_total || 0),
          rows.map((r) => r.b.valor_total || 0),
          'vendedor',
          rows.map((r) => r.key)
        );
      } else {
        const vend = (data.por_vendedor || []).slice(0, 12);
        _renderBar('vendRelGerChartVendedor', 'vendedor', vend.map(r => r.vendedor), vend.map(r => r.valor_total), '#6366f1', 'vendedor', vend.map(r => r.codigo_vendedor));
      }
    }
    if (sec === 'evolucao') {
      const multi = data.evolucao_tipo === 'mes' || dataB?.evolucao_tipo === 'mes';
      const titulo = document.getElementById('vendRelGerEvolTitulo');
      if (titulo) titulo.textContent = multi ? 'Faturamento mensal' : 'Faturamento semanal';
      const rowsA = multi ? (data.evolucao_mensal || []) : (data.evolucao_semanal || []);
      if (dataB) {
        const rowsB = multi ? (dataB.evolucao_mensal || []) : (dataB.evolucao_semanal || []);
        const chave = multi ? 'mes' : 'semana';
        const merged = _mergePorChave(rowsA, rowsB, chave);
        merged.sort((x, y) => String(x.key).localeCompare(String(y.key), 'pt-BR', { numeric: true }));
        const labels = merged.map((r) => r.a.label || r.b.label || r.key);
        const keys = multi ? merged.map((r) => r.key) : null;
        _renderBarCmp('vendRelGerChartEvol', 'evol', labels, merged.map((r) => r.a.valor_total || 0), merged.map((r) => r.b.valor_total || 0), multi ? 'mes_key' : null, keys);
        _renderBarCmp('vendRelGerChartEvolPedidos', 'evolPed', labels, merged.map((r) => r.a.total_pedidos || 0), merged.map((r) => r.b.total_pedidos || 0), multi ? 'mes_key' : null, keys);
      } else {
        const labels = multi ? rowsA.map(r => r.label) : rowsA.map(r => r.semana);
        const keys = multi ? rowsA.map(r => r.mes) : null;
        _renderBar('vendRelGerChartEvol', 'evol', labels, rowsA.map(r => r.valor_total), '#38bdf8', multi ? 'mes_key' : null, keys);
        _renderBar('vendRelGerChartEvolPedidos', 'evolPed', labels, rowsA.map(r => r.total_pedidos), '#8b5cf6', multi ? 'mes_key' : null, keys);
      }
    }
    if (sec === 'pareto') {
      const canvas = document.getElementById('vendRelGerChartPareto');
      if (canvas && typeof Chart !== 'undefined') {
        canvas.title = 'Clique para filtrar o relatório com este valor';
        _destroyChart('pareto');
        if (dataB) {
          const rows = _topMerge(data.pareto || [], dataB.pareto || [], 'familia', 'valor_total', 10);
          _renderBarCmp('vendRelGerChartPareto', 'pareto', rows.map((r) => r.key), rows.map((r) => r.a.valor_total || 0), rows.map((r) => r.b.valor_total || 0), 'familia');
        } else {
          const stacked = _dadosParetoStacked(data);
          _charts.pareto = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels: stacked.labels, datasets: stacked.datasets },
            options: _optsStacked('pareto'),
          });
        }
      }
    }
    if (sec === 'itens') {
      const rows = data.analise_itens?.por_mes_familia || [];
      const canvas = document.getElementById('vendRelGerChartItens');
      if (canvas) canvas.title = 'Clique para filtrar o relatório com este valor';
      const info = document.getElementById('vendRelGerItensInfo');
      const resumo = document.getElementById('vendRelGerItensResumo');
      const tituloItens = document.getElementById('vendRelGerItensChartTitle');
      if (dataB) {
        const famA = data.por_familia || [];
        const famB = dataB.por_familia || [];
        const merged = _topMerge(famA, famB, 'familia', 'quantidade', 10);
        _renderBarCmp('vendRelGerChartItens', 'itens', merged.map((r) => r.key), merged.map((r) => r.a.quantidade || 0), merged.map((r) => r.b.quantidade || 0), 'familia');
        if (tituloItens) tituloItens.textContent = 'Quantidade de itens por família';
        const q1 = Number(data.kpis?.quantidade_itens) || 0;
        const q2 = Number(dataB.kpis?.quantidade_itens) || 0;
        if (info) info.textContent = `${_comparacao.label1}: ${QTD.format(q1)} item(ns)  ·  ${_comparacao.label2}: ${QTD.format(q2)} item(ns)`;
        if (resumo) resumo.innerHTML = `Variação de itens: ${_deltaHtml(q1, q2, false)}`;
      } else {
        const stacked = _buildItensStacked(rows);
        if (canvas && typeof Chart !== 'undefined') {
          _destroyChart('itens');
          _charts.itens = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels: stacked.labels, datasets: stacked.datasets },
            options: _optsStacked('itens'),
          });
        }
        if (tituloItens) tituloItens.textContent = 'Itens por mês de NF e família';
        const janela = data.analise_itens?.janela || {};
        if (info) info.textContent = `Pedidos no período ${data.periodo || '—'} · ${janela.total_itens || 0} item(ns) com NF no gráfico por mês de emissão`;
        if (resumo) {
          const totalQtd = rows.reduce((s, r) => s + (r.quantidade || 0), 0);
          resumo.innerHTML = `<strong>${totalQtd}</strong> unidade(s) em <strong>${stacked.mesesOrd.length}</strong> mês(es) de NF e <strong>${stacked.topFam.length}</strong> família(s) no gráfico.`;
        }
      }
    }
    _chartsRendered.add(sec);
  }

  function _linhasFinanceiro(rows) {
    if (!rows?.length) return '<tr><td colspan="5" style="text-align:center;color:#94a3b8;">Nenhum pedido no período.</td></tr>';
    return rows.map(r => `<tr><td>${_esc(r.numero_pedido || r.codigo_pedido)}</td><td>${_esc(r.cliente)}</td><td>${_esc(r.estado)}</td><td>${_fmtData(r.data)}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`).join('');
  }

  function _htmlResumoComparacao() {
    if (!_emComparacao()) return '';
    const a = _data?.kpis || {};
    const b = _dataB?.kpis || {};
    const l1 = _esc(_comparacao.label1);
    const l2 = _esc(_comparacao.label2);
    const linhas = [
      ['Pedidos', a.total_pedidos, b.total_pedidos, false],
      ['Faturamento', a.valor_total, b.valor_total, true],
      ['Ticket médio', a.ticket_medio, b.ticket_medio, true],
      ['Clientes', a.clientes, b.clientes, false],
    ];
    return `<table class="at-rel-ger-tbl"><thead><tr><th>Indicador</th><th class="r">${l1}</th><th class="r">${l2}</th><th class="r">Var.</th></tr></thead><tbody>${
      linhas.map(([lab, v1, v2, money]) => `<tr><td>${lab}</td><td class="r">${money ? MOEDA.format(v1 || 0) : QTD.format(v1 || 0)}</td><td class="r">${money ? MOEDA.format(v2 || 0) : QTD.format(v2 || 0)}</td><td class="r">${_deltaHtml(v1, v2, money)}</td></tr>`).join('')
    }</tbody></table>`;
  }

  function _renderTabelas(data) {
    const dataB = _emComparacao() ? _dataB : null;
    const famBody = document.getElementById('vendRelGerFamiliaBody');
    if (famBody) {
      if (dataB) {
        const rows = _topMerge(data.por_familia || [], dataB.por_familia || [], 'familia', 'valor_total', 20);
        famBody.innerHTML = rows.length
          ? rows.map((r) => `<tr><td>${_esc(r.key)}</td><td class="r">${MOEDA.format(r.a.valor_total || 0)}</td><td class="r">${MOEDA.format(r.b.valor_total || 0)}</td><td class="r">${_deltaHtml(r.a.valor_total, r.b.valor_total, true)}</td></tr>`).join('')
          : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Nenhuma família no período.</td></tr>';
      } else {
        const rows = data.por_familia || [];
        famBody.innerHTML = rows.length
          ? rows.map(r => `<tr><td>${_esc(r.familia)}</td><td class="r">${QTD.format(r.quantidade || 0)}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`).join('')
          : '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">Nenhuma família no período.</td></tr>';
      }
    }
    const cliBody = document.getElementById('vendRelGerClienteBody');
    if (cliBody) {
      if (dataB) {
        const rows = _topMerge(data.por_cliente || [], dataB.por_cliente || [], 'cliente', 'valor_total', 20);
        cliBody.innerHTML = rows.length
          ? rows.map((r) => `<tr><td>${_esc(r.key)}</td><td class="r">${MOEDA.format(r.a.valor_total || 0)}</td><td class="r">${MOEDA.format(r.b.valor_total || 0)}</td><td class="r">${_deltaHtml(r.a.valor_total, r.b.valor_total, true)}</td></tr>`).join('')
          : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Nenhum cliente no período.</td></tr>';
      } else {
        const rows = data.por_cliente || [];
        cliBody.innerHTML = rows.length
          ? rows.map(r => `<tr><td>${_esc(r.cliente)}</td><td class="r">${r.total}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td></tr>`).join('')
          : '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">Nenhum cliente no período.</td></tr>';
      }
    }
    const vendBody = document.getElementById('vendRelGerVendedorBody');
    if (vendBody) {
      if (dataB) {
        const rows = _topMerge(data.por_vendedor || [], dataB.por_vendedor || [], 'vendedor', 'valor_total', 30);
        vendBody.innerHTML = rows.length
          ? rows.map((r) => `<tr><td>${_esc(r.key)}</td><td class="r">${MOEDA.format(r.a.valor_total || 0)}</td><td class="r">${MOEDA.format(r.b.valor_total || 0)}</td><td class="r">${_deltaHtml(r.a.valor_total, r.b.valor_total, true)}</td></tr>`).join('')
          : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Nenhum vendedor no período.</td></tr>';
      } else {
        const rows = data.por_vendedor || [];
        vendBody.innerHTML = rows.length
          ? rows.map(r => `<tr><td>${_esc(r.vendedor)}</td><td class="r">${r.total_pedidos}</td><td class="r">${r.clientes}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td><td class="r">${MOEDA.format(r.ticket_medio || 0)}</td></tr>`).join('')
          : '<tr><td colspan="5" style="text-align:center;color:#94a3b8;">Nenhum vendedor no período.</td></tr>';
      }
    }
    const vendKpis = document.getElementById('vendRelGerKpisVendedor');
    if (vendKpis) {
      const rows = data.por_vendedor || [];
      const rowsB = dataB?.por_vendedor || [];
      const totalV = rows.length;
      const fatV = rows.reduce((s, r) => s + (r.valor_total || 0), 0);
      const top = rows[0];
      if (dataB) {
        const fatB = rowsB.reduce((s, r) => s + (r.valor_total || 0), 0);
        const l1 = _esc(_comparacao.label1);
        const l2 = _esc(_comparacao.label2);
        vendKpis.innerHTML = [
          { label: 'Vendedores', html: `<div class="vend-rel-kpi-duo"><div><small>${l1}</small><div class="val">${totalV}</div></div><div><small>${l2}</small><div class="val">${rowsB.length}</div></div></div>${_deltaHtml(totalV, rowsB.length, false)}`, cor: '#6366f1' },
          { label: 'Faturamento', html: `<div class="vend-rel-kpi-duo"><div><small>${l1}</small><div class="val">${MOEDA.format(fatV)}</div></div><div><small>${l2}</small><div class="val">${MOEDA.format(fatB)}</div></div></div>${_deltaHtml(fatV, fatB, true)}`, cor: '#38bdf8' },
        ].map((c) => `<div class="at-rel-ger-kpi vend-rel-kpi-cmp" style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div>${c.html}</div>`).join('');
      } else {
        const cards = [
          { label: 'Vendedores ativos', value: totalV, cor: '#6366f1' },
          { label: 'Faturamento (vendedores)', value: MOEDA.format(fatV), cor: '#38bdf8' },
          { label: 'Top vendedor', value: top ? _esc(top.vendedor) : '—', cor: '#10b981' },
          { label: 'Valor top', value: top ? MOEDA.format(top.valor_total || 0) : '—', cor: '#f59e0b' },
        ];
        vendKpis.innerHTML = cards.map(c => `<div class="at-rel-ger-kpi" style="--kpi-cor:${c.cor}"><div class="lbl">${c.label}</div><div class="val">${c.value}</div></div>`).join('');
      }
    }
    const parBody = document.getElementById('vendRelGerParetoBody');
    if (parBody) {
      if (dataB) {
        const rows = _topMerge(data.pareto || [], dataB.pareto || [], 'familia', 'valor_total', 20);
        parBody.innerHTML = rows.length
          ? rows.map((r) => `<tr><td>${_esc(r.key)}</td><td class="r">${MOEDA.format(r.a.valor_total || 0)}</td><td class="r">${MOEDA.format(r.b.valor_total || 0)}</td><td class="r">${_deltaHtml(r.a.valor_total, r.b.valor_total, true)}</td></tr>`).join('')
          : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Sem dados.</td></tr>';
      } else {
        const rows = data.pareto || [];
        parBody.innerHTML = rows.length
          ? rows.map(r => `<tr><td>${_esc(r.familia)}</td><td class="r">${MOEDA.format(r.valor_total || 0)}</td><td class="r">${r.pct}%</td><td class="r">${r.pct_acum}%</td></tr>`).join('')
          : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Sem dados.</td></tr>';
      }
    }
    const finBody = document.getElementById('vendRelGerFinanceiroBody');
    if (finBody) finBody.innerHTML = _linhasFinanceiro(data.financeiro || []);
    const finBodyB = document.getElementById('vendRelGerFinanceiroBodyB');
    if (finBodyB) finBodyB.innerHTML = _linhasFinanceiro(dataB?.financeiro || []);
    const titA = document.getElementById('vendRelGerFinTituloA');
    const titB = document.getElementById('vendRelGerFinTituloB');
    if (titA) titA.textContent = dataB ? `Top Pedidos — ${_comparacao.label1}` : 'Top Pedidos por Valor';
    if (titB) titB.textContent = dataB ? `Top Pedidos — ${_comparacao.label2}` : 'Top Pedidos — Mês 2';

    const resumoHtml = _htmlResumoComparacao();
    ['vendRelGerCmpResumoPlano', 'vendRelGerCmpResumoConc'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = resumoHtml;
    });
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

  async function _fetchRelatorio(qs, signal) {
    const resp = await fetch(`/api/sac/vendas/relatorio-gerencial?${qs}`, {
      credentials: 'include',
      signal,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || 'Erro ao carregar relatório.');
    return data;
  }

  async function _carregar() {
    const geracao = ++_carregarGeracao;
    const statusEl = document.getElementById('vendRelGerStatus');
    const erroEl = document.getElementById('vendRelGerErro');
    const conteudoEl = document.getElementById('vendRelGerConteudo');
    const aplicarBtn = document.getElementById('vendRelGerAplicarBtn');
    const resetBtn = document.getElementById('vendRelGerResetDrillBtn');
    const jaTemConteudo = !!(conteudoEl && conteudoEl.style.display !== 'none' && _data);

    if (_carregarAbort) _carregarAbort.abort();
    _carregarAbort = new AbortController();

    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.classList.toggle('is-inline', jaTemConteudo);
      const span = statusEl.querySelector('.at-rel-ger-loading-inner span');
      if (span) span.textContent = jaTemConteudo ? 'Atualizando relatório...' : 'Gerando relatório...';
    }
    if (conteudoEl && jaTemConteudo) {
      conteudoEl.style.opacity = '0.55';
      conteudoEl.style.pointerEvents = 'none';
    }
    if (erroEl) erroEl.style.display = 'none';
    if (aplicarBtn) {
      aplicarBtn.disabled = true;
      aplicarBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Aplicando...';
    }
    if (resetBtn) resetBtn.disabled = true;

    try {
      const signal = _carregarAbort.signal;
      let data;
      if (_comparacao) {
        const [dataA, dataB] = await Promise.all([
          _fetchRelatorio(_filtrosQueryParams(_qsOverrideComparacao(1)), signal),
          _fetchRelatorio(_filtrosQueryParams(_qsOverrideComparacao(2)), signal),
        ]);
        data = dataA;
        _dataB = dataB;
      } else {
        data = await _fetchRelatorio(_filtrosQueryParams(), signal);
        _dataB = null;
      }

      if (geracao !== _carregarGeracao) return;

      _destroyAllCharts();
      _data = data;
      _textos = _resolverTextos(data);
      _atualizarBotaoComparar();
      _montarPaginas();
      _renderKpis(data.kpis || {}, _dataB?.kpis);
      _renderTabelas(data);
      _renderTextos();
      _renderChartsSecao(_secao, data);
      _atualizarBarraDrill();

      if (statusEl) {
        statusEl.style.display = 'none';
        statusEl.classList.remove('is-inline');
      }
      if (conteudoEl) {
        conteudoEl.style.display = 'block';
        conteudoEl.style.opacity = '';
        conteudoEl.style.pointerEvents = '';
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;
      }
      if (statusEl) {
        statusEl.style.display = 'none';
        statusEl.classList.remove('is-inline');
      }
      if (conteudoEl) {
        conteudoEl.style.opacity = '';
        conteudoEl.style.pointerEvents = '';
      }
      if (erroEl) { erroEl.style.display = 'block'; erroEl.textContent = err.message || 'Erro.'; }
    } finally {
      if (geracao !== _carregarGeracao) return;
      if (aplicarBtn) {
        aplicarBtn.disabled = false;
        aplicarBtn.innerHTML = HTML_APLICAR;
      }
      if (resetBtn) resetBtn.disabled = false;
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
      #vendRelGerRegistrosModal tr.is-clickable { cursor: pointer; }
      #vendRelGerRegistrosModal tr.is-clickable:hover td { background: #eff6ff; }
      #vendRelGerRegistrosModal .vend-rel-export-btns { display: flex; gap: 6px; flex-shrink: 0; }
      #vendRelGerRegistrosModal .vend-rel-export-btns button {
        padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff;
        color: #334155; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
      }
      #vendRelGerRegistrosModal .vend-rel-export-btns button:hover { background: #f1f5f9; border-color: #94a3b8; }
      #vendRelGerRegistrosModal .vend-rel-export-btns button:disabled { opacity: .6; cursor: wait; }
      #vendRelGerItensModal { z-index: 10080; }
      #vendRelGerItensModal .at-rel-ger-lote-modal-card { max-width: 860px; }
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
      #vendRelGerCompararBtn.is-on {
        border-color: #f59e0b !important;
        background: rgba(245,158,11,.28) !important;
        color: #fde68a !important;
      }
      .vend-rel-cmp-nota {
        font-size: 12px; color: #475569; margin: 0 0 12px; padding: 8px 10px;
        background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px;
      }
      .vend-rel-delta { font-size: 11px; font-weight: 700; }
      .vend-rel-delta.up { color: #15803d; }
      .vend-rel-delta.down { color: #b91c1c; }
      .vend-rel-delta.flat { color: #64748b; }
      .vend-rel-kpi-duo { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 4px 0; }
      .vend-rel-kpi-duo small { display: block; font-size: 9px; color: #64748b; font-weight: 700; text-transform: uppercase; }
      .at-rel-ger-kpi.vend-rel-kpi-cmp .val { font-size: 14px; }
      .vend-rel-cmp-resumo { margin-bottom: 12px; }
      .vend-rel-cmp-field { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 150px; }
      .vend-rel-cmp-field label { font-size: 11px; font-weight: 700; color: #94a3b8; }
      .vend-rel-cmp-field select {
        padding: 8px 10px; border-radius: 8px; border: 1px solid #374151;
        background: #111827; color: #e5e7eb; font-size: 13px;
      }
      #vendRelGerCmpErro { font-size: 12px; color: #f87171; min-height: 16px; margin-top: 8px; }
      #vendRelGerAplicarBtn:disabled { cursor: wait; opacity: .9; }
      #vendRelGerResetDrillBtn:disabled { cursor: wait; opacity: .85; }
      #vendRelGerStatus.at-rel-ger-loading.is-inline {
        margin-top: 10px; padding: 10px 16px;
        background: rgba(14,165,233,.12); border: 1px solid #0ea5e9;
      }
      #vendRelGerStatus.at-rel-ger-loading.is-inline .at-rel-ger-loading-inner {
        flex-direction: row; gap: 10px;
      }
      #vendRelGerStatus.at-rel-ger-loading.is-inline .at-rel-ger-loading-inner i { font-size: 18px; color: #38bdf8; }
      #vendRelGerStatus.at-rel-ger-loading.is-inline .at-rel-ger-loading-inner small { display: none; }
      .vend-rel-drill-bar {
        display: none; align-items: center; gap: 8px; flex-wrap: wrap;
        margin-top: 10px; padding: 8px 12px; border-radius: 10px;
        border: 1px solid #0ea5e9; background: rgba(14,165,233,.12);
      }
      .vend-rel-drill-label { font-size: 12px; font-weight: 700; color: #7dd3fc; display: flex; align-items: center; gap: 6px; }
      .vend-rel-drill-chip {
        font-size: 12px; color: #e2e8f0; background: #0f172a; border: 1px solid #334155;
        border-radius: 999px; padding: 4px 10px;
      }
      .vend-rel-drill-chip strong { color: #7dd3fc; margin-right: 4px; }
      .vend-rel-drill-reset, #vendRelGerResetDrillBtn {
        padding: 6px 14px; border-radius: 8px; border: 1px solid #f87171;
        background: rgba(248,113,113,.18); color: #fecaca; cursor: pointer;
        display: none; align-items: center; gap: 6px; font-size: 13px; font-weight: 700;
      }
      .vend-rel-drill-reset { display: inline-flex; }
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

  function _injetarBotaoResetDrill() {
    if (document.getElementById('vendRelGerResetDrillBtn')) return;
    const filtro = document.getElementById('vendRelGerFiltroBtn');
    const cfg = document.getElementById('vendRelGerConfigBtn');
    const parent = filtro?.parentElement || cfg?.parentElement;
    if (!parent) return;
    const btn = document.createElement('button');
    btn.id = 'vendRelGerResetDrillBtn';
    btn.type = 'button';
    btn.title = 'Limpar os filtros feitos pelo clique nos gráficos';
    btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Resetar filtro';
    btn.style.display = 'none';
    if (filtro && filtro.nextSibling) parent.insertBefore(btn, filtro.nextSibling);
    else if (cfg) parent.insertBefore(btn, cfg);
    else parent.appendChild(btn);
    btn.addEventListener('click', _resetarFiltroGrafico);
  }

  function _injetarBarraDrill() {
    if (document.getElementById('vendRelGerDrillBar')) return;
    const bar = document.getElementById('vendRelGerFiltrosBar');
    const host = bar?.parentElement;
    if (!host) return;
    const drill = document.createElement('div');
    drill.id = 'vendRelGerDrillBar';
    drill.className = 'vend-rel-drill-bar';
    drill.style.display = 'none';
    host.insertBefore(drill, bar.nextSibling);
  }

  function _injetarBotaoComparar() {
    if (document.getElementById('vendRelGerCompararBtn')) return;
    const cfg = document.getElementById('vendRelGerConfigBtn');
    if (!cfg?.parentElement) return;
    const btn = document.createElement('button');
    btn.id = 'vendRelGerCompararBtn';
    btn.type = 'button';
    btn.title = 'Comparar dois meses';
    btn.style.cssText = 'padding:6px 14px;border-radius:8px;border:1px solid #f59e0b;background:rgba(245,158,11,.15);color:#fcd34d;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;';
    btn.innerHTML = '<i class="fa-solid fa-arrow-right-arrow-left"></i> Comparar';
    cfg.parentElement.insertBefore(btn, cfg);
  }

  function _atualizarBotaoComparar() {
    const btn = document.getElementById('vendRelGerCompararBtn');
    if (!btn) return;
    const on = !!_comparacao;
    const modo = _modoAtual();
    const tituloOff = modo === 'trimestre'
      ? 'Comparar dois trimestres'
      : (modo === 'periodo' ? 'Comparar dois períodos' : 'Comparar dois meses');
    btn.classList.toggle('is-on', on);
    btn.innerHTML = on
      ? '<i class="fa-solid fa-arrow-right-arrow-left"></i> Comparando'
      : '<i class="fa-solid fa-arrow-right-arrow-left"></i> Comparar';
    btn.title = on ? `${_comparacao.label1} × ${_comparacao.label2}` : tituloOff;
  }

  function _anosDisponiveis() {
    const el = document.getElementById('vendRelGerAno');
    const yNow = new Date().getFullYear();
    const fromSel = el ? [...el.options].map((o) => Number(o.value)).filter((n) => n >= 2000) : [];
    const set = new Set(fromSel.length ? fromSel : [yNow, yNow - 1]);
    set.add(yNow);
    return [...set].sort((a, b) => b - a);
  }

  function _syncModalCompararUi() {
    const modo = _modoAtual();
    const titulo = document.getElementById('vendRelGerCmpTitulo');
    const ajuda = document.getElementById('vendRelGerCmpAjuda');
    const wrapMes = document.getElementById('vendRelGerCmpWrapMes');
    const wrapTri = document.getElementById('vendRelGerCmpWrapTri');
    const wrapPer = document.getElementById('vendRelGerCmpWrapPeriodo');
    if (titulo) {
      titulo.innerHTML = modo === 'trimestre'
        ? '<i class="fa-solid fa-arrow-right-arrow-left" style="color:#f59e0b;"></i> Comparar trimestres'
        : (modo === 'periodo'
          ? '<i class="fa-solid fa-arrow-right-arrow-left" style="color:#f59e0b;"></i> Comparar períodos'
          : '<i class="fa-solid fa-arrow-right-arrow-left" style="color:#f59e0b;"></i> Comparar meses');
    }
    if (ajuda) {
      ajuda.textContent = modo === 'trimestre'
        ? 'Escolha dois trimestres. Não importa a ordem: o relatório sempre mostra do mais antigo para o mais recente (como no calendário).'
        : (modo === 'periodo'
          ? 'Escolha dois intervalos de data. Não importa a ordem: o relatório sempre mostra do mais antigo para o mais recente.'
          : 'Escolha dois meses. Não importa a ordem: o relatório sempre mostra do mais antigo para o mais recente (como no calendário).');
    }
    if (wrapMes) wrapMes.style.display = modo === 'mes_ano' ? 'flex' : 'none';
    if (wrapTri) wrapTri.style.display = modo === 'trimestre' ? 'flex' : 'none';
    if (wrapPer) wrapPer.style.display = modo === 'periodo' ? 'flex' : 'none';
  }

  function _preencherSelectsComparar() {
    const modo = _modoAtual();
    _syncModalCompararUi();
    const now = new Date();
    const anos = _anosDisponiveis();
    const err = document.getElementById('vendRelGerCmpErro');
    if (err) err.textContent = '';
    const sair = document.getElementById('vendRelGerCmpSair');
    if (sair) sair.style.display = _comparacao ? 'inline-flex' : 'none';

    if (modo === 'trimestre') {
      const triAtual = Number.parseInt(document.getElementById('vendRelGerTrimestre')?.value, 10) || _trimestreAtual();
      const anoAtual = Number.parseInt(document.getElementById('vendRelGerAno')?.value, 10) || now.getFullYear();
      let tri1 = _comparacao?.tipo === 'trimestre' ? _comparacao.tri1 : null;
      let ano1 = _comparacao?.tipo === 'trimestre' ? _comparacao.ano1 : null;
      let tri2 = _comparacao?.tipo === 'trimestre' ? _comparacao.tri2 : null;
      let ano2 = _comparacao?.tipo === 'trimestre' ? _comparacao.ano2 : null;
      if (!tri1 || !ano1 || !tri2 || !ano2) {
        // Mesmo trimestre do ano anterior × trimestre atual (como no modo mês)
        tri2 = triAtual;
        ano2 = anoAtual;
        tri1 = triAtual;
        ano1 = anoAtual - 1;
      } else {
        const [antigo, novo] = _ordenarCronologicoTri(
          { tri: tri1, ano: ano1 },
          { tri: tri2, ano: ano2 }
        );
        tri1 = antigo.tri; ano1 = antigo.ano;
        tri2 = novo.tri; ano2 = novo.ano;
      }
      if (!anos.includes(ano1)) anos.push(ano1);
      if (!anos.includes(ano2)) anos.push(ano2);
      anos.sort((a, b) => b - a);
      const anosHtml = anos.map((y) => `<option value="${y}">${y}</option>`).join('');
      const elT1 = document.getElementById('vendRelGerCmpTri1');
      const elA1 = document.getElementById('vendRelGerCmpAnoTri1');
      const elT2 = document.getElementById('vendRelGerCmpTri2');
      const elA2 = document.getElementById('vendRelGerCmpAnoTri2');
      if (elT1) elT1.innerHTML = _opcoesTrimestreHtml(tri1);
      if (elT2) elT2.innerHTML = _opcoesTrimestreHtml(tri2);
      if (elA1) { elA1.innerHTML = anosHtml; elA1.value = String(ano1); }
      if (elA2) { elA2.innerHTML = anosHtml; elA2.value = String(ano2); }
      return;
    }

    if (modo === 'periodo') {
      const di = document.getElementById('vendRelGerDataInicio')?.value || '';
      const df = document.getElementById('vendRelGerDataFim')?.value || '';
      let ini1 = _comparacao?.tipo === 'periodo' ? _comparacao.data_inicio1 : '';
      let fim1 = _comparacao?.tipo === 'periodo' ? _comparacao.data_fim1 : '';
      let ini2 = _comparacao?.tipo === 'periodo' ? _comparacao.data_inicio2 : '';
      let fim2 = _comparacao?.tipo === 'periodo' ? _comparacao.data_fim2 : '';
      if (!ini1 || !fim1 || !ini2 || !fim2) {
        ini2 = di;
        fim2 = df;
        if (ini2 && fim2) {
          const a = new Date(`${ini2}T12:00:00`);
          const b = new Date(`${fim2}T12:00:00`);
          const dias = Math.max(0, Math.round((b - a) / 86400000));
          const fimAnt = new Date(a);
          fimAnt.setDate(fimAnt.getDate() - 1);
          const iniAnt = new Date(fimAnt);
          iniAnt.setDate(iniAnt.getDate() - dias);
          const pad = (n) => String(n).padStart(2, '0');
          const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          ini1 = ymd(iniAnt);
          fim1 = ymd(fimAnt);
        }
      }
      const elI1 = document.getElementById('vendRelGerCmpDataIni1');
      const elF1 = document.getElementById('vendRelGerCmpDataFim1');
      const elI2 = document.getElementById('vendRelGerCmpDataIni2');
      const elF2 = document.getElementById('vendRelGerCmpDataFim2');
      if (elI1) elI1.value = ini1 || '';
      if (elF1) elF1.value = fim1 || '';
      if (elI2) elI2.value = ini2 || '';
      if (elF2) elF2.value = fim2 || '';
      return;
    }

    const mesAtual = Number.parseInt(document.getElementById('vendRelGerMes')?.value, 10) || (now.getMonth() + 1);
    const anoAtual = Number.parseInt(document.getElementById('vendRelGerAno')?.value, 10) || now.getFullYear();
    let mes1 = _comparacao?.tipo !== 'trimestre' && _comparacao?.tipo !== 'periodo' ? _comparacao?.mes1 : null;
    let ano1 = _comparacao?.tipo !== 'trimestre' && _comparacao?.tipo !== 'periodo' ? _comparacao?.ano1 : null;
    let mes2 = _comparacao?.tipo !== 'trimestre' && _comparacao?.tipo !== 'periodo' ? _comparacao?.mes2 : null;
    let ano2 = _comparacao?.tipo !== 'trimestre' && _comparacao?.tipo !== 'periodo' ? _comparacao?.ano2 : null;
    if (!mes1 || !ano1 || !mes2 || !ano2) {
      mes2 = mesAtual;
      ano2 = anoAtual;
      mes1 = mesAtual - 1;
      ano1 = anoAtual;
      if (mes1 < 1) { mes1 = 12; ano1 -= 1; }
    } else {
      const [antigo, novo] = _ordenarCronologico(
        { mes: mes1, ano: ano1 },
        { mes: mes2, ano: ano2 }
      );
      mes1 = antigo.mes; ano1 = antigo.ano;
      mes2 = novo.mes; ano2 = novo.ano;
    }
    if (!anos.includes(ano1)) anos.push(ano1);
    if (!anos.includes(ano2)) anos.push(ano2);
    anos.sort((a, b) => b - a);
    const anosHtml = anos.map((y) => `<option value="${y}">${y}</option>`).join('');
    const elM1 = document.getElementById('vendRelGerCmpMes1');
    const elA1 = document.getElementById('vendRelGerCmpAno1');
    const elM2 = document.getElementById('vendRelGerCmpMes2');
    const elA2 = document.getElementById('vendRelGerCmpAno2');
    if (elM1) elM1.innerHTML = _opcoesMesHtml(mes1);
    if (elM2) elM2.innerHTML = _opcoesMesHtml(mes2);
    if (elA1) { elA1.innerHTML = anosHtml; elA1.value = String(ano1); }
    if (elA2) { elA2.innerHTML = anosHtml; elA2.value = String(ano2); }
  }

  function _abrirModalComparar() {
    _preencherSelectsComparar();
    const el = document.getElementById('vendRelGerCmpModal');
    if (el) el.style.display = 'flex';
  }

  function _fecharModalComparar() {
    const el = document.getElementById('vendRelGerCmpModal');
    if (el) el.style.display = 'none';
  }

  function _aplicarComparacao() {
    const modo = _modoAtual();
    const err = document.getElementById('vendRelGerCmpErro');

    if (modo === 'trimestre') {
      const tri1 = Number.parseInt(document.getElementById('vendRelGerCmpTri1')?.value, 10);
      const ano1 = Number.parseInt(document.getElementById('vendRelGerCmpAnoTri1')?.value, 10);
      const tri2 = Number.parseInt(document.getElementById('vendRelGerCmpTri2')?.value, 10);
      const ano2 = Number.parseInt(document.getElementById('vendRelGerCmpAnoTri2')?.value, 10);
      if (![tri1, ano1, tri2, ano2].every((n) => Number.isFinite(n))) {
        if (err) err.textContent = 'Escolha os dois trimestres.';
        return;
      }
      if (tri1 === tri2 && ano1 === ano2) {
        if (err) err.textContent = 'Escolha dois trimestres diferentes.';
        return;
      }
      const [antigo, novo] = _ordenarCronologicoTri(
        { tri: tri1, ano: ano1 },
        { tri: tri2, ano: ano2 }
      );
      _comparacao = {
        tipo: 'trimestre',
        tri1: antigo.tri,
        ano1: antigo.ano,
        tri2: novo.tri,
        ano2: novo.ano,
        label1: _labelTrimestre(antigo.tri, antigo.ano),
        label2: _labelTrimestre(novo.tri, novo.ano),
      };
      _fecharModalComparar();
      _atualizarBotaoComparar();
      _carregar();
      return;
    }

    if (modo === 'periodo') {
      const ini1 = document.getElementById('vendRelGerCmpDataIni1')?.value?.trim() || '';
      const fim1 = document.getElementById('vendRelGerCmpDataFim1')?.value?.trim() || '';
      const ini2 = document.getElementById('vendRelGerCmpDataIni2')?.value?.trim() || '';
      const fim2 = document.getElementById('vendRelGerCmpDataFim2')?.value?.trim() || '';
      const okYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (![ini1, fim1, ini2, fim2].every(okYmd)) {
        if (err) err.textContent = 'Preencha as datas dos dois períodos.';
        return;
      }
      const norm = (a, b) => (a <= b ? { inicio: a, fim: b } : { inicio: b, fim: a });
      const p1 = norm(ini1, fim1);
      const p2 = norm(ini2, fim2);
      if (p1.inicio === p2.inicio && p1.fim === p2.fim) {
        if (err) err.textContent = 'Escolha dois períodos diferentes.';
        return;
      }
      const [antigo, novo] = _ordenarCronologicoPeriodo(p1, p2);
      _comparacao = {
        tipo: 'periodo',
        data_inicio1: antigo.inicio,
        data_fim1: antigo.fim,
        data_inicio2: novo.inicio,
        data_fim2: novo.fim,
        label1: _labelPeriodoDatas(antigo.inicio, antigo.fim),
        label2: _labelPeriodoDatas(novo.inicio, novo.fim),
      };
      _fecharModalComparar();
      _atualizarBotaoComparar();
      _carregar();
      return;
    }

    const mes1 = Number.parseInt(document.getElementById('vendRelGerCmpMes1')?.value, 10);
    const ano1 = Number.parseInt(document.getElementById('vendRelGerCmpAno1')?.value, 10);
    const mes2 = Number.parseInt(document.getElementById('vendRelGerCmpMes2')?.value, 10);
    const ano2 = Number.parseInt(document.getElementById('vendRelGerCmpAno2')?.value, 10);
    if (![mes1, ano1, mes2, ano2].every((n) => Number.isFinite(n))) {
      if (err) err.textContent = 'Escolha os dois meses.';
      return;
    }
    if (mes1 === mes2 && ano1 === ano2) {
      if (err) err.textContent = 'Escolha dois meses diferentes.';
      return;
    }
    const [antigo, novo] = _ordenarCronologico(
      { mes: mes1, ano: ano1 },
      { mes: mes2, ano: ano2 }
    );
    _comparacao = {
      tipo: 'mes_ano',
      mes1: antigo.mes,
      ano1: antigo.ano,
      mes2: novo.mes,
      ano2: novo.ano,
      label1: _labelMesAno(antigo.mes, antigo.ano),
      label2: _labelMesAno(novo.mes, novo.ano),
    };
    _fecharModalComparar();
    _atualizarBotaoComparar();
    _carregar();
  }

  function _sairComparacao() {
    _comparacao = null;
    _dataB = null;
    _fecharModalComparar();
    _atualizarBotaoComparar();
    _carregar();
  }

  function _injetarModalComparar() {
    if (document.getElementById('vendRelGerCmpModal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="vendRelGerCmpModal" class="modal-overlay" style="display:none;z-index:10070;" role="dialog" aria-modal="true">
        <div class="modal-content" style="max-width:480px;width:92%;background:#0f172a;border:1px solid #334155;border-radius:14px;padding:0;overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #1e293b;">
            <div id="vendRelGerCmpTitulo" style="font-size:15px;font-weight:700;color:#e2e8f0;display:flex;align-items:center;gap:8px;">
              <i class="fa-solid fa-arrow-right-arrow-left" style="color:#f59e0b;"></i> Comparar meses
            </div>
            <button type="button" id="vendRelGerCmpFechar" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px;" title="Fechar">&times;</button>
          </div>
          <div style="padding:16px;">
            <p id="vendRelGerCmpAjuda" style="margin:0 0 14px;font-size:13px;color:#94a3b8;line-height:1.45;">
              Escolha dois meses. Não importa a ordem: o relatório sempre mostra do mais antigo para o mais recente (como no calendário).
            </p>
            <div id="vendRelGerCmpWrapMes" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
              <div class="vend-rel-cmp-field">
                <label>Mês 1</label>
                <select id="vendRelGerCmpMes1"></select>
                <select id="vendRelGerCmpAno1"></select>
              </div>
              <div class="vend-rel-cmp-field">
                <label>Mês 2</label>
                <select id="vendRelGerCmpMes2"></select>
                <select id="vendRelGerCmpAno2"></select>
              </div>
            </div>
            <div id="vendRelGerCmpWrapTri" style="display:none;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
              <div class="vend-rel-cmp-field">
                <label>Trimestre 1</label>
                <select id="vendRelGerCmpTri1"></select>
                <select id="vendRelGerCmpAnoTri1"></select>
              </div>
              <div class="vend-rel-cmp-field">
                <label>Trimestre 2</label>
                <select id="vendRelGerCmpTri2"></select>
                <select id="vendRelGerCmpAnoTri2"></select>
              </div>
            </div>
            <div id="vendRelGerCmpWrapPeriodo" style="display:none;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
              <div class="vend-rel-cmp-field">
                <label>Período 1</label>
                <input type="date" id="vendRelGerCmpDataIni1" style="display:block;margin-top:4px;width:100%;">
                <input type="date" id="vendRelGerCmpDataFim1" style="display:block;margin-top:4px;width:100%;">
              </div>
              <div class="vend-rel-cmp-field">
                <label>Período 2</label>
                <input type="date" id="vendRelGerCmpDataIni2" style="display:block;margin-top:4px;width:100%;">
                <input type="date" id="vendRelGerCmpDataFim2" style="display:block;margin-top:4px;width:100%;">
              </div>
            </div>
            <div id="vendRelGerCmpErro"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;justify-content:flex-end;">
              <button type="button" id="vendRelGerCmpSair" style="display:none;padding:8px 12px;border-radius:8px;border:1px solid #64748b;background:transparent;color:#cbd5e1;cursor:pointer;font-size:13px;font-weight:600;">
                Sair da comparação
              </button>
              <button type="button" id="vendRelGerCmpCancelar" style="padding:8px 12px;border-radius:8px;border:1px solid #334155;background:rgba(255,255,255,.04);color:#cbd5e1;cursor:pointer;font-size:13px;font-weight:600;">
                Cancelar
              </button>
              <button type="button" id="vendRelGerCmpOk" style="padding:8px 14px;border-radius:8px;border:none;background:#f59e0b;color:#1c1917;cursor:pointer;font-size:13px;font-weight:800;">
                Comparar
              </button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
    document.getElementById('vendRelGerCmpFechar')?.addEventListener('click', _fecharModalComparar);
    document.getElementById('vendRelGerCmpCancelar')?.addEventListener('click', _fecharModalComparar);
    document.getElementById('vendRelGerCmpOk')?.addEventListener('click', _aplicarComparacao);
    document.getElementById('vendRelGerCmpSair')?.addEventListener('click', _sairComparacao);
    document.getElementById('vendRelGerCmpModal')?.addEventListener('click', (e) => {
      if (e.target?.id === 'vendRelGerCmpModal') _fecharModalComparar();
    });
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
    _injetarBarraDrill();
  }

  function _injetarModalRegistros() {
    if (document.getElementById('vendRelGerRegistrosModal')) {
      _garantirCabecalhoRegistros();
      return;
    }
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
            <input id="vendRelGerRegistrosBusca" type="search" placeholder="Pesquisar pedido, cliente, vendedor ou NF..." autocomplete="off">
            <div class="vend-rel-export-btns">
              <button type="button" id="vendRelGerRegistrosPdfBtn" title="Gerar PDF da lista">
                <i class="fa-solid fa-file-pdf"></i> PDF
              </button>
              <button type="button" id="vendRelGerRegistrosExcelBtn" title="Gerar Excel (.xlsx)">
                <i class="fa-solid fa-file-excel"></i> Excel
              </button>
            </div>
            <span id="vendRelGerRegistrosQtd" class="at-rel-ger-lote-modal-qtd"></span>
          </div>
          <div class="at-rel-ger-lote-modal-body">
            <table class="at-rel-ger-lote-modal-tbl">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Data</th>
                  <th class="r">Qtd</th>
                  <th>Vendedor</th>
                  <th>NF</th>
                  <th class="r">Valor</th>
                </tr>
              </thead>
              <tbody id="vendRelGerRegistrosBody"></tbody>
              <tfoot id="vendRelGerRegistrosFoot"></tfoot>
            </table>
          </div>
        </div>
      </div>
      <div id="vendRelGerItensModal" class="at-rel-ger-lote-modal" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="vendRelGerItensTitulo">
        <div class="at-rel-ger-lote-modal-card">
          <div class="at-rel-ger-lote-modal-head">
            <div>
              <div class="at-rel-ger-lote-modal-kicker" style="color:#0284c7;">Produtos do pedido</div>
              <h3 id="vendRelGerItensTitulo">Pedido</h3>
              <div id="vendRelGerItensSub" class="at-rel-ger-lote-modal-sub"></div>
            </div>
            <button type="button" id="vendRelGerItensFechar" class="at-rel-ger-lote-modal-close" title="Fechar" aria-label="Fechar">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div id="vendRelGerItensStatus" class="at-rel-ger-lote-modal-status">Carregando...</div>
          <div class="at-rel-ger-lote-modal-body">
            <table class="at-rel-ger-lote-modal-tbl">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th class="r">Qtd</th>
                  <th class="r">Valor</th>
                </tr>
              </thead>
              <tbody id="vendRelGerItensBody"></tbody>
              <tfoot id="vendRelGerItensFoot"></tfoot>
            </table>
          </div>
        </div>
      </div>`;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  }

  function _garantirCabecalhoRegistros() {
    const thead = document.querySelector('#vendRelGerRegistrosModal thead tr');
    if (thead && !thead.textContent.includes('NF')) {
      thead.innerHTML = `
        <th>Pedido</th>
        <th>Cliente</th>
        <th>Data</th>
        <th class="r">Qtd</th>
        <th>Vendedor</th>
        <th>NF</th>
        <th class="r">Valor</th>`;
    }
    const busca = document.getElementById('vendRelGerRegistrosBusca');
    if (busca) busca.placeholder = 'Pesquisar pedido, cliente, vendedor ou NF...';
    const toolbar = document.querySelector('#vendRelGerRegistrosModal .at-rel-ger-lote-modal-toolbar');
    if (toolbar && !document.getElementById('vendRelGerRegistrosPdfBtn')) {
      const qtd = document.getElementById('vendRelGerRegistrosQtd');
      const btns = document.createElement('div');
      btns.className = 'vend-rel-export-btns';
      btns.innerHTML = `
        <button type="button" id="vendRelGerRegistrosPdfBtn" title="Gerar PDF da lista">
          <i class="fa-solid fa-file-pdf"></i> PDF
        </button>
        <button type="button" id="vendRelGerRegistrosExcelBtn" title="Gerar Excel (.xlsx)">
          <i class="fa-solid fa-file-excel"></i> Excel
        </button>`;
      if (qtd) toolbar.insertBefore(btns, qtd);
      else toolbar.appendChild(btns);
      document.getElementById('vendRelGerRegistrosPdfBtn')?.addEventListener('click', _exportarRegistrosPdf);
      document.getElementById('vendRelGerRegistrosExcelBtn')?.addEventListener('click', _exportarRegistrosExcel);
    }
    if (!document.getElementById('vendRelGerItensModal')) {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div id="vendRelGerItensModal" class="at-rel-ger-lote-modal" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="vendRelGerItensTitulo">
          <div class="at-rel-ger-lote-modal-card">
            <div class="at-rel-ger-lote-modal-head">
              <div>
                <div class="at-rel-ger-lote-modal-kicker" style="color:#0284c7;">Produtos do pedido</div>
                <h3 id="vendRelGerItensTitulo">Pedido</h3>
                <div id="vendRelGerItensSub" class="at-rel-ger-lote-modal-sub"></div>
              </div>
              <button type="button" id="vendRelGerItensFechar" class="at-rel-ger-lote-modal-close" title="Fechar" aria-label="Fechar">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div id="vendRelGerItensStatus" class="at-rel-ger-lote-modal-status">Carregando...</div>
            <div class="at-rel-ger-lote-modal-body">
              <table class="at-rel-ger-lote-modal-tbl">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descrição</th>
                    <th class="r">Qtd</th>
                    <th class="r">Valor</th>
                  </tr>
                </thead>
                <tbody id="vendRelGerItensBody"></tbody>
                <tfoot id="vendRelGerItensFoot"></tfoot>
              </table>
            </div>
          </div>
        </div>`;
      document.body.appendChild(wrap.firstElementChild);
      document.getElementById('vendRelGerItensFechar')?.addEventListener('click', _fecharModalItens);
      document.getElementById('vendRelGerItensModal')?.addEventListener('click', (e) => {
        if (e.target?.id === 'vendRelGerItensModal') _fecharModalItens();
      });
    }
  }

  function _modoAtual() {
    if (document.getElementById('vendRelGerModoPeriodo')?.classList.contains('is-active')) return 'periodo';
    if (document.getElementById('vendRelGerModoTrimestre')?.classList.contains('is-active')) return 'trimestre';
    return 'mes_ano';
  }

  function _tipoComparacaoDoModo(modo) {
    if (modo === 'trimestre') return 'trimestre';
    if (modo === 'periodo') return 'periodo';
    return 'mes_ano';
  }

  function _setModoFiltro(modo) {
    const isMes = modo === 'mes_ano';
    const isTri = modo === 'trimestre';
    const isPeriodo = modo === 'periodo';
    // Se estava comparando outro tipo (ex.: mês) e mudou para Trimestre/Período, sai da comparação
    // para não mostrar "JAN × JAN" com o filtro de trimestre ativo.
    if (_comparacao) {
      const tipoEsperado = _tipoComparacaoDoModo(modo);
      const tipoAtual = _comparacao.tipo || 'mes_ano';
      if (tipoAtual !== tipoEsperado) {
        _comparacao = null;
        _dataB = null;
        _atualizarBotaoComparar();
        if (_data) _carregar();
      }
    }
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
    const qDigits = q.replace(/\D/g, '');
    return _registrosRows.filter((r) => {
      const nf = String(r.nf || '');
      const nfDigits = nf.replace(/\D/g, '');
      const blob = `${r.numero_pedido || ''} ${r.cliente || ''} ${r.vendedor || ''} ${nf} ${r.qtd ?? ''}`.toLowerCase();
      if (blob.includes(q)) return true;
      // Aceita busca sem zeros à esquerda (ex.: 15224 encontra 00015224)
      if (qDigits && nfDigits && (nfDigits === qDigits || nfDigits.endsWith(qDigits))) return true;
      return false;
    });
  }

  function _fmtQtd(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return QTD.format(v);
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
      <tr class="is-clickable"
          data-codigo-pedido="${_esc(r.codigo_pedido ?? '')}"
          data-nf-id="${_esc(r.nf_id ?? '')}"
          data-numero-pedido="${_esc(r.numero_pedido || '')}"
          data-cliente="${_esc(r.cliente || '')}"
          title="Clique para ver os produtos">
        <td class="os-id">${_esc(r.numero_pedido || r.codigo_pedido || '—')}</td>
        <td>${_esc(r.cliente || '—')}</td>
        <td>${_esc(_fmtData(r.data))}</td>
        <td class="r">${_esc(_fmtQtd(r.qtd))}</td>
        <td>${_esc(r.vendedor || '—')}</td>
        <td>${_esc(r.nf || '—')}</td>
        <td class="r">${MOEDA.format(r.valor_total || 0)}</td>
      </tr>`).join('');
    const soma = rows.reduce((s, r) => s + (Number(r.valor_total) || 0), 0);
    const somaQtd = rows.reduce((s, r) => s + (Number(r.qtd) || 0), 0);
    if (foot) {
      foot.innerHTML = `<tr><td colspan="3">Total (${rows.length})</td><td class="r">${_esc(_fmtQtd(somaQtd))}</td><td colspan="2"></td><td class="r">${MOEDA.format(soma)}</td></tr>`;
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
    _fecharModalItens();
  }

  function _fecharModalItens() {
    const modal = document.getElementById('vendRelGerItensModal');
    if (modal) modal.style.display = 'none';
    if (_itensAbort) _itensAbort.abort();
  }

  async function _abrirModalItensPedido(tr) {
    if (!tr) return;
    _injetarModalRegistros();
    const codigo = tr.getAttribute('data-codigo-pedido') || '';
    const nfId = tr.getAttribute('data-nf-id') || '';
    const numero = tr.getAttribute('data-numero-pedido') || codigo || '—';
    const cliente = tr.getAttribute('data-cliente') || '';
    const modal = document.getElementById('vendRelGerItensModal');
    const titulo = document.getElementById('vendRelGerItensTitulo');
    const sub = document.getElementById('vendRelGerItensSub');
    const statusEl = document.getElementById('vendRelGerItensStatus');
    const body = document.getElementById('vendRelGerItensBody');
    const foot = document.getElementById('vendRelGerItensFoot');
    if (!modal || !body) return;
    if (titulo) titulo.textContent = `Pedido ${numero}`;
    if (sub) sub.textContent = cliente ? `Cliente: ${cliente}` : 'Carregando produtos...';
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Carregando...</td></tr>';
    if (foot) foot.innerHTML = '';
    modal.style.display = 'flex';
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Carregando produtos...'; }

    if (_itensAbort) _itensAbort.abort();
    _itensAbort = new AbortController();
    try {
      const qs = new URLSearchParams();
      if (nfId) qs.set('nf_id', nfId);
      const resp = await fetch(
        `/api/sac/vendas/relatorio-gerencial/pedido-itens/${encodeURIComponent(codigo || '0')}?${qs}`,
        { credentials: 'include', signal: _itensAbort.signal }
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || 'Erro ao carregar produtos.');
      const rows = Array.isArray(data.rows) ? data.rows : [];
      if (sub) {
        const nfTxt = data.nf ? ` · NF ${data.nf}` : '';
        sub.textContent = `${cliente || '—'}${nfTxt} · ${rows.length} produto(s)`;
      }
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Nenhum produto encontrado neste pedido.</td></tr>';
      } else {
        body.innerHTML = rows.map((it) => `
          <tr>
            <td class="os-id">${_esc(it.codigo || '—')}</td>
            <td>${_esc(it.descricao || '—')}</td>
            <td class="r">${_esc(_fmtQtd(it.quantidade))}</td>
            <td class="r">${MOEDA.format(it.valor_total || 0)}</td>
          </tr>`).join('');
        const somaQtd = rows.reduce((s, it) => s + (Number(it.quantidade) || 0), 0);
        const somaVal = rows.reduce((s, it) => s + (Number(it.valor_total) || 0), 0);
        if (foot) {
          foot.innerHTML = `<tr><td colspan="2">Total (${rows.length})</td><td class="r">${_esc(_fmtQtd(somaQtd))}</td><td class="r">${MOEDA.format(somaVal)}</td></tr>`;
        }
      }
      if (statusEl) statusEl.style.display = 'none';
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = err.message || 'Erro.'; }
      body.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#ef4444;">${_esc(err.message || 'Erro')}</td></tr>`;
    }
  }

  function _linhasExportacaoRegistros() {
    return _filtrarRegistrosVisiveis().map((r) => ({
      Pedido: r.numero_pedido || r.codigo_pedido || '',
      Cliente: r.cliente || '',
      Data: _fmtData(r.data),
      Qtd: Number(r.qtd) || 0,
      Vendedor: r.vendedor || '',
      NF: r.nf || '',
      Valor: Number(r.valor_total) || 0,
    }));
  }

  /** Monta linhas do Excel: pedido + produtos logo abaixo (quando vierem em r.itens). */
  function _linhasExportacaoRegistrosComItens(registros) {
    const out = [];
    for (const r of registros || []) {
      out.push({
        Tipo: 'Pedido',
        Pedido: r.numero_pedido || r.codigo_pedido || '',
        Cliente: r.cliente || '',
        Data: _fmtData(r.data),
        Qtd: Number(r.qtd) || 0,
        Vendedor: r.vendedor || '',
        NF: r.nf || '',
        Valor: Number(r.valor_total) || 0,
        'Cód. produto': '',
        Produto: '',
        'Qtd produto': '',
        'Valor produto': '',
      });
      const itens = Array.isArray(r.itens) ? r.itens : [];
      for (const it of itens) {
        out.push({
          Tipo: 'Produto',
          Pedido: r.numero_pedido || r.codigo_pedido || '',
          Cliente: '',
          Data: '',
          Qtd: '',
          Vendedor: '',
          NF: r.nf || '',
          Valor: '',
          'Cód. produto': it.codigo || '',
          Produto: it.descricao || '',
          'Qtd produto': Number(it.quantidade) || 0,
          'Valor produto': Number(it.valor_total) || 0,
        });
      }
    }
    return out;
  }

  function _exportarRegistrosPdf() {
    const rows = _filtrarRegistrosVisiveis();
    if (!rows.length) {
      alert('Não há registros para exportar.');
      return;
    }
    const titulo = document.getElementById('vendRelGerRegistrosTitulo')?.textContent || 'Faturamento';
    const sub = document.getElementById('vendRelGerRegistrosSub')?.textContent || '';
    const corpo = rows.map((r) => `
      <tr>
        <td>${_esc(r.numero_pedido || r.codigo_pedido || '')}</td>
        <td>${_esc(r.cliente || '')}</td>
        <td>${_esc(_fmtData(r.data))}</td>
        <td class="r">${_esc(_fmtQtd(r.qtd))}</td>
        <td>${_esc(r.vendedor || '')}</td>
        <td>${_esc(r.nf || '')}</td>
        <td class="r">${MOEDA.format(r.valor_total || 0)}</td>
      </tr>`).join('');
    const soma = rows.reduce((s, r) => s + (Number(r.valor_total) || 0), 0);
    const somaQtd = rows.reduce((s, r) => s + (Number(r.qtd) || 0), 0);
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${_esc(titulo)} — ${_esc(sub)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:24px;}
  h1{font-size:18px;margin:0 0 4px;}
  .sub{font-size:12px;color:#64748b;margin-bottom:16px;}
  table{width:100%;border-collapse:collapse;font-size:11px;}
  th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;}
  th{background:#e2e8f0;font-size:10px;text-transform:uppercase;}
  .r{text-align:right;font-variant-numeric:tabular-nums;}
  tfoot td{font-weight:700;background:#f8fafc;}
  @media print{body{margin:12px;}}
</style></head><body>
  <h1>Relatório Gerencial — Vendas · ${_esc(titulo)}</h1>
  <div class="sub">${_esc(sub)} · Gerado em ${_esc(_fmtDataGeracao())}</div>
  <table>
    <thead><tr>
      <th>Pedido</th><th>Cliente</th><th>Data</th><th class="r">Qtd</th>
      <th>Vendedor</th><th>NF</th><th class="r">Valor</th>
    </tr></thead>
    <tbody>${corpo}</tbody>
    <tfoot><tr>
      <td colspan="3">Total (${rows.length})</td>
      <td class="r">${_esc(_fmtQtd(somaQtd))}</td>
      <td colspan="2"></td>
      <td class="r">${MOEDA.format(soma)}</td>
    </tr></tfoot>
  </table>
  <script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      alert('Permita pop-ups para gerar o PDF.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function _ensureXlsx() {
    if (window.XLSX) return window.XLSX;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/xlsx/xlsx.full.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Não foi possível carregar a biblioteca Excel.'));
      document.head.appendChild(s);
    });
    if (!window.XLSX) throw new Error('Biblioteca Excel indisponível.');
    return window.XLSX;
  }

  async function _exportarRegistrosExcel() {
    const visiveis = _filtrarRegistrosVisiveis();
    if (!visiveis.length) {
      alert('Não há registros para exportar.');
      return;
    }
    const btn = document.getElementById('vendRelGerRegistrosExcelBtn');
    const statusEl = document.getElementById('vendRelGerRegistrosStatus');
    if (btn) { btn.disabled = true; }
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Montando Excel com produtos...'; }
    try {
      // Uma única chamada com todos os itens (leve). Depois filtra o que está na tela/busca.
      const qs = _comparacao
        ? _filtrosQueryParams(_qsOverrideComparacao(1))
        : _filtrosQueryParams();
      qs.set('com_itens', '1');
      const resp = await fetch(`/api/sac/vendas/relatorio-gerencial/registros?${qs}`, {
        credentials: 'include',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) throw new Error(data.error || 'Erro ao buscar produtos para o Excel.');

      const byKey = new Map();
      for (const r of data.registros || []) {
        const key = `${r.codigo_pedido || ''}|${r.nf_id || ''}|${r.numero_pedido || ''}|${r.nf || ''}`;
        byKey.set(key, r);
      }
      const comItens = visiveis.map((r) => {
        const key = `${r.codigo_pedido || ''}|${r.nf_id || ''}|${r.numero_pedido || ''}|${r.nf || ''}`;
        const full = byKey.get(key);
        return full ? { ...r, itens: full.itens || [] } : { ...r, itens: [] };
      });

      const linhas = _linhasExportacaoRegistrosComItens(comItens);
      const XLSX = await _ensureXlsx();
      const titulo = document.getElementById('vendRelGerRegistrosTitulo')?.textContent || 'Faturamento';
      const periodo = (_data?.periodo || 'periodo').replace(/[^\w\-]+/g, '_');
      const ws = XLSX.utils.json_to_sheet(linhas);
      ws['!cols'] = [
        { wch: 9 }, { wch: 12 }, { wch: 36 }, { wch: 12 }, { wch: 8 },
        { wch: 28 }, { wch: 14 }, { wch: 14 },
        { wch: 14 }, { wch: 42 }, { wch: 10 }, { wch: 14 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Registros');
      XLSX.writeFile(wb, `vendas_${titulo.toLowerCase()}_${periodo}.xlsx`);
    } catch (err) {
      alert(err.message || 'Erro ao gerar Excel.');
    } finally {
      if (btn) btn.disabled = false;
      if (statusEl) statusEl.style.display = 'none';
    }
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
    if (sub) sub.textContent = _comparacao
      ? `Período: ${_comparacao.label1} (Mês 1 da comparação)`
      : (_data?.periodo ? `Período: ${_data.periodo}` : 'Carregando...');
    if (busca) busca.value = '';
    // Não limpa a tabela enquanto carrega — evita sumir o relatório no filtro
    modal.style.display = 'flex';
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Atualizando registros...'; }
    const bodyEl = document.getElementById('vendRelGerRegistrosBody');
    if (bodyEl && _registrosRows.length) bodyEl.style.opacity = '0.55';

    if (_registrosAbort) _registrosAbort.abort();
    _registrosAbort = new AbortController();
    try {
      const qs = _comparacao
        ? _filtrosQueryParams(_qsOverrideComparacao(1))
        : _filtrosQueryParams();
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
      if (bodyEl) bodyEl.style.opacity = '';
      if (statusEl) statusEl.style.display = 'none';
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (bodyEl) bodyEl.style.opacity = '';
      if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = err.message || 'Erro.'; }
    }
  }

  function _filtrosQueryParams(override) {
    const qs = new URLSearchParams();
    qs.set('modo', 'mes');
    qs.set('etapa', 'entregue');
    const ov = override || {};
    if (ov.data_inicio && ov.data_fim) {
      qs.set('data_inicio', String(ov.data_inicio));
      qs.set('data_fim', String(ov.data_fim));
    } else if (ov.trimestre && ov.ano) {
      qs.set('ano', String(ov.ano));
      qs.set('trimestre', String(ov.trimestre));
    } else if (ov.mes && ov.ano) {
      qs.set('ano', String(ov.ano));
      qs.set('mes', String(ov.mes));
    } else {
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
    } else if (_drillExtra.familia_nome) {
      qs.set('familia_nome', _drillExtra.familia_nome);
    }
    if (_drillExtra.cliente) qs.set('cliente', _drillExtra.cliente);
    if (_drillExtra.etapa_pedido) qs.set('etapa_pedido', _drillExtra.etapa_pedido);
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
  .vend-rel-delta { font-weight: 700; }
  .vend-rel-delta.up { color: #15803d; }
  .vend-rel-delta.down { color: #b91c1c; }
  .vend-rel-delta.flat { color: #64748b; }
  .pdf-ftr { margin-top: auto; padding-top: 8px; border-top: 2px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 8px; color: #64748b; }
  .pdf-slogan { font-style: italic; color: #1e3a5f; font-weight: 600; }
  .pdf-pg { font-weight: 700; color: #0284c7; }
  @page { size: A4; margin: 10mm 8mm; }
`;
  }

  function _pdfHeader(periodo, etapa) {
    const tipo = _comparacao ? 'Comparativo Gerencial de Vendas' : 'Relatório Gerencial de Vendas';
    return `
      <div class="pdf-hdr">
        <div class="pdf-brand"><div class="pdf-logo">FT</div><div><div class="pdf-name">FROMTHERM</div><div class="pdf-sub">BOMBAS DE CALOR</div></div></div>
        <div class="pdf-title"><div class="pdf-type">${tipo}</div><div class="pdf-per">${_periodoTitulo(periodo, etapa)}</div></div>
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
      const periodo = _emComparacao()
        ? `${_comparacao.label1} × ${_comparacao.label2}`
        : (d.periodo || '—');
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

      const kpiHtml = _emComparacao()
        ? _htmlResumoComparacao()
        : [
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
          <div class="kpis">${_emComparacao() ? '' : kpiHtml}</div>
          ${_emComparacao() ? `<div class="box" style="margin-bottom:8px;">${kpiHtml}</div>` : ''}
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
      _injetarBotaoResetDrill();
      _injetarBarraDrill();
      _injetarBotaoComparar();
      _injetarModalComparar();
      _injetarFamiliaMulti();
      _injetarModalRegistros();
      _setModoFiltro('mes_ano');
      _setBarraFiltrosVisivel(false);
      document.getElementById('vendRelGerFiltroBtn')?.addEventListener('click', _toggleBarraFiltros);
      document.getElementById('vendRelGerCompararBtn')?.addEventListener('click', _abrirModalComparar);
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
      document.getElementById('vendRelGerRegistrosPdfBtn')?.addEventListener('click', _exportarRegistrosPdf);
      document.getElementById('vendRelGerRegistrosExcelBtn')?.addEventListener('click', _exportarRegistrosExcel);
      document.getElementById('vendRelGerRegistrosBody')?.addEventListener('click', (e) => {
        const tr = e.target?.closest?.('tr.is-clickable');
        if (tr) _abrirModalItensPedido(tr);
      });
      document.getElementById('vendRelGerItensFechar')?.addEventListener('click', _fecharModalItens);
      document.getElementById('vendRelGerItensModal')?.addEventListener('click', (e) => {
        if (e.target?.id === 'vendRelGerItensModal') _fecharModalItens();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (document.getElementById('vendRelGerCmpModal')?.style.display === 'flex') {
          _fecharModalComparar();
          return;
        }
        if (document.getElementById('vendRelGerItensModal')?.style.display === 'flex') {
          _fecharModalItens();
          return;
        }
        if (document.getElementById('vendRelGerRegistrosModal')?.style.display === 'flex') {
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
