const BTN_ID = 'producaoPrimeiraPecaOkBtnListarInspecoes';
const MODAL_ID = 'producaoPrimeiraPecaOkInspecoesIappModal';
const STYLE_ID = 'producaoPrimeiraPecaOkInspecoesIappStyles';

let carregando = false;

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

function formatarProjeto(value) {
  if (!value) return '-';
  if (typeof value === 'string') return formatarTexto(value);
  const candidatos = [value.descricao, value.identificacao, value.nome, value.id];
  const encontrado = candidatos.find((item) => item !== null && typeof item !== 'undefined' && String(item).trim() !== '');
  return encontrado ? formatarTexto(encontrado) : escapeHtml(JSON.stringify(value));
}

function formatarLinha(value) {
  if (!value) return '-';
  if (typeof value === 'string') return formatarTexto(value);
  const partes = [value.identificacao, value.descricao].filter((item) => item !== null && typeof item !== 'undefined' && String(item).trim() !== '');
  return partes.length ? partes.map((item) => escapeHtml(String(item))).join(' - ') : '-';
}

function formatarFuncionario(value) {
  if (!value) return '-';
  if (typeof value === 'string') return formatarTexto(value);
  const partes = [value.identificacao, value.nome, value.cracha].filter((item) => item !== null && typeof item !== 'undefined' && String(item).trim() !== '');
  return partes.length ? partes.map((item) => escapeHtml(String(item))).join(' - ') : '-';
}

function renderField(label, value, options = {}) {
  const classes = options.wide ? 'ppok-iapp-field ppok-iapp-field-wide' : 'ppok-iapp-field';
  return `
    <div class="${classes}">
      <span class="ppok-iapp-field-label">${escapeHtml(label)}</span>
      <div class="ppok-iapp-field-value">${value}</div>
    </div>
  `;
}

function injetarEstilos() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ppok-iapp-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 10090;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(2, 6, 23, 0.74);
      backdrop-filter: blur(5px);
    }

    .ppok-iapp-modal-overlay.is-open {
      display: flex;
    }

    .ppok-iapp-modal {
      width: min(1080px, 100%);
      max-height: min(88vh, 920px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(17, 24, 39, 0.98));
      box-shadow: 0 32px 80px rgba(0, 0, 0, 0.48);
    }

    .ppok-iapp-modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 22px 24px 18px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      background: linear-gradient(135deg, rgba(29, 78, 216, 0.18), rgba(15, 23, 42, 0.04));
    }

    .ppok-iapp-modal-title {
      margin: 0;
      color: #f8fafc;
      font-size: 20px;
      font-weight: 700;
      line-height: 1.2;
    }

    .ppok-iapp-modal-subtitle {
      margin: 6px 0 0;
      color: #94a3b8;
      font-size: 13px;
      line-height: 1.5;
    }

    .ppok-iapp-modal-close {
      flex: 0 0 auto;
      width: 38px;
      height: 38px;
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.72);
      color: #e2e8f0;
      font-size: 18px;
      cursor: pointer;
    }

    .ppok-iapp-modal-body {
      overflow: auto;
      padding: 22px 24px 26px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .ppok-iapp-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .ppok-iapp-meta-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(37, 99, 235, 0.12);
      border: 1px solid rgba(37, 99, 235, 0.24);
      color: #bfdbfe;
      font-size: 12px;
      font-weight: 600;
    }

    .ppok-iapp-meta-chip.is-success {
      background: rgba(34, 197, 94, 0.12);
      border-color: rgba(34, 197, 94, 0.24);
      color: #86efac;
    }

    .ppok-iapp-meta-chip.is-neutral {
      background: rgba(148, 163, 184, 0.12);
      border-color: rgba(148, 163, 184, 0.2);
      color: #cbd5e1;
    }

    .ppok-iapp-loading,
    .ppok-iapp-empty,
    .ppok-iapp-error {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 220px;
      padding: 24px;
      border-radius: 16px;
      border: 1px dashed rgba(148, 163, 184, 0.24);
      background: rgba(15, 23, 42, 0.44);
      color: #cbd5e1;
      text-align: center;
      font-size: 14px;
      line-height: 1.6;
    }

    .ppok-iapp-error {
      color: #fecaca;
      border-color: rgba(239, 68, 68, 0.3);
      background: rgba(127, 29, 29, 0.24);
    }

    .ppok-iapp-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
    }

    .ppok-iapp-card {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 16px;
      border-radius: 16px;
      border: 1px solid rgba(148, 163, 184, 0.16);
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.68), rgba(17, 24, 39, 0.96));
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }

    .ppok-iapp-card-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .ppok-iapp-card-code {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 700;
      color: #dbeafe;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    .ppok-iapp-card-title {
      margin: 0;
      color: #f8fafc;
      font-size: 15px;
      font-weight: 700;
      line-height: 1.4;
    }

    .ppok-iapp-card-status {
      flex: 0 0 auto;
      padding: 7px 10px;
      border-radius: 999px;
      border: 1px solid transparent;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .03em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .ppok-iapp-card-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .ppok-iapp-card-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(30, 41, 59, 0.86);
      border: 1px solid rgba(148, 163, 184, 0.16);
      color: #cbd5e1;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .03em;
      text-transform: uppercase;
    }

    .ppok-iapp-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .ppok-iapp-section-title {
      color: #93c5fd;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .ppok-iapp-fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .ppok-iapp-field {
      padding: 10px 11px;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.62);
      border: 1px solid rgba(148, 163, 184, 0.1);
    }

    .ppok-iapp-field-wide {
      grid-column: 1 / -1;
    }

    .ppok-iapp-field-label {
      display: block;
      margin-bottom: 4px;
      color: #94a3b8;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    .ppok-iapp-field-value {
      color: #f8fafc;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.45;
      word-break: break-word;
    }

    .ppok-iapp-card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding-top: 2px;
    }

    .ppok-iapp-card-note {
      color: #94a3b8;
      font-size: 12px;
      line-height: 1.5;
    }

    @media (max-width: 720px) {
      .ppok-iapp-modal-overlay {
        padding: 12px;
      }

      .ppok-iapp-modal-header,
      .ppok-iapp-modal-body {
        padding-left: 16px;
        padding-right: 16px;
      }

      .ppok-iapp-fields {
        grid-template-columns: 1fr;
      }

      .ppok-iapp-card-top {
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
  overlay.className = 'ppok-iapp-modal-overlay';
  overlay.innerHTML = `
    <div class="ppok-iapp-modal" role="dialog" aria-modal="true" aria-labelledby="ppokIappModalTitulo">
      <div class="ppok-iapp-modal-header">
        <div>
          <h2 id="ppokIappModalTitulo" class="ppok-iapp-modal-title">Operações de Engenharia</h2>
          <p class="ppok-iapp-modal-subtitle">Ao abrir, a tela verifica novidades na IAPP, atualiza o SQL local e exibe os registros já organizados a partir das tabelas do schema engenharia.</p>
        </div>
        <button type="button" class="ppok-iapp-modal-close" aria-label="Fechar modal">&times;</button>
      </div>
      <div class="ppok-iapp-modal-body" id="ppokIappModalBody"></div>
    </div>
  `;

  const closeButton = overlay.querySelector('.ppok-iapp-modal-close');
  const closeModal = () => {
    overlay.classList.remove('is-open');
    document.body.style.removeProperty('overflow');
  };

  closeButton?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('is-open')) {
      closeModal();
    }
  });

  document.body.appendChild(overlay);
  return overlay;
}

function abrirModal() {
  const overlay = garantirModal();
  overlay.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function atualizarBotaoCarregando(ativo) {
  const button = document.getElementById(BTN_ID);
  if (!button) return;
  if (!button.dataset.originalHtml) {
    button.dataset.originalHtml = button.innerHTML;
  }
  button.disabled = ativo;
  button.style.opacity = ativo ? '0.8' : '1';
  button.style.cursor = ativo ? 'wait' : 'pointer';
  button.innerHTML = ativo
    ? '<i class="fa-solid fa-spinner fa-spin"></i> Carregando...'
    : button.dataset.originalHtml;
}

function renderizarCarregando() {
  const body = document.getElementById('ppokIappModalBody');
  if (!body) return;
  body.innerHTML = `
    <div class="ppok-iapp-loading">
      <div>
        <div style="font-size:26px;margin-bottom:10px;color:#60a5fa;"><i class="fa-solid fa-spinner fa-spin"></i></div>
        Verificando mudanças na IAPP e carregando operações do SQL...
      </div>
    </div>
  `;
}

function renderizarErro(message) {
  const body = document.getElementById('ppokIappModalBody');
  if (!body) return;
  body.innerHTML = `
    <div class="ppok-iapp-error">
      <div>
        <div style="font-size:24px;margin-bottom:10px;"><i class="fa-solid fa-triangle-exclamation"></i></div>
        ${escapeHtml(message || 'Não foi possível carregar as operações.')}
      </div>
    </div>
  `;
}

function renderizarOperacoes(data) {
  const body = document.getElementById('ppokIappModalBody');
  if (!body) return;

  const itens = Array.isArray(data?.response) ? data.response : [];
  const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : 0;
  const meta = data?.meta || {};
  const syncSummary = data?.syncSummary || null;
  const pagina = syncSummary ? escapeHtml(String(syncSummary.startPage || '1')) : '1';
  const ultimaSync = formatarDataHora(syncSummary?.finishedAt || meta?.ultima_sincronizacao);
  const ultimaAtualizacaoIapp = formatarDataHora(meta?.ultima_atualizacao_iapp);

  if (!itens.length) {
    body.innerHTML = `
      <div class="ppok-iapp-meta">
        <div class="ppok-iapp-meta-chip is-neutral"><i class="fa-solid fa-database"></i> Origem SQL local</div>
        <div class="ppok-iapp-meta-chip"><i class="fa-solid fa-list"></i> Total local: ${formatarNumeroInteiro(total)}</div>
        <div class="ppok-iapp-meta-chip"><i class="fa-solid fa-rotate"></i> Última sync: ${ultimaSync}</div>
      </div>
      <div class="ppok-iapp-empty">
        <div>
          <div style="font-size:24px;margin-bottom:10px;color:#94a3b8;"><i class="fa-solid fa-inbox"></i></div>
          Nenhuma operação disponível nas tabelas locais.
        </div>
      </div>
    `;
    return;
  }

  const cards = itens.map((item) => {
    const badgeLocal = formatarTexto(item?.local);
    const badgeClassificacao = formatarTexto(item?.classificacao);

    return `
      <article class="ppok-iapp-card">
        <div class="ppok-iapp-card-top">
          <div>
            <div class="ppok-iapp-card-code"><i class="fa-solid fa-hashtag"></i> ${formatarTexto(item?.identificacao)}</div>
            <h3 class="ppok-iapp-card-title">${formatarTexto(item?.descricao)}</h3>
            <div class="ppok-iapp-card-badges" style="margin-top:10px;">
              <span class="ppok-iapp-card-badge"><i class="fa-solid fa-location-dot"></i> ${badgeLocal}</span>
              <span class="ppok-iapp-card-badge"><i class="fa-solid fa-layer-group"></i> ${badgeClassificacao}</span>
            </div>
          </div>
          <span class="ppok-iapp-card-status" style="background:rgba(14,165,233,.14);border-color:rgba(14,165,233,.3);color:#7dd3fc;">
            Ordem ${formatarNumeroInteiro(item?.ordem)}
          </span>
        </div>

        <div class="ppok-iapp-section">
          <div class="ppok-iapp-section-title">Base da operação</div>
          <div class="ppok-iapp-fields">
            ${renderField('ID operação', formatarNumeroInteiro(item?.id))}
            ${renderField('Unidade', formatarTexto(item?.unidade))}
            ${renderField('Valor unidade tempo', formatarNumero(item?.valor_unidade_tempo, 4))}
            ${renderField('Projeto', formatarProjeto(item?.projeto))}
          </div>
        </div>

        <div class="ppok-iapp-section">
          <div class="ppok-iapp-section-title">Capacidade</div>
          <div class="ppok-iapp-fields">
            ${renderField('Capacidade diária', formatarNumero(item?.capacidade_diaria, 4))}
            ${renderField('Qtde capacidade diária', formatarNumero(item?.qtde_capacidade_diaria, 4))}
            ${renderField('Qtde meta', formatarNumero(item?.qtde_meta, 4))}
            ${renderField('Classificação', formatarTexto(item?.classificacao))}
          </div>
        </div>

        <div class="ppok-iapp-section">
          <div class="ppok-iapp-section-title">Estrutura</div>
          <div class="ppok-iapp-fields">
            ${renderField('Linha de produção', formatarLinha(item?.linha_producao), { wide: true })}
            ${renderField('Fase produtiva', formatarLinha(item?.fase_produtiva), { wide: true })}
            ${renderField('Grupo máquinas', formatarLinha(item?.grupo_maquinas), { wide: true })}
            ${renderField('Funcionário padrão', formatarFuncionario(item?.funcionario_padrao), { wide: true })}
          </div>
        </div>

        <div class="ppok-iapp-section">
          <div class="ppok-iapp-section-title">Rastreabilidade</div>
          <div class="ppok-iapp-fields">
            ${renderField('Atualizado na IAPP', formatarDataHora(item?.data_ultima_atualizacao))}
            ${renderField('Sincronizado no SQL', formatarDataHora(item?.sincronizado_em))}
          </div>
        </div>

        <div class="ppok-iapp-card-footer">
          <div class="ppok-iapp-card-note">Leitura do schema engenharia.iapp_operacoes.</div>
          <div class="ppok-iapp-card-note">Página consultada na IAPP: ${pagina}</div>
        </div>
      </article>
    `;
  }).join('');

  const chips = [
    `<div class="ppok-iapp-meta-chip is-neutral"><i class="fa-solid fa-database"></i> Origem SQL local</div>`,
    `<div class="ppok-iapp-meta-chip"><i class="fa-solid fa-rectangle-list"></i> Itens exibidos: ${formatarNumeroInteiro(itens.length)}</div>`,
    `<div class="ppok-iapp-meta-chip"><i class="fa-solid fa-list"></i> Total local: ${formatarNumeroInteiro(total)}</div>`,
    `<div class="ppok-iapp-meta-chip"><i class="fa-solid fa-sitemap"></i> Linhas: ${formatarNumeroInteiro(meta?.linhas_producao)}</div>`,
    `<div class="ppok-iapp-meta-chip"><i class="fa-solid fa-diagram-project"></i> Fases: ${formatarNumeroInteiro(meta?.fases_produtivas)}</div>`,
    `<div class="ppok-iapp-meta-chip"><i class="fa-solid fa-clock"></i> Última sync SQL: ${ultimaSync}</div>`,
    `<div class="ppok-iapp-meta-chip"><i class="fa-solid fa-cloud-arrow-up"></i> Última atualização IAPP: ${ultimaAtualizacaoIapp}</div>`
  ];

  if (syncSummary) {
    chips.push(`<div class="ppok-iapp-meta-chip is-success"><i class="fa-solid fa-rotate"></i> Páginas verificadas: ${formatarNumeroInteiro(syncSummary.paginasProcessadas)}</div>`);
    chips.push(`<div class="ppok-iapp-meta-chip is-success"><i class="fa-solid fa-arrow-down-wide-short"></i> Registros verificados: ${formatarNumeroInteiro(syncSummary.registrosProcessados)}</div>`);
  }

  body.innerHTML = `
    <div class="ppok-iapp-meta">
      ${chips.join('')}
    </div>
    <div class="ppok-iapp-grid">${cards}</div>
  `;
}

async function listarInspecoesPaginaUm() {
  if (carregando) return;

  carregando = true;
  abrirModal();
  renderizarCarregando();
  atualizarBotaoCarregando(true);

  try {
    const response = await fetch('/api/engenharia/operacoes/local?sync=1', {
      credentials: 'include'
    });
    const data = await response.json();

    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || 'Não foi possível listar as operações.');
    }

    renderizarOperacoes(data);
  } catch (error) {
    console.error('[1aPecaOK] Erro ao listar operações IAPP:', error);
    renderizarErro(error?.message || 'Não foi possível listar as operações.');
  } finally {
    carregando = false;
    atualizarBotaoCarregando(false);
  }
}

function init() {
  injetarEstilos();
  garantirModal();

  const button = document.getElementById(BTN_ID);
  if (!button || button.dataset.bound === 'true') return;

  button.dataset.bound = 'true';
  button.addEventListener('click', listarInspecoesPaginaUm);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}