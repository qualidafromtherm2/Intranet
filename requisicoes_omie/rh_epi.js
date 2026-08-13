/**
 * RH — EPI: página com guias
 * 1) Solicitação de EPI (relação por cargo da planilha Fromtherm)
 * 2) Controle de EPI entregues (ficha FT-M00-FCEPI)
 * Configuração: modal com catálogo ativar/desativar
 */
let _epiInited = false;
let _epiPane = null;
let _epiUsuarios = [];
let _epiCatalogo = [];
let _epiCatalogoUnico = []; // config: itens únicos
let _epiProdutosDisp = []; // solicitação: produtos vinculados ativos
let _epiVariacoesMap = {}; // codigo -> [{ tipo_id, tipo_nome, valores:[{id,valor}] }]
let _epiCarrinho = []; // { key, epi_catalogo_id, codigo, descricao, ca, url_imagem, epi_tipo, quantidade, tamanho }
let _epiSolicitacoes = [];
let _epiEntregas = [];
let _epiConfigView = 'menu'; // menu | catalogo
let _epiConfigCatalogoTab = 'ativos'; // ativos | inativos
let _epiProdCatalogoId = null;
let _epiProdCatalogoCa = '';
let _epiProdBuscaTimer = null;
let _epiProdBuscaSeq = 0;
let _epiProdBuscaQ = '';
let _epiProdBuscaOffset = 0;
let _epiProdBuscaHasMore = false;
let _epiProdBuscaLoading = false;

function epiRoles() {
  const raw = window.userRoles ?? window.__sessionUser?.roles ?? [];
  if (Array.isArray(raw)) return raw;
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** RH ou admin: configuração, controle de entregues e botões Informações/Editar */
function epiPodeGerenciar() {
  if (epiRoles().some((r) => String(r || '').trim().toLowerCase() === 'admin')) return true;
  const setor = String(window.__sessionUser?.setor || window.__sessionUser?.sector || '').trim().toLowerCase();
  if (setor === 'rh' || setor.includes('recursos humanos') || /(^|[^a-z])rh([^a-z]|$)/i.test(setor)) return true;
  const funcao = String(window.__sessionUser?.funcao_nome || window.__sessionUser?.funcao || '').trim().toLowerCase();
  if (funcao.includes('recursos humanos') || /(^|[^a-z])rh([^a-z]|$)/i.test(funcao)) return true;
  return false;
}

function applyEpiPermissions(pane) {
  if (!pane) return;
  const pode = epiPodeGerenciar();
  pane.classList.toggle('epi-somente-solicitacao', !pode);
  const cfg = epiVal('#epiBtnConfig', pane);
  if (cfg) cfg.style.display = pode ? '' : 'none';
  const tabEnt = epiVal('[data-epi-tab="entregas"]', pane);
  if (tabEnt) tabEnt.style.display = pode ? '' : 'none';
  if (!pode) {
    epiValAll('[data-epi-tab]', pane).forEach((b) => b.classList.remove('lp-tab-active'));
    epiVal('[data-epi-tab="solicitacao"]', pane)?.classList.add('lp-tab-active');
    epiVal('#epiTabSolicitacao', pane)?.classList.add('is-active');
    epiVal('#epiTabEntregas', pane)?.classList.remove('is-active');
  }
}

function epiVal(sel, root = document) {
  return root.querySelector(sel);
}

function epiValAll(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

async function epiFetchJson(url, init = {}) {
  const res = await fetch(url, { credentials: 'include', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function epiEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function epiFmtDateBR(str) {
  if (!str) return '—';
  const s = typeof str === 'string' ? str.slice(0, 10) : String(str).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function epiTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function findTabsRoot() {
  return document.querySelector('.main-container')
    || document.querySelector('.tab-content')
    || document.body;
}

function ensureEpiPane(root) {
  if (_epiPane) return _epiPane;

  const pane = document.createElement('div');
  pane.id = 'rhEpi';
  pane.className = 'tab-pane';
  pane.style.display = 'none';
  pane.style.flex = '1';
  pane.style.minHeight = '0';
  pane.style.overflow = 'hidden';
  pane.innerHTML = `
    <style>
    #rhEpi{padding:18px 24px;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
    #rhEpi .epi-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;flex-shrink:0}
    #rhEpi .epi-title{font-size:18px;font-weight:700;color:#e8ecff}
    #rhEpi .lp-tabs-nav{display:flex;align-items:center;gap:4px;margin-bottom:14px;border-bottom:2px solid rgba(255,255,255,.12);padding-bottom:0;flex-shrink:0}
    #rhEpi .lp-tab-btn{background:none;border:none;padding:10px 18px;font-size:14px;font-weight:600;color:#9ca3af;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;display:flex;align-items:center;gap:6px}
    #rhEpi .lp-tab-btn:hover{color:#93c5fd}
    #rhEpi .lp-tab-btn.lp-tab-active{color:#60a5fa;border-bottom-color:#60a5fa}
    #rhEpi .lp-tab-count{background:rgba(96,165,250,.18);color:#93c5fd;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700}
    #rhEpi .epi-tab-panel{display:none;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;flex-direction:column;gap:14px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
    #rhEpi .epi-tab-panel.is-active{display:flex}
    #rhEpi .epi-card{border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(17,20,28,.45);padding:14px 16px;flex-shrink:0}
    #rhEpi .epi-card h3{margin:0 0 12px;font-size:15px;color:#e8ecff}
    #rhEpi .epi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
    #rhEpi label.epi-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#a8b3d4}
    #rhEpi input:not([type=checkbox]):not([type=radio]),
    #rhEpi select,
    #rhEpi textarea{
      padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);
      background:rgba(17,20,28,.65);color:#e8ecff;font-size:13px;box-sizing:border-box
    }
    #rhEpi textarea{min-height:64px;resize:vertical}
    #rhEpi input[type=checkbox]{
      -webkit-appearance:checkbox !important;
      appearance:auto !important;
      width:16px !important;height:16px !important;
      min-width:16px !important;max-width:16px !important;
      min-height:16px !important;max-height:16px !important;
      padding:0 !important;margin:0 !important;
      border:none !important;border-radius:3px !important;
      background:transparent !important;box-shadow:none !important;
      flex:0 0 16px !important;align-self:center;accent-color:#5f8eff;cursor:pointer
    }
    #rhEpi .epi-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
    #rhEpi .epi-btn{padding:8px 14px;border-radius:10px;border:1px solid rgba(95,142,255,.45);background:rgba(58,109,240,.22);color:#cfe0ff;cursor:pointer;font-size:13px;font-weight:600}
    #rhEpi .epi-btn:hover{background:rgba(58,109,240,.35)}
    #rhEpi .epi-btn-ghost{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#c8d0e8}
    #rhEpi .epi-btn-danger{border-color:rgba(255,115,115,.35);background:rgba(255,95,95,.14);color:#ffc9c9}
    #rhEpi .epi-table-wrap{overflow:auto;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(17,20,28,.35)}
    #rhEpi table{width:100%;border-collapse:collapse;font-size:13px}
    #rhEpi th,#rhEpi td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;color:#e1e6f8}
    #rhEpi th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#a8b3d4;background:rgba(255,255,255,.03);position:sticky;top:0}
    #rhEpi .epi-empty{padding:28px;text-align:center;color:#9ca3af;font-size:13px}
    #rhEpi .epi-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
    #rhEpi .epi-badge-aberta{background:rgba(245,158,11,.18);color:#fbbf24}
    #rhEpi .epi-badge-atendida{background:rgba(34,197,94,.18);color:#4ade80}
    #rhEpi .epi-badge-cancelada{background:rgba(148,163,184,.18);color:#94a3b8}
    #rhEpi .epi-check-list{display:flex;flex-direction:column;gap:10px;max-height:none;overflow:visible;padding:4px 0;-webkit-overflow-scrolling:touch}
    #rhEpi .epi-cargo-group{border:1px solid rgba(255,255,255,.1);border-radius:10px;overflow:visible}
    #rhEpi .epi-cargo-title{margin:0;padding:8px 12px;font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#93c5fd;background:rgba(96,165,250,.1);border-bottom:1px solid rgba(255,255,255,.08)}
    #rhEpi .epi-check-item{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.06)}
    #rhEpi .epi-check-item:last-child{border-bottom:none}
    #rhEpi .epi-check-item .epi-chk-label{display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer;color:#e1e6f8;font-size:13px;margin:0}
    #rhEpi .epi-check-item .epi-chk-label span{line-height:1.3}
    #rhEpi .epi-check-item .epi-ca{color:#93c5fd;font-size:12px;white-space:nowrap;flex-shrink:0}
    #rhEpi .epi-check-item input[type=number]{width:64px;padding:4px 6px !important}
    #rhEpi .epi-check-item input[type=text].epi-tam{width:72px;padding:4px 6px !important}
    #rhEpi .epi-hint{font-size:12px;color:#9ca3af;margin:0 0 8px}
    #rhEpi .epi-prod-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:10px;align-items:stretch}
    #rhEpi .epi-prod-card{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(18,29,45,.85);box-shadow:none;height:100%;min-height:100%}
    #rhEpi .epi-prod-card:hover{border-color:rgba(95,142,255,.4)}
    #rhEpi .epi-prod-card-img{width:100%;height:120px;object-fit:contain;border-radius:8px;background:#0b1220;border:1px solid rgba(255,255,255,.08);flex-shrink:0}
    #rhEpi .epi-prod-card-img.ph{display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:28px}
    #rhEpi .epi-prod-card-cod{font-weight:700;font-size:13px;color:#edf4fc}
    #rhEpi .epi-prod-card-desc{font-size:12px;color:#9eb0c5;line-height:1.35;min-height:32px}
    #rhEpi .epi-prod-card-tipo{font-size:11px;color:#93c5fd}
    #rhEpi .epi-prod-card-estoque{margin:2px 0 4px;min-height:36px;padding:6px 8px;border-radius:6px;background:#f9fafb;border:1px solid rgba(0,0,0,.06)}
    #rhEpi .epi-prod-card-footer{margin-top:auto;display:flex;flex-direction:column;gap:8px;padding-top:4px}
    #rhEpi .epi-prod-card-vars{display:flex;flex-direction:column;gap:6px;width:100%;min-height:28px}
    #rhEpi .epi-prod-card-vars select{width:100%;padding:6px 8px !important;font-size:12px}
    #rhEpi .epi-prod-card-vars .epi-var-empty{font-size:11px;color:#9ca3af}
    #rhEpi .epi-prod-card-actions{display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap}
    #rhEpi .epi-prod-card-actions input[type=number]{width:56px;padding:6px !important;flex-shrink:0}
    #rhEpi .epi-prod-card-btns{display:flex;flex-direction:column;gap:6px;width:100%}
    #rhEpi .epi-prod-card-btns .epi-btn{width:100%;text-align:center;padding:8px 10px;font-size:12px}
    #rhEpi .epi-cart{margin-top:14px;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px;background:rgba(255,255,255,.03)}
    #rhEpi .epi-cart-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
    #rhEpi .epi-cart-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)}
    #rhEpi .epi-cart-item:last-child{border-bottom:none}
    #rhEpi .epi-cart-thumb{width:40px;height:40px;object-fit:cover;border-radius:8px;background:#0b1220;flex-shrink:0}
    .light-mode #rhEpi .epi-prod-card{background:#fff;border-color:#e5e7eb}
    .light-mode #rhEpi .epi-prod-card-cod{color:#111827}
    .light-mode #rhEpi .epi-prod-card-desc{color:#6b7280}
    .light-mode #rhEpi .epi-cart{background:#f9fafb;border-color:#e5e7eb}
    #rhEpi .epi-sign-thumb{height:36px;max-width:120px;object-fit:contain;background:#fff;border-radius:6px;border:1px solid rgba(255,255,255,.15);cursor:pointer;vertical-align:middle}
    #rhEpi .epi-badge-assinado{background:rgba(34,197,94,.18);color:#4ade80}
    #rhEpi .epi-badge-pend-assin{background:rgba(245,158,11,.18);color:#fbbf24}
    /* Modal config */
    #rhEpi .epi-modal-back{position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
    #rhEpi .epi-modal{width:min(720px,100%);max-height:min(86vh,820px);display:flex;flex-direction:column;background:#1a1d27;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.45);overflow:hidden}
    #rhEpi .epi-modal-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1);flex-shrink:0}
    #rhEpi .epi-modal-head h3{margin:0;font-size:16px;color:#e8ecff}
    #rhEpi .epi-modal-close{border:none;background:transparent;color:#a8b3d4;font-size:22px;cursor:pointer;line-height:1}
    #rhEpi .epi-modal-body{padding:14px 16px;overflow:auto;flex:1;min-height:0}
    #rhEpi .epi-cfg-menu{display:flex;flex-direction:column;gap:8px}
    #rhEpi .epi-cfg-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);cursor:pointer;color:#e1e6f8;text-align:left;width:100%;font-size:14px}
    #rhEpi .epi-cfg-item:hover{border-color:rgba(95,142,255,.45);background:rgba(58,109,240,.14)}
    #rhEpi .epi-cfg-item i.fa-chevron-right{color:#9ca3af;font-size:12px}
    #rhEpi .epi-cfg-back{margin-bottom:10px}
    #rhEpi .epi-cfg-toggle-row{display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06)}
    #rhEpi .epi-cfg-toggle-row .epi-cfg-row-top{display:flex;align-items:center;gap:10px;width:100%}
    #rhEpi .epi-cfg-toggle-row .epi-chk-label{display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer;color:#e1e6f8;font-size:13px;margin:0}
    #rhEpi .epi-cfg-toggle-row.is-off{opacity:.55}
    #rhEpi .epi-cfg-prod-count{font-size:11px;color:#93c5fd;white-space:nowrap}
    #rhEpi .epi-cfg-prods{display:flex;flex-wrap:wrap;gap:8px;padding-left:26px}
    #rhEpi .epi-cfg-prod-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);font-size:11px;color:#cfe0ff;max-width:100%}
    #rhEpi .epi-cfg-prod-chip img,#rhEpi .epi-cfg-prod-chip .ph{width:28px;height:28px;object-fit:contain;border-radius:6px;background:#0b1220;flex-shrink:0}
    #rhEpi .epi-cfg-prod-chip .ph{display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:12px}
    #rhEpi .epi-cfg-tabs{display:flex;gap:6px;margin:0 0 12px;flex-wrap:wrap}
    #rhEpi .epi-cfg-tab{padding:7px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#c8d0e8;cursor:pointer;font-size:12px;font-weight:600}
    #rhEpi .epi-cfg-tab.is-active{background:rgba(58,109,240,.28);border-color:rgba(95,142,255,.55);color:#dbeafe}
    #rhEpi .epi-prod-ca-box{display:flex;gap:8px;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap}
    #rhEpi .epi-prod-ca-box .epi-field{flex:1;min-width:140px}
    #rhEpi.epi-somente-solicitacao .epi-btn-info,
    #rhEpi.epi-somente-solicitacao .epi-btn-editar{display:none !important}
    #rhEpi .epi-prod-modal{width:min(640px,100%);max-height:min(90vh,860px)}
    #rhEpi .epi-prod-search{width:100%;margin-bottom:10px}
    #rhEpi .epi-prod-results,#rhEpi .epi-prod-linked{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow:auto}
    #rhEpi .epi-prod-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);cursor:pointer;text-align:left;width:100%;color:#e1e6f8}
    #rhEpi .epi-prod-row:hover{border-color:rgba(95,142,255,.45);background:rgba(58,109,240,.14)}
    #rhEpi .epi-prod-row.linked{cursor:default}
    #rhEpi .epi-prod-thumb{width:40px;height:40px;object-fit:cover;border-radius:8px;background:#111827;flex-shrink:0;border:1px solid rgba(255,255,255,.1)}
    #rhEpi .epi-prod-thumb.ph{display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:14px}
    #rhEpi .epi-prod-meta{flex:1;min-width:0}
    #rhEpi .epi-prod-cod{font-weight:700;font-size:13px;color:#f8fafc}
    #rhEpi .epi-prod-desc{font-size:12px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .light-mode #rhEpi .epi-prod-row{background:#f9fafb;border-color:#e5e7eb;color:#1f2937}
    .light-mode #rhEpi .epi-prod-cod{color:#111827}
    .light-mode #rhEpi .epi-prod-desc{color:#6b7280}
    .light-mode #rhEpi .epi-title{color:#111827}
    .light-mode #rhEpi .lp-tabs-nav{border-bottom-color:#e5e7eb}
    .light-mode #rhEpi .lp-tab-btn{color:#6b7280}
    .light-mode #rhEpi .lp-tab-btn.lp-tab-active{color:#2563eb;border-bottom-color:#2563eb}
    .light-mode #rhEpi .epi-card{background:#fff;border-color:#e5e7eb}
    .light-mode #rhEpi .epi-card h3{color:#111827}
    .light-mode #rhEpi label.epi-field{color:#4b5563}
    .light-mode #rhEpi input:not([type=checkbox]):not([type=radio]),
    .light-mode #rhEpi select,
    .light-mode #rhEpi textarea{background:#f9fafb;border-color:#d1d5db;color:#111827}
    .light-mode #rhEpi th{background:#f9fafb;color:#374151;border-color:#e5e7eb}
    .light-mode #rhEpi td{color:#1f2937;border-color:#f3f4f6}
    .light-mode #rhEpi .epi-table-wrap,.light-mode #rhEpi .epi-cargo-group{background:#fff;border-color:#e5e7eb}
    .light-mode #rhEpi .epi-cargo-title{background:#eff6ff;color:#1d4ed8;border-color:#e5e7eb}
    .light-mode #rhEpi .epi-check-item .epi-chk-label{color:#1f2937}
    .light-mode #rhEpi .epi-modal{background:#fff;border-color:#e5e7eb}
    .light-mode #rhEpi .epi-modal-head{border-color:#e5e7eb}
    .light-mode #rhEpi .epi-modal-head h3{color:#111827}
    .light-mode #rhEpi .epi-cfg-item{background:#f9fafb;border-color:#e5e7eb;color:#1f2937}
    </style>

    <div class="epi-header">
      <div class="epi-title"><i class="fa-solid fa-hard-hat" style="margin-right:8px"></i>EPI — Equipamento de Proteção Individual</div>
      <button type="button" class="epi-btn epi-btn-ghost" id="epiBtnConfig" title="Configurações">
        <i class="fa-solid fa-gear" style="margin-right:6px"></i>Configuração
      </button>
    </div>

    <div class="lp-tabs-nav" role="tablist">
      <button type="button" class="lp-tab-btn lp-tab-active" data-epi-tab="solicitacao" role="tab">
        <i class="fa-solid fa-clipboard-list"></i>
        <span>Solicitação de EPI</span>
        <span class="lp-tab-count" id="epiSolCount">0</span>
      </button>
      <button type="button" class="lp-tab-btn" data-epi-tab="entregas" role="tab">
        <i class="fa-solid fa-box-open"></i>
        <span>Controle de entregues</span>
        <span class="lp-tab-count" id="epiEntCount">0</span>
      </button>
    </div>

    <div id="epiTabSolicitacao" class="epi-tab-panel is-active" role="tabpanel">
      <div class="epi-card">
        <h3>Nova solicitação</h3>
        <p class="epi-hint">Selecione o colaborador, escolha os produtos vinculados aos EPIs e adicione ao carrinho.</p>
        <div class="epi-grid">
          <label class="epi-field">Colaborador
            <select id="epiSolUser"></select>
          </label>
          <label class="epi-field">Observação
            <input id="epiSolObs" type="text" placeholder="Opcional" />
          </label>
          <label class="epi-field">Buscar produto
            <input id="epiProdFiltro" type="search" placeholder="Filtrar por código ou descrição…" />
          </label>
        </div>
        <div style="margin-top:12px">
          <strong style="font-size:13px;color:#cfe0ff">EPIs sugeridos / catálogo</strong>
          <div id="epiCheckList" class="epi-prod-grid"><div class="epi-empty">Carregando…</div></div>
        </div>
        <div class="epi-cart" id="epiCartBox">
          <div class="epi-cart-head">
            <strong style="color:#e8ecff"><i class="fa-solid fa-cart-shopping" style="margin-right:6px"></i>Carrinho <span id="epiCartCount" class="lp-tab-count">0</span></strong>
            <button type="button" class="epi-btn epi-btn-ghost" id="epiBtnLimparCart">Limpar</button>
          </div>
          <div id="epiCartList"><div class="epi-empty" style="padding:12px">Carrinho vazio.</div></div>
          <div class="epi-actions">
            <button type="button" class="epi-btn" id="epiBtnCriarSol">Criar solicitação</button>
          </div>
        </div>
      </div>

      <div class="epi-card" style="min-height:200px;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <h3 style="margin:0">Solicitações</h3>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="epiSolFiltroStatus" style="width:auto">
              <option value="">Todas</option>
              <option value="aberta" selected>Abertas</option>
              <option value="atendida">Atendidas</option>
              <option value="cancelada">Canceladas</option>
            </select>
            <button type="button" class="epi-btn epi-btn-ghost" id="epiBtnRefreshSol">Atualizar</button>
          </div>
        </div>
        <div class="epi-table-wrap" style="flex:1">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Data</th>
                <th>Colaborador</th>
                <th>Cargo</th>
                <th>Itens</th>
                <th>Status</th>
                <th>Assinatura</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="epiSolTbody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="epiTabEntregas" class="epi-tab-panel" role="tabpanel">
      <div class="epi-card">
        <h3>Registrar entrega (ficha de controle)</h3>
        <p class="epi-hint">Campos da ficha FT-M00-FCEPI: colaborador, descrição, C.A., quantidade, data de entrega e devolução.</p>
        <div class="epi-grid">
          <label class="epi-field">Colaborador
            <select id="epiEntUser"></select>
          </label>
          <label class="epi-field">EPI (catálogo)
            <select id="epiEntItem"></select>
          </label>
          <label class="epi-field">C.A.
            <input id="epiEntCa" type="text" />
          </label>
          <label class="epi-field">Quantidade
            <input id="epiEntQtd" type="number" min="1" value="1" />
          </label>
          <label class="epi-field">Tamanho
            <input id="epiEntTam" type="text" placeholder="Ex.: 41" />
          </label>
          <label class="epi-field">Cód. item
            <input id="epiEntCod" type="text" />
          </label>
          <label class="epi-field">Data entrega
            <input id="epiEntData" type="date" />
          </label>
          <label class="epi-field">Data devolução
            <input id="epiEntDev" type="date" />
          </label>
          <label class="epi-field">Observação
            <input id="epiEntObs" type="text" />
          </label>
        </div>
        <div class="epi-actions">
          <button type="button" class="epi-btn" id="epiBtnRegistrarEnt">Registrar entrega</button>
        </div>
      </div>

      <div class="epi-card" style="flex:1;min-height:220px;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <h3 style="margin:0">EPIs entregues</h3>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input id="epiEntBusca" type="text" placeholder="Buscar colaborador, EPI ou C.A." style="width:240px;max-width:100%" />
            <button type="button" class="epi-btn epi-btn-ghost" id="epiBtnRefreshEnt">Atualizar</button>
          </div>
        </div>
        <div class="epi-table-wrap" style="flex:1">
          <table>
            <thead>
              <tr>
                <th>Cód.</th>
                <th>Colaborador</th>
                <th>Função</th>
                <th>Descrição do EPI</th>
                <th>C.A.</th>
                <th>Qtd</th>
                <th>Tam.</th>
                <th>Entrega</th>
                <th>Devolução</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="epiEntTbody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="epiConfigModal" class="epi-modal-back" style="display:none" aria-hidden="true">
      <div class="epi-modal" role="dialog" aria-modal="true" aria-labelledby="epiConfigTitle">
        <div class="epi-modal-head">
          <h3 id="epiConfigTitle">Configuração — EPI</h3>
          <button type="button" class="epi-modal-close" id="epiConfigClose" aria-label="Fechar">×</button>
        </div>
        <div class="epi-modal-body" id="epiConfigBody"></div>
      </div>
    </div>

    <div id="epiProdModal" class="epi-modal-back" style="display:none;z-index:12100" aria-hidden="true">
      <div class="epi-modal epi-prod-modal" role="dialog" aria-modal="true" aria-labelledby="epiProdTitle">
        <div class="epi-modal-head">
          <h3 id="epiProdTitle">Produtos do EPI</h3>
          <button type="button" class="epi-modal-close" id="epiProdClose" aria-label="Fechar">×</button>
        </div>
        <div class="epi-modal-body">
          <p class="epi-hint" id="epiProdHint">Vincule produtos do cadastro a este tipo de EPI.</p>
          <div class="epi-prod-ca-box">
            <label class="epi-field">C.A.
              <input id="epiProdCaInput" type="text" placeholder="Número do C.A." />
            </label>
            <button type="button" class="epi-btn" id="epiProdCaSalvar">Salvar C.A.</button>
          </div>
          <input id="epiProdSearch" class="epi-prod-search" type="search" placeholder="Pesquisar código ou descrição (mín. 4 letras)…" autocomplete="off" />
          <div id="epiProdResults" class="epi-prod-results" style="margin-bottom:14px"></div>
          <strong style="font-size:13px;color:#cfe0ff">Produtos vinculados</strong>
          <div id="epiProdLinked" class="epi-prod-linked" style="margin-top:8px"></div>
        </div>
      </div>
    </div>
  `;

  root.appendChild(pane);
  _epiPane = pane;
  bindEpiPane(pane);
  applyEpiPermissions(pane);
  return pane;
}

function fillUserSelects(pane) {
  const opts = ['<option value="">Selecione…</option>']
    .concat(_epiUsuarios.map((u) => {
      const nome = u.nome_completo || u.username || `#${u.id}`;
      const cargo = u.funcao || u.cargo || '';
      return `<option value="${u.id}" data-cargo="${epiEscape(cargo)}">${epiEscape(nome)}${cargo ? ` — ${epiEscape(cargo)}` : ''}</option>`;
    }));
  const html = opts.join('');
  const sol = epiVal('#epiSolUser', pane);
  const ent = epiVal('#epiEntUser', pane);
  if (sol) sol.innerHTML = html;
  if (ent) ent.innerHTML = html;
}

function fillCatalogoSelect(pane) {
  const sel = epiVal('#epiEntItem', pane);
  if (!sel) return;
  const seen = new Map();
  for (const p of _epiProdutosDisp) {
    if (!seen.has(p.epi_catalogo_id)) {
      seen.set(p.epi_catalogo_id, { id: p.epi_catalogo_id, descricao: p.epi_tipo, ca: p.epi_ca });
    }
  }
  // fallback: also from unique catalog
  for (const c of _epiCatalogoUnico.filter((x) => x.ativo !== false)) {
    if (!seen.has(c.epi_catalogo_id)) {
      seen.set(c.epi_catalogo_id, { id: c.epi_catalogo_id, descricao: c.descricao, ca: c.ca });
    }
  }
  const list = Array.from(seen.values()).sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
  sel.innerHTML = ['<option value="">Selecione…</option>']
    .concat(list.map((c) =>
      `<option value="${c.id}" data-desc="${epiEscape(c.descricao)}" data-ca="${epiEscape(c.ca || '')}">${epiEscape(c.descricao)}${c.ca ? ` (CA ${epiEscape(c.ca)})` : ''}</option>`
    ))
    .join('');
}

function epiCardImg(url) {
  if (url) {
    return `<img class="epi-prod-card-img" src="${epiEscape(url)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'epi-prod-card-img ph\\'><i class=\\'fa-solid fa-box\\'></i></div>'" />`;
  }
  return `<div class="epi-prod-card-img ph"><i class="fa-solid fa-box"></i></div>`;
}

function renderVariacaoSelects(codigo) {
  const grupos = _epiVariacoesMap[codigo] || [];
  if (!grupos.length) {
    return '<span class="epi-var-empty">Sem variação cadastrada</span>';
  }
  return grupos.map((g) => `
    <select class="epi-card-var" data-tipo-id="${g.tipo_id}" data-tipo-nome="${epiEscape(g.tipo_nome)}" title="${epiEscape(g.tipo_nome)}">
      <option value="">${epiEscape(g.tipo_nome)}…</option>
      ${(g.valores || []).map((v) => `<option value="${epiEscape(v.valor)}">${epiEscape(v.valor)}</option>`).join('')}
    </select>
  `).join('');
}

function renderProdutosCards(pane) {
  const box = epiVal('#epiCheckList', pane);
  if (!box) return;
  const filtro = (epiVal('#epiProdFiltro', pane)?.value || '').trim().toLowerCase();
  let list = _epiProdutosDisp.slice();
  if (filtro) {
    list = list.filter((p) =>
      String(p.codigo || '').toLowerCase().includes(filtro)
      || String(p.descricao || '').toLowerCase().includes(filtro)
      || String(p.epi_tipo || '').toLowerCase().includes(filtro)
    );
  }
  if (!list.length) {
    box.className = 'epi-prod-grid';
    box.innerHTML = '<div class="epi-empty">Nenhum produto vinculado aos EPIs ativos. Use Configuração → Configurar nos itens.</div>';
    return;
  }
  box.className = 'epi-prod-grid';
  box.innerHTML = list.map((p) => {
    const key = `${p.epi_catalogo_id}::${p.codigo}`;
    const cod = String(p.codigo || '');
    const codProd = String(p.codigo_produto || p.codigo || '');
    return `
      <div class="epi-prod-card" data-key="${epiEscape(key)}"
        data-catalogo-id="${p.epi_catalogo_id}"
        data-codigo="${epiEscape(cod)}"
        data-codigo-produto="${epiEscape(codProd)}"
        data-desc="${epiEscape(p.descricao || '')}"
        data-ca="${epiEscape(p.epi_ca || '')}"
        data-tipo="${epiEscape(p.epi_tipo || '')}"
        data-img="${epiEscape(p.url_imagem || '')}"
        data-unidade="UN">
        ${epiCardImg(p.url_imagem)}
        <div class="epi-prod-card-cod">${epiEscape(cod)}</div>
        <div class="epi-prod-card-desc">${epiEscape(p.descricao || '')}</div>
        <div class="epi-prod-card-tipo">${epiEscape(p.epi_tipo || 'EPI')}${p.epi_ca ? ` · CA ${epiEscape(p.epi_ca)}` : ''}</div>
        <div id="estoque-card-${epiEscape(cod)}" class="epi-prod-card-estoque" data-codigo="${epiEscape(cod)}"></div>
        <div class="epi-prod-card-footer">
          <div class="epi-prod-card-actions">
            <input type="number" class="epi-card-qtd" min="1" value="1" title="Quantidade" />
            <div class="epi-prod-card-vars">${renderVariacaoSelects(cod)}</div>
          </div>
          <div class="epi-prod-card-btns">
            <button type="button" class="epi-btn epi-btn-ghost epi-btn-info">
              <i class="fa-solid fa-circle-info" style="margin-right:4px"></i>Informações
            </button>
            <button type="button" class="epi-btn epi-btn-ghost epi-btn-editar">
              <i class="fa-solid fa-pen-to-square" style="margin-right:4px"></i>Editar produto
            </button>
            <button type="button" class="epi-btn epi-add-cart">
              <i class="fa-solid fa-cart-plus" style="margin-right:4px"></i>Adicionar
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  if (typeof window.carregarEstoqueCards === 'function') {
    setTimeout(() => window.carregarEstoqueCards({ force: true }), 80);
  }
}

async function loadVariacoesParaCards() {
  const codigos = [...new Set(_epiProdutosDisp.map((p) => String(p.codigo || '').trim()).filter(Boolean))];
  if (!codigos.length) {
    _epiVariacoesMap = {};
    return;
  }
  try {
    const map = await epiFetchJson(`/api/produtos/variacoes/por-codigos?codigos=${encodeURIComponent(codigos.join(','))}`);
    _epiVariacoesMap = map && typeof map === 'object' ? map : {};
  } catch (_) {
    _epiVariacoesMap = {};
  }
}

function renderCarrinho(pane) {
  const list = epiVal('#epiCartList', pane);
  const count = epiVal('#epiCartCount', pane);
  if (count) count.textContent = String(_epiCarrinho.length);
  if (!list) return;
  if (!_epiCarrinho.length) {
    list.innerHTML = '<div class="epi-empty" style="padding:12px">Carrinho vazio.</div>';
    return;
  }
  list.innerHTML = _epiCarrinho.map((it, idx) => `
    <div class="epi-cart-item" data-idx="${idx}">
      ${it.url_imagem
        ? `<img class="epi-cart-thumb" src="${epiEscape(it.url_imagem)}" alt="" />`
        : `<div class="epi-cart-thumb ph" style="display:flex;align-items:center;justify-content:center;color:#6b7280"><i class="fa-solid fa-box"></i></div>`}
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:#e8ecff;font-size:13px">${epiEscape(it.codigo)}</div>
        <div style="font-size:12px;color:#9ca3af">${epiEscape(it.descricao || it.epi_tipo || '')}</div>
        <div style="font-size:11px;color:#93c5fd">qtd ${it.quantidade}${it.tamanho ? ` · ${epiEscape(it.tamanho)}` : ''}${it.ca ? ` · CA ${epiEscape(it.ca)}` : ''}</div>
      </div>
      <button type="button" class="epi-btn epi-btn-danger epi-cart-del" data-idx="${idx}">Remover</button>
    </div>
  `).join('');
}

function addToCarrinho(item) {
  const key = item.key || `${item.epi_catalogo_id}::${item.codigo}`;
  const existing = _epiCarrinho.find((x) => x.key === key && String(x.tamanho || '') === String(item.tamanho || ''));
  if (existing) {
    existing.quantidade = (Number(existing.quantidade) || 1) + (Number(item.quantidade) || 1);
    return;
  }
  _epiCarrinho.push({ ...item, key });
}

function epiCfgProdutosMini(produtos) {
  const list = Array.isArray(produtos) ? produtos : [];
  if (!list.length) {
    return '<div class="epi-cfg-prods"><span class="epi-hint" style="margin:0">Nenhum produto vinculado.</span></div>';
  }
  return `<div class="epi-cfg-prods">${list.map((p) => `
    <div class="epi-cfg-prod-chip" title="${epiEscape(p.descricao || p.codigo || '')}">
      ${p.url_imagem
        ? `<img src="${epiEscape(p.url_imagem)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'ph\\'><i class=\\'fa-solid fa-box\\'></i></div>'" />`
        : `<div class="ph"><i class="fa-solid fa-box"></i></div>`}
      <span>${epiEscape(p.codigo || '—')}</span>
    </div>
  `).join('')}</div>`;
}

function renderConfigBody(pane) {
  const body = epiVal('#epiConfigBody', pane);
  const title = epiVal('#epiConfigTitle', pane);
  if (!body) return;

  if (_epiConfigView === 'menu') {
    if (title) title.textContent = 'Configuração — EPI';
    body.innerHTML = `
      <p class="epi-hint">Escolha o que deseja configurar. Vamos acrescentando opções aqui aos poucos.</p>
      <div class="epi-cfg-menu">
        <button type="button" class="epi-cfg-item" data-epi-cfg="catalogo">
          <span><i class="fa-solid fa-list-check" style="margin-right:8px;color:#60a5fa"></i>EPIs sugeridos / catálogo</span>
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    `;
    return;
  }

  if (_epiConfigView === 'catalogo') {
    if (title) title.textContent = 'EPIs sugeridos / catálogo';
    if (!_epiCatalogoUnico.length) {
      body.innerHTML = `
        <button type="button" class="epi-btn epi-btn-ghost epi-cfg-back" id="epiCfgBack"><i class="fa-solid fa-arrow-left" style="margin-right:6px"></i>Voltar</button>
        <div class="epi-empty">Catálogo vazio.</div>
      `;
      return;
    }
    const ativos = _epiCatalogoUnico.filter((c) => c.ativo !== false);
    const inativos = _epiCatalogoUnico.filter((c) => c.ativo === false);
    const list = _epiConfigCatalogoTab === 'inativos' ? inativos : ativos;
    body.innerHTML = `
      <button type="button" class="epi-btn epi-btn-ghost epi-cfg-back" id="epiCfgBack"><i class="fa-solid fa-arrow-left" style="margin-right:6px"></i>Voltar</button>
      <p class="epi-hint">Use o checkbox para ativar/inativar. Ativos aparecem na solicitação. Em Configurar você altera o C.A. e vincula produtos.</p>
      <div class="epi-cfg-tabs">
        <button type="button" class="epi-cfg-tab ${_epiConfigCatalogoTab === 'ativos' ? 'is-active' : ''}" data-epi-cfg-tab="ativos">
          Ativos <span class="lp-tab-count">${ativos.length}</span>
        </button>
        <button type="button" class="epi-cfg-tab ${_epiConfigCatalogoTab === 'inativos' ? 'is-active' : ''}" data-epi-cfg-tab="inativos">
          Inativos <span class="lp-tab-count">${inativos.length}</span>
        </button>
      </div>
      <div class="epi-check-list" style="max-height:none">
        <div class="epi-cargo-group">
          ${list.length ? list.map((c) => `
            <div class="epi-cfg-toggle-row ${c.ativo !== false ? '' : 'is-off'}" data-epi-catalogo-id="${c.epi_catalogo_id}">
              <div class="epi-cfg-row-top">
                <label class="epi-chk-label">
                  <input type="checkbox" class="epi-cfg-ativo" data-id="${c.epi_catalogo_id}" ${c.ativo !== false ? 'checked' : ''} />
                  <span>${epiEscape(c.descricao)}</span>
                </label>
                <span class="epi-ca">CA: ${epiEscape(c.ca || '—')}</span>
                <span class="epi-cfg-prod-count">${Number(c.qtd_produtos || (c.produtos || []).length || 0)} prod.</span>
                <button type="button" class="epi-btn epi-btn-ghost epi-cfg-produtos"
                  data-catalogo-id="${c.epi_catalogo_id}"
                  data-desc="${epiEscape(c.descricao)}"
                  data-ca="${epiEscape(c.ca || '')}"
                  title="Vincular produtos e C.A.">Configurar</button>
              </div>
              ${epiCfgProdutosMini(c.produtos)}
            </div>
          `).join('') : `<div class="epi-empty" style="padding:16px">Nenhum item nesta guia.</div>`}
        </div>
      </div>
    `;
  }
}

function statusBadge(st) {
  const s = String(st || 'aberta');
  return `<span class="epi-badge epi-badge-${epiEscape(s)}">${epiEscape(s)}</span>`;
}

function renderSolicitacoes(pane) {
  const tbody = epiVal('#epiSolTbody', pane);
  const count = epiVal('#epiSolCount', pane);
  if (count) count.textContent = String(_epiSolicitacoes.length);
  if (!tbody) return;
  if (!_epiSolicitacoes.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="epi-empty">Nenhuma solicitação.</td></tr>';
    return;
  }
  tbody.innerHTML = _epiSolicitacoes.map((s) => {
    const cargo = s.cargo_funcao || s.cargo_cadastro || '—';
    const assinatura = s.assinatura_url
      ? `<a href="${epiEscape(s.assinatura_url)}" target="_blank" rel="noopener noreferrer" title="Ver assinatura">
           <img class="epi-sign-thumb" src="${epiEscape(s.assinatura_url)}" alt="Assinatura" />
         </a>
         <div style="font-size:11px;color:#9ca3af;margin-top:2px">${epiFmtDateBR(s.assinado_em)}</div>`
      : `<span class="epi-badge epi-badge-pend-assin">Pendente</span>`;
    return `
    <tr data-sol-id="${s.id}">
      <td>${s.id}</td>
      <td>${epiFmtDateBR(s.created_at)}</td>
      <td>${epiEscape(s.colaborador || s.username || '')}</td>
      <td>${epiEscape(cargo)}</td>
      <td>${s.qtd_itens || 0}</td>
      <td>${statusBadge(s.status)}</td>
      <td>${assinatura}</td>
      <td style="white-space:nowrap">
        <button type="button" class="epi-btn epi-btn-ghost epi-sol-ver" data-id="${s.id}">Ver</button>
        ${s.status === 'aberta' && epiPodeGerenciar() ? `
          <button type="button" class="epi-btn epi-btn-ghost epi-sol-atender" data-id="${s.id}">Atender</button>
          <button type="button" class="epi-btn epi-btn-danger epi-sol-cancelar" data-id="${s.id}">Cancelar</button>
        ` : ''}
      </td>
    </tr>`;
  }).join('');
}

function renderEntregas(pane) {
  const tbody = epiVal('#epiEntTbody', pane);
  const count = epiVal('#epiEntCount', pane);
  if (count) count.textContent = String(_epiEntregas.length);
  if (!tbody) return;
  if (!_epiEntregas.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="epi-empty">Nenhuma entrega registrada.</td></tr>';
    return;
  }
  tbody.innerHTML = _epiEntregas.map((e) => `
    <tr data-ent-id="${e.id}">
      <td>${epiEscape(e.codigo_item || e.id)}</td>
      <td>${epiEscape(e.colaborador || e.username || '')}</td>
      <td>${epiEscape(e.funcao || '—')}</td>
      <td>${epiEscape(e.item || '')}</td>
      <td>${epiEscape(e.ca || '—')}</td>
      <td>${e.quantidade != null ? e.quantidade : 1}</td>
      <td>${epiEscape(e.tamanho || '—')}</td>
      <td>${epiFmtDateBR(e.data_entrega)}</td>
      <td>${epiFmtDateBR(e.data_devolucao)}</td>
      <td>
        <button type="button" class="epi-btn epi-btn-ghost epi-ent-devolver" data-id="${e.id}" title="Registrar devolução" ${e.data_devolucao ? 'disabled' : ''}>Devolver</button>
        <button type="button" class="epi-btn epi-btn-danger epi-ent-del" data-id="${e.id}">Excluir</button>
      </td>
    </tr>
  `).join('');
}

function openConfigModal(pane) {
  _epiConfigView = 'menu';
  renderConfigBody(pane);
  const modal = epiVal('#epiConfigModal', pane);
  if (modal) {
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeConfigModal(pane) {
  const modal = epiVal('#epiConfigModal', pane);
  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
}

function epiProdThumb(url) {
  if (url) {
    return `<img class="epi-prod-thumb" src="${epiEscape(url)}" alt="" loading="lazy" onerror="this.style.display='none'" />`;
  }
  return `<div class="epi-prod-thumb ph"><i class="fa-solid fa-box"></i></div>`;
}

function renderEpiProdLinked(pane, produtos) {
  const box = epiVal('#epiProdLinked', pane);
  if (!box) return;
  if (!produtos.length) {
    box.innerHTML = '<div class="epi-empty" style="padding:12px">Nenhum produto vinculado ainda.</div>';
    return;
  }
  box.innerHTML = produtos.map((p) => `
    <div class="epi-prod-row linked" data-vinculo-id="${p.id}">
      ${epiProdThumb(p.url_imagem)}
      <div class="epi-prod-meta">
        <div class="epi-prod-cod">${epiEscape(p.codigo)}</div>
        <div class="epi-prod-desc">${epiEscape(p.descricao || '')}</div>
      </div>
      <button type="button" class="epi-btn epi-btn-danger epi-prod-del" data-vinculo-id="${p.id}">Remover</button>
    </div>
  `).join('');
}

function renderEpiProdResults(pane, produtos, { append = false, hasMore = false } = {}) {
  const box = epiVal('#epiProdResults', pane);
  if (!box) return;
  box.querySelector('.epi-prod-more')?.remove();
  if (!append && !produtos.length) {
    box.innerHTML = '<div class="epi-empty" style="padding:12px">Nenhum produto encontrado.</div>';
    return;
  }
  const html = produtos.map((p) => `
    <button type="button" class="epi-prod-row epi-prod-pick"
      data-codigo="${epiEscape(p.codigo)}"
      data-codigo-produto="${epiEscape(p.codigo_produto || '')}"
      data-desc="${epiEscape(p.descricao || '')}"
      data-img="${epiEscape(p.url_imagem || '')}">
      ${epiProdThumb(p.url_imagem)}
      <div class="epi-prod-meta">
        <div class="epi-prod-cod">${epiEscape(p.codigo)}</div>
        <div class="epi-prod-desc">${epiEscape(p.descricao || '')}</div>
      </div>
      <i class="fa-solid fa-plus" style="color:#93c5fd"></i>
    </button>
  `).join('');
  if (append) box.insertAdjacentHTML('beforeend', html);
  else box.innerHTML = html;
  if (hasMore) {
    box.insertAdjacentHTML('beforeend', '<div class="epi-prod-more epi-empty" style="padding:8px;font-size:11px">Role para carregar mais…</div>');
  }
}

function resetEpiProdBusca() {
  _epiProdBuscaQ = '';
  _epiProdBuscaOffset = 0;
  _epiProdBuscaHasMore = false;
  _epiProdBuscaLoading = false;
}

async function buscarEpiProdutos(pane, { q, offset = 0, append = false, seq = null } = {}) {
  const box = epiVal('#epiProdResults', pane);
  if (!box) return;
  const termo = String(q || '').trim();
  if (termo.length < 4) return;
  if (_epiProdBuscaLoading) return;
  _epiProdBuscaLoading = true;
  try {
    if (!append) {
      box.innerHTML = '<div class="epi-empty" style="padding:12px">Buscando…</div>';
    } else {
      const tip = box.querySelector('.epi-prod-more');
      if (tip) tip.textContent = 'Carregando mais…';
    }
    const data = await epiFetchJson(
      `/api/rh/epi/produtos/buscar?q=${encodeURIComponent(termo)}&limit=10&offset=${Number(offset) || 0}`
    );
    if (seq != null && seq !== _epiProdBuscaSeq) return;
    const lista = Array.isArray(data.produtos) ? data.produtos : [];
    _epiProdBuscaQ = termo;
    _epiProdBuscaOffset = (Number(offset) || 0) + lista.length;
    _epiProdBuscaHasMore = !!data.hasMore;
    renderEpiProdResults(pane, lista, { append, hasMore: _epiProdBuscaHasMore });
  } catch (err) {
    if (seq != null && seq !== _epiProdBuscaSeq) return;
    if (!append) {
      box.innerHTML = `<div class="epi-empty" style="padding:12px">${epiEscape(err.message || 'Erro na busca')}</div>`;
    } else {
      const tip = box.querySelector('.epi-prod-more');
      if (tip) tip.textContent = 'Falha ao carregar mais. Role novamente.';
      _epiProdBuscaHasMore = true;
    }
  } finally {
    _epiProdBuscaLoading = false;
  }
}

async function carregarMaisEpiProdutos(pane) {
  if (_epiProdBuscaLoading || !_epiProdBuscaHasMore || !_epiProdBuscaQ) return;
  await buscarEpiProdutos(pane, {
    q: _epiProdBuscaQ,
    offset: _epiProdBuscaOffset,
    append: true,
    seq: _epiProdBuscaSeq,
  });
}

async function loadEpiProdutosVinculados(pane) {
  if (!_epiProdCatalogoId) return;
  const data = await epiFetchJson(`/api/rh/epi/catalogo/${_epiProdCatalogoId}/produtos`);
  renderEpiProdLinked(pane, Array.isArray(data.produtos) ? data.produtos : []);
  return data;
}

async function openEpiProdModal(pane, { catalogoId, descricao, ca }) {
  _epiProdCatalogoId = Number(catalogoId);
  _epiProdCatalogoCa = ca || '';
  const title = epiVal('#epiProdTitle', pane);
  const hint = epiVal('#epiProdHint', pane);
  const caInput = epiVal('#epiProdCaInput', pane);
  if (title) title.textContent = `Configurar — ${descricao || 'EPI'}`;
  if (hint) {
    hint.textContent = `Tipo: ${descricao || '—'}. Atualize o C.A. e vincule produtos (pesquisa contém, após 4 letras; role a lista para ver mais 10).`;
  }
  if (caInput) caInput.value = ca || '';
  const search = epiVal('#epiProdSearch', pane);
  if (search) search.value = '';
  resetEpiProdBusca();
  renderEpiProdResults(pane, []);
  try {
    await loadEpiProdutosVinculados(pane);
  } catch (err) {
    alert('Erro ao carregar produtos: ' + (err.message || err));
  }
  const modal = epiVal('#epiProdModal', pane);
  if (modal) {
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }
  search?.focus();
}

function closeEpiProdModal(pane) {
  _epiProdCatalogoId = null;
  _epiProdCatalogoCa = '';
  const modal = epiVal('#epiProdModal', pane);
  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
}

function updateQtdProdutosBadge(pane, catalogoId, qtd) {
  epiValAll(`[data-epi-catalogo-id="${catalogoId}"] .epi-cfg-prod-count`, pane).forEach((el) => {
    el.textContent = `${qtd} prod.`;
  });
  for (const it of _epiCatalogoUnico) {
    if (Number(it.epi_catalogo_id) === Number(catalogoId)) it.qtd_produtos = qtd;
  }
}

function syncCatalogoProdutosCache(catalogoId, produtos) {
  const list = Array.isArray(produtos) ? produtos : [];
  for (const it of _epiCatalogoUnico) {
    if (Number(it.epi_catalogo_id) === Number(catalogoId)) {
      it.produtos = list.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        descricao: p.descricao,
        url_imagem: p.url_imagem,
      }));
      it.qtd_produtos = list.length;
    }
  }
}

async function loadUsuarios(pane) {
  _epiUsuarios = await epiFetchJson('/api/rh/colaboradores/usuarios');
  fillUserSelects(pane);
}

async function loadRelacao(pane) {
  const [unico, produtos] = await Promise.all([
    epiFetchJson('/api/rh/epi/catalogo-unico'),
    epiFetchJson('/api/rh/epi/produtos-disponiveis'),
  ]);
  _epiCatalogoUnico = Array.isArray(unico) ? unico : [];
  _epiProdutosDisp = Array.isArray(produtos) ? produtos : [];
  _epiCatalogo = _epiCatalogoUnico
    .filter((c) => c.ativo !== false)
    .map((c) => ({ id: c.epi_catalogo_id, descricao: c.descricao, ca: c.ca }));
  fillCatalogoSelect(pane);
  await loadVariacoesParaCards();
  renderProdutosCards(pane);
  renderCarrinho(pane);
}

async function loadSolicitacoes(pane) {
  const status = epiVal('#epiSolFiltroStatus', pane)?.value || '';
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  _epiSolicitacoes = await epiFetchJson(`/api/rh/epi/solicitacoes${qs}`);
  renderSolicitacoes(pane);
}

async function loadEntregas(pane) {
  const q = epiVal('#epiEntBusca', pane)?.value?.trim() || '';
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  _epiEntregas = await epiFetchJson(`/api/rh/epi/entregas${qs}`);
  renderEntregas(pane);
}

function cartItemsPayload() {
  return _epiCarrinho.map((it) => ({
    epi_catalogo_id: it.epi_catalogo_id || null,
    descricao: it.codigo
      ? `${it.codigo} — ${it.descricao || it.epi_tipo || 'EPI'}`
      : (it.descricao || it.epi_tipo || it.codigo || 'EPI'),
    ca: it.ca || '',
    quantidade: Math.max(1, Number(it.quantidade) || 1),
    tamanho: it.tamanho || '',
    codigo: it.codigo || null,
  }));
}

function bindEpiPane(pane) {
  epiValAll('[data-epi-tab]', pane).forEach((btn) => {
    btn.addEventListener('click', () => {
      epiValAll('[data-epi-tab]', pane).forEach((b) => b.classList.remove('lp-tab-active'));
      btn.classList.add('lp-tab-active');
      const tab = btn.dataset.epiTab;
      epiVal('#epiTabSolicitacao', pane)?.classList.toggle('is-active', tab === 'solicitacao');
      epiVal('#epiTabEntregas', pane)?.classList.toggle('is-active', tab === 'entregas');
      if (tab === 'entregas') loadEntregas(pane).catch(() => {});
    });
  });

  epiVal('#epiBtnConfig', pane)?.addEventListener('click', async () => {
    try {
      _epiCatalogoUnico = await epiFetchJson('/api/rh/epi/catalogo-unico');
    } catch (_) { /* usa cache */ }
    openConfigModal(pane);
  });

  epiVal('#epiConfigClose', pane)?.addEventListener('click', () => closeConfigModal(pane));
  epiVal('#epiConfigModal', pane)?.addEventListener('click', (ev) => {
    if (ev.target === epiVal('#epiConfigModal', pane)) closeConfigModal(pane);
  });

  epiVal('#epiConfigBody', pane)?.addEventListener('click', async (ev) => {
    const cfgTab = ev.target.closest('[data-epi-cfg-tab]');
    if (cfgTab) {
      _epiConfigCatalogoTab = cfgTab.dataset.epiCfgTab === 'inativos' ? 'inativos' : 'ativos';
      renderConfigBody(pane);
      return;
    }
    const cfgBtn = ev.target.closest('[data-epi-cfg]');
    if (cfgBtn) {
      _epiConfigView = cfgBtn.dataset.epiCfg;
      if (_epiConfigView === 'catalogo') _epiConfigCatalogoTab = 'ativos';
      renderConfigBody(pane);
      return;
    }
    if (ev.target.closest('#epiCfgBack')) {
      _epiConfigView = 'menu';
      renderConfigBody(pane);
      return;
    }
    const prodBtn = ev.target.closest('.epi-cfg-produtos');
    if (prodBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      openEpiProdModal(pane, {
        catalogoId: prodBtn.dataset.catalogoId,
        descricao: prodBtn.dataset.desc || '',
        ca: prodBtn.dataset.ca || '',
      }).catch((err) => alert(err.message || err));
    }
  });

  epiVal('#epiProdCaSalvar', pane)?.addEventListener('click', async () => {
    if (!_epiProdCatalogoId) return;
    const ca = epiVal('#epiProdCaInput', pane)?.value?.trim() || '';
    try {
      const updated = await epiFetchJson(`/api/rh/epi/catalogo/${_epiProdCatalogoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ca }),
      });
      _epiProdCatalogoCa = updated.ca || '';
      for (const it of _epiCatalogoUnico) {
        if (Number(it.epi_catalogo_id) === Number(_epiProdCatalogoId)) {
          it.ca = updated.ca || null;
        }
      }
      const hint = epiVal('#epiProdHint', pane);
      const item = _epiCatalogoUnico.find((c) => Number(c.epi_catalogo_id) === Number(_epiProdCatalogoId));
      if (hint) {
        hint.textContent = `Tipo: ${item?.descricao || '—'}. C.A. atualizado. Vincule produtos abaixo.`;
      }
      if (_epiConfigView === 'catalogo') renderConfigBody(pane);
      await loadRelacao(pane);
      alert('C.A. salvo.');
    } catch (err) {
      alert('Falha ao salvar C.A.: ' + (err.message || err));
    }
  });

  epiVal('#epiProdClose', pane)?.addEventListener('click', () => closeEpiProdModal(pane));
  epiVal('#epiProdModal', pane)?.addEventListener('click', (ev) => {
    if (ev.target === epiVal('#epiProdModal', pane)) closeEpiProdModal(pane);
  });

  epiVal('#epiProdSearch', pane)?.addEventListener('input', () => {
    clearTimeout(_epiProdBuscaTimer);
    const q = epiVal('#epiProdSearch', pane)?.value?.trim() || '';
    const box = epiVal('#epiProdResults', pane);
    resetEpiProdBusca();
    if (q.length < 4) {
      if (box) box.innerHTML = q.length
        ? '<div class="epi-empty" style="padding:12px">Digite pelo menos 4 letras…</div>'
        : '';
      return;
    }
    const seq = ++_epiProdBuscaSeq;
    _epiProdBuscaTimer = setTimeout(() => {
      buscarEpiProdutos(pane, { q, offset: 0, append: false, seq }).catch(() => {});
    }, 300);
  });

  epiVal('#epiProdResults', pane)?.addEventListener('scroll', () => {
    const box = epiVal('#epiProdResults', pane);
    if (!box || _epiProdBuscaLoading || !_epiProdBuscaHasMore) return;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 36) {
      carregarMaisEpiProdutos(pane).catch(() => {});
    }
  });

  epiVal('#epiProdResults', pane)?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.epi-prod-pick');
    if (!btn || !_epiProdCatalogoId) return;
    try {
      await epiFetchJson(`/api/rh/epi/catalogo/${_epiProdCatalogoId}/produtos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: btn.dataset.codigo,
          codigo_produto: btn.dataset.codigoProduto || null,
          descricao: btn.dataset.desc || null,
          url_imagem: btn.dataset.img || null,
        }),
      });
      const data = await loadEpiProdutosVinculados(pane);
      updateQtdProdutosBadge(pane, _epiProdCatalogoId, (data?.produtos || []).length);
      syncCatalogoProdutosCache(_epiProdCatalogoId, data?.produtos || []);
      if (_epiConfigView === 'catalogo') renderConfigBody(pane);
      await loadRelacao(pane);
      const search = epiVal('#epiProdSearch', pane);
      if (search) search.value = '';
      renderEpiProdResults(pane, []);
    } catch (err) {
      alert('Falha ao vincular: ' + (err.message || err));
    }
  });

  epiVal('#epiProdLinked', pane)?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.epi-prod-del');
    if (!btn || !_epiProdCatalogoId) return;
    const vinculoId = Number(btn.dataset.vinculoId);
    if (!vinculoId) return;
    if (!confirm('Remover este produto do EPI?')) return;
    try {
      await epiFetchJson(`/api/rh/epi/catalogo/${_epiProdCatalogoId}/produtos/${vinculoId}`, {
        method: 'DELETE',
      });
      const data = await loadEpiProdutosVinculados(pane);
      updateQtdProdutosBadge(pane, _epiProdCatalogoId, (data?.produtos || []).length);
      syncCatalogoProdutosCache(_epiProdCatalogoId, data?.produtos || []);
      if (_epiConfigView === 'catalogo') renderConfigBody(pane);
      await loadRelacao(pane);
    } catch (err) {
      alert('Falha ao remover: ' + (err.message || err));
    }
  });

  epiVal('#epiConfigBody', pane)?.addEventListener('change', async (ev) => {
    const chk = ev.target.closest('.epi-cfg-ativo');
    if (!chk) return;
    const id = Number(chk.dataset.id);
    const ativo = !!chk.checked;
    try {
      await epiFetchJson(`/api/rh/epi/catalogo/${id}/ativo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo }),
      });
      for (const it of _epiCatalogoUnico) {
        if (Number(it.epi_catalogo_id) === id) it.ativo = ativo;
      }
      // Mantém a guia atual; o item some da lista atual e aparece na outra
      renderConfigBody(pane);
      await loadRelacao(pane);
    } catch (err) {
      chk.checked = !ativo;
      alert('Falha ao salvar: ' + (err.message || err));
    }
  });

  epiVal('#epiCheckList', pane)?.addEventListener('click', (ev) => {
    const btnInfo = ev.target.closest('.epi-btn-info');
    if (btnInfo) {
      const card = btnInfo.closest('.epi-prod-card');
      if (!card) return;
      const codigo = card.dataset.codigo || '';
      if (typeof window.abrirModalEditarProduto === 'function') {
        window.abrirModalEditarProduto(codigo);
      } else {
        alert('Tela de informações não disponível. Atualize a página (F5).');
      }
      return;
    }

    const btnEditar = ev.target.closest('.epi-btn-editar');
    if (btnEditar) {
      const card = btnEditar.closest('.epi-prod-card');
      if (!card) return;
      const codigo = card.dataset.codigo || '';
      const codigoProduto = card.dataset.codigoProduto || codigo;
      const desc = card.dataset.desc || '';
      const unidade = card.dataset.unidade || 'UN';
      if (typeof window.abrirEdicaoRapidaProduto === 'function') {
        window.abrirEdicaoRapidaProduto(codigo, codigoProduto, desc, unidade);
      } else {
        alert('Edição rápida não disponível. Atualize a página (F5).');
      }
      return;
    }

    const btn = ev.target.closest('.epi-add-cart');
    if (!btn) return;
    const card = btn.closest('.epi-prod-card');
    if (!card) return;
    const qtd = Number(card.querySelector('.epi-card-qtd')?.value) || 1;
    const selects = Array.from(card.querySelectorAll('.epi-card-var'));
    const partes = [];
    for (const sel of selects) {
      const val = String(sel.value || '').trim();
      const tipoNome = sel.dataset.tipoNome || 'Variação';
      if (!val) {
        alert(`Selecione: ${tipoNome}`);
        sel.focus();
        return;
      }
      partes.push(`${tipoNome}: ${val}`);
    }
    const tamanho = partes.join(' · ');
    addToCarrinho({
      key: card.dataset.key,
      epi_catalogo_id: Number(card.dataset.catalogoId) || null,
      codigo: card.dataset.codigo || '',
      descricao: card.dataset.desc || '',
      ca: card.dataset.ca || '',
      epi_tipo: card.dataset.tipo || '',
      url_imagem: card.dataset.img || '',
      quantidade: qtd,
      tamanho,
    });
    renderCarrinho(pane);
  });

  epiVal('#epiProdFiltro', pane)?.addEventListener('input', () => {
    renderProdutosCards(pane);
  });

  epiVal('#epiCartList', pane)?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.epi-cart-del');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (!Number.isInteger(idx)) return;
    _epiCarrinho.splice(idx, 1);
    renderCarrinho(pane);
  });

  epiVal('#epiBtnLimparCart', pane)?.addEventListener('click', () => {
    _epiCarrinho = [];
    renderCarrinho(pane);
  });

  epiVal('#epiBtnCriarSol', pane)?.addEventListener('click', async () => {
    const userSel = epiVal('#epiSolUser', pane);
    const userId = Number(userSel?.value);
    if (!userId) {
      alert('Selecione o colaborador.');
      return;
    }
    const itens = cartItemsPayload();
    if (!itens.length) {
      alert('Adicione ao menos um produto ao carrinho.');
      return;
    }
    const cargo = userSel.selectedOptions?.[0]?.dataset?.cargo || null;
    try {
      await epiFetchJson('/api/rh/epi/solicitacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          cargo_funcao: cargo,
          observacao: epiVal('#epiSolObs', pane)?.value?.trim() || null,
          itens,
        }),
      });
      alert('Solicitação criada.');
      epiVal('#epiSolObs', pane).value = '';
      _epiCarrinho = [];
      renderCarrinho(pane);
      await loadSolicitacoes(pane);
    } catch (err) {
      alert('Falha ao criar solicitação: ' + (err.message || err));
    }
  });

  epiVal('#epiBtnRefreshSol', pane)?.addEventListener('click', () => loadSolicitacoes(pane).catch((e) => alert(e.message)));
  epiVal('#epiSolFiltroStatus', pane)?.addEventListener('change', () => loadSolicitacoes(pane).catch(() => {}));

  epiVal('#epiSolTbody', pane)?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (!id) return;
    try {
      if (btn.classList.contains('epi-sol-ver')) {
        const det = await epiFetchJson(`/api/rh/epi/solicitacoes/${id}`);
        const linhas = (det.itens || []).map((i) =>
          `• ${i.descricao} (CA ${i.ca || '—'}) qtd ${i.quantidade}${i.tamanho ? ` tam ${i.tamanho}` : ''}`
        ).join('\n');
        alert(`Solicitação #${det.id}\n${det.colaborador}\nStatus: ${det.status}\n\n${linhas}`);
      } else if (btn.classList.contains('epi-sol-atender')) {
        const det = await epiFetchJson(`/api/rh/epi/solicitacoes/${id}`);
        epiValAll('[data-epi-tab]', pane).forEach((b) => b.classList.toggle('lp-tab-active', b.dataset.epiTab === 'entregas'));
        epiVal('#epiTabSolicitacao', pane)?.classList.remove('is-active');
        epiVal('#epiTabEntregas', pane)?.classList.add('is-active');
        const entUser = epiVal('#epiEntUser', pane);
        if (entUser) entUser.value = String(det.user_id);
        if (det.itens?.length === 1) {
          const it = det.itens[0];
          const sel = epiVal('#epiEntItem', pane);
          if (sel && it.epi_catalogo_id) {
            sel.value = String(it.epi_catalogo_id);
            epiVal('#epiEntCa', pane).value = it.ca || '';
            epiVal('#epiEntQtd', pane).value = String(it.quantidade || 1);
            epiVal('#epiEntTam', pane).value = it.tamanho || '';
          }
        }
        const regBtn = epiVal('#epiBtnRegistrarEnt', pane);
        if (regBtn) regBtn.dataset.solicitacaoId = String(id);
        await loadEntregas(pane);
      } else if (btn.classList.contains('epi-sol-cancelar')) {
        if (!confirm('Cancelar esta solicitação?')) return;
        await epiFetchJson(`/api/rh/epi/solicitacoes/${id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cancelada' }),
        });
        await loadSolicitacoes(pane);
      }
    } catch (err) {
      alert(err.message || err);
    }
  });

  epiVal('#epiEntItem', pane)?.addEventListener('change', (ev) => {
    const opt = ev.target.selectedOptions?.[0];
    if (!opt) return;
    epiVal('#epiEntCa', pane).value = opt.dataset.ca || '';
  });

  const dataEnt = epiVal('#epiEntData', pane);
  if (dataEnt) dataEnt.value = epiTodayISO();

  epiVal('#epiBtnRegistrarEnt', pane)?.addEventListener('click', async (ev) => {
    const userId = Number(epiVal('#epiEntUser', pane)?.value);
    if (!userId) {
      alert('Selecione o colaborador.');
      return;
    }
    const itemSel = epiVal('#epiEntItem', pane);
    const opt = itemSel?.selectedOptions?.[0];
    const item = opt?.dataset?.desc || '';
    if (!item || !itemSel.value) {
      alert('Selecione o EPI no catálogo.');
      return;
    }
    const solicitacao_id = Number(ev.currentTarget.dataset.solicitacaoId) || null;
    try {
      await epiFetchJson('/api/rh/epi/entregas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          item,
          epi_catalogo_id: Number(itemSel.value) || null,
          ca: epiVal('#epiEntCa', pane)?.value?.trim() || null,
          quantidade: Number(epiVal('#epiEntQtd', pane)?.value) || 1,
          tamanho: epiVal('#epiEntTam', pane)?.value?.trim() || null,
          codigo_item: epiVal('#epiEntCod', pane)?.value?.trim() || null,
          data_entrega: epiVal('#epiEntData', pane)?.value || null,
          data_devolucao: epiVal('#epiEntDev', pane)?.value || null,
          observacao: epiVal('#epiEntObs', pane)?.value?.trim() || null,
          solicitacao_id,
        }),
      });
      alert('Entrega registrada.');
      delete ev.currentTarget.dataset.solicitacaoId;
      epiVal('#epiEntObs', pane).value = '';
      epiVal('#epiEntTam', pane).value = '';
      epiVal('#epiEntCod', pane).value = '';
      epiVal('#epiEntQtd', pane).value = '1';
      epiVal('#epiEntDev', pane).value = '';
      await loadEntregas(pane);
      await loadSolicitacoes(pane);
    } catch (err) {
      alert('Falha ao registrar: ' + (err.message || err));
    }
  });

  epiVal('#epiBtnRefreshEnt', pane)?.addEventListener('click', () => loadEntregas(pane).catch((e) => alert(e.message)));
  let _buscaTimer = null;
  epiVal('#epiEntBusca', pane)?.addEventListener('input', () => {
    clearTimeout(_buscaTimer);
    _buscaTimer = setTimeout(() => loadEntregas(pane).catch(() => {}), 350);
  });

  epiVal('#epiEntTbody', pane)?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (!id) return;
    try {
      if (btn.classList.contains('epi-ent-devolver')) {
        await epiFetchJson(`/api/rh/epi/entregas/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data_devolucao: epiTodayISO() }),
        });
        await loadEntregas(pane);
      } else if (btn.classList.contains('epi-ent-del')) {
        if (!confirm('Excluir este registro de entrega?')) return;
        await epiFetchJson(`/api/rh/epi/entregas/${id}`, { method: 'DELETE' });
        await loadEntregas(pane);
      }
    } catch (err) {
      alert(err.message || err);
    }
  });
}

async function carregarPainelEpi() {
  const pane = _epiPane;
  if (!pane) return;
  try {
    await Promise.all([
      loadUsuarios(pane),
      loadRelacao(pane),
      loadSolicitacoes(pane),
      loadEntregas(pane),
    ]);
  } catch (err) {
    console.error('[rh_epi] carregarPainelEpi', err);
    alert('Erro ao carregar EPI: ' + (err.message || err));
  }
}

async function doOpenEpi() {
  const root = findTabsRoot();
  const pane = ensureEpiPane(root);
  applyEpiPermissions(pane);

  if (typeof window.showMainTab === 'function') {
    window.showMainTab('rhEpi');
    pane.style.display = 'flex';
  } else {
    document.querySelectorAll('.tab-pane').forEach((el) => { el.style.display = 'none'; });
    pane.style.display = 'flex';
  }

  await carregarPainelEpi();
}

export function initRhEpiUI() {
  if (_epiInited) return;
  _epiInited = true;

  const btn = document.querySelector('#btn-rh-epi');
  if (!btn) return;

  if (!btn.dataset.bindEpi) {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      doOpenEpi();
    });
    btn.dataset.bindEpi = '1';
  }

  window.openRhEpi = doOpenEpi;
}

export const openRhEpi = doOpenEpi;
