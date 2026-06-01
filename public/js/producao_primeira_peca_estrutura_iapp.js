const BTN_ID = 'producaoPrimeiraPecaOkBtnListarEstrutura';
const MODAL_ID = 'producaoPrimeiraPecaOkEstruturaIappModal';
const STYLE_ID = 'producaoPrimeiraPecaOkEstruturaIappStyles';
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 18;

let carregando = false;
let pollingTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatarTexto(value) {
  const texto = String(value ?? '').trim();
  return texto ? escapeHtml(texto) : '-';
}

function formatarNumeroInteiro(value) {
  if (value === null || typeof value === 'undefined' || value === '') return '-';
  const numero = Number(value);
  if (!Number.isFinite(numero)) return escapeHtml(String(value));
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(numero);
}

function formatarNumero(value, digits = 2) {
  if (value === null || typeof value === 'undefined' || value === '') return '-';
  const numero = Number(value);
  if (!Number.isFinite(numero)) return escapeHtml(String(value));
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(numero);
}

function formatarDataHora(value) {
  if (!value) return '-';
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return escapeHtml(String(value));
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(data);
}

function formatarTempoMinutos(value) {
  if (value === null || typeof value === 'undefined' || value === '') return '-';
  const numero = Number(value);
  if (!Number.isFinite(numero)) return escapeHtml(String(value));
  return `${formatarNumero(numero, 2)} min`;
}

function formatarStatus(value) {
  const texto = String(value ?? '').trim();
  if (!texto) return { label: '-', className: 'is-default' };

  const normalizado = texto.toUpperCase();
  if (normalizado.includes('ABERTO')) return { label: texto, className: 'is-open' };
  if (normalizado.includes('FECHADO')) return { label: texto, className: 'is-closed' };
  if (normalizado.includes('SUSPENSO') || normalizado.includes('BLOQUEADO')) return { label: texto, className: 'is-alert' };
  return { label: texto, className: 'is-default' };
}

function somarTempos(operacao) {
  const campos = [
    operacao?.tempo_operacao,
    operacao?.tempo_preparacao,
    operacao?.tempo_espera,
    operacao?.tempo_transporte,
    operacao?.tempo_fila
  ];

  return campos.reduce((acc, value) => {
    const numero = Number(value);
    return Number.isFinite(numero) ? acc + numero : acc;
  }, 0);
}

function renderField(label, value, options = {}) {
  const classes = options.wide ? 'ppok-estrutura-field ppok-estrutura-field-wide' : 'ppok-estrutura-field';
  return `
    <div class="${classes}">
      <span class="ppok-estrutura-field-label">${escapeHtml(label)}</span>
      <div class="ppok-estrutura-field-value">${value}</div>
    </div>
  `;
}

function renderResumoChip(icon, label, value) {
  return `
    <div class="ppok-estrutura-resumo-chip">
      <i class="fa-solid ${escapeHtml(icon)}"></i>
      <span>${escapeHtml(label)}:</span>
      <strong>${value}</strong>
    </div>
  `;
}

function injetarEstilos() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ppok-estrutura-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 10091;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(3, 7, 18, 0.76);
      backdrop-filter: blur(5px);
    }

    .ppok-estrutura-modal-overlay.is-open {
      display: flex;
    }

    .ppok-estrutura-modal {
      width: min(1180px, 100%);
      max-height: min(90vh, 960px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid rgba(45, 212, 191, 0.2);
      background: linear-gradient(180deg, rgba(8, 47, 73, 0.98), rgba(15, 23, 42, 0.98));
      box-shadow: 0 28px 90px rgba(0, 0, 0, 0.45);
    }

    .ppok-estrutura-modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 24px 26px 20px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.14);
      background: linear-gradient(135deg, rgba(20, 184, 166, 0.18), rgba(14, 116, 144, 0.08));
    }

    .ppok-estrutura-modal-title {
      margin: 0;
      color: #f8fafc;
      font-size: 21px;
      font-weight: 700;
      line-height: 1.2;
    }

    .ppok-estrutura-modal-subtitle {
      margin: 7px 0 0;
      color: #cbd5e1;
      font-size: 13px;
      line-height: 1.6;
    }

    .ppok-estrutura-modal-close {
      flex: 0 0 auto;
      width: 40px;
      height: 40px;
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.72);
      color: #e2e8f0;
      font-size: 18px;
      cursor: pointer;
    }

    .ppok-estrutura-modal-body {
      overflow: auto;
      padding: 22px 24px 28px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .ppok-estrutura-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .ppok-estrutura-meta-chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid rgba(94, 234, 212, 0.22);
      background: rgba(13, 148, 136, 0.14);
      color: #ccfbf1;
      font-size: 12px;
      font-weight: 600;
    }

    .ppok-estrutura-meta-chip.is-neutral {
      background: rgba(148, 163, 184, 0.12);
      border-color: rgba(148, 163, 184, 0.18);
      color: #e2e8f0;
    }

    .ppok-estrutura-meta-chip.is-success {
      background: rgba(34, 197, 94, 0.12);
      border-color: rgba(34, 197, 94, 0.2);
      color: #bbf7d0;
    }

    .ppok-estrutura-loading,
    .ppok-estrutura-empty,
    .ppok-estrutura-error {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 240px;
      padding: 24px;
      border-radius: 16px;
      border: 1px dashed rgba(148, 163, 184, 0.22);
      background: rgba(15, 23, 42, 0.44);
      color: #dbeafe;
      text-align: center;
      font-size: 14px;
      line-height: 1.7;
    }

    .ppok-estrutura-error {
      color: #fecaca;
      border-color: rgba(239, 68, 68, 0.28);
      background: rgba(127, 29, 29, 0.22);
    }

    .ppok-estrutura-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
      align-items: start;
    }

    .ppok-estrutura-card {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 18px;
      border-radius: 18px;
      border: 1px solid rgba(148, 163, 184, 0.14);
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.7), rgba(15, 23, 42, 0.96));
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }

    .ppok-estrutura-card-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .ppok-estrutura-card-code {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #99f6e4;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    .ppok-estrutura-card-title {
      margin: 0;
      color: #f8fafc;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.45;
    }

    .ppok-estrutura-card-status {
      flex: 0 0 auto;
      padding: 7px 11px;
      border-radius: 999px;
      border: 1px solid transparent;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .04em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .ppok-estrutura-card-status.is-open {
      background: rgba(34, 197, 94, 0.14);
      border-color: rgba(34, 197, 94, 0.24);
      color: #bbf7d0;
    }

    .ppok-estrutura-card-status.is-closed {
      background: rgba(59, 130, 246, 0.16);
      border-color: rgba(59, 130, 246, 0.24);
      color: #bfdbfe;
    }

    .ppok-estrutura-card-status.is-alert {
      background: rgba(248, 113, 113, 0.15);
      border-color: rgba(248, 113, 113, 0.24);
      color: #fecaca;
    }

    .ppok-estrutura-card-status.is-default {
      background: rgba(148, 163, 184, 0.14);
      border-color: rgba(148, 163, 184, 0.22);
      color: #e2e8f0;
    }

    .ppok-estrutura-card-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .ppok-estrutura-card-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(8, 47, 73, 0.74);
      border: 1px solid rgba(148, 163, 184, 0.14);
      color: #cffafe;
      font-size: 11px;
      font-weight: 700;
    }

    .ppok-estrutura-section {
      display: flex;
      flex-direction: column;
      gap: 9px;
    }

    .ppok-estrutura-section-title {
      color: #67e8f9;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .ppok-estrutura-fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .ppok-estrutura-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 11px 12px;
      border-radius: 13px;
      background: rgba(15, 23, 42, 0.58);
      border: 1px solid rgba(148, 163, 184, 0.1);
    }

    .ppok-estrutura-field-wide {
      grid-column: 1 / -1;
    }

    .ppok-estrutura-field-label {
      color: #94a3b8;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    .ppok-estrutura-field-value {
      color: #f8fafc;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.45;
      word-break: break-word;
    }

    .ppok-estrutura-resumo {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .ppok-estrutura-resumo-chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(14, 116, 144, 0.18);
      border: 1px solid rgba(103, 232, 249, 0.16);
      color: #e0f2fe;
      font-size: 11px;
      font-weight: 700;
    }

    .ppok-estrutura-resumo-chip strong {
      color: #f8fafc;
    }

    .ppok-estrutura-op-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .ppok-estrutura-op {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      border-radius: 14px;
      background: rgba(8, 47, 73, 0.46);
      border: 1px solid rgba(103, 232, 249, 0.12);
    }

    .ppok-estrutura-op-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .ppok-estrutura-op-title {
      margin: 0;
      color: #f8fafc;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.45;
    }

    .ppok-estrutura-op-subtitle {
      margin: 4px 0 0;
      color: #a5f3fc;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    .ppok-estrutura-op-total {
      flex: 0 0 auto;
      padding: 6px 9px;
      border-radius: 999px;
      background: rgba(15, 118, 110, 0.26);
      border: 1px solid rgba(94, 234, 212, 0.18);
      color: #ccfbf1;
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
    }

    .ppok-estrutura-op-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .ppok-estrutura-op-chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }

    .ppok-estrutura-op-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 9px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(148, 163, 184, 0.12);
      color: #dbeafe;
      font-size: 11px;
      font-weight: 700;
    }

    .ppok-estrutura-materials {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }

    .ppok-estrutura-material {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 9px;
      border-radius: 999px;
      background: rgba(14, 116, 144, 0.2);
      border: 1px solid rgba(125, 211, 252, 0.12);
      color: #e0f2fe;
      font-size: 11px;
      font-weight: 700;
    }

    .ppok-estrutura-card-footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: #94a3b8;
      font-size: 11px;
      line-height: 1.5;
    }

    @media (max-width: 900px) {
      .ppok-estrutura-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 720px) {
      .ppok-estrutura-modal-overlay {
        padding: 12px;
      }

      .ppok-estrutura-modal-header,
      .ppok-estrutura-modal-body {
        padding-left: 16px;
        padding-right: 16px;
      }

      .ppok-estrutura-fields,
      .ppok-estrutura-op-grid {
        grid-template-columns: 1fr;
      }

      .ppok-estrutura-card-footer {
        flex-direction: column;
      }
    }
  `;

  document.head.appendChild(style);
}

function garantirModal() {
  let overlay = document.getElementById(MODAL_ID);
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.className = 'ppok-estrutura-modal-overlay';
  overlay.innerHTML = `
    <div class="ppok-estrutura-modal" role="dialog" aria-modal="true" aria-labelledby="ppokEstruturaModalTitulo">
      <div class="ppok-estrutura-modal-header">
        <div>
          <h2 id="ppokEstruturaModalTitulo" class="ppok-estrutura-modal-title">Estruturas de Produto</h2>
          <p class="ppok-estrutura-modal-subtitle">Ao abrir, a tela verifica mudanças nas fichas da IAPP, atualiza as tabelas do schema engenharia e renderiza a estrutura localmente pelo SQL.</p>
        </div>
        <button type="button" class="ppok-estrutura-modal-close" aria-label="Fechar modal">&times;</button>
      </div>
      <div id="ppokEstruturaModalBody" class="ppok-estrutura-modal-body"></div>
    </div>
  `;

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      fecharModal();
    }
  });

  overlay.querySelector('.ppok-estrutura-modal-close')?.addEventListener('click', fecharModal);
  document.body.appendChild(overlay);

  return overlay;
}

function abrirModal() {
  garantirModal().classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function fecharModal() {
  cancelarPolling();
  const overlay = document.getElementById(MODAL_ID);
  if (overlay) {
    overlay.classList.remove('is-open');
  }
  document.body.style.overflow = '';
}

function cancelarPolling() {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
}

function modalAberto() {
  const overlay = document.getElementById(MODAL_ID);
  return Boolean(overlay && overlay.classList.contains('is-open'));
}

function agendarPolling(tentativasRestantes = POLL_MAX_ATTEMPTS) {
  cancelarPolling();
  if (tentativasRestantes <= 0) return;

  pollingTimer = setTimeout(() => {
    atualizarEstruturasEmSegundoPlano(tentativasRestantes);
  }, POLL_INTERVAL_MS);
}

async function atualizarEstruturasEmSegundoPlano(tentativasRestantes) {
  pollingTimer = null;

  if (!modalAberto()) return;

  try {
    const response = await fetch('/api/engenharia/fichas/local?sync=0', {
      credentials: 'include'
    });
    const data = await response.json();

    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || data?.message || 'Falha ao atualizar as estruturas.');
    }

    renderizarFichas(data);

    if (data?.syncInProgress) {
      agendarPolling(tentativasRestantes - 1);
    }
  } catch (error) {
    console.error('[estrutura-produto-iapp] erro ao atualizar estruturas em segundo plano:', error);
    if (tentativasRestantes > 1) {
      agendarPolling(tentativasRestantes - 1);
    }
  }
}

function renderizarCarregando() {
  const body = document.getElementById('ppokEstruturaModalBody');
  if (!body) return;

  body.innerHTML = `
    <div class="ppok-estrutura-loading">
      <div>
        <div style="font-size:26px;margin-bottom:10px;color:#5eead4;"><i class="fa-solid fa-spinner fa-spin"></i></div>
        Verificando mudanças nas fichas da IAPP e carregando a estrutura do SQL...
      </div>
    </div>
  `;
}

function renderizarErro(message) {
  const body = document.getElementById('ppokEstruturaModalBody');
  if (!body) return;

  body.innerHTML = `
    <div class="ppok-estrutura-error">
      <div>
        <div style="font-size:24px;margin-bottom:10px;"><i class="fa-solid fa-triangle-exclamation"></i></div>
        ${escapeHtml(message || 'Não foi possível carregar as estruturas agora.')}
      </div>
    </div>
  `;
}

function renderizarOperacao(operacao) {
  const titulo = operacao?.descricao || (operacao?.operacao_id ? `Operação ${formatarNumeroInteiro(operacao.operacao_id)}` : 'Operação sem identificação');
  const subtitulo = operacao?.identificacao
    ? `${formatarTexto(operacao.identificacao)}${operacao?.operacao_id ? ` • ID ${formatarNumeroInteiro(operacao.operacao_id)}` : ''}`
    : (operacao?.operacao_id ? `ID ${formatarNumeroInteiro(operacao.operacao_id)}` : '-');
  const totais = operacao?.totais || {};
  const materiaisPreview = Array.isArray(operacao?.materiais_preview) ? operacao.materiais_preview : [];
  const tempoTotal = somarTempos(operacao);

  return `
    <article class="ppok-estrutura-op">
      <div class="ppok-estrutura-op-top">
        <div>
          <h4 class="ppok-estrutura-op-title">${titulo}</h4>
          <div class="ppok-estrutura-op-subtitle">${subtitulo}</div>
        </div>
        <div class="ppok-estrutura-op-total">${formatarTempoMinutos(tempoTotal)}</div>
      </div>

      <div class="ppok-estrutura-op-grid">
        ${renderField('Tempo operação', formatarTempoMinutos(operacao?.tempo_operacao))}
        ${renderField('Tempo preparação', formatarTempoMinutos(operacao?.tempo_preparacao))}
        ${renderField('Tempo espera', formatarTempoMinutos(operacao?.tempo_espera))}
        ${renderField('Tempo transporte', formatarTempoMinutos(operacao?.tempo_transporte))}
        ${renderField('Capacidade', formatarNumero(operacao?.capacidade, 4))}
        ${renderField('Meta', formatarNumero(operacao?.meta, 4))}
      </div>

      <div class="ppok-estrutura-op-chip-row">
        <span class="ppok-estrutura-op-chip"><i class="fa-solid fa-boxes-stacked"></i> Materiais: ${formatarNumeroInteiro(totais?.materiais)}</span>
        <span class="ppok-estrutura-op-chip"><i class="fa-solid fa-cubes"></i> Subprodutos: ${formatarNumeroInteiro(totais?.subprodutos)}</span>
        <span class="ppok-estrutura-op-chip"><i class="fa-solid fa-list-check"></i> Checklists: ${formatarNumeroInteiro(totais?.checklists)}</span>
        <span class="ppok-estrutura-op-chip"><i class="fa-solid fa-briefcase"></i> Serviços: ${formatarNumeroInteiro(totais?.servicos)}</span>
      </div>

      ${operacao?.linha_producao || operacao?.fase_produtiva ? `
        <div class="ppok-estrutura-op-chip-row">
          ${operacao?.linha_producao ? `<span class="ppok-estrutura-op-chip"><i class="fa-solid fa-industry"></i> ${formatarTexto(operacao.linha_producao.descricao || operacao.linha_producao.identificacao)}</span>` : ''}
          ${operacao?.fase_produtiva ? `<span class="ppok-estrutura-op-chip"><i class="fa-solid fa-diagram-project"></i> ${formatarTexto(operacao.fase_produtiva.descricao)}</span>` : ''}
        </div>
      ` : ''}

      ${materiaisPreview.length ? `
        <div class="ppok-estrutura-materials">
          ${materiaisPreview.map((item) => `
            <span class="ppok-estrutura-material">
              <i class="fa-solid fa-barcode"></i>
              ${formatarNumeroInteiro(item?.produto_id)}
              <strong>x${formatarNumero(item?.qtde, 4)}</strong>
            </span>
          `).join('')}
        </div>
      ` : ''}
    </article>
  `;
}

function renderizarFichas(data) {
  const body = document.getElementById('ppokEstruturaModalBody');
  if (!body) return;

  const fichas = Array.isArray(data?.response) ? data.response : [];
  const meta = data?.meta || {};
  const syncSummary = data?.syncSummary || null;
  const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : 0;
  const ultimaSync = formatarDataHora(syncSummary?.finishedAt || meta?.ultima_sincronizacao);
  const ultimaAtualizacaoIapp = formatarDataHora(meta?.ultima_atualizacao_iapp);
  const syncInProgress = Boolean(data?.syncInProgress);

  if (!fichas.length) {
    const chips = [
      `<div class="ppok-estrutura-meta-chip is-neutral"><i class="fa-solid fa-database"></i> Origem SQL local</div>`,
      `<div class="ppok-estrutura-meta-chip"><i class="fa-solid fa-table-list"></i> Total local: ${formatarNumeroInteiro(total)}</div>`,
      `<div class="ppok-estrutura-meta-chip"><i class="fa-solid fa-rotate"></i> Última sync: ${ultimaSync}</div>`
    ];

    if (syncInProgress) {
      chips.push(`<div class="ppok-estrutura-meta-chip is-success"><i class="fa-solid fa-arrows-rotate fa-spin"></i> Atualizando em segundo plano</div>`);
    }

    body.innerHTML = `
      <div class="ppok-estrutura-meta">
        ${chips.join('')}
      </div>
      <div class="ppok-estrutura-empty">
        <div>
          <div style="font-size:24px;margin-bottom:10px;color:#94a3b8;"><i class="fa-solid fa-box-open"></i></div>
          ${syncInProgress ? 'Primeira carga em andamento. As fichas vão aparecer automaticamente quando a sync terminar.' : 'Nenhuma ficha disponível nas tabelas locais.'}
        </div>
      </div>
    `;
    return;
  }

  const chips = [
    `<div class="ppok-estrutura-meta-chip is-neutral"><i class="fa-solid fa-database"></i> Origem SQL local</div>`,
    `<div class="ppok-estrutura-meta-chip"><i class="fa-solid fa-diagram-project"></i> Fichas: ${formatarNumeroInteiro(meta?.total_fichas ?? fichas.length)}</div>`,
    `<div class="ppok-estrutura-meta-chip"><i class="fa-solid fa-industry"></i> Operações: ${formatarNumeroInteiro(meta?.total_operacoes)}</div>`,
    `<div class="ppok-estrutura-meta-chip"><i class="fa-solid fa-boxes-stacked"></i> Materiais: ${formatarNumeroInteiro(meta?.total_materiais)}</div>`,
    `<div class="ppok-estrutura-meta-chip"><i class="fa-solid fa-cubes"></i> Subprodutos: ${formatarNumeroInteiro(meta?.total_subprodutos)}</div>`,
    `<div class="ppok-estrutura-meta-chip"><i class="fa-solid fa-list-check"></i> Checklists: ${formatarNumeroInteiro(meta?.total_checklists)}</div>`,
    `<div class="ppok-estrutura-meta-chip"><i class="fa-solid fa-briefcase"></i> Serviços: ${formatarNumeroInteiro(meta?.total_servicos)}</div>`,
    `<div class="ppok-estrutura-meta-chip"><i class="fa-solid fa-clock"></i> Última sync SQL: ${ultimaSync}</div>`,
    `<div class="ppok-estrutura-meta-chip"><i class="fa-solid fa-cloud-arrow-up"></i> Última atualização IAPP: ${ultimaAtualizacaoIapp}</div>`
  ];

  if (syncSummary) {
    chips.push(`<div class="ppok-estrutura-meta-chip is-success"><i class="fa-solid fa-rotate"></i> Páginas verificadas: ${formatarNumeroInteiro(syncSummary.paginasProcessadas)}</div>`);
    chips.push(`<div class="ppok-estrutura-meta-chip is-success"><i class="fa-solid fa-arrow-down-wide-short"></i> Registros verificados: ${formatarNumeroInteiro(syncSummary.registrosProcessados)}</div>`);
  }

  if (syncInProgress) {
    chips.push(`<div class="ppok-estrutura-meta-chip is-success"><i class="fa-solid fa-arrows-rotate fa-spin"></i> Atualizando em segundo plano</div>`);
  }

  const cards = fichas.map((item) => {
    const status = formatarStatus(item?.status);
    const operacoes = Array.isArray(item?.operacoes) ? item.operacoes : [];

    return `
      <article class="ppok-estrutura-card">
        <div class="ppok-estrutura-card-top">
          <div>
            <div class="ppok-estrutura-card-code"><i class="fa-solid fa-layer-group"></i> ${formatarTexto(item?.identificacao)}</div>
            <h3 class="ppok-estrutura-card-title">${formatarTexto(item?.descricao)}</h3>
            <div class="ppok-estrutura-card-badges">
              <span class="ppok-estrutura-card-badge"><i class="fa-solid fa-box"></i> ${formatarTexto(item?.produto)}</span>
              <span class="ppok-estrutura-card-badge"><i class="fa-solid fa-cubes"></i> ${formatarTexto(item?.modelo)}</span>
            </div>
          </div>
          <span class="ppok-estrutura-card-status ${status.className}">${escapeHtml(status.label)}</span>
        </div>

        <div class="ppok-estrutura-section">
          <div class="ppok-estrutura-section-title">Base da ficha</div>
          <div class="ppok-estrutura-fields">
            ${renderField('ID ficha', formatarNumeroInteiro(item?.id))}
            ${renderField('Produto', formatarTexto(item?.produto))}
            ${renderField('Qtde', formatarNumero(item?.qtde, 4))}
            ${renderField('Qtde batelada', formatarNumero(item?.qtde_batelada, 4))}
            ${renderField('Qtde referência', formatarNumero(item?.qtde_referencia, 4))}
            ${renderField('Modelo', formatarTexto(item?.modelo))}
          </div>
        </div>

        <div class="ppok-estrutura-section">
          <div class="ppok-estrutura-section-title">Custos e ciclo</div>
          <div class="ppok-estrutura-fields">
            ${renderField('VCPP', formatarNumero(item?.vcpp, 4))}
            ${renderField('VCP', formatarNumero(item?.vcp, 4))}
            ${renderField('Criado em', formatarDataHora(item?.data_criacao))}
            ${renderField('Atualizado na IAPP', formatarDataHora(item?.data_ultima_atualizacao))}
            ${renderField('Validade', formatarDataHora(item?.data_validade))}
            ${renderField('Sincronizado no SQL', formatarDataHora(item?.sincronizado_em))}
          </div>
        </div>

        <div class="ppok-estrutura-section">
          <div class="ppok-estrutura-section-title">Estrutura consolidada</div>
          <div class="ppok-estrutura-resumo">
            ${renderResumoChip('fa-industry', 'Operações', formatarNumeroInteiro(item?.total_operacoes))}
            ${renderResumoChip('fa-boxes-stacked', 'Materiais', formatarNumeroInteiro(item?.total_materiais))}
            ${renderResumoChip('fa-cubes', 'Subprodutos', formatarNumeroInteiro(item?.total_subprodutos))}
            ${renderResumoChip('fa-list-check', 'Checklists', formatarNumeroInteiro(item?.total_checklists))}
            ${renderResumoChip('fa-briefcase', 'Serviços', formatarNumeroInteiro(item?.total_servicos))}
          </div>
        </div>

        <div class="ppok-estrutura-section">
          <div class="ppok-estrutura-section-title">Operações da estrutura</div>
          <div class="ppok-estrutura-op-list">
            ${operacoes.length ? operacoes.map(renderizarOperacao).join('') : '<div class="ppok-estrutura-empty" style="min-height:120px;">Sem operações vinculadas nesta ficha.</div>'}
          </div>
        </div>

        <div class="ppok-estrutura-card-footer">
          <div>Leitura do schema engenharia.iapp_fichas e tabelas filhas.</div>
          <div>Usuário criador: ${formatarNumeroInteiro(item?.usuario_criador)} | Último atualizador: ${formatarNumeroInteiro(item?.ultimo_usuario_atualizador)}</div>
        </div>
      </article>
    `;
  }).join('');

  body.innerHTML = `
    <div class="ppok-estrutura-meta">
      ${chips.join('')}
    </div>
    <div class="ppok-estrutura-grid">${cards}</div>
  `;
}

function atualizarBotaoCarregando(estaCarregando) {
  const botao = document.getElementById(BTN_ID);
  if (!botao) return;

  botao.disabled = estaCarregando;
  botao.style.opacity = estaCarregando ? '0.75' : '1';
  botao.style.cursor = estaCarregando ? 'wait' : 'pointer';
}

async function listarEstruturas() {
  if (carregando) return;

  carregando = true;
  abrirModal();
  renderizarCarregando();
  atualizarBotaoCarregando(true);
  cancelarPolling();

  try {
    const response = await fetch('/api/engenharia/fichas/local?sync=1&wait=0', {
      credentials: 'include'
    });
    const data = await response.json();

    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || data?.message || 'Falha ao consultar as estruturas.');
    }

    renderizarFichas(data);

    if (data?.syncInProgress) {
      agendarPolling();
    }
  } catch (error) {
    console.error('[estrutura-produto-iapp] erro ao listar estruturas:', error);
    renderizarErro(error?.message || 'Falha ao listar estruturas.');
  } finally {
    carregando = false;
    atualizarBotaoCarregando(false);
  }
}

function inicializar() {
  injetarEstilos();

  const botao = document.getElementById(BTN_ID);
  if (!botao || botao.dataset.iappEstruturaBound === '1') return;

  botao.dataset.iappEstruturaBound = '1';
  botao.addEventListener('click', listarEstruturas);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      fecharModal();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializar, { once: true });
} else {
  inicializar();
}