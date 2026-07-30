(function inicializarModuloSimuladorFrete() {
'use strict';

const freteState = {
  inicializado: false,
  carregado: false,
  itens: [],
  resultadosBusca: [],
  cotacao: null,
  cotacoesRecentes: [],
  gestao: null,
  produtosPendentes: null,
  status: null,
  buscaTimer: null,
  buscaController: null,
  localidadesTimer: null,
  localidadesController: null,
  ultimaUf: ''
};

const FRETE_UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const esc = (valor) => String(valor ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const numero = (valor) => Number.isFinite(Number(valor)) ? Number(valor) : 0;
const moeda = (valor) => numero(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const decimal = (valor, casas = 2) => numero(valor).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const percentual = (valor) => `${decimal(valor, Number(valor) % 1 === 0 ? 0 : 2)}%`;
const limparCep = (valor) => String(valor || '').replace(/\D/g, '').slice(0, 8);
const formatarCep = (valor) => limparCep(valor).replace(/^(\d{5})(\d{0,3}).*/, (_, a, b) => b ? `${a}-${b}` : a);

function parseValorMercadoria(valor) {
  let texto = String(valor ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!texto || texto.startsWith('-')) return 0;
  const ultimaVirgula = texto.lastIndexOf(',');
  const ultimoPonto = texto.lastIndexOf('.');
  if (ultimaVirgula >= 0) {
    texto = `${texto.slice(0, ultimaVirgula).replace(/[.,]/g, '') || '0'}.${texto.slice(ultimaVirgula + 1).replace(/\D/g, '') || '0'}`;
  } else if (ultimoPonto >= 0) {
    const partes = texto.split('.');
    const ultimo = partes[partes.length - 1];
    texto = partes.length > 2 || ultimo.length === 3 ? partes.join('') : `${partes.slice(0, -1).join('') || '0'}.${ultimo || '0'}`;
  }
  const resultado = Number(texto);
  return Number.isFinite(resultado) && resultado >= 0 ? resultado : 0;
}

const formatarValorMercadoria = (valor) => parseValorMercadoria(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataHora = (valor) => valor ? new Date(valor).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { credentials: 'include', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const erro = new Error(data.error || `Falha HTTP ${response.status}`);
    erro.status = response.status;
    erro.data = data;
    throw erro;
  }
  return data;
}

function calcularResumoLocal() {
  return freteState.itens.reduce((acc, item) => {
    const qtd = numero(item.quantidade);
    const altura = numero(item.altura);
    const largura = numero(item.largura);
    const profundidade = numero(item.profundidade);
    const peso = numero(item.peso_bruto) > 0 ? numero(item.peso_bruto) : numero(item.peso_liq);
    acc.volumes += qtd;
    acc.peso += peso * qtd;
    acc.cubagem += (altura * largura * profundidade / 1_000_000) * qtd;
    if (!item.apto_simulacao) acc.invalidos += 1;
    return acc;
  }, { volumes: 0, peso: 0, cubagem: 0, invalidos: 0 });
}

function imagemProduto(item, classe = 'frete-product-image') {
  if (item.url_imagem) return `<img class="${classe}" src="${esc(item.url_imagem)}" alt="" loading="lazy">`;
  return '<span class="frete-product-placeholder"><i class="fa-solid fa-box"></i></span>';
}

function renderBusca() {
  const container = document.getElementById('freteBuscaResultados');
  if (!container) return;
  if (!freteState.resultadosBusca.length) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  container.hidden = false;
  container.innerHTML = freteState.resultadosBusca.map((item) => `
    <button type="button" class="frete-search-option" data-frete-add="${esc(item.codigo)}">
      ${imagemProduto(item)}
      <span class="frete-search-copy"><strong>${esc(item.codigo)}</strong><span>${esc(item.descricao)}</span></span>
      <span class="frete-product-state ${item.apto_simulacao ? '' : 'is-warning'}">${item.apto_simulacao ? 'Pronto' : 'Revisar cadastro'}</span>
    </button>
  `).join('');
}

function renderItens() {
  const container = document.getElementById('freteItens');
  if (!container) return;
  if (!freteState.itens.length) {
    container.innerHTML = '<div class="frete-empty"><i class="fa-solid fa-dolly"></i><strong>Nenhuma máquina adicionada</strong><span>Pesquise pelo código ou nome do produto.</span></div>';
  } else {
    container.innerHTML = freteState.itens.map((item) => {
      const peso = numero(item.peso_bruto) > 0 ? numero(item.peso_bruto) : numero(item.peso_liq);
      return `
        <article class="frete-item ${item.apto_simulacao ? '' : 'is-invalid'}" data-frete-item="${esc(item.codigo)}">
          ${imagemProduto(item)}
          <div class="frete-item-copy">
            <strong title="${esc(item.descricao)}">${esc(item.codigo)} · ${esc(item.descricao)}</strong>
            <span class="frete-item-meta">
              <span>${decimal(item.altura, 0)} × ${decimal(item.largura, 0)} × ${decimal(item.profundidade, 0)} cm</span>
              <span>${decimal(peso, 1)} kg/un</span>
              ${item.apto_simulacao ? '' : '<span style="color:#fbbf24">Dimensão ou peso pendente</span>'}
            </span>
          </div>
          <div class="frete-qty" aria-label="Quantidade">
            <button type="button" data-frete-qtd="-1" aria-label="Diminuir quantidade">−</button>
            <input value="${esc(item.quantidade)}" inputmode="numeric" aria-label="Quantidade de ${esc(item.codigo)}" data-frete-qtd-input>
            <button type="button" data-frete-qtd="1" aria-label="Aumentar quantidade">+</button>
          </div>
          <button type="button" class="frete-btn frete-btn-danger" data-frete-remove aria-label="Remover ${esc(item.codigo)}"><i class="fa-solid fa-trash-can"></i></button>
        </article>
      `;
    }).join('');
  }
  renderResumo();
}

function renderResumo() {
  const resumo = calcularResumoLocal();
  const set = (id, valor) => { const el = document.getElementById(id); if (el) el.textContent = valor; };
  set('freteResumoVolumes', decimal(resumo.volumes, 0));
  set('freteResumoPeso', `${decimal(resumo.peso, 1)} kg`);
  set('freteResumoCubagem', `${decimal(resumo.cubagem, 3)} m³`);
  set('freteResumoTransportadoras', String((freteState.status?.tabelas || []).filter((item) => item.status === 'ativa').length));
  const aviso = document.getElementById('freteCadastroAviso');
  if (aviso) {
    aviso.hidden = resumo.invalidos === 0;
    aviso.innerHTML = resumo.invalidos
      ? `<i class="fa-solid fa-triangle-exclamation"></i><span>${resumo.invalidos} produto(s) precisam de peso e dimensões confiáveis antes da simulação.</span>`
      : '';
  }
  const botao = document.getElementById('freteSimularBtn');
  if (botao) botao.disabled = !freteState.itens.length || resumo.invalidos > 0;
}

function renderResultados(cotacao) {
  const painel = document.getElementById('freteResultadosPanel');
  const container = document.getElementById('freteResultados');
  if (!painel || !container) return;
  painel.hidden = false;
  const resultados = Array.isArray(cotacao?.resultados) ? cotacao.resultados : [];
  if (!resultados.length) {
    container.innerHTML = '<div class="frete-empty"><i class="fa-solid fa-route"></i><strong>Nenhuma tabela cadastrada</strong><span>Importe e valide as tabelas das transportadoras para iniciar a competição.</span></div>';
    return;
  }
  const homologados = resultados.filter((item) => item.ok && item.homologado);
  const previas = resultados.filter((item) => item.ok && !item.homologado);
  const melhorHomologado = homologados.length ? Math.min(...homologados.map((item) => numero(item.valor_total))) : null;
  const melhorPrevia = previas.length ? Math.min(...previas.map((item) => numero(item.valor_total))) : null;
  container.innerHTML = resultados.map((item) => {
    const melhor = item.ok && item.homologado && numero(item.valor_total) === melhorHomologado;
    const melhorEmRevisao = item.ok && !item.homologado && numero(item.valor_total) === melhorPrevia;
    if (!item.ok) {
      const atendeSemTarifa = item.tipo_resultado === 'cobertura_sem_tarifa';
      const status = atendeSemTarifa ? 'Preço pendente' : 'Não participa';
      const classe = atendeSemTarifa ? 'is-pending' : 'is-unavailable';
      return `<article class="frete-quote ${classe}"><div class="frete-quote-head"><div><h3>${esc(item.transportadora)}</h3><small>Tabela ${esc(item.versao || 'sem versão')}</small></div><span class="frete-quote-price">${status}</span></div><div class="frete-alert" style="margin-top:10px"><i class="fa-solid fa-circle-info"></i><span>${esc(item.motivo)}</span></div></article>`;
    }
    const previa = !item.homologado;
    const temIcmsDeclarado = item.icms_percentual != null && item.subtotal_sem_icms != null;
    const rotuloIcms = item.icms_estimado ? 'assumido' : 'configurado';
    return `
      <article class="frete-quote ${melhor ? 'is-best' : ''} ${previa ? 'is-preview' : ''} ${melhorEmRevisao ? 'is-best-preview' : ''}">
        <div class="frete-quote-head">
          <div><h3>${esc(item.transportadora)}</h3><small>${melhor ? 'Melhor valor homologado · ' : melhorEmRevisao ? 'Menor prévia técnica · ' : previa ? 'Prévia técnica · ' : ''}Tabela ${esc(item.versao)}</small></div>
          <span class="frete-quote-price">${moeda(item.valor_total)}</span>
        </div>
        ${previa ? '<div class="frete-alert is-preview-note"><i class="fa-solid fa-flask"></i><span>Valor em validação. Não utilize como preço homologado para o cliente.</span></div>' : ''}
        <div class="frete-quote-meta">
          <span class="frete-chip"><i class="fa-solid fa-clock"></i>${item.prazo_min_dias == null ? 'Prazo não informado' : `${item.prazo_min_dias}${item.prazo_max_dias && item.prazo_max_dias !== item.prazo_min_dias ? `–${item.prazo_max_dias}` : ''} dias`}</span>
          <span class="frete-chip"><i class="fa-solid fa-weight-hanging"></i>${decimal(item.peso_cobravel_kg, 1)} kg cobrados</span>
        </div>
        ${temIcmsDeclarado ? `<div class="frete-icms-assumption"><i class="fa-solid fa-receipt"></i><span>ICMS estimado por dentro: <strong>${percentual(item.icms_percentual)} ${rotuloIcms}</strong> para ${esc(item.icms_origem_uf)} → ${esc(item.icms_destino_uf)}.</span></div>` : ''}
        <div class="frete-breakdown">
          <div><span>Frete peso</span><strong>${moeda(item.frete_peso)}</strong></div>
          ${(item.adicionais_detalhe || []).map((taxa) => `<div><span>${esc(taxa.nome)}</span><strong>${moeda(taxa.valor)}</strong></div>`).join('')}
          ${temIcmsDeclarado ? `<div class="frete-breakdown-subtotal"><span>Subtotal antes do ICMS</span><strong>${moeda(item.subtotal_sem_icms)}</strong></div><div class="frete-breakdown-tax"><span>ICMS (${percentual(item.icms_percentual)} por dentro)</span><strong>${moeda(item.icms_valor)}</strong></div>` : ''}
          <div><span>Peso cubado</span><strong>${decimal(item.peso_cubado_kg, 1)} kg</strong></div>
        </div>
      </article>
    `;
  }).join('');
  painel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCotacoesRecentes() {
  const container = document.getElementById('freteCotacoesRecentes');
  if (!container) return;
  if (!freteState.cotacoesRecentes.length) {
    container.innerHTML = '<div class="frete-empty"><i class="fa-solid fa-clock-rotate-left"></i><strong>Nenhuma cotação recente</strong><span>As próximas simulações ficarão disponíveis aqui para reutilização.</span></div>';
    return;
  }
  container.innerHTML = freteState.cotacoesRecentes.map((item) => `
    <button type="button" class="frete-recent" data-frete-reopen="${esc(item.id)}">
      <span class="frete-recent-main"><strong>#${esc(item.id)} · ${esc(item.destino_cidade)}/${esc(item.destino_uf)}</strong><small>${esc(dataHora(item.criado_em))} · ${numero(item.itens)} produto(s)</small></span>
      <span class="frete-recent-meta"><strong>${item.melhor_valor != null ? moeda(item.melhor_valor) : item.melhor_previa != null ? `Prévia ${moeda(item.melhor_previa)}` : 'Sem preço calculado'}</strong><small>${decimal(item.peso_real_kg, 1)} kg · ${decimal(item.volume_m3, 3)} m³</small></span>
      <i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i>
    </button>
  `).join('');
}

async function carregarCotacoesRecentes() {
  const painel = document.getElementById('freteRecentesPanel');
  const container = document.getElementById('freteCotacoesRecentes');
  if (!painel || !container) return;
  const abrir = painel.hidden;
  painel.hidden = !abrir;
  if (!abrir) return;
  document.getElementById('freteGestaoPanel').hidden = true;
  container.innerHTML = '<div class="frete-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Carregando cotações...</span></div>';
  try {
    const data = await fetchJson('/api/frete/cotacoes?limit=8');
    freteState.cotacoesRecentes = data.itens || [];
    renderCotacoesRecentes();
  } catch (erro) {
    container.innerHTML = `<div class="frete-alert is-error"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(erro.message)}</span></div>`;
  }
}

async function reabrirCotacao(id) {
  const container = document.getElementById('freteCotacoesRecentes');
  if (container) container.innerHTML = '<div class="frete-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Reabrindo cotação...</span></div>';
  try {
    const data = await fetchJson(`/api/frete/cotacoes/${encodeURIComponent(id)}`);
    const cotacao = data.cotacao || {};
    freteState.itens = (data.itens || []).map((item) => ({ ...item, quantidade: Math.max(1, Math.floor(numero(item.quantidade) || 1)) }));
    const cep = document.getElementById('freteCep');
    const uf = document.getElementById('freteUf');
    const cidade = document.getElementById('freteCidade');
    const valor = document.getElementById('freteValorMercadoria');
    if (cep) cep.value = formatarCep(cotacao.destino_cep == null ? '' : String(cotacao.destino_cep).padStart(8, '0'));
    if (uf) uf.value = cotacao.destino_uf || '';
    if (cidade) cidade.value = cotacao.destino_cidade || '';
    if (valor) valor.value = formatarValorMercadoria(cotacao.valor_mercadoria);
    atualizarUf({ preservarCidade: true, buscaCidade: cotacao.destino_cidade || '' });
    renderItens();
    freteState.cotacao = data.resultados?.length ? { cotacao_id: cotacao.id, resultados: data.resultados, historica: true } : null;
    if (freteState.cotacao) renderResultados(freteState.cotacao);
    else document.getElementById('freteResultadosPanel').hidden = true;
    document.getElementById('freteRecentesPanel').hidden = true;
    document.getElementById('freteSimuladorRoot')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (erro) {
    if (container) container.innerHTML = `<div class="frete-alert is-error"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(erro.message)}</span></div>`;
  }
}

function renderGestao() {
  const container = document.getElementById('freteGestaoConteudo');
  if (!container || !freteState.gestao) return;
  const { tabelas = [], pode_gerenciar: podeGerenciar } = freteState.gestao;
  const tabelasPrincipais = tabelas.filter((item) => !item.eh_auxiliar);
  const pendentes = freteState.produtosPendentes;
  const resumo = pendentes?.resumo || {};
  container.innerHTML = `
    <div class="frete-quality-summary">
      <div class="frete-quality-metric"><span>Transportadoras</span><strong>${tabelasPrincipais.length}</strong></div>
      <div class="frete-quality-metric"><span>Homologadas</span><strong>${tabelasPrincipais.filter((item) => item.status === 'ativa').length}</strong></div>
      <div class="frete-quality-metric"><span>Com bloqueios</span><strong>${tabelasPrincipais.filter((item) => item.diagnostico?.bloqueios?.length).length}</strong></div>
      <div class="frete-quality-metric"><span>Produtos pendentes</span><strong>${numero(resumo.total_pendentes)}</strong></div>
    </div>
    <div class="frete-table-health-grid">
      ${tabelasPrincipais.map((item) => {
        const diagnostico = item.diagnostico || {};
        const bloqueios = diagnostico.bloqueios || [];
        const avisos = diagnostico.avisos || [];
        const classeStatus = item.status === 'ativa' ? 'is-active' : item.status === 'inativa' ? 'is-inactive' : 'is-review';
        return `<article class="frete-table-health ${bloqueios.length ? 'has-blockers' : ''}">
          <div class="frete-table-health-head"><div><h3>${esc(item.transportadora)}</h3><small>${esc(item.versao)}</small></div><span class="frete-table-status ${classeStatus}">${item.status === 'ativa' ? 'Homologada' : item.status === 'inativa' ? 'Inativa' : 'Em revisão'}</span></div>
          <div class="frete-table-stats"><span>${numero(diagnostico.coberturas)} coberturas</span><span>${numero(diagnostico.faixas)} tarifas</span><span>${numero(diagnostico.regras) + numero(diagnostico.adicionais_cep)} regras</span></div>
          ${bloqueios.map((texto) => `<div class="frete-quality-note is-blocker"><i class="fa-solid fa-circle-xmark"></i><span>${esc(texto)}</span></div>`).join('')}
          ${avisos.slice(0, 3).map((texto) => `<div class="frete-quality-note is-warning"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(texto)}</span></div>`).join('')}
          ${avisos.length > 3 ? `<small class="frete-more-notes">+ ${avisos.length - 3} alerta(s) no relatório de importação</small>` : ''}
          <div class="frete-table-source"><span title="${esc(item.arquivo_origem || '')}"><i class="fa-solid fa-file-lines"></i>${esc(item.arquivo_origem || 'Fonte principal não informada')}</span><span>${esc(dataHora(item.atualizado_em))}</span></div>
          ${(item.fontes_auxiliares || []).length ? `<div class="frete-aux-sources">
            <strong>Fontes incorporadas</strong>
            ${(item.fontes_auxiliares || []).map((fonte) => `<div class="frete-aux-source">
              <span title="${esc(fonte.arquivo_origem || '')}"><i class="fa-solid fa-paperclip"></i><b>${esc(fonte.arquivo_origem || 'Fonte auxiliar')}</b><small>${esc(fonte.finalidade_fonte || 'Dados incorporados à tabela principal.')}</small></span>
              <em>Incorporada</em>
            </div>`).join('')}
          </div>` : ''}
          ${podeGerenciar ? `<div class="frete-table-actions">
            ${item.status !== 'ativa' ? `<button type="button" class="frete-btn frete-btn-ghost" data-frete-table-status="ativa" data-frete-table-id="${item.id}" ${bloqueios.length ? 'disabled' : ''}><i class="fa-solid fa-shield-check"></i>Homologar</button>` : ''}
            ${item.status !== 'em_revisao' ? `<button type="button" class="frete-btn frete-btn-ghost" data-frete-table-status="em_revisao" data-frete-table-id="${item.id}">Revisar</button>` : ''}
            ${item.status !== 'inativa' ? `<button type="button" class="frete-btn frete-btn-ghost" data-frete-table-status="inativa" data-frete-table-id="${item.id}">Inativar</button>` : ''}
          </div>` : ''}
        </article>`;
      }).join('')}
    </div>
    <section class="frete-product-quality">
      <div class="frete-subhead"><div><h3>Qualidade do cadastro dos produtos</h3><p>Produtos fiscais 00 e 04 que ainda não podem compor uma cotação confiável.</p></div><span>${numero(resumo.total_pendentes)} pendente(s)</span></div>
      <div class="frete-quality-tags"><span>Sem altura: ${numero(resumo.sem_altura)}</span><span>Sem largura: ${numero(resumo.sem_largura)}</span><span>Sem profundidade: ${numero(resumo.sem_profundidade)}</span><span>Sem peso: ${numero(resumo.sem_peso)}</span><span>Unidade suspeita: ${numero(resumo.unidade_suspeita)}</span></div>
      <div class="frete-product-pending-list">
        ${(pendentes?.itens || []).slice(0, 30).map((item) => `<div class="frete-product-pending"><strong>${esc(item.codigo)}</strong><span>${esc(item.descricao)}</span><small>${(item.pendencias || []).map(esc).join(' · ')}</small></div>`).join('') || '<div class="frete-empty"><strong>Cadastros completos</strong><span>Nenhuma pendência encontrada.</span></div>'}
      </div>
      ${(pendentes?.itens || []).length > 30 ? `<p class="frete-quality-footnote">Exibindo 30 de ${pendentes.itens.length} registros retornados.</p>` : ''}
    </section>`;
}

async function carregarGestao() {
  const painel = document.getElementById('freteGestaoPanel');
  const container = document.getElementById('freteGestaoConteudo');
  if (!painel || !container) return;
  const abrir = painel.hidden;
  painel.hidden = !abrir;
  if (!abrir) return;
  document.getElementById('freteRecentesPanel').hidden = true;
  container.innerHTML = '<div class="frete-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Auditando tabelas e produtos...</span></div>';
  try {
    const [gestao, produtosPendentes] = await Promise.all([
      fetchJson('/api/frete/gestao'),
      fetchJson('/api/frete/produtos-pendentes?limit=100')
    ]);
    freteState.gestao = gestao;
    freteState.produtosPendentes = produtosPendentes;
    renderGestao();
  } catch (erro) {
    container.innerHTML = `<div class="frete-alert is-error"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(erro.message)}</span></div>`;
  }
}

async function alterarStatusTabela(tabelaId, status) {
  const tabela = freteState.gestao?.tabelas?.find((item) => String(item.id) === String(tabelaId));
  if (!tabela) return;
  const rotulo = status === 'ativa' ? 'homologar' : status === 'inativa' ? 'inativar' : 'colocar em revisão';
  const observacao = window.prompt(`Informe o motivo para ${rotulo} a tabela ${tabela.transportadora}:`, 'Validação operacional registrada');
  if (observacao == null) return;
  try {
    await fetchJson(`/api/frete/tabelas/${encodeURIComponent(tabelaId)}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, observacao })
    });
    freteState.gestao = null;
    document.getElementById('freteGestaoPanel').hidden = true;
    await carregarStatus();
    await carregarGestao();
  } catch (erro) {
    const bloqueios = erro.data?.bloqueios || [];
    window.alert(`${erro.message}${bloqueios.length ? `\n\n${bloqueios.join('\n')}` : ''}`);
  }
}

function montarResumoCotacao() {
  if (!freteState.cotacao) return '';
  const destino = `${document.getElementById('freteCidade')?.value || ''}/${document.getElementById('freteUf')?.value || ''}`;
  const linhas = [`Cotação de frete #${freteState.cotacao.cotacao_id || ''}`, `Destino: ${destino}`, `Valor da mercadoria: ${formatarValorMercadoria(document.getElementById('freteValorMercadoria')?.value)}`, '', 'Carga:'];
  freteState.itens.forEach((item) => linhas.push(`- ${item.quantidade}x ${item.codigo} · ${item.descricao}`));
  linhas.push('', 'Opções:');
  (freteState.cotacao.resultados || []).filter((item) => item.ok).forEach((item) => {
    const icms = item.icms_percentual != null
      ? `; ICMS ${percentual(item.icms_percentual)} ${item.icms_estimado ? 'assumido' : 'configurado'}: ${moeda(item.icms_valor)}`
      : '';
    linhas.push(`- ${item.transportadora}: ${moeda(item.valor_total)}${icms}${item.homologado ? '' : ' (prévia em revisão)'}`);
  });
  return linhas.join('\n');
}

async function copiarResumoCotacao() {
  const texto = montarResumoCotacao();
  if (!texto) return;
  try {
    await navigator.clipboard.writeText(texto);
    const botao = document.getElementById('freteCopiarResumoBtn');
    if (botao) {
      const original = botao.innerHTML;
      botao.innerHTML = '<i class="fa-solid fa-check"></i>Copiado';
      setTimeout(() => { botao.innerHTML = original; }, 1800);
    }
  } catch (_erro) {
    window.prompt('Copie o resumo da cotação:', texto);
  }
}

function template() {
  return `
    <div class="frete-shell">
      <header class="frete-header">
        <div class="frete-title"><span class="frete-title-icon"><i class="fa-solid fa-calculator"></i></span><div><h1>Simulador de frete</h1><p>Monte a carga e compare apenas transportadoras que atendem ao destino.</p></div></div>
        <div class="frete-header-actions"><button id="freteGestaoBtn" class="frete-btn frete-btn-secondary" type="button"><i class="fa-solid fa-clipboard-check"></i>Tabelas e qualidade</button><button id="freteRecentesBtn" class="frete-btn frete-btn-secondary" type="button"><i class="fa-solid fa-clock-rotate-left"></i>Cotações recentes</button><span class="frete-status-pill" id="freteStatus"><i class="fa-solid fa-circle"></i>Preparando tabelas...</span></div>
      </header>
      <main class="frete-workspace">
        <section id="freteRecentesPanel" class="frete-panel frete-recents" hidden><div class="frete-panel-head"><div><h2>Últimas cotações</h2><p>Reabra uma simulação para ajustar destino, valor ou quantidades.</p></div><span class="frete-step"><i class="fa-solid fa-clock-rotate-left"></i></span></div><div class="frete-panel-body"><div id="freteCotacoesRecentes" class="frete-recents-list"></div></div></section>
        <section id="freteGestaoPanel" class="frete-panel frete-management" hidden><div class="frete-panel-head"><div><h2>Tabelas e qualidade</h2><p>Homologue somente fontes conferidas e acompanhe dados que afetam o cálculo.</p></div><span class="frete-step"><i class="fa-solid fa-shield-halved"></i></span></div><div class="frete-panel-body"><div id="freteGestaoConteudo"></div></div></section>
        <section class="frete-panel">
          <div class="frete-panel-head"><div><h2>Destino</h2><p id="freteOrigem">A origem Fromtherm é fixa.</p></div><span class="frete-step">1</span></div>
          <div class="frete-panel-body">
            <div class="frete-field"><label for="freteCep">CEP</label><div class="frete-inline"><input id="freteCep" class="frete-input" inputmode="numeric" maxlength="9" placeholder="00000-000" autocomplete="postal-code"><button id="freteBuscarCep" class="frete-btn frete-btn-secondary" type="button"><i class="fa-solid fa-magnifying-glass"></i>Buscar</button></div><small id="freteCepStatus">O CEP define a faixa de atendimento com maior precisão.</small></div>
            <div class="frete-grid-2"><div class="frete-field"><label for="freteUf">UF</label><input id="freteUf" class="frete-input" list="freteUfOpcoes" maxlength="2" placeholder="Digite a UF" autocomplete="address-level1" aria-describedby="freteUfStatus"><datalist id="freteUfOpcoes">${FRETE_UFS.map((uf) => `<option value="${uf}"></option>`).join('')}</datalist><small id="freteUfStatus">Digite para pesquisar, por exemplo: S.</small></div><div class="frete-field"><label for="freteCidade">Cidade</label><input id="freteCidade" class="frete-input" list="freteCidadeOpcoes" placeholder="Selecione primeiro a UF" autocomplete="address-level2" aria-describedby="freteCidadeStatus" disabled><datalist id="freteCidadeOpcoes"></datalist><small id="freteCidadeStatus">As sugestões mostram todos os municípios e indicam quais têm cobertura.</small></div></div>
            <div class="frete-field"><label for="freteValorMercadoria">Valor da mercadoria</label><input id="freteValorMercadoria" class="frete-input" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-describedby="freteValorStatus"><small id="freteValorStatus">Aceita 12.000,00, 12000 ou 12000,00.</small></div>
          </div>
        </section>
        <section class="frete-panel">
          <div class="frete-panel-head"><div><h2>Máquinas e mercadorias</h2><p>Somente produtos fiscais 00 e 04.</p></div><span class="frete-step">2</span></div>
          <div class="frete-panel-body">
            <div class="frete-search"><div class="frete-search-box"><i class="fa-solid fa-magnifying-glass"></i><input id="freteBuscaProduto" class="frete-input" placeholder="Código ou nome do produto" autocomplete="off"></div><div id="freteBuscaResultados" class="frete-results" hidden></div></div>
            <div id="freteItens" class="frete-items"></div>
          </div>
        </section>
        <section class="frete-panel frete-summary-panel">
          <div class="frete-panel-head"><div><h2>Resumo da carga</h2><p>Pré-romaneio calculado automaticamente.</p></div><span class="frete-step">3</span></div>
          <div class="frete-panel-body">
            <div class="frete-summary"><div class="frete-metric-grid"><div class="frete-metric"><span>Volumes</span><strong id="freteResumoVolumes">0</strong></div><div class="frete-metric"><span>Peso real</span><strong id="freteResumoPeso">0,0 kg</strong></div><div class="frete-metric"><span>Cubagem</span><strong id="freteResumoCubagem">0,000 m³</strong></div><div class="frete-metric"><span>Homologadas</span><strong id="freteResumoTransportadoras">0</strong></div></div><div id="freteCadastroAviso" class="frete-alert" hidden></div></div>
            <button id="freteSimularBtn" class="frete-btn frete-btn-primary frete-simulate" type="button" disabled><i class="fa-solid fa-bolt"></i>Comparar fretes</button>
          </div>
        </section>
        <section id="freteResultadosPanel" class="frete-panel frete-quotes" hidden><div class="frete-panel-head"><div><h2>Opções para este frete</h2><p>Estimativa detalhada; confirme a contratação com a transportadora.</p></div><div class="frete-result-actions"><button id="freteCopiarResumoBtn" class="frete-btn frete-btn-ghost" type="button"><i class="fa-solid fa-copy"></i>Copiar resumo</button><button id="freteImprimirBtn" class="frete-btn frete-btn-ghost" type="button"><i class="fa-solid fa-print"></i>Imprimir</button></div></div><div class="frete-panel-body"><div id="freteResultados" class="frete-quotes-grid"></div></div></section>
      </main>
    </div>
  `;
}

function adicionarProduto(codigo) {
  const item = freteState.resultadosBusca.find((produto) => String(produto.codigo) === String(codigo));
  if (!item) return;
  const existente = freteState.itens.find((produto) => String(produto.codigo) === String(codigo));
  if (existente) existente.quantidade += 1;
  else freteState.itens.push({ ...item, quantidade: 1 });
  freteState.resultadosBusca = [];
  const busca = document.getElementById('freteBuscaProduto');
  if (busca) busca.value = '';
  renderBusca();
  renderItens();
}

async function pesquisarProdutos(termo) {
  freteState.buscaController?.abort();
  if (String(termo).trim().length < 2) {
    freteState.resultadosBusca = [];
    renderBusca();
    return;
  }
  freteState.buscaController = new AbortController();
  try {
    const data = await fetchJson(`/api/frete/produtos?q=${encodeURIComponent(termo)}&limit=20`, { signal: freteState.buscaController.signal });
    freteState.resultadosBusca = data.itens || [];
    renderBusca();
  } catch (erro) {
    if (erro.name !== 'AbortError') {
      freteState.resultadosBusca = [];
      renderBusca();
    }
  }
}

function renderCidades(localidades) {
  const lista = document.getElementById('freteCidadeOpcoes');
  if (!lista) return;
  lista.innerHTML = (Array.isArray(localidades) ? localidades : [])
    .map((item) => `<option value="${esc(item.cidade)}">${numero(item.transportadoras) > 0 ? `${numero(item.transportadoras)} tabela(s) com cobertura` : 'Sem cobertura cadastrada'}</option>`)
    .join('');
}

async function carregarCidades(uf, busca = '') {
  const cidade = document.getElementById('freteCidade');
  const status = document.getElementById('freteCidadeStatus');
  freteState.localidadesController?.abort();
  if (!FRETE_UFS.includes(uf)) {
    if (cidade) cidade.disabled = true;
    renderCidades([]);
    return;
  }

  freteState.localidadesController = new AbortController();
  if (cidade) cidade.disabled = false;
  if (status) status.textContent = 'Carregando municípios...';
  try {
    const data = await fetchJson(`/api/frete/localidades?uf=${encodeURIComponent(uf)}&q=${encodeURIComponent(busca)}&limit=1000`, { signal: freteState.localidadesController.signal });
    if (document.getElementById('freteUf')?.value !== uf) return;
    renderCidades(data.itens || []);
    const atendidas = (data.itens || []).filter((item) => numero(item.transportadoras) > 0).length;
    if (status) status.textContent = data.itens?.length
      ? `${data.itens.length} município(s) encontrado(s); ${atendidas} com cobertura cadastrada.`
      : 'Nenhum município encontrado; ainda é possível informar a cidade manualmente.';
  } catch (erro) {
    if (erro.name === 'AbortError') return;
    renderCidades([]);
    if (status) status.textContent = 'Não foi possível carregar as cidades; informe manualmente.';
  }
}

function atualizarUf({ preservarCidade = false, buscaCidade = '' } = {}) {
  const ufInput = document.getElementById('freteUf');
  const cidade = document.getElementById('freteCidade');
  const status = document.getElementById('freteUfStatus');
  const uf = String(ufInput?.value || '').replace(/[^a-z]/gi, '').toUpperCase().slice(0, 2);
  if (ufInput) ufInput.value = uf;

  if (!FRETE_UFS.includes(uf)) {
    if (freteState.ultimaUf && !preservarCidade && cidade) cidade.value = '';
    freteState.ultimaUf = '';
    if (cidade) cidade.disabled = true;
    renderCidades([]);
    if (status) status.textContent = uf ? 'Continue digitando ou escolha uma UF sugerida.' : 'Digite para pesquisar, por exemplo: S.';
    return;
  }

  if (!preservarCidade && uf !== freteState.ultimaUf && cidade) cidade.value = '';
  freteState.ultimaUf = uf;
  ufInput?.removeAttribute('aria-invalid');
  if (status) status.textContent = `UF ${uf} selecionada.`;
  carregarCidades(uf, buscaCidade);
}

async function buscarCep() {
  const input = document.getElementById('freteCep');
  const status = document.getElementById('freteCepStatus');
  const cep = limparCep(input?.value);
  if (cep.length !== 8) {
    if (input) input.setAttribute('aria-invalid', 'true');
    if (status) status.textContent = 'Informe os 8 dígitos do CEP.';
    return;
  }
  input?.removeAttribute('aria-invalid');
  if (status) status.textContent = 'Consultando CEP...';
  try {
    const data = await fetchJson(`/api/viacep/${cep}`);
    if (data.erro) throw new Error('CEP não encontrado.');
    document.getElementById('freteUf').value = data.uf || '';
    document.getElementById('freteCidade').value = data.localidade || '';
    atualizarUf({ preservarCidade: true, buscaCidade: data.localidade || '' });
    if (status) status.textContent = `${data.localidade || ''}${data.uf ? ` / ${data.uf}` : ''}${data.bairro ? ` · ${data.bairro}` : ''}`;
  } catch (erro) {
    if (status) status.textContent = erro.message || 'Não foi possível consultar o CEP.';
    input?.setAttribute('aria-invalid', 'true');
  }
}

async function simular() {
  const botao = document.getElementById('freteSimularBtn');
  const painel = document.getElementById('freteResultadosPanel');
  const container = document.getElementById('freteResultados');
  const destino = {
    cep: limparCep(document.getElementById('freteCep')?.value),
    uf: String(document.getElementById('freteUf')?.value || '').toUpperCase(),
    cidade: document.getElementById('freteCidade')?.value.trim()
  };
  if (!FRETE_UFS.includes(destino.uf) || !destino.cidade) {
    if (!FRETE_UFS.includes(destino.uf)) document.getElementById('freteUf')?.setAttribute('aria-invalid', 'true');
    document.getElementById('freteCidade')?.setAttribute('aria-invalid', 'true');
    return;
  }
  document.getElementById('freteCidade')?.removeAttribute('aria-invalid');
  botao.disabled = true;
  botao.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>Calculando...';
  painel.hidden = false;
  container.innerHTML = '<div class="frete-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Cruzando cobertura, peso e tabelas...</span></div>';
  try {
    const data = await fetchJson('/api/frete/simular', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destino, valor_mercadoria: parseValorMercadoria(document.getElementById('freteValorMercadoria')?.value), itens: freteState.itens.map((item) => ({ codigo: item.codigo, quantidade: item.quantidade })) })
    });
    freteState.cotacao = data;
    renderResultados(data);
  } catch (erro) {
    const detalhes = erro.data?.detalhes || [];
    container.innerHTML = `<div class="frete-alert is-error"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(erro.message)}${detalhes.length ? `<br>${detalhes.map((item) => `${esc(item.codigo)}: ${esc(item.erros.join(' '))}`).join('<br>')}` : ''}</span></div>`;
  } finally {
    botao.innerHTML = '<i class="fa-solid fa-bolt"></i>Comparar fretes';
    renderResumo();
  }
}

function bind() {
  document.getElementById('freteBuscaProduto')?.addEventListener('input', (event) => {
    clearTimeout(freteState.buscaTimer);
    freteState.buscaTimer = setTimeout(() => pesquisarProdutos(event.target.value), 250);
  });
  document.getElementById('freteBuscaResultados')?.addEventListener('click', (event) => {
    const botao = event.target.closest('[data-frete-add]');
    if (botao) adicionarProduto(botao.dataset.freteAdd);
  });
  document.getElementById('freteItens')?.addEventListener('click', (event) => {
    const linha = event.target.closest('[data-frete-item]');
    if (!linha) return;
    const item = freteState.itens.find((produto) => String(produto.codigo) === linha.dataset.freteItem);
    if (!item) return;
    if (event.target.closest('[data-frete-remove]')) freteState.itens = freteState.itens.filter((produto) => produto !== item);
    const qtd = event.target.closest('[data-frete-qtd]');
    if (qtd) item.quantidade = Math.max(1, numero(item.quantidade) + numero(qtd.dataset.freteQtd));
    renderItens();
  });
  document.getElementById('freteItens')?.addEventListener('change', (event) => {
    if (!event.target.matches('[data-frete-qtd-input]')) return;
    const linha = event.target.closest('[data-frete-item]');
    const item = freteState.itens.find((produto) => String(produto.codigo) === linha?.dataset.freteItem);
    if (item) item.quantidade = Math.max(1, Math.floor(numero(event.target.value) || 1));
    renderItens();
  });
  document.getElementById('freteCep')?.addEventListener('input', (event) => { event.target.value = formatarCep(event.target.value); });
  document.getElementById('freteBuscarCep')?.addEventListener('click', buscarCep);
  document.getElementById('freteCep')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') buscarCep(); });
  document.getElementById('freteUf')?.addEventListener('input', () => atualizarUf());
  document.getElementById('freteUf')?.addEventListener('change', () => atualizarUf());
  document.getElementById('freteCidade')?.addEventListener('focus', (event) => {
    const uf = document.getElementById('freteUf')?.value;
    if (FRETE_UFS.includes(uf) && !event.target.value) carregarCidades(uf);
  });
  document.getElementById('freteCidade')?.addEventListener('input', (event) => {
    event.target.removeAttribute('aria-invalid');
    clearTimeout(freteState.localidadesTimer);
    const uf = document.getElementById('freteUf')?.value;
    if (FRETE_UFS.includes(uf)) {
      freteState.localidadesTimer = setTimeout(() => carregarCidades(uf, event.target.value.trim()), 250);
    }
  });
  document.getElementById('freteValorMercadoria')?.addEventListener('blur', (event) => {
    if (event.target.value.trim()) event.target.value = formatarValorMercadoria(event.target.value);
  });
  document.getElementById('freteRecentesBtn')?.addEventListener('click', carregarCotacoesRecentes);
  document.getElementById('freteGestaoBtn')?.addEventListener('click', carregarGestao);
  document.getElementById('freteGestaoConteudo')?.addEventListener('click', (event) => {
    const botao = event.target.closest('[data-frete-table-status]');
    if (botao && !botao.disabled) alterarStatusTabela(botao.dataset.freteTableId, botao.dataset.freteTableStatus);
  });
  document.getElementById('freteCotacoesRecentes')?.addEventListener('click', (event) => {
    const botao = event.target.closest('[data-frete-reopen]');
    if (botao) reabrirCotacao(botao.dataset.freteReopen);
  });
  document.getElementById('freteSimularBtn')?.addEventListener('click', simular);
  document.getElementById('freteCopiarResumoBtn')?.addEventListener('click', copiarResumoCotacao);
  document.getElementById('freteImprimirBtn')?.addEventListener('click', () => window.print());
}

async function carregarStatus() {
  const el = document.getElementById('freteStatus');
  try {
    freteState.status = await fetchJson('/api/frete/status');
    const ativas = (freteState.status.tabelas || []).filter((item) => item.status === 'ativa').length;
    const total = numero(freteState.status.produtos?.total);
    const aptos = numero(freteState.status.produtos?.aptos);
    if (el) el.innerHTML = `<i class="fa-solid fa-circle"></i>${ativas} tabela(s) ativa(s) · ${aptos}/${total} produtos aptos`;
    const origem = freteState.status.origem;
    const origemEl = document.getElementById('freteOrigem');
    if (origemEl && origem) origemEl.textContent = `Origem fixa: ${origem.cidade}/${origem.uf} · CEP ${origem.cep}.`;
  } catch (erro) {
    if (el) el.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:#fbbf24"></i>${esc(erro.message)}`;
  }
  renderResumo();
}

function inicializar() {
  if (freteState.inicializado) return;
  const root = document.getElementById('freteSimuladorRoot');
  if (!root) return;
  freteState.inicializado = true;
  root.innerHTML = template();
  bind();
  renderItens();
}

function abrir() {
  inicializar();
  window.showMainTab?.('freteSimuladorPane');
  history.replaceState(null, '', '#simulador-frete');
  if (!freteState.carregado) {
    freteState.carregado = true;
    carregarStatus();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const menu = document.getElementById('menu-simulador-frete');
  menu?.addEventListener('click', (event) => { event.preventDefault(); abrir(); });
  if (location.hash === '#simulador-frete') abrir();
});

window.abrirSimuladorFrete = abrir;

})();
