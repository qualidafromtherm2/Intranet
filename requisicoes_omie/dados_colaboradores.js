// requisicoes_omie/dados_colaboradores.js
// Cadastro de Colaboradores (SQL) — com editor de permissões
let _inited = false;
function LOG(...a){ console.log('[COLAB]', ...a); }

function findTabsRoot(){
  return document.querySelector('.main-container')
      || document.querySelector('.tab-content')
      || document.body;
}
function mk(tag, cls, txt){
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (txt != null) el.textContent = txt;
  return el;
}

/* ============ Página ============ */
function ensurePane(root){
  let pane = document.getElementById('dadosColaboradores');
  if (pane) return pane;

  pane = document.createElement('div');
  pane.id = 'dadosColaboradores';
  pane.className = 'tab-pane';
  pane.style.display = 'none';
  pane.innerHTML = `
    <div class="content-wrapper">
      <div class="content-section">
        <div class="title-wrapper">
          <div class="content-section-title">Cadastro de colaboradores</div>
          <div class="side-by-side">
            <input id="colabFilter" type="text" placeholder="Filtrar por usuário/ID/role">
            <button id="btnRecarregarColab" class="content-button status-button">Recarregar</button>
          </div>
        </div>

        <div class="table-grid colab-grid">
          <div class="th">Usuário</div>
          <div class="th">ID</div>
          <div class="th">Setor</div>
          <div class="th">Função</div>
          <div class="th">Ações</div>
        </div>
      </div>
    </div>
  `;
  root.appendChild(pane);

  const st = document.createElement('style');
  st.textContent = `
    /* Grid da lista em estilo tabela, mais limpo e profissional (escopado) */
    #dadosColaboradores .colab-grid{display:grid;grid-template-columns:1.2fr 90px 180px 1.8fr 140px;gap:0;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;background:rgba(17,20,28,.6);box-shadow:0 8px 26px rgba(0,0,0,.2)}
    #dadosColaboradores .colab-grid .th,#dadosColaboradores .colab-grid .td{padding:12px 14px}
    #dadosColaboradores .colab-grid .th{font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:12px;color:#a8b3d4;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.08)}
    #dadosColaboradores .colab-grid .td{border-bottom:1px solid rgba(255,255,255,.06);background:transparent}
    #dadosColaboradores .colab-grid .td:nth-child(5n+2),
    #dadosColaboradores .colab-grid .td:nth-child(5n+3){text-align:center;color:#e5eaff}
    #dadosColaboradores .colab-grid .btn-acao{justify-self:end}
    #dadosColaboradores .colab-grid .td-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end}
    #dadosColaboradores .colab-grid .btn-icon{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:#d7defe;cursor:pointer;font-size:0;padding:0;line-height:0;transition:background .15s ease,border-color .15s ease,transform .15s ease,color .15s ease}
    #dadosColaboradores .colab-grid .btn-icon:hover{background:rgba(77,128,255,.18);border-color:rgba(96,148,255,.55);color:#f5f7ff;transform:translateY(-1px)}
    #dadosColaboradores .colab-grid .btn-icon:focus-visible{outline:2px solid rgba(95,142,255,.8);outline-offset:2px}
    #dadosColaboradores .colab-grid .btn-icon svg{display:block;width:18px;height:18px;pointer-events:none}
    #dadosColaboradores .colab-grid .btn-icon svg *,
    #dadosColaboradores .colab-grid .btn-icon svg path{fill:currentColor!important;stroke:none!important}
  @keyframes spin{to{transform:rotate(360deg)}}
  .loading{position:relative}
  .loading::after{content:'';position:absolute;right:-6px;top:-6px;width:14px;height:14px;border:2px solid rgba(255,255,255,.6);border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
  @media(max-width:1100px){#dadosColaboradores .colab-grid{grid-template-columns:1fr 70px 130px 1.4fr 110px}}

    /* Toolbar: filtro e botão recarregar */
    #dadosColaboradores .title-wrapper{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
    #dadosColaboradores .title-wrapper .side-by-side{display:flex;gap:8px;align-items:center}
    #colabFilter{min-width:320px;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(17,20,28,.6);color:#e8ecff}
    #colabFilter::placeholder{color:#93a0c2;opacity:.8}

    /* Chips de Permissões de Produto */
    .perm-chips{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}
    .perm-chip{background:rgba(84,120,255,.16);border:1px solid rgba(120,150,255,.25);padding:3px 8px;border-radius:999px;font-size:12px;color:#e6eaff}

    .colab-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.54);backdrop-filter:saturate(120%) blur(2px);z-index:9998;display:flex;align-items:center;justify-content:center}
    .colab-modal{width:min(920px,94vw);max-height:88vh;overflow:auto;background:#151923;border:1px solid rgba(255,255,255,.08);border-radius:16px;box-shadow:0 20px 80px rgba(0,0,0,.5)}
    .colab-modal header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.08)}
    .colab-modal header h3{margin:0;font-size:18px}
    .colab-modal .body{padding:16px 20px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .colab-modal .row{display:flex;gap:8px;align-items:center}
    .colab-modal label{opacity:.8;width:110px}
    .colab-modal .pill{display:inline-flex;gap:6px;flex-wrap:wrap}
    .colab-modal .pill .badge{background:rgba(80,120,255,.18);padding:4px 8px;border-radius:999px}
    .colab-modal footer{padding:14px 20px;border-top:1px solid rgba(255,255,255,.08);display:flex;gap:8px;justify-content:flex-end}

    .btn{padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:transparent;color:#eaeaea;cursor:pointer}
    .btn.primary{background:#2d6bff;border-color:#2d6bff;color:white}
    .btn.ghost{background:transparent}

    .perm-toolbar{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
    .sep{height:1px;background:rgba(255,255,255,.08);grid-column:1/-1;margin:4px 0}

    .perm-list{grid-column:1/-1}
    .perm-list .grp{margin:10px 0;padding:10px;border-radius:10px;background:rgba(255,255,255,.03)}
    .perm-list .grp h4{margin:0 0 8px 0;font-size:14px;opacity:.9}
    .perm-list .node{display:flex;gap:8px;align-items:center;padding:4px 0}
    .perm-list .node .indent{display:inline-block;width:18px}
  `;
  pane.appendChild(st);

  pane.querySelector('#btnRecarregarColab')
      .addEventListener('click', async (ev) => {
        const b = ev.currentTarget;
        b.classList.add('loading');
        b.disabled = true;
        const prev = b.textContent;
        b.textContent = 'Carregando…';
        try { await carregarLista(pane); }
        finally { b.disabled = false; b.classList.remove('loading'); b.textContent = prev; }
      });
  pane.querySelector('#colabFilter')
      .addEventListener('input', () => aplicarFiltro(pane));

  return pane;
}

/* ============ Lista ============ */
function renderLinhas(pane, lista){
  const grid = pane.querySelector('.colab-grid');
  grid.querySelectorAll('.td').forEach(n => n.remove());

  lista.forEach(u => {
    const c1 = mk('div','td', u.username);
    const c2 = mk('div','td', String(u.id));
    const c3 = mk('div','td', u.setor  || '—');
    const opsText = Array.isArray(u.operacoes) && u.operacoes.length
      ? u.operacoes.map(op => op?.label || op?.operacao || op?.name || '').filter(Boolean).join(', ')
      : '';
    const c4 = mk('div','td');
    const funcOpsLbl = [u.funcao || '—', opsText].filter(Boolean).join(' • ');
    c4.appendChild(mk('div', '', funcOpsLbl));

    // Chips de Permissões de Produto
    const perms = Array.isArray(u.produto_permissoes) ? u.produto_permissoes : [];
    if (perms.length) {
      const chips = mk('div','perm-chips');
      perms.forEach(p => {
        const chip = mk('span','perm-chip', p?.nome || p?.codigo || '');
        chips.appendChild(chip);
      });
      c4.appendChild(chips);
    }
const c5 = mk('div','td td-actions');

const SVG_NS = 'http://www.w3.org/2000/svg';
const makeSvgIcon = (paths) => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  paths.forEach(cfg => {
    const path = document.createElementNS(SVG_NS, 'path');
    Object.entries(cfg).forEach(([k,v]) => path.setAttribute(k, v));
    svg.appendChild(path);
  });
  return svg;
};

const iconFactories = {
  pencil: () => makeSvgIcon([
    { d: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z' },
    { d: 'M20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z' }
  ]),
  trash: () => makeSvgIcon([
    { d: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12z' },
    { d: 'M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z' }
  ])
};

// botão ícone (reutilizável)
const makeIconBtn = (title, kind) => {
  const b = mk('button',`btn-icon icon-${kind}`);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.appendChild(iconFactories[kind]());
  return b;
};

// Detalhes (ícone lápis)
const btnDet = makeIconBtn('Detalhes', 'pencil');
btnDet.addEventListener('click', async (ev) => {
  const b = ev.currentTarget; b.classList.add('loading'); b.disabled = true;
  try { await abrirDetalhes(u); }
  finally { b.disabled = false; b.classList.remove('loading'); }
});
c5.appendChild(btnDet);

// Excluir (ícone lixeira)
const btnDel = makeIconBtn('Excluir', 'trash');
btnDel.addEventListener('click', async (ev) => {
  const ok = confirm(`Excluir o usuário "${u.username}" (ID ${u.id})? Esta ação não pode ser desfeita.`);
  if (!ok) return;
  try {
    const b = ev.currentTarget; b.classList.add('loading'); b.disabled = true;
    const r = await fetch(`/api/colaboradores/${encodeURIComponent(u.id)}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (!r.ok) {
      const err = await r.json().catch(()=>({}));
      throw new Error(err.error || `Falha (HTTP ${r.status})`);
    }
    await carregarLista(pane); // recarrega a lista
  } catch (e) {
    alert('Não foi possível excluir: ' + (e.message || e));
  } finally {
    const b = ev.currentTarget; b.disabled = false; b.classList.remove('loading');
  }
});
c5.appendChild(btnDel);

grid.append(c1,c2,c3,c4,c5);

  });

  pane._raw = lista;
  aplicarFiltro(pane);
}
function aplicarFiltro(pane){
  const filtro = (pane.querySelector('#colabFilter').value || '').toLowerCase().trim();
  const grid   = pane.querySelector('.colab-grid');
  const tds    = Array.from(grid.querySelectorAll('.td'));
  for (let i=0;i<tds.length;i+=5){
    const cols = tds.slice(i,i+5);
    const txt = cols.map(c=>c.textContent).join(' ').toLowerCase();
    const ok  = !filtro || txt.includes(filtro);
    cols.forEach(n => n.style.display = ok ? '' : 'none');
  }
}

function normalizeOperacoes(val){
  if (Array.isArray(val)) return val;
  if (typeof val === 'string'){
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

/* ============ API ============ */
async function carregarLista(pane){
  const res = await fetch('/api/users', { credentials:'include' });
  if (!res.ok){
    const err = await res.json().catch(()=> ({}));
    throw new Error(`Falha ao listar usuários (HTTP ${res.status}) ${JSON.stringify(err)}`);
  }
  const arr = await res.json();
  const lista = arr.map(x => ({
    id: String(x.id),
    username: x.username,
    roles: Array.isArray(x.roles) ? x.roles : [],
    setor:  x.setor  || x.profile?.setor  || '',
    funcao: x.funcao || x.profile?.funcao || '',
    operacao: x.operacao || x.profile?.operacao || '',
    operacao_id: x.operacao_id != null ? Number(x.operacao_id) :
                 (x.profile?.operacao_id != null ? Number(x.profile.operacao_id) : null),
    operacoes: normalizeOperacoes(x.operacoes ?? x.profile?.operacoes),
    produto_permissoes: Array.isArray(x.produto_permissoes) ? x.produto_permissoes : []
  }));
  renderLinhas(pane, lista);
}

/* ============ Modal Detalhes + Editor de Permissões ============ */
function closeModal(mod){ mod?.remove(); document.body.style.overflow=''; }
function showModal(html){
  const back = document.createElement('div');
  back.className = 'colab-modal-backdrop';
  back.innerHTML = html;
  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';
  back.addEventListener('click', e => { if (e.target === back) closeModal(back); });
  document.addEventListener('keydown', escOnce);
  function escOnce(ev){ if (ev.key === 'Escape'){ closeModal(back); document.removeEventListener('keydown', escOnce); } }
  return back;
}

async function abrirDetalhes(u){
  // enriquece com perfil
  let enriched = null;
  try {
    const r = await fetch(`/api/users/${encodeURIComponent(u.id)}`, { credentials:'include' });
    if (r.ok) enriched = await r.json();
  } catch {}
  const user    = enriched?.user    || u;
  const profile = enriched?.profile || {};
  const roles   = user.roles || [];
  const setor   = profile.setor  || u.setor  || '';
  const funcao  = profile.funcao || u.funcao || '';
  const operacao = profile.operacao || u.operacao || '';
  const operacaoIdRaw = profile.operacao_id ?? u.operacao_id ?? null;
  const operacaoId = operacaoIdRaw != null ? Number(operacaoIdRaw) : null;
  const operacoes = normalizeOperacoes(profile.operacoes ?? u.operacoes);

  const html = `
    <div class="colab-modal" role="dialog" aria-modal="true">
      <header>
        <h3>Colaborador — ${user.username}</h3>
        <button class="btn ghost js-close">Fechar</button>
      </header>

      <div class="body">
        <div class="row"><label>ID</label><div>${user.id}</div></div>
        <div class="row"><label>Usuário</label><div>${user.username}</div></div>
        <div class="row"><label>Perfis</label>
          <div class="pill">${roles.length ? roles.map(r=>`<span class="badge">${r}</span>`).join(' ') : '—'}</div>
        </div>
        <div class="row"><label>Setor</label><div>${setor || '—'}</div></div>
        <div class="row"><label>Função</label><div>${funcao || '—'}</div></div>
        <div class="row"><label>Operações</label>
          <div class="pill" style="flex-wrap:wrap;gap:6px;">
            ${
              operacoes.length
                ? operacoes.map(op => `<span class="badge">${op.label || op.operacao || op.name || op.id}</span>`).join(' ')
                : (operacao ? `<span class="badge">${operacao}</span>` : '—')
            }
          </div>
        </div>

        <div class="sep"></div>

<div class="row" style="grid-column:1/-1; display:flex; gap:8px; align-items:center">
  <button class="btn primary js-open-perm">Permissões</button>
  <button class="btn js-edit">Editar</button>
  <button class="btn danger js-reset-pass" title="Redefinir a senha deste usuário para 123">Resetar senha</button>
</div>



        <!-- o editor não é mais renderizado aqui; usamos showPermissoes() -->
        <div class="perm-list" style="display:none"></div>
        <div class="perm-toolbar" style="display:none"></div>
      </div>

      <footer>
        <button class="btn ghost js-close">Fechar</button>
      </footer>
    </div>
  `;

  const modal = showModal(html);

  // clique no "Resetar senha" → POST /api/users/:id/password/reset
const btnReset = modal.querySelector('.js-reset-pass');
btnReset?.addEventListener('click', async (ev) => {
  const id = String(user.id);
  const b = ev.currentTarget; b.disabled = true; b.classList.add('loading');
  const prev = b.textContent; b.textContent = 'Resetando…';
  try {
    const r = await fetch(`/api/users/${encodeURIComponent(id)}/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (!r.ok) {
      const err = await r.text().catch(()=> '');
      throw new Error(`HTTP ${r.status} ${err || ''}`.trim());
    }
    alert('Senha redefinida para 123. No próximo login, o usuário deverá alterar a senha.');
  } catch (e) {
    alert('Falha ao redefinir a senha: ' + (e.message || e));
  } finally {
    b.textContent = prev;
    b.disabled = false;
    b.classList.remove('loading');
  }
});




  modal.querySelectorAll('.js-close').forEach(b => b.addEventListener('click', () => closeModal(modal)));

  // 👉 NOVO: abre o editor moderno de permissões (aquele com “Menu lateral / Menu superior”)
modal.querySelector('.js-open-perm').addEventListener('click', async (ev) => {
  const b = ev.currentTarget; b.disabled = true; b.classList.add('loading');

  try {
    if (window.syncNavNodes) await window.syncNavNodes();
  } catch (e) {
    console.warn('[perm-sync]', e);
  }
  try { await window.syncNavNodes?.(); } catch (e) { console.warn('[perm-sync]', e); }

  try {
    await showPermissoes(String(user.id), user.username);
  } finally {
    b.disabled = false; b.classList.remove('loading');
  }
});

// abrir o modal de edição reaproveitando o modal global
modal.querySelector('.js-edit')?.addEventListener('click', async (ev) => {
  const b = ev.currentTarget; b.disabled = true; b.classList.add('loading');
  try {
    // passamos os dados por NOME (funcao/setor) + roles; o menu_produto.js resolve os IDs
    const payload = {
      id: user.id,
      username: user.username,
      roles: Array.isArray(user.roles) ? user.roles : [],
      funcao: funcao || '',  // nomes já extraídos acima
      setor:  setor  || '',
      operacao: operacao || '',
      operacao_id: operacaoId,
      operacoes,
      produto_permissoes: Array.isArray(profile.produto_permissoes)
        ? profile.produto_permissoes
        : (Array.isArray(u.produto_permissoes) ? u.produto_permissoes : [])
    };
    // exposto no menu_produto.js
    if (window.openColabEdit) {
      await window.openColabEdit(payload);
      closeModal(modal); // fecha o "Detalhes", já que o de edição abre por cima
    } else {
      alert('Editor não disponível nesta página.');
    }
  } catch (e) {
    console.warn('[editar usuário]', e);
    alert('Falha ao abrir editor.');
  } finally {
    b.disabled = false; b.classList.remove('loading');
  }
});

}


/* ============ Abrir página ============ */
async function doOpen(){
  const root = findTabsRoot();
  const pane = ensurePane(root);

  try { await carregarLista(pane); }
  catch (err){
    LOG('erro:', err);
    pane.querySelector('.colab-grid').insertAdjacentHTML(
      'beforeend',
      `<div class="td" style="grid-column:1/-1;color:salmon">${String(err.message||err)}</div>`
    );
  }

  if (typeof window.showMainTab === 'function'){
    window.showMainTab('dadosColaboradores');
  } else {
    document.querySelectorAll('.tab-pane, .kanban-page').forEach(el => {
      const ativa = (el.id === 'dadosColaboradores');
      el.style.display = ativa ? 'block' : 'none';
      el.classList.toggle('active', ativa);
    });
    try { history.replaceState(null,'','#colaboradores'); } catch {}
  }
}

export function initDadosColaboradoresUI(){
  if (_inited) return;
  _inited = true;
  const btn = document.querySelector('#btn-colaboradores');
  LOG('init: botão encontrado?', !!btn, btn);
  if (!btn) return;
  if (!btn.dataset.colabBind){
    btn.addEventListener('click', (e) => { e.preventDefault(); doOpen(); });
    btn.dataset.colabBind = '1';
  }
  window.openColaboradores = doOpen; // debug
}
export const openColaboradores = doOpen;

const ensurePermStyles = (() => {
  let injected = false;
  return () => {
    if (injected) return;
    injected = true;
    const css = document.createElement('style');
    css.id = 'colabPermStyles';
    css.textContent = `
      .colab-perm-modal{position:fixed;inset:0;padding:24px;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center}
      .colab-perm-box{width:min(920px,95vw);max-height:88vh;overflow:auto;background:#161b26;border:1px solid rgba(255,255,255,.08);border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.55);padding:18px 20px;display:flex;flex-direction:column}
      .colab-perm-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
      .colab-perm-title{margin:0;font-size:18px;font-weight:600;flex:1;color:#f5f7ff}
      .colab-perm-body{flex:1;overflow:auto;padding-right:4px}
      .colab-perm-section{margin:18px 0 6px}
      .colab-perm-section:first-child{margin-top:0}
      .colab-perm-section-title{opacity:.8;font-weight:600;margin-bottom:10px;text-transform:uppercase;font-size:13px;letter-spacing:.04em}
      .colab-perm-item{display:flex;align-items:center;gap:10px;padding:6px;border-radius:8px;color:#dae0ff;transition:background .15s ease}
      .colab-perm-item:hover{background:rgba(84,120,255,.12)}
      .colab-perm-item[data-depth="0"]{font-weight:600}
      .colab-perm-item input[type="checkbox"]{width:18px;height:18px;margin:0;flex:0 0 auto;appearance:auto;border-radius:4px;accent-color:#506dff}
      .colab-perm-text{flex:1;line-height:1.35}
      .colab-perm-footer{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}
      .colab-perm-btn{padding:9px 18px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#e8ecff;font-weight:600;cursor:pointer;transition:filter .15s ease,background .15s ease,border-color .15s ease}
      .colab-perm-btn.primary{background:#2f66ff;border-color:#2f66ff;color:#fff}
      .colab-perm-btn:hover{filter:brightness(1.05)}
      .colab-perm-btn:focus-visible{outline:2px solid rgba(95,142,255,.9);outline-offset:2px}
      @media(max-width:640px){
        .colab-perm-modal{padding:12px}
        .colab-perm-box{padding:16px}
      }
    `;
    document.head.appendChild(css);
  };
})();

function renderPermissoes(nodes, currentMap) {
  // nodes: array vindo de /permissions/tree
  // currentMap: Map(key => allowed) com estado atual permitido/negado
  const byPos = { side: [], top: [] };
  nodes.forEach(n => byPos[n.pos].push(n));

  const wrap = document.createElement('div');
  wrap.className = 'perm-wrap';

  // CSS básico (somente uma vez)
  if (!document.getElementById('permCss')) {
    const css = document.createElement('style');
    css.id='permCss';
    css.textContent = `
      .perm-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center}
      .perm-box{width:min(920px,95vw);max-height:85vh;overflow:auto;background:#1f232b;border-radius:12px;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
      .perm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
      .perm-body h3{margin:12px 0 6px;font-weight:600;opacity:.9}
      .perm-item{display:flex;gap:8px;align-items:center;padding:2px 0}
      .perm-item input[type="checkbox"]{transform:scale(1.05)}
      .perm-footer{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
      .perm-lbl{opacity:.9}
      hr{border:0;border-top:1px solid rgba(255,255,255,.08);margin:12px 0}
    `;
    document.head.appendChild(css);
  }

  ['side','top'].forEach(pos => {
    const grupo = byPos[pos];
    if (!grupo.length) return;

    const header = document.createElement('h3');
    header.textContent = (pos === 'side') ? 'Menu lateral' : 'Menu superior';
    wrap.appendChild(header);

    // organiza por pai -> filhos
    const byParent = new Map(); // parent_id -> []
    const roots = [];
    grupo.forEach(n => {
      if (n.parent_id) {
        if (!byParent.has(n.parent_id)) byParent.set(n.parent_id, []);
        byParent.get(n.parent_id).push(n);
      } else {
        roots.push(n);
      }
    });

    const sortFn = (a,b) => (a.sort - b.sort) || (a.id - b.id);

    function makeItem(n, depth=0) {
      const line = document.createElement('div');
      line.className = 'perm-item';
      line.style.marginLeft = `${depth*16}px`;

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!currentMap.get(n.key);
      chk.dataset.nodeId  = n.id;
      chk.dataset.nodeKey = n.key;

      const lbl = document.createElement('span');
      lbl.className = 'perm-lbl';
      lbl.textContent = n.label;

      line.append(chk, lbl);
      wrap.appendChild(line);

      (byParent.get(n.id) || []).sort(sortFn).forEach(c => makeItem(c, depth+1));
    }

    roots.sort(sortFn).forEach(r => makeItem(r, 0));

    wrap.appendChild(document.createElement('hr')); // divisória entre grupos
  });

  return wrap;
}

// ====== Permissões: abre rápido e sincroniza em paralelo ======
async function showPermissoes(userId, username) {
  ensurePermStyles();
  // 1) Abre o modal imediatamente (skeleton)
  if (!window.__permModalEl) {
    window.__permModalEl = document.createElement('div');
    window.__permModalEl.className = 'colab-perm-modal';
    document.body.appendChild(window.__permModalEl);
  }
  const $ = window.__permModalEl;
  $.innerHTML = `
    <div class="colab-perm-box" role="dialog" aria-modal="true">
      <div class="colab-perm-head">
        <h3 class="colab-perm-title">Permissões de <span style="opacity:.7;font-weight:500">${username}</span></h3>
        <button id="permClose" class="colab-perm-btn">Fechar</button>
      </div>
      <div id="permBody" class="colab-perm-body">
        <div style="padding:24px 8px;opacity:.7;text-align:center">Carregando permissões…</div>
      </div>
      <div class="colab-perm-footer">
        <button id="permSalvar" class="colab-perm-btn primary">Salvar alterações</button>
      </div>
    </div>`;
  $.style.display = 'flex';

  $.onclick = ev => { if (ev.target === $) $.style.display = 'none'; };

  const btnFechar = $.querySelector('#permClose');
  btnFechar.onclick = () => ($.style.display='none');

  const body = $.querySelector('#permBody');

  // 2) Dispara a sync em paralelo (NÃO aguarda)
  try { window.maybeSyncNavNodes?.(); } catch {}

  // 3) Busca a árvore de permissões imediatamente
  let tree;
  try {
    const r = await fetch(`/api/users/${userId}/permissions/tree`, { credentials:'include' });
    if (!r.ok) throw new Error('HTTP '+r.status);
    tree = await r.json();
  } catch (e) {
    body.innerHTML = `<div style="color:#f66">Falha ao carregar permissões (${e.message||e}).</div>`;
    return;
  }

  // 4) Render bonitinho: “Menu lateral” / “Menu superior” com divisórias
  const byPos = { side: [], top: [] };
  for (const n of (tree.nodes || [])) byPos[n.pos]?.push(n);

  function buildTree(arr){
    const map = new Map();
    const roots = [];
    arr.forEach(item => {
      map.set(item.id, { ...item, children: [] });
    });
    map.forEach(node => {
      if (node.parent_id && map.has(node.parent_id)) {
        map.get(node.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    });
    const sortFn = (a,b)=> ((a.sort ?? 0) - (b.sort ?? 0)) || (a.label||'').localeCompare(b.label||'', 'pt');
    const sortTree = nodes => {
      nodes.sort(sortFn);
      nodes.forEach(n => sortTree(n.children));
    };
    sortTree(roots);
    return roots;
  }

  function renderSection(title, nodes){
    if (!nodes.length) return;
    const section = document.createElement('section');
    section.className = 'colab-perm-section';
    const header = document.createElement('div');
    header.className = 'colab-perm-section-title';
    header.textContent = title;
    section.appendChild(header);

    const renderNode = (node, depth=0) => {
      const row = document.createElement('label');
      row.className = 'colab-perm-item';
      row.dataset.depth = String(depth);
      if (depth > 0) row.style.marginLeft = `${depth * 16}px`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'perm-cb';
      cb.dataset.node = String(node.id);
      cb.checked = !!node.allowed;

      const span = document.createElement('span');
      span.className = 'colab-perm-text';
      span.textContent = node.label;

      row.append(cb, span);
      section.appendChild(row);
      node.children.forEach(child => renderNode(child, depth + 1));
    };

    nodes.forEach(n => renderNode(n, 0));
    body.appendChild(section);
  }

  body.innerHTML = '';
  renderSection('Menu lateral', buildTree(byPos.side));
  renderSection('Menu superior', buildTree(byPos.top));

  // 5) Salvar
  $.querySelector('#permSalvar').onclick = async () => {
    const cbs = $.querySelectorAll('.perm-cb');
    const overrides = [];
    cbs.forEach(cb => overrides.push({ node_id: Number(cb.dataset.node), allow: cb.checked }));
    const r = await fetch(`/api/users/${userId}/permissions/override`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body: JSON.stringify({ overrides })
    });
    if (!r.ok) {
      const err = await r.json().catch(()=>({}));
      alert('Falha ao salvar: ' + (err.error||r.status));
      return;
    }
    alert('Permissões salvas.');
    window.__navSync.last = 0;          // força próxima sync a enviar estado novo
    window.syncNavNodes?.(true);        // dispara uma sync forçada em background
    window.dispatchEvent(new Event('auth:changed')); // reavalia visibilidade
  };
}
