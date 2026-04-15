let _cfInited = false;

function cfVal(sel, root = document) {
  return root.querySelector(sel);
}

function cfNormalizeId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function cfFetchJson(url, init = {}) {
  const res = await fetch(url, { credentials: 'include', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function cfEscapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cfFmtDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function cfFmtDateBR(str) {
  if (!str) return '—';
  const s = typeof str === 'string' ? str.slice(0, 10) : str;
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d.getTime())) return s;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function cfCalcCiclo(dataAdmissao, totalDias) {
  if (!dataAdmissao) return { proxFerias: null, dataLimite: null, saldoDias: 30 };
  const admStr = typeof dataAdmissao === 'string' ? dataAdmissao.slice(0, 10) : dataAdmissao;
  const admissao = new Date(admStr + 'T00:00:00');
  if (isNaN(admissao.getTime())) return { proxFerias: null, dataLimite: null, saldoDias: 30 };

  const ciclosCompletos = Math.floor(totalDias / 30);
  const diasUsados = totalDias % 30;
  const saldo = 30 - diasUsados;
  const cicloAtual = ciclosCompletos + 1;

  const proxFerias = new Date(admissao);
  proxFerias.setFullYear(proxFerias.getFullYear() + cicloAtual);

  const dataLimite = new Date(proxFerias);
  dataLimite.setFullYear(dataLimite.getFullYear() + 1);
  dataLimite.setDate(dataLimite.getDate() - 1);

  return { proxFerias, dataLimite, saldoDias: saldo };
}

function cfStatusBadge(dataAdmissao, totalDias) {
  const ciclo = cfCalcCiclo(dataAdmissao, totalDias);
  if (!ciclo.proxFerias) return '<span class="cf-badge cf-badge-gray">Sem admissão</span>';

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  if (ciclo.saldoDias <= 0) {
    return '<span class="cf-badge cf-badge-green">Em dia</span>';
  }
  if (hoje > ciclo.dataLimite) {
    return '<span class="cf-badge cf-badge-red">Vencidas</span>';
  }
  if (hoje > ciclo.proxFerias) {
    return '<span class="cf-badge cf-badge-yellow">Férias pendentes</span>';
  }
  return '<span class="cf-badge cf-badge-green">Em dia</span>';
}

/* ===== Painel principal ===== */

function findTabsRoot() {
  return document.querySelector('.main-container')
    || document.querySelector('.tab-content')
    || document.body;
}

let _cfPane = null;

function ensureCfPane(root) {
  if (_cfPane) return _cfPane;

  const pane = document.createElement('div');
  pane.id = 'rhControleFerias';
  pane.className = 'tab-pane';
  pane.style.display = 'none';
  pane.style.flex = '1';
  pane.style.minHeight = '0';
  pane.style.overflow = 'hidden';
  pane.innerHTML = `
    <style>
    /* ====== Controle de Férias ====== */
    #rhControleFerias{padding:18px 24px;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
    #rhControleFerias .cf-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;flex-shrink:0}
    #rhControleFerias .cf-title{font-size:18px;font-weight:700;color:#e8ecff}
    #rhControleFerias .cf-search{padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(17,20,28,.65);color:#e8ecff;width:300px;max-width:100%}
    #rhControleFerias .cf-table-wrap{overflow:auto;flex:1;min-height:0;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(17,20,28,.45)}
    #rhControleFerias .cf-filter-btn{display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(17,20,28,.65);color:#a8b3d4;cursor:pointer;font-size:13px;white-space:nowrap;transition:border-color .2s,background .2s}
    #rhControleFerias .cf-filter-btn:hover{background:rgba(58,109,240,.18);border-color:rgba(95,142,255,.45);color:#e8ecff}
    #rhControleFerias .cf-filter-btn.active{background:rgba(58,109,240,.22);border-color:rgba(95,142,255,.55);color:#a8c4ff}
    #rhControleFerias .cf-filter-dropdown{position:absolute;top:calc(100% + 6px);right:0;z-index:200;background:#1a1d27;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px 14px;min-width:210px;box-shadow:0 8px 32px rgba(0,0,0,.45)}
    #rhControleFerias .cf-filter-dropdown label{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;color:#e1e6f8;cursor:pointer;user-select:none}
    #rhControleFerias .cf-filter-dropdown input[type=checkbox]{accent-color:#5f8eff;width:15px;height:15px;cursor:pointer}
    .light-mode #rhControleFerias .cf-filter-btn{background:#f9fafb;border-color:#d1d5db;color:#374151}
    .light-mode #rhControleFerias .cf-filter-btn:hover{background:#dbeafe;border-color:#93c5fd;color:#1e40af}
    .light-mode #rhControleFerias .cf-filter-btn.active{background:#dbeafe;border-color:#93c5fd;color:#1e40af}
    .light-mode #rhControleFerias .cf-filter-dropdown{background:#fff;border-color:#e5e7eb;box-shadow:0 8px 24px rgba(0,0,0,.12)}
    .light-mode #rhControleFerias .cf-filter-dropdown label{color:#1f2937}
    #rhControleFerias table{width:100%;border-collapse:collapse;font-size:13px}
    #rhControleFerias th{text-align:left;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.12);font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#a8b3d4;background:rgba(17,20,28,.95);white-space:nowrap;position:sticky;top:0;z-index:1}
    #rhControleFerias td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06);color:#e1e6f8;white-space:nowrap}
    #rhControleFerias tr:hover td{background:rgba(255,255,255,.04)}
    #rhControleFerias .cf-btn{padding:5px 12px;border-radius:8px;border:1px solid rgba(95,142,255,.35);background:rgba(58,109,240,.14);color:#a8c4ff;cursor:pointer;font-size:12px;white-space:nowrap}
    #rhControleFerias .cf-btn:hover{background:rgba(58,109,240,.28)}
    .cf-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
    .cf-badge-green{background:rgba(34,197,94,.18);color:#4ade80;border:1px solid rgba(34,197,94,.3)}
    .cf-badge-yellow{background:rgba(234,179,8,.18);color:#fbbf24;border:1px solid rgba(234,179,8,.3)}
    .cf-badge-red{background:rgba(239,68,68,.18);color:#f87171;border:1px solid rgba(239,68,68,.3)}
    .cf-badge-gray{background:rgba(156,163,175,.18);color:#9ca3af;border:1px solid rgba(156,163,175,.3)}

    /* --- Modal detalhes --- */
    .cf-modal-backdrop{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
    .cf-modal{background:#1a1d27;border:1px solid rgba(255,255,255,.1);border-radius:14px;width:95%;max-width:720px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden}
    .cf-modal header{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
    .cf-modal header h3{margin:0;font-size:16px;color:#e8ecff}
    .cf-modal .cf-modal-close{background:none;border:none;color:#9ca3af;font-size:22px;cursor:pointer;padding:0 4px}
    .cf-modal .cf-modal-body{padding:18px;overflow-y:auto;flex:1}
    .cf-modal footer{padding:12px 16px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:flex-end;gap:8px}
    .cf-modal label{display:block;font-size:12px;color:#a8b3d4;margin-bottom:4px;margin-top:12px}
    .cf-modal input,.cf-modal select{width:100%;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(17,20,28,.65);color:#e8ecff}
    .cf-modal input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(1) brightness(1.5)}
    .cf-modal .cf-hist-empty{opacity:.7;padding:12px 4px;text-align:center;font-size:13px}
    .cf-modal .cf-hist-table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
    .cf-modal .cf-hist-table th{text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.12);font-size:11px;text-transform:uppercase;color:#a8b3d4;background:rgba(255,255,255,.03)}
    .cf-modal .cf-hist-table td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);color:#e1e6f8}
    .cf-modal .cf-btn-del{border:1px solid rgba(255,115,115,.35);background:rgba(255,95,95,.14);color:#ffc9c9;border-radius:8px;padding:3px 8px;cursor:pointer;font-size:12px}
    .cf-modal .cf-anexos-list{max-height:180px;overflow-y:auto;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:6px 8px;margin-top:4px;background:rgba(17,20,28,.3)}
    .cf-modal .cf-anexo-item{display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)}
    .cf-modal .cf-anexo-item:last-child{border-bottom:none}
    .cf-modal .cf-anexo-link{color:#93b5ff;text-decoration:none;font-size:12px}
    .cf-modal .cf-anexo-link:hover{text-decoration:underline}

    /* ====== Light-mode overrides ====== */
    .light-mode #rhControleFerias .cf-title{color:#1f2937}
    .light-mode #rhControleFerias .cf-search{background:#f9fafb;border-color:#d1d5db;color:#1f2937}
    .light-mode #rhControleFerias .cf-table-wrap{background:#fff;border-color:#e5e7eb}
    .light-mode #rhControleFerias th{color:#374151;border-color:#e5e7eb;background:#f9fafb}
    .light-mode #rhControleFerias td{color:#1f2937;border-color:#f3f4f6}
    .light-mode #rhControleFerias tr:hover td{background:#f3f4f6}
    .light-mode #rhControleFerias .cf-btn{border-color:#93c5fd;background:#dbeafe;color:#1e40af}
    .light-mode .cf-modal{background:#fff;border-color:#e5e7eb}
    .light-mode .cf-modal header{border-color:#e5e7eb}
    .light-mode .cf-modal header h3{color:#1f2937}
    .light-mode .cf-modal .cf-modal-close{color:#6b7280}
    .light-mode .cf-modal footer{border-color:#e5e7eb}
    .light-mode .cf-modal label{color:#374151}
    .light-mode .cf-modal input,.light-mode .cf-modal select{background:#f9fafb;border-color:#d1d5db;color:#1f2937}
    .light-mode .cf-modal input[type="date"]::-webkit-calendar-picker-indicator{filter:none}
    .light-mode .cf-modal .cf-hist-table th{color:#374151;border-color:#e5e7eb;background:#f9fafb}
    .light-mode .cf-modal .cf-hist-table td{color:#1f2937;border-color:#f3f4f6}
    .light-mode .cf-modal .cf-btn-del{border-color:#fca5a5;background:#fef2f2;color:#b91c1c}
    .light-mode .cf-modal .cf-anexos-list{background:#f3f4f6;border-color:#e5e7eb}
    .light-mode .cf-modal .cf-anexo-link{color:#1e40af}

    @media (max-width: 768px){
      #rhControleFerias{padding:10px 12px}
      #rhControleFerias .cf-search{width:100%}
    }
    </style>

    <div class="cf-header">
      <div class="cf-title">Controle de Férias</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="cfSearch" class="cf-search" type="text" placeholder="Buscar colaborador...">
        <div style="position:relative">
          <button id="cfFilterBtn" type="button" class="cf-filter-btn active" title="Filtrar por tipo de contrato">
            <i class="fa-solid fa-filter" style="font-size:12px"></i>
            <span id="cfFilterLabel">CLT + Sem tipo</span>
          </button>
          <div id="cfFilterDropdown" class="cf-filter-dropdown" style="display:none">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:8px">Tipo de contrato</div>
            <label><input type="checkbox" class="cf-fc" value="CLT" checked> CLT</label>
            <label><input type="checkbox" class="cf-fc" value="PJ"> PJ</label>
            <label><input type="checkbox" class="cf-fc" value="Temporario"> Temporário</label>
            <label><input type="checkbox" class="cf-fc" value="Terceiro"> Terceiro</label>
            <label><input type="checkbox" id="cfFcVazio" checked> Sem tipo definido</label>
          </div>
        </div>
        <button id="cfReload" type="button" class="content-button status-button">Recarregar</button>
      </div>
    </div>

    <div class="cf-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Nome</th>
            <th>Admissão</th>
            <th>Próx. férias</th>
            <th>Limite</th>
            <th>Saldo</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="cfTableBody"></tbody>
      </table>
    </div>
  `;

  root.appendChild(pane);
  _cfPane = pane;

  // --- Event listeners ---
  cfVal('#cfReload', pane).addEventListener('click', () => carregarPainelFerias());
  cfVal('#cfSearch', pane).addEventListener('input', () => filtrarTabela());

  // --- Filtro tipo_contrato ---
  const filterBtn = cfVal('#cfFilterBtn', pane);
  const filterDropdown = cfVal('#cfFilterDropdown', pane);

  filterBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = filterDropdown.style.display !== 'none';
    filterDropdown.style.display = open ? 'none' : 'block';
  });

  document.addEventListener('click', (ev) => {
    if (!pane.contains(ev.target)) return;
    if (!filterDropdown.contains(ev.target) && ev.target !== filterBtn) {
      filterDropdown.style.display = 'none';
    }
  });

  pane.querySelectorAll('.cf-fc, #cfFcVazio').forEach((cb) => {
    cb.addEventListener('change', () => {
      atualizarFiltroLabel(pane);
      filtrarTabela();
    });
  });

  return pane;
}

function getContratoFiltros(pane) {
  const tipos = [];
  pane.querySelectorAll('.cf-fc:checked').forEach((cb) => tipos.push(cb.value));
  const incluiVazio = !!cfVal('#cfFcVazio', pane)?.checked;
  return { tipos, incluiVazio };
}

function atualizarFiltroLabel(pane) {
  const { tipos, incluiVazio } = getContratoFiltros(pane);
  const filterBtn = cfVal('#cfFilterBtn', pane);
  const labelEl = cfVal('#cfFilterLabel', pane);
  if (!filterBtn || !labelEl) return;

  const partes = [...tipos];
  if (incluiVazio) partes.push('Sem tipo');

  if (partes.length === 0) {
    labelEl.textContent = 'Nenhum';
    filterBtn.classList.remove('active');
  } else if (partes.length >= 5) {
    labelEl.textContent = 'Todos';
    filterBtn.classList.add('active');
  } else {
    labelEl.textContent = partes.join(' + ');
    filterBtn.classList.add('active');
  }
}

let _cfData = [];

async function carregarPainelFerias() {
  try {
    _cfData = await cfFetchJson('/api/rh/funcionarios/ferias-painel');
  } catch (err) {
    alert('Falha ao carregar painel de férias: ' + (err.message || err));
    _cfData = [];
  }
  filtrarTabela();
}

function renderTabela(dados) {
  const tbody = cfVal('#cfTableBody', _cfPane);
  if (!tbody) return;

  if (!dados.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;opacity:.6;padding:20px">Nenhum colaborador encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = dados.map((u) => {
    const totalDias = Number(u.total_dias_gozados) || 0;
    const ciclo = cfCalcCiclo(u.data_admissao, totalDias);
    const proxStr = ciclo.proxFerias ? cfFmtDateBR(cfFmtDateISO(ciclo.proxFerias)) : '—';
    const limiteStr = ciclo.dataLimite ? cfFmtDateBR(cfFmtDateISO(ciclo.dataLimite)) : '—';
    const saldoStr = ciclo.proxFerias ? `${ciclo.saldoDias} / 30` : '—';
    const badge = cfStatusBadge(u.data_admissao, totalDias);

    return `<tr>
      <td>${cfEscapeHtml(u.username || '')}</td>
      <td>${cfEscapeHtml(u.nome_completo || '')}</td>
      <td>${cfFmtDateBR(u.data_admissao)}</td>
      <td>${proxStr}</td>
      <td>${limiteStr}</td>
      <td>${saldoStr}</td>
      <td>${badge}</td>
      <td><button class="cf-btn" data-user-id="${u.id}" data-user-name="${cfEscapeHtml(u.username || '')}">Gerenciar</button></td>
    </tr>`;
  }).join('');

  // Delegação de cliques
  tbody.onclick = (ev) => {
    const btn = ev.target.closest('.cf-btn[data-user-id]');
    if (!btn) return;
    const userId = cfNormalizeId(btn.dataset.userId);
    const userName = btn.dataset.userName || '';
    if (userId) abrirModalFerias(userId, userName);
  };
}

function filtrarTabela() {
  const termo = (cfVal('#cfSearch', _cfPane)?.value || '').toLowerCase().trim();
  const { tipos, incluiVazio } = getContratoFiltros(_cfPane);

  const filtrado = _cfData.filter((u) => {
    // filtro por tipo_contrato
    const tc = u.tipo_contrato || '';
    const passaContrato = (tc === '' ? incluiVazio : tipos.includes(tc));
    if (!passaContrato) return false;

    // filtro por texto
    if (!termo) return true;
    return (
      (u.username || '').toLowerCase().includes(termo) ||
      (u.nome_completo || '').toLowerCase().includes(termo)
    );
  });
  renderTabela(filtrado);
}

/* ===== Modal de gerenciamento individual ===== */

async function abrirModalFerias(userId, userName) {
  // Remove modal anterior
  document.getElementById('cfModalFerias')?.remove();

  const back = document.createElement('div');
  back.id = 'cfModalFerias';
  back.className = 'cf-modal-backdrop';
  back.innerHTML = `
    <div class="cf-modal" role="dialog" aria-modal="true">
      <header>
        <h3><i class="fa-solid fa-umbrella-beach" style="margin-right:8px"></i>Férias — ${cfEscapeHtml(userName)}</h3>
        <button type="button" class="cf-modal-close">×</button>
      </header>
      <div class="cf-modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">
          <div>
            <label for="cfModalAdmissao">Data de admissão</label>
            <input id="cfModalAdmissao" type="date">
          </div>
          <div>
            <label>Próximas férias</label>
            <input id="cfModalProxFerias" type="date" readonly style="opacity:.85;cursor:default">
          </div>
          <div>
            <label>Data limite</label>
            <input id="cfModalLimite" type="date" readonly style="opacity:.85;cursor:default">
          </div>
          <div>
            <label>Saldo</label>
            <input id="cfModalSaldo" type="text" readonly style="opacity:.85;cursor:default" value="—">
          </div>
        </div>

        <div style="border-top:1px solid rgba(255,255,255,.08);margin-top:16px;padding-top:14px">
          <h4 style="margin:0 0 8px;font-size:14px;color:#e8ecff">Registrar período de férias</h4>
          <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
            <div>
              <small style="opacity:.7;font-size:11px">Início</small>
              <input id="cfModalRegInicio" type="date" style="width:160px">
            </div>
            <div>
              <small style="opacity:.7;font-size:11px">Fim</small>
              <input id="cfModalRegFim" type="date" style="width:160px">
            </div>
            <button id="cfModalRegBtn" type="button" class="content-button status-button" style="height:38px">Registrar</button>
          </div>
        </div>

        <div style="border-top:1px solid rgba(255,255,255,.08);margin-top:16px;padding-top:14px">
          <h4 style="margin:0 0 8px;font-size:14px;color:#e8ecff">Histórico de férias</h4>
          <div id="cfModalHistorico"></div>
        </div>

        <div style="border-top:1px solid rgba(255,255,255,.08);margin-top:16px;padding-top:14px">
          <h4 style="margin:0 0 8px;font-size:14px;color:#e8ecff">Anexos de férias</h4>
          <div id="cfModalAnexos" class="cf-anexos-list"></div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
            <button id="cfModalAnexoBtn" type="button" class="content-button status-button">Anexar documento</button>
            <input id="cfModalAnexoInput" type="file" style="display:none">
          </div>
        </div>
      </div>
      <footer>
        <button type="button" class="content-button status-button cf-modal-cancel">Fechar</button>
      </footer>
    </div>
  `;

  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';

  const close = () => {
    back.remove();
    document.body.style.overflow = '';
    // Recarrega o painel para atualizar tabela
    carregarPainelFerias();
  };

  cfVal('.cf-modal-close', back).addEventListener('click', close);
  cfVal('.cf-modal-cancel', back).addEventListener('click', close);
  back.addEventListener('click', (ev) => { if (ev.target === back) close(); });

  // --- Carregar dados ---
  let registros = [];

  async function carregarTudo() {
    try {
      const [feriasData, regs, anexos] = await Promise.all([
        cfFetchJson(`/api/rh/funcionarios/ferias/${encodeURIComponent(userId)}`),
        cfFetchJson(`/api/rh/funcionarios/ferias-registros/${encodeURIComponent(userId)}`),
        cfFetchJson(`/api/rh/funcionarios/ferias-anexos/${encodeURIComponent(userId)}`),
      ]);
      registros = regs;
      cfVal('#cfModalAdmissao', back).value = feriasData.data_admissao ? feriasData.data_admissao.slice(0, 10) : '';
      recalcular();
      renderHistorico();
      renderAnexos(anexos);
    } catch (err) {
      console.error('Erro ao carregar dados de férias:', err);
    }
  }

  function recalcular() {
    const admStr = cfVal('#cfModalAdmissao', back).value;
    const totalDias = registros.reduce((s, r) => s + (r.dias || 0), 0);
    const ciclo = cfCalcCiclo(admStr, totalDias);

    cfVal('#cfModalProxFerias', back).value = ciclo.proxFerias ? cfFmtDateISO(ciclo.proxFerias) : '';
    cfVal('#cfModalLimite', back).value = ciclo.dataLimite ? cfFmtDateISO(ciclo.dataLimite) : '';
    cfVal('#cfModalSaldo', back).value = ciclo.proxFerias ? `${ciclo.saldoDias} / 30 dias restantes` : '—';
  }

  function renderHistorico() {
    const box = cfVal('#cfModalHistorico', back);
    if (!registros.length) {
      box.innerHTML = '<div class="cf-hist-empty">Nenhum registro de férias.</div>';
      return;
    }
    box.innerHTML = `<table class="cf-hist-table">
      <thead><tr><th>Início</th><th>Fim</th><th>Dias</th><th>Registrado por</th><th></th></tr></thead>
      <tbody>${registros.map(r => `<tr>
        <td>${cfFmtDateBR(r.data_inicio)}</td>
        <td>${cfFmtDateBR(r.data_fim)}</td>
        <td>${r.dias}</td>
        <td>${cfEscapeHtml(r.registrado_por || '—')}</td>
        <td><button class="cf-btn-del" data-reg-id="${r.id}">Excluir</button></td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  function renderAnexos(anexos) {
    const box = cfVal('#cfModalAnexos', back);
    const arr = Array.isArray(anexos) ? anexos : [];
    if (!arr.length) {
      box.innerHTML = '<div class="cf-hist-empty">Nenhum anexo de férias.</div>';
      return;
    }
    box.innerHTML = arr.map(a => `
      <div class="cf-anexo-item">
        <a class="cf-anexo-link" href="${cfEscapeHtml(a.url_arquivo || '#')}" target="_blank" rel="noopener noreferrer">${cfEscapeHtml(a.nome_arquivo || 'Arquivo')}</a>
        <button class="cf-btn-del" data-anexo-id="${a.id}">Excluir</button>
      </div>
    `).join('');
  }

  // --- Salvar data de admissão ao alterar ---
  cfVal('#cfModalAdmissao', back).addEventListener('change', async () => {
    try {
      await cfFetchJson(`/api/rh/funcionarios/ferias/${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data_admissao: cfVal('#cfModalAdmissao', back).value || null,
          data_limite_ferias: cfVal('#cfModalLimite', back).value || null,
          ferias_vencidas: false,
        }),
      });
      recalcular();
    } catch (err) {
      alert('Falha ao salvar data de admissão: ' + (err.message || err));
    }
  });

  // --- Registrar férias ---
  cfVal('#cfModalRegBtn', back).addEventListener('click', async () => {
    const inicio = cfVal('#cfModalRegInicio', back).value;
    const fim = cfVal('#cfModalRegFim', back).value;
    if (!inicio || !fim) { alert('Informe data de início e fim.'); return; }
    if (fim < inicio) { alert('Data fim não pode ser anterior à data início.'); return; }
    try {
      await cfFetchJson(`/api/rh/funcionarios/ferias-registros/${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data_inicio: inicio,
          data_fim: fim,
          registrado_por: window.__sessionUser?.username || null,
        }),
      });
      cfVal('#cfModalRegInicio', back).value = '';
      cfVal('#cfModalRegFim', back).value = '';
      await carregarTudo();
    } catch (err) {
      alert('Falha ao registrar férias: ' + (err.message || err));
    }
  });

  // --- Excluir registro ---
  cfVal('#cfModalHistorico', back).addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.cf-btn-del[data-reg-id]');
    if (!btn) return;
    const regId = cfNormalizeId(btn.dataset.regId);
    if (!regId || !confirm('Confirma excluir este registro de férias?')) return;
    try {
      await cfFetchJson(`/api/rh/funcionarios/ferias-registros/${encodeURIComponent(regId)}`, { method: 'DELETE' });
      await carregarTudo();
    } catch (err) {
      alert('Falha ao excluir registro: ' + (err.message || err));
    }
  });

  // --- Anexar documento ---
  cfVal('#cfModalAnexoBtn', back).addEventListener('click', () => {
    cfVal('#cfModalAnexoInput', back).click();
  });

  cfVal('#cfModalAnexoInput', back).addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('bucket', 'Funcionarios');
      form.append('path', `${userId}/ferias/${Date.now()}_${file.name}`);

      const uploadData = await cfFetchJson('/api/upload/supabase', { method: 'POST', body: form });
      if (!uploadData?.url || !uploadData?.path) throw new Error('Upload incompleto');

      await cfFetchJson(`/api/rh/funcionarios/ferias-anexos/${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_arquivo: file.name,
          url_arquivo: uploadData.url,
          path_arquivo: uploadData.path,
          enviado_por: window.__sessionUser?.username || null,
        }),
      });
      await carregarTudo();
    } catch (err) {
      alert('Falha ao anexar documento: ' + (err.message || err));
    }
  });

  // --- Excluir anexo ---
  cfVal('#cfModalAnexos', back).addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.cf-btn-del[data-anexo-id]');
    if (!btn) return;
    const aId = cfNormalizeId(btn.dataset.anexoId);
    if (!aId || !confirm('Confirma excluir este anexo?')) return;
    try {
      await cfFetchJson(`/api/rh/funcionarios/ferias-anexos/${encodeURIComponent(aId)}`, { method: 'DELETE' });
      await carregarTudo();
    } catch (err) {
      alert('Falha ao excluir anexo: ' + (err.message || err));
    }
  });

  // Carrega tudo ao abrir
  await carregarTudo();
}

/* ===== Abertura pública ===== */

async function doOpenCf() {
  const root = findTabsRoot();
  const pane = ensureCfPane(root);

  if (typeof window.showMainTab === 'function') {
    window.showMainTab('rhControleFerias');
    // showOnlyInMain força display:'block', corrigimos para flex
    pane.style.display = 'flex';
  } else {
    document.querySelectorAll('.tab-pane').forEach(el => { el.style.display = 'none'; });
    pane.style.display = 'flex';
  }

  await carregarPainelFerias();
}

export function initRhControleFeriasUI() {
  if (_cfInited) return;
  _cfInited = true;

  const btn = document.querySelector('#btn-rh-controle-ferias');
  if (!btn) return;

  if (!btn.dataset.bindCf) {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      doOpenCf();
    });
    btn.dataset.bindCf = '1';
  }

  window.openRhControleFerias = doOpenCf;
}

export const openRhControleFerias = doOpenCf;
