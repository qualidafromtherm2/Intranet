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
    .colab-grid{display:grid;grid-template-columns:1fr 80px 160px 240px 140px;gap:8px}
    .colab-grid .th{font-weight:600;opacity:.9;padding:8px 10px}
    .colab-grid .td{padding:8px 10px;border-radius:8px;background:var(--ds-card,rgba(255,255,255,.04))}
    .colab-grid .btn-acao{justify-self:end}
    @media(max-width:1100px){.colab-grid{grid-template-columns:1fr 70px 130px 200px 120px}}

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
      .addEventListener('click', () => carregarLista(pane));
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
    const c4 = mk('div','td', u.funcao || '—');
    const c5 = mk('div','td');
    const b  = mk('button','content-button status-button btn-acao','Detalhes');
    b.addEventListener('click', () => abrirDetalhes(u));
    c5.appendChild(b);
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
    funcao: x.funcao || x.profile?.funcao || ''
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

        <div class="sep"></div>

        <div class="row" style="grid-column:1/-1">
          <button class="btn primary js-open-perm">Permissões</button>
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
  modal.querySelectorAll('.js-close').forEach(b => b.addEventListener('click', () => closeModal(modal)));

  // 👉 NOVO: abre o editor moderno de permissões (aquele com “Menu lateral / Menu superior”)
  modal.querySelector('.js-open-perm').addEventListener('click', async () => {
    try {
      // garante que os nós atuais do DOM já estejam no SQL antes de abrir
      if (window.syncNavNodes) await window.syncNavNodes();
    } catch (e) {
      console.warn('[perm-sync]', e);
    }
    await showPermissoes(String(user.id), user.username);
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

async function showPermissoes(userId, username) {
  try {
    // 1) Garante que os nós atuais do DOM já estejam no SQL
    if (window.syncNavNodes) await window.syncNavNodes();

    // 2) Busca a árvore de permissões do usuário alvo
    const resp = await fetch(`/api/users/${userId}/permissions/tree`, { credentials:'include' });
    if (!resp.ok) {
      const err = await resp.json().catch(()=>({}));
      alert(err.error || 'Sem permissão para ver as permissões deste usuário.');
      return;
    }
    const data  = await resp.json();
    const nodes = data.nodes || [];

    // 3) Estado atual (Map por key)
    const current = new Map(nodes.map(n => [n.key, !!n.allowed]));

    // 4) Cria/abre modal
    let modal = document.getElementById('permModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'permModal';
      modal.className = 'perm-modal';
      modal.innerHTML = `
        <div class="perm-box">
          <div class="perm-head">
            <strong>Permissões de <span id="permUser"></span></strong>
            <button type="button" class="perm-close">×</button>
          </div>
          <div class="perm-body"></div>
          <div class="perm-footer">
            <button class="content-button status-button perm-save">Salvar alterações</button>
            <button class="content-button perm-cancel">Fechar</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('.perm-close').onclick =
      modal.querySelector('.perm-cancel').onclick = () => modal.remove();
    }
    modal.querySelector('#permUser').textContent = username || userId;

    const body = modal.querySelector('.perm-body');
    body.innerHTML = '';
    body.appendChild(renderPermissoes(nodes, current));

    modal.style.display = 'flex';

    // 5) Salvar
    const saveBtn = modal.querySelector('.perm-save');
    saveBtn.onclick = async () => {
      const changes = [];
      body.querySelectorAll('input[type="checkbox"][data-node-id]').forEach(chk => {
        const key = chk.dataset.nodeKey;
        const novo = !!chk.checked;
        if (current.get(key) !== novo) {
          changes.push({ node_id: Number(chk.dataset.nodeId), allow: novo });
        }
      });

      try {
        if (changes.length) {
          const r = await fetch(`/api/users/${userId}/permissions`, {
            method:'POST',
            headers:{ 'Content-Type':'application/json' },
            credentials:'include',
            body: JSON.stringify({ changes })
          });
          if (!r.ok) throw new Error('HTTP '+r.status);
        }
        // força UI a reavaliar (menus/botões com perm-hidden)
        window.dispatchEvent(new Event('auth:changed'));
        alert('Permissões salvas!');
        modal.remove();
      } catch (e) {
        console.error('[perm-save]', e);
        alert('Falha ao salvar permissões.');
      }
    };
  } catch (e) {
    console.error('[showPermissoes]', e);
    alert('Erro ao abrir permissões.');
  }
}

