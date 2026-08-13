/**
 * Meus EPIs — área do colaborador
 * Solicitações (com assinatura no celular) + entregas recebidas
 */
let _meInited = false;
let _mePane = null;
let _meData = { perfil: null, solicitacoes: [], entregas: [] };
let _meSignSolId = null;
let _meDrawing = false;
let _meLastPt = null;

function meVal(sel, root = document) {
  return root.querySelector(sel);
}

async function meFetchJson(url, init = {}) {
  const res = await fetch(url, { credentials: 'include', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function meEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function meFmtDateBR(str) {
  if (!str) return '—';
  const s = typeof str === 'string' ? str.slice(0, 10) : String(str).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function findTabsRoot() {
  return document.querySelector('.main-container')
    || document.querySelector('.tab-content')
    || document.body;
}

function ensureMeusEpiPane(root) {
  if (_mePane) return _mePane;

  const pane = document.createElement('div');
  pane.id = 'rhMeusEpis';
  pane.className = 'tab-pane';
  pane.style.display = 'none';
  pane.style.flex = '1';
  pane.style.minHeight = '0';
  pane.style.overflow = 'hidden';
  pane.innerHTML = `
    <style>
    #rhMeusEpis{padding:18px 24px;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
    #rhMeusEpis .me-header{flex-shrink:0;margin-bottom:12px}
    #rhMeusEpis .me-title{font-size:18px;font-weight:700;color:#e8ecff;margin:0 0 4px}
    #rhMeusEpis .me-sub{font-size:13px;color:#9ca3af;margin:0}
    #rhMeusEpis .me-scroll{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:14px}
    #rhMeusEpis .me-card{border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(17,20,28,.45);padding:14px 16px}
    #rhMeusEpis .me-card h3{margin:0 0 10px;font-size:15px;color:#e8ecff}
    #rhMeusEpis .me-btn{padding:10px 14px;border-radius:10px;border:1px solid rgba(95,142,255,.45);background:rgba(58,109,240,.22);color:#cfe0ff;cursor:pointer;font-size:14px;font-weight:600}
    #rhMeusEpis .me-btn-ghost{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#c8d0e8}
    #rhMeusEpis .me-btn-danger{border-color:rgba(255,115,115,.35);background:rgba(255,95,95,.14);color:#ffc9c9}
    #rhMeusEpis .me-sol{border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px;margin-bottom:10px;background:rgba(255,255,255,.03)}
    #rhMeusEpis .me-sol-top{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-bottom:8px}
    #rhMeusEpis .me-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
    #rhMeusEpis .me-badge-pend{background:rgba(245,158,11,.18);color:#fbbf24}
    #rhMeusEpis .me-badge-ok{background:rgba(34,197,94,.18);color:#4ade80}
    #rhMeusEpis .me-badge-st{background:rgba(148,163,184,.18);color:#cbd5e1}
    #rhMeusEpis .me-itens{margin:0;padding-left:18px;color:#e1e6f8;font-size:13px}
    #rhMeusEpis .me-empty{padding:20px;text-align:center;color:#9ca3af;font-size:13px}
    #rhMeusEpis .me-sign-img{max-width:220px;max-height:80px;background:#fff;border-radius:8px;border:1px solid rgba(255,255,255,.15)}
    #rhMeusEpis table{width:100%;border-collapse:collapse;font-size:13px}
    #rhMeusEpis th,#rhMeusEpis td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;color:#e1e6f8}
    #rhMeusEpis th{font-size:11px;text-transform:uppercase;color:#a8b3d4}
    #rhMeusEpis .me-modal-back{position:fixed;inset:0;z-index:13000;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;padding:0}
    #rhMeusEpis .me-modal{width:100%;max-width:560px;max-height:92vh;background:#1a1d27;border-radius:16px 16px 0 0;border:1px solid rgba(255,255,255,.12);display:flex;flex-direction:column;overflow:hidden}
    #rhMeusEpis .me-modal-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)}
    #rhMeusEpis .me-modal-head h3{margin:0;font-size:16px;color:#e8ecff}
    #rhMeusEpis .me-modal-body{padding:14px 16px;overflow:auto;flex:1}
    #rhMeusEpis .me-modal-actions{display:flex;gap:8px;padding:12px 16px;border-top:1px solid rgba(255,255,255,.1);flex-wrap:wrap}
    #rhMeusEpis #meSignCanvas{
      width:100%;height:220px;touch-action:none;background:#fff;border-radius:12px;
      border:1px solid #cbd5e1;display:block;cursor:crosshair
    }
    #rhMeusEpis .me-hint{font-size:12px;color:#9ca3af;margin:0 0 10px}
    .light-mode #rhMeusEpis .me-title,.light-mode #rhMeusEpis .me-card h3,.light-mode #rhMeusEpis .me-modal-head h3{color:#111827}
    .light-mode #rhMeusEpis .me-card,.light-mode #rhMeusEpis .me-sol{background:#fff;border-color:#e5e7eb}
    .light-mode #rhMeusEpis .me-modal{background:#fff}
    .light-mode #rhMeusEpis td{color:#1f2937}
    @media (min-width:700px){
      #rhMeusEpis .me-modal-back{align-items:center;padding:16px}
      #rhMeusEpis .me-modal{border-radius:14px;max-height:86vh}
    }
    </style>

    <div class="me-header">
      <h2 class="me-title"><i class="fa-solid fa-hard-hat" style="margin-right:8px"></i>Meus EPIs</h2>
      <p class="me-sub" id="meSubLine">Carregando…</p>
    </div>

    <div class="me-scroll">
      <div class="me-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <h3 style="margin:0">Solicitações para mim</h3>
          <button type="button" class="me-btn me-btn-ghost" id="meBtnRefresh">Atualizar</button>
        </div>
        <div id="meSolList"></div>
      </div>

      <div class="me-card">
        <h3>EPIs entregues</h3>
        <div style="overflow:auto">
          <table>
            <thead>
              <tr>
                <th>Descrição</th>
                <th>C.A.</th>
                <th>Qtd</th>
                <th>Tam.</th>
                <th>Entrega</th>
                <th>Devolução</th>
              </tr>
            </thead>
            <tbody id="meEntTbody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="meSignModal" class="me-modal-back" style="display:none" aria-hidden="true">
      <div class="me-modal" role="dialog" aria-modal="true" aria-labelledby="meSignTitle">
        <div class="me-modal-head">
          <h3 id="meSignTitle">Assinar solicitação</h3>
          <button type="button" class="me-btn me-btn-ghost" id="meSignClose" aria-label="Fechar">×</button>
        </div>
        <div class="me-modal-body">
          <p class="me-hint">Desenhe sua assinatura com o dedo (celular) ou mouse. Ela será gravada e vinculada a esta solicitação.</p>
          <div id="meSignItens" style="margin-bottom:10px;font-size:13px;color:#cfe0ff"></div>
          <canvas id="meSignCanvas" width="800" height="360"></canvas>
        </div>
        <div class="me-modal-actions">
          <button type="button" class="me-btn me-btn-ghost" id="meSignClear">Limpar</button>
          <button type="button" class="me-btn" id="meSignSave" style="margin-left:auto">Confirmar assinatura</button>
        </div>
      </div>
    </div>
  `;

  root.appendChild(pane);
  _mePane = pane;
  bindMeusEpiPane(pane);
  return pane;
}

function renderMeusEpis(pane) {
  const perfil = _meData.perfil || {};
  const sub = meVal('#meSubLine', pane);
  if (sub) {
    sub.textContent = `${perfil.nome || perfil.username || 'Colaborador'}${perfil.cargo ? ` — ${perfil.cargo}` : ''}`;
  }

  const list = meVal('#meSolList', pane);
  const sols = _meData.solicitacoes || [];
  if (list) {
    if (!sols.length) {
      list.innerHTML = '<div class="me-empty">Nenhuma solicitação de EPI para você.</div>';
    } else {
      list.innerHTML = sols.map((s) => {
        const itens = Array.isArray(s.itens) ? s.itens : [];
        const itensHtml = itens.length
          ? `<ul class="me-itens">${itens.map((i) =>
              `<li>${meEscape(i.descricao)} <span style="color:#93c5fd">(CA ${meEscape(i.ca || '—')})</span> — qtd ${i.quantidade || 1}${i.tamanho ? ` · tam ${meEscape(i.tamanho)}` : ''}</li>`
            ).join('')}</ul>`
          : '<div class="me-empty" style="padding:8px">Sem itens</div>';
        const assinada = !!s.assinatura_url;
        return `
          <div class="me-sol" data-sol-id="${s.id}">
            <div class="me-sol-top">
              <div>
                <strong style="color:#e8ecff">#${s.id}</strong>
                <span style="color:#9ca3af;font-size:12px;margin-left:8px">${meFmtDateBR(s.created_at)}</span>
                <div style="margin-top:6px">
                  <span class="me-badge me-badge-st">${meEscape(s.status || 'aberta')}</span>
                  ${assinada
                    ? '<span class="me-badge me-badge-ok" style="margin-left:6px">Assinado</span>'
                    : '<span class="me-badge me-badge-pend" style="margin-left:6px">Assinatura pendente</span>'}
                </div>
              </div>
              <div>
                ${assinada
                  ? `<a href="${meEscape(s.assinatura_url)}" target="_blank" rel="noopener"><img class="me-sign-img" src="${meEscape(s.assinatura_url)}" alt="Assinatura" /></a>`
                  : (s.status === 'cancelada'
                      ? ''
                      : `<button type="button" class="me-btn me-assinar" data-id="${s.id}">Assinar no celular</button>`)}
              </div>
            </div>
            ${itensHtml}
            ${s.observacao ? `<div style="margin-top:8px;font-size:12px;color:#9ca3af">Obs.: ${meEscape(s.observacao)}</div>` : ''}
          </div>
        `;
      }).join('');
    }
  }

  const tbody = meVal('#meEntTbody', pane);
  const ents = _meData.entregas || [];
  if (tbody) {
    if (!ents.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="me-empty">Nenhuma entrega registrada.</td></tr>';
    } else {
      tbody.innerHTML = ents.map((e) => `
        <tr>
          <td>${meEscape(e.item || '')}</td>
          <td>${meEscape(e.ca || '—')}</td>
          <td>${e.quantidade != null ? e.quantidade : 1}</td>
          <td>${meEscape(e.tamanho || '—')}</td>
          <td>${meFmtDateBR(e.data_entrega)}</td>
          <td>${meFmtDateBR(e.data_devolucao)}</td>
        </tr>
      `).join('');
    }
  }
}

function getSignCanvas(pane) {
  return meVal('#meSignCanvas', pane);
}

function getSignCtx(pane) {
  const canvas = getSignCanvas(pane);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111827';
  return ctx;
}

function clearSignCanvas(pane) {
  const canvas = getSignCanvas(pane);
  const ctx = getSignCtx(pane);
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function canvasPos(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  const src = ev.touches?.[0] || ev.changedTouches?.[0] || ev;
  const x = ((src.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((src.clientY - rect.top) / rect.height) * canvas.height;
  return { x, y };
}

function openSignModal(pane, solId) {
  _meSignSolId = solId;
  const sol = (_meData.solicitacoes || []).find((s) => Number(s.id) === Number(solId));
  const itensBox = meVal('#meSignItens', pane);
  if (itensBox && sol) {
    const itens = Array.isArray(sol.itens) ? sol.itens : [];
    itensBox.innerHTML = itens.map((i) => `• ${meEscape(i.descricao)} (CA ${meEscape(i.ca || '—')})`).join('<br>');
  }
  clearSignCanvas(pane);
  const modal = meVal('#meSignModal', pane);
  if (modal) {
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeSignModal(pane) {
  _meSignSolId = null;
  _meDrawing = false;
  const modal = meVal('#meSignModal', pane);
  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
}

function canvasIsBlank(canvas) {
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // fundo branco: se quase tudo for branco, está em branco
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a > 10 && (r < 250 || g < 250 || b < 250)) ink += 1;
    if (ink > 40) return false;
  }
  return true;
}

async function loadMeusEpis(pane) {
  _meData = await meFetchJson('/api/rh/epi/meus');
  renderMeusEpis(pane);
}

function bindMeusEpiPane(pane) {
  meVal('#meBtnRefresh', pane)?.addEventListener('click', () => {
    loadMeusEpis(pane).catch((e) => alert(e.message || e));
  });

  meVal('#meSolList', pane)?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.me-assinar');
    if (!btn) return;
    openSignModal(pane, Number(btn.dataset.id));
  });

  meVal('#meSignClose', pane)?.addEventListener('click', () => closeSignModal(pane));
  meVal('#meSignClear', pane)?.addEventListener('click', () => clearSignCanvas(pane));
  meVal('#meSignModal', pane)?.addEventListener('click', (ev) => {
    if (ev.target === meVal('#meSignModal', pane)) closeSignModal(pane);
  });

  const canvas = getSignCanvas(pane);
  if (canvas) {
    clearSignCanvas(pane);
    const start = (ev) => {
      ev.preventDefault();
      _meDrawing = true;
      _meLastPt = canvasPos(canvas, ev);
    };
    const move = (ev) => {
      if (!_meDrawing) return;
      ev.preventDefault();
      const ctx = getSignCtx(pane);
      const pt = canvasPos(canvas, ev);
      if (!ctx || !_meLastPt) return;
      ctx.beginPath();
      ctx.moveTo(_meLastPt.x, _meLastPt.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      _meLastPt = pt;
    };
    const end = (ev) => {
      if (!_meDrawing) return;
      ev.preventDefault();
      _meDrawing = false;
      _meLastPt = null;
    };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end, { passive: false });
  }

  meVal('#meSignSave', pane)?.addEventListener('click', async () => {
    const canvasEl = getSignCanvas(pane);
    if (!canvasEl || !_meSignSolId) return;
    if (canvasIsBlank(canvasEl)) {
      alert('Desenhe sua assinatura antes de confirmar.');
      return;
    }
    const base64 = canvasEl.toDataURL('image/png');
    const btn = meVal('#meSignSave', pane);
    if (btn) btn.disabled = true;
    try {
      const data = await meFetchJson(`/api/rh/epi/solicitacoes/${_meSignSolId}/assinar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assinatura_base64: base64 }),
      });
      closeSignModal(pane);
      await loadMeusEpis(pane);
      if (data?.estoque_baixa_ok === false || data?.estoque_baixa_erro) {
        alert(
          'Assinatura gravada, mas a baixa no estoque ##RH falhou.\n'
          + 'Avise o RH para usar “Reprocessar estoque”.\n\n'
          + (data.estoque_baixa_erro || '')
        );
      } else {
        alert('Assinado e estoque ##RH baixado com sucesso.');
      }
    } catch (err) {
      alert('Falha ao gravar assinatura: ' + (err.message || err));
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function doOpenMeusEpis() {
  const root = findTabsRoot();
  const pane = ensureMeusEpiPane(root);

  if (typeof window.showMainTab === 'function') {
    window.showMainTab('rhMeusEpis');
    pane.style.display = 'flex';
  } else {
    document.querySelectorAll('.tab-pane').forEach((el) => { el.style.display = 'none'; });
    pane.style.display = 'flex';
  }

  try {
    await loadMeusEpis(pane);
  } catch (err) {
    alert('Erro ao carregar Meus EPIs: ' + (err.message || err));
  }
}

export function initRhMeusEpisUI() {
  if (_meInited) return;
  _meInited = true;

  const btn = document.querySelector('#btn-rh-meus-epis');
  if (!btn) return;

  if (!btn.dataset.bindMeusEpi) {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      doOpenMeusEpis();
    });
    btn.dataset.bindMeusEpi = '1';
  }

  window.openRhMeusEpis = doOpenMeusEpis;
}

export const openRhMeusEpis = doOpenMeusEpis;
