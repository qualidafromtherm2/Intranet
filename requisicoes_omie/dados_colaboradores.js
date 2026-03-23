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
        <div class="row"><label>E-mail</label><div>${user.email || '—'}</div></div>
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
      email: user.email || '',
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
      /* ======= OVERLAY DO MODAL ======= */
      .colab-perm-modal{position:fixed;inset:0;padding:24px;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)}

      /* ======= CAIXA PRINCIPAL ======= */
      .colab-perm-box{width:min(780px,95vw);max-height:88vh;background:#161b26;border:1px solid rgba(255,255,255,.08);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden}

      /* ======= CABEÇALHO ======= */
      .colab-perm-head{display:flex;align-items:center;gap:12px;padding:20px 24px 16px;border-bottom:1px solid rgba(255,255,255,.06)}
      .colab-perm-title{margin:0;font-size:17px;font-weight:600;flex:1;color:#f5f7ff}
      .colab-perm-title span{opacity:.6;font-weight:400}

      /* ======= BARRA DE BUSCA ======= */
      .colab-perm-search-wrap{padding:12px 24px 8px}
      .colab-perm-search{width:100%;padding:9px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#e8ecff;font-size:14px;outline:none;transition:border-color .2s}
      .colab-perm-search::placeholder{color:rgba(255,255,255,.3)}
      .colab-perm-search:focus{border-color:rgba(80,109,255,.5)}

      /* ======= CORPO SCROLLÁVEL ======= */
      .colab-perm-body{flex:1;overflow-y:auto;padding:8px 24px 16px;scroll-behavior:smooth}
      .colab-perm-body::-webkit-scrollbar{width:6px}
      .colab-perm-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}

      /* ======= GRUPO (seção: Menu lateral / Menu superior / Telas Produto) ======= */
      .colab-perm-group{margin-bottom:20px}
      .colab-perm-group:last-child{margin-bottom:0}
      .colab-perm-group-header{display:flex;align-items:center;gap:8px;padding:8px 0 6px;cursor:default}
      .colab-perm-group-label{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.45)}
      .colab-perm-group-line{flex:1;height:1px;background:rgba(255,255,255,.06)}
      .colab-perm-group-count{font-size:11px;color:rgba(255,255,255,.3);font-variant-numeric:tabular-nums}

      /* ======= CATEGORIA (pai) ======= */
      .colab-perm-cat{margin:4px 0 2px;border-radius:10px;background:rgba(255,255,255,.02);overflow:hidden;transition:background .15s}
      .colab-perm-cat:hover{background:rgba(255,255,255,.035)}
      .colab-perm-cat-head{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;user-select:none}
      .colab-perm-cat-head .perm-arrow{width:16px;height:16px;color:rgba(255,255,255,.35);transition:transform .2s;flex-shrink:0}
      .colab-perm-cat.open .perm-arrow{transform:rotate(90deg)}

      /* ======= ITEM (checkbox) ======= */
      .colab-perm-item{display:flex;align-items:center;gap:10px;padding:7px 14px;border-radius:8px;color:#dae0ff;transition:background .12s;cursor:pointer;user-select:none}
      .colab-perm-item:hover{background:rgba(80,109,255,.08)}
      .colab-perm-item.is-parent{font-weight:600;color:#f0f2ff}
      .colab-perm-item.is-child{padding-left:24px;font-size:14px;color:rgba(218,224,255,.85)}
      .colab-perm-item input[type="checkbox"]{width:18px;height:18px;margin:0;flex:0 0 auto;accent-color:#506dff;cursor:pointer}
      .colab-perm-text{flex:1;line-height:1.35}
      .colab-perm-item.hidden-by-search{display:none}

      /* ======= FILHOS OCULTOS (colapsado) ======= */
      .colab-perm-children{overflow:hidden;max-height:0;transition:max-height .25s ease;padding-left:18px}
      .colab-perm-cat.open > .colab-perm-children{max-height:3000px}

      /* ======= RODAPÉ ======= */
      .colab-perm-footer{display:flex;gap:10px;justify-content:space-between;align-items:center;padding:14px 24px;border-top:1px solid rgba(255,255,255,.06)}
      .colab-perm-footer-left{display:flex;gap:8px}
      .colab-perm-footer-right{display:flex;gap:8px}

      /* ======= BOTÕES ======= */
      .colab-perm-btn{padding:9px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#e8ecff;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
      .colab-perm-btn:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.18)}
      .colab-perm-btn:focus-visible{outline:2px solid rgba(95,142,255,.7);outline-offset:2px}
      .colab-perm-btn.primary{background:#2f66ff;border-color:#2f66ff;color:#fff}
      .colab-perm-btn.primary:hover{background:#3d73ff}
      .colab-perm-btn.danger{background:rgba(255,80,80,.12);border-color:rgba(255,80,80,.2);color:#ff8080}
      .colab-perm-btn.danger:hover{background:rgba(255,80,80,.18)}
      .colab-perm-btn .btn-icon{font-size:15px;vertical-align:middle;margin-right:4px}
      .colab-perm-btn.saving{pointer-events:none;opacity:.6}

      /* ======= VAZIO / ERRO ======= */
      .colab-perm-empty{padding:32px 16px;text-align:center;color:rgba(255,255,255,.35);font-size:14px}

      /* ======= RESPONSIVO ======= */
      @media(max-width:640px){
        .colab-perm-modal{padding:10px}
        .colab-perm-box{border-radius:12px}
        .colab-perm-head,.colab-perm-body,.colab-perm-footer,.colab-perm-search-wrap{padding-left:14px;padding-right:14px}
        .colab-perm-item.is-child{padding-left:28px}
      }
    `;
    document.head.appendChild(css);
  };
})();

// ====== SVG Helper ======
const ARROW_SVG = `<svg class="perm-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 4l4 4-4 4"/></svg>`;

// ====== Permissões: abre rápido e sincroniza em paralelo ======
async function showPermissoes(userId, username) {
  ensurePermStyles();

  // 1) Cria ou reutiliza o container do modal
  if (!window.__permModalEl) {
    window.__permModalEl = document.createElement('div');
    window.__permModalEl.className = 'colab-perm-modal';
    document.body.appendChild(window.__permModalEl);
  }
  const $ = window.__permModalEl;
  $.innerHTML = `
    <div class="colab-perm-box" role="dialog" aria-modal="true">
      <div class="colab-perm-head">
        <h3 class="colab-perm-title">Permissões de <span>${username}</span></h3>
        <button id="permClose" class="colab-perm-btn">✕ Fechar</button>
      </div>
      <div class="colab-perm-search-wrap">
        <input id="permSearch" class="colab-perm-search" type="text" placeholder="Buscar permissão…" autocomplete="off">
      </div>
      <div id="permBody" class="colab-perm-body">
        <div class="colab-perm-empty">Carregando permissões…</div>
      </div>
      <div class="colab-perm-footer">
        <div class="colab-perm-footer-left">
          <button id="permMarcarTodos" class="colab-perm-btn"><span class="btn-icon">☑</span> Marcar Todos</button>
          <button id="permDesmarcarTodos" class="colab-perm-btn danger"><span class="btn-icon">☐</span> Desmarcar Todos</button>
        </div>
        <div class="colab-perm-footer-right">
          <button id="permSalvar" class="colab-perm-btn primary"><span class="btn-icon">💾</span> Salvar alterações</button>
        </div>
      </div>
    </div>`;
  $.style.display = 'flex';

  // Fechar ao clicar fora ou no botão
  $.onclick = ev => { if (ev.target === $) $.style.display = 'none'; };
  $.querySelector('#permClose').onclick = () => ($.style.display = 'none');

  const body = $.querySelector('#permBody');

  // 2) Sync em paralelo (não aguarda)
  try { window.maybeSyncNavNodes?.(); } catch {}

  // 3) Busca a árvore de permissões
  let tree;
  try {
    const r = await fetch(`/api/users/${userId}/permissions/tree`, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    tree = await r.json();
  } catch (e) {
    body.innerHTML = `<div class="colab-perm-empty" style="color:#f66">Falha ao carregar permissões (${e.message || e}).</div>`;
    return;
  }

  // 4) Organiza nós por posição
  const posLabels = { side: 'Menu lateral', top: 'Menu superior' };
  const byPos = {};
  for (const n of (tree.nodes || [])) {
    const pos = n.pos || 'side';
    if (!byPos[pos]) byPos[pos] = [];
    byPos[pos].push(n);
  }

  // Monta árvore: pai → filhos
  function buildTree(arr) {
    const map = new Map();
    const roots = [];
    arr.forEach(item => map.set(item.id, { ...item, children: [] }));
    map.forEach(node => {
      if (node.parent_id && map.has(node.parent_id)) {
        map.get(node.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    });
    const sortFn = (a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || (a.label || '').localeCompare(b.label || '', 'pt');
    const sortTree = nodes => { nodes.sort(sortFn); nodes.forEach(n => sortTree(n.children)); };
    sortTree(roots);
    return roots;
  }

  // 5) Renderiza cada grupo de posição (recursivo para sub-níveis)
  body.innerHTML = '';
  const allCheckboxes = [];
  const nodeMap = new Map();       // id → { cb, childrenEl }
  const parentLookup = new Map();  // child_id → parent_id

  function buildParentLookupFromRoots(roots) {
    for (const r of roots) {
      for (const c of r.children) {
        parentLookup.set(c.id, r.id);
        buildParentLookupFromRoots([c]);
      }
    }
  }

  // Propaga estado para cima (indeterminate nos pais)
  function bubbleUp(nodeId) {
    const pid = parentLookup.get(nodeId);
    if (!pid) return;
    const entry = nodeMap.get(pid);
    if (!entry) return;
    const directCbs = Array.from(
      entry.childrenEl.querySelectorAll(
        ':scope > .colab-perm-cat > .colab-perm-cat-head .perm-cb, :scope > .colab-perm-item > .perm-cb'
      )
    );
    const total = directCbs.length;
    const checked = directCbs.filter(c => c.checked).length;
    const hasIndet = directCbs.some(c => c.indeterminate);
    entry.cb.checked = checked > 0;
    entry.cb.indeterminate = (checked > 0 && checked < total) || hasIndet;
    bubbleUp(pid);
  }

  // Renderiza um nó (recursivo)
  function renderNode(node, container, depth) {
    const hasChildren = node.children.length > 0;

    if (hasChildren) {
      const cat = document.createElement('div');
      cat.className = 'colab-perm-cat' + (depth === 0 ? ' open' : '');

      const catHead = document.createElement('div');
      catHead.className = 'colab-perm-cat-head';

      const parentLabel = document.createElement('label');
      parentLabel.className = 'colab-perm-item is-parent';
      parentLabel.style.padding = '0';
      parentLabel.style.flex = '1';

      const parentCb = document.createElement('input');
      parentCb.type = 'checkbox';
      parentCb.className = 'perm-cb';
      parentCb.dataset.node = String(node.id);
      parentCb.checked = !!node.allowed;
      allCheckboxes.push(parentCb);

      const parentSpan = document.createElement('span');
      parentSpan.className = 'colab-perm-text';
      parentSpan.textContent = node.label;

      parentLabel.append(parentCb, parentSpan);
      catHead.innerHTML = ARROW_SVG;
      catHead.appendChild(parentLabel);
      cat.appendChild(catHead);

      const childrenEl = document.createElement('div');
      childrenEl.className = 'colab-perm-children';

      for (const child of node.children) {
        renderNode(child, childrenEl, depth + 1);
      }

      cat.appendChild(childrenEl);
      container.appendChild(cat);

      nodeMap.set(node.id, { cb: parentCb, childrenEl });

      // Toggle expandir/colapsar
      catHead.querySelector('.perm-arrow').addEventListener('click', (e) => {
        e.stopPropagation();
        cat.classList.toggle('open');
      });

      // Checkbox pai: marca/desmarca TODOS os descendentes
      parentCb.addEventListener('change', () => {
        childrenEl.querySelectorAll('.perm-cb').forEach(cb => {
          cb.checked = parentCb.checked;
          cb.indeterminate = false;
        });
        bubbleUp(node.id);
        atualizarContadores();
      });

    } else {
      const itemLabel = document.createElement('label');
      itemLabel.className = depth === 0 ? 'colab-perm-item is-parent' : 'colab-perm-item is-child';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'perm-cb';
      cb.dataset.node = String(node.id);
      cb.checked = !!node.allowed;
      allCheckboxes.push(cb);

      const span = document.createElement('span');
      span.className = 'colab-perm-text';
      span.textContent = node.label;

      itemLabel.append(cb, span);
      container.appendChild(itemLabel);

      cb.addEventListener('change', () => {
        bubbleUp(node.id);
        atualizarContadores();
      });
    }
  }

  // Calcula estado indeterminate de baixo para cima após renderizar
  function initIndeterminate(nodes) {
    for (const n of nodes) {
      if (n.children.length > 0) {
        initIndeterminate(n.children);
        const entry = nodeMap.get(n.id);
        if (!entry) continue;
        const directCbs = Array.from(
          entry.childrenEl.querySelectorAll(
            ':scope > .colab-perm-cat > .colab-perm-cat-head .perm-cb, :scope > .colab-perm-item > .perm-cb'
          )
        );
        const total = directCbs.length;
        const checked = directCbs.filter(c => c.checked).length;
        const hasIndet = directCbs.some(c => c.indeterminate);
        entry.cb.checked = checked > 0;
        entry.cb.indeterminate = (checked > 0 && checked < total) || hasIndet;
      }
    }
  }

  const posOrder = ['side', 'top'];
  for (const pos of posOrder) {
    const nodes = byPos[pos];
    if (!nodes || !nodes.length) continue;

    const groupEl = document.createElement('div');
    groupEl.className = 'colab-perm-group';

    const header = document.createElement('div');
    header.className = 'colab-perm-group-header';
    header.innerHTML = `
      <span class="colab-perm-group-label">${posLabels[pos] || pos}</span>
      <div class="colab-perm-group-line"></div>
      <span class="colab-perm-group-count"></span>
    `;
    groupEl.appendChild(header);

    const roots = buildTree(nodes);
    buildParentLookupFromRoots(roots);

    for (const root of roots) {
      renderNode(root, groupEl, 0);
    }

    initIndeterminate(roots);
    body.appendChild(groupEl);
  }

  // 6) Contadores
  function atualizarContadores() {
    body.querySelectorAll('.colab-perm-group').forEach(group => {
      const cbs = group.querySelectorAll('.perm-cb');
      const marcados = Array.from(cbs).filter(c => c.checked).length;
      const countEl = group.querySelector('.colab-perm-group-count');
      if (countEl) countEl.textContent = `${marcados}/${cbs.length} ativos`;
    });
  }
  atualizarContadores();

  // 7) Busca em tempo real
  const searchInput = $.querySelector('#permSearch');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    body.querySelectorAll('.colab-perm-cat').forEach(cat => {
      const items = cat.querySelectorAll('.colab-perm-item');
      let hasVisible = false;
      items.forEach(item => {
        const text = item.querySelector('.colab-perm-text')?.textContent?.toLowerCase() || '';
        const match = !q || text.includes(q);
        item.classList.toggle('hidden-by-search', !match);
        if (match) hasVisible = true;
      });
      cat.style.display = hasVisible ? '' : 'none';
      if (q && hasVisible) cat.classList.add('open');
    });
    body.querySelectorAll('.colab-perm-group > .colab-perm-item').forEach(item => {
      const text = item.querySelector('.colab-perm-text')?.textContent?.toLowerCase() || '';
      item.classList.toggle('hidden-by-search', q && !text.includes(q));
    });
  });

  // 8) Marcar Todos / Desmarcar Todos
  $.querySelector('#permMarcarTodos').onclick = () => {
    allCheckboxes.forEach(cb => { cb.checked = true; cb.indeterminate = false; });
    atualizarContadores();
  };
  $.querySelector('#permDesmarcarTodos').onclick = () => {
    allCheckboxes.forEach(cb => { cb.checked = false; cb.indeterminate = false; });
    atualizarContadores();
  };

  // 9) Salvar
  $.querySelector('#permSalvar').onclick = async () => {
    const btn = $.querySelector('#permSalvar');
    btn.classList.add('saving');
    btn.textContent = 'Salvando…';
    const overrides = allCheckboxes.map(cb => ({ node_id: Number(cb.dataset.node), allow: cb.checked }));
    try {
      const r = await fetch(`/api/users/${userId}/permissions/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ overrides })
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        alert('Falha ao salvar: ' + (err.error || r.status));
        return;
      }
      alert('Permissões salvas com sucesso!');
      window.__navSync.last = 0;
      window.syncNavNodes?.(true);
      window.dispatchEvent(new Event('auth:changed'));
    } catch (e) {
      alert('Erro ao salvar: ' + (e.message || e));
    } finally {
      btn.classList.remove('saving');
      btn.innerHTML = '<span class="btn-icon">💾</span> Salvar alterações';
    }
  };
}
