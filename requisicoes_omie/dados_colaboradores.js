// SEM forçar porta; mesma origem
const API_BASE = '';
const COLAB_LOG = (...a) => console.log('[COLAB]', ...a);

export function initDadosColaboradoresUI() {
  if (window.__colabInitDone) { COLAB_LOG('init: já inicializado'); return; }
  window.__colabInitDone = true;
  COLAB_LOG('init: começando');

  // Botão do menu lateral
  const btn = document.querySelector(
    '#btn-colaboradores, [data-colab="colab"], [data-nav="colaboradores"], a[href="#colaboradores"]'
  );
  COLAB_LOG('init: botão encontrado?', !!btn, btn);

  const onClick = (ev) => {
    COLAB_LOG('click: capturado', { target: ev.target, currentTarget: ev.currentTarget });
    try { ev.preventDefault(); } catch {}
    openColaboradores();
  };

  if (btn) {
    if (!btn.dataset.colabBind) {
      btn.dataset.colabBind = '1';
      btn.addEventListener('click', onClick);
      COLAB_LOG('init: listener vinculado ao botão');
    } else {
      COLAB_LOG('init: botão já tinha listener');
    }
  } else {
    // fallback por delegação
    COLAB_LOG('init: botão não encontrado — delegação por texto');
    document.addEventListener('click', (ev) => {
      const a = ev.target.closest('a,button,.main-header-link,.side-menu a');
      if (!a) return;
      const txt = (a.textContent || '').toLowerCase();
      if (/colaborador/.test(txt) || a.id === 'btn-colaboradores' || a.dataset.colab === 'colab') {
        COLAB_LOG('delegation: clique detectado em', a);
        try { ev.preventDefault(); } catch {}
        openColaboradores();
      }
    }, true);
  }

  // ⬇️ AQUI ESTÁ O AJUSTE DE RAIZ
  function findTabsRoot() {
    // Preferimos o mesmo container onde vivem as abas principais como #listaProdutos e #paginaInicio
    const lp = document.getElementById('listaProdutos');
    if (lp?.parentElement) {
      COLAB_LOG('findTabsRoot: usando parent de #listaProdutos', lp.parentElement);
      return lp.parentElement;
    }
    const pi = document.getElementById('paginaInicio');
    if (pi?.parentElement) {
      COLAB_LOG('findTabsRoot: usando parent de #paginaInicio', pi.parentElement);
      return pi.parentElement;
    }
    // Caso extremo: pega um container que contenha .tab-pane mas NÃO esteja dentro de #produtoTabs .tab-content
    const candidates = Array.from(document.querySelectorAll('.tab-pane'))
      .map(p => p.parentElement)
      .filter(el => el && !el.closest('#produtoTabs .tab-content'));
    const root = candidates[0] || document.body;
    COLAB_LOG('findTabsRoot: candidato backup =', root);
    return root;
  }

  function hideSiblings(root, pane) {
    // Esconde apenas irmãos de primeiro nível
    const siblings = root.querySelectorAll(':scope > .tab-pane');
    COLAB_LOG('hideSiblings: total panes =', siblings.length);
    siblings.forEach(p => {
      if (p === pane) return;
      p.classList.remove('active');
      p.style.display = 'none';
    });
  }

  function ensurePane(root) {
    let pane = document.getElementById('dadosColaboradores');
    if (pane && pane.parentElement !== root) {
      COLAB_LOG('ensurePane: movendo pane para o contêiner correto');
      pane.parentElement?.removeChild(pane);
      root.appendChild(pane);
    }
    if (!pane) {
      COLAB_LOG('ensurePane: criando pane');
      pane = document.createElement('div');
      pane.id = 'dadosColaboradores';
      pane.className = 'tab-pane';
      pane.innerHTML = `
        <div class="content-wrapper">
          <div class="content-section">
            <div class="title-wrapper">
              <div class="content-section-title">Colaboradores</div>
              <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
                <input id="filtroColab" placeholder="Filtrar por usuário/ID/role"
                       style="padding:6px 10px;border-radius:10px;border:1px solid #ddd;min-width:260px"/>
                <button id="btnRecarregarColab" class="content-button status-button">Recarregar</button>
              </div>
            </div>
            <ul id="colaboradoresList" class="grid-pecas" style="list-style:none;margin:12px 0;padding:0"></ul>
          </div>
        </div>
      `;
      root.appendChild(pane);
    } else {
      COLAB_LOG('ensurePane: reutilizando pane existente');
    }

    // Força visibilidade no layout principal
    pane.classList.add('active');
    pane.style.display   = 'block';
    pane.style.flex      = '1 1 auto';
    pane.style.width     = '100%';
    pane.style.minHeight = '40vh';
    pane.style.overflow  = 'auto';
    pane.style.zIndex    = '1';

    return pane;
  }

async function carregarLista(pane) {
  const ul     = pane.querySelector('#colaboradoresList');
  const filtro = pane.querySelector('#filtroColab');
  const btnRel = pane.querySelector('#btnRecarregarColab');

  ul.innerHTML = '<li>Carregando…</li>';

  // status para saber se pode editar roles
  let isAdmin = false;
  try {
    const st = await fetch('/api/auth/status', { credentials: 'include' });
    const sj = st.ok ? await st.json() : { loggedIn:false };
    isAdmin = !!(sj?.user?.roles || []).includes('admin');
  } catch {}

  try {
    const resp = await fetch(`/api/users`, { credentials: 'include' });
    if (!resp.ok) {
      const txt = await resp.text().catch(()=> '');
      ul.innerHTML = `<li>Falha ao listar usuários (HTTP ${resp.status}) ${txt}</li>`;
      return;
    }

    const data  = await resp.json();
    const users = Array.isArray(data) ? data : (data.users || data.data || data.items || []);

    const render = () => {
      ul.innerHTML = '';

      const termos = (filtro.value || '').toLowerCase().trim().split(/\s+/).filter(Boolean);

      // cabeçalho
      const header = document.createElement('li');
      header.className = 'header-row';
      header.style.display = 'grid';
      header.style.gridTemplateColumns = '200px 120px 1fr 120px';
      header.style.gap = '8px';
      header.style.alignItems = 'center';
      header.innerHTML = `
        <div><b>Usuário</b></div>
        <div><b>ID</b></div>
        <div><b>Perfis (roles)</b></div>
        <div style="text-align:center"><b>Ação</b></div>
      `;
      ul.appendChild(header);

      users
        .filter(u => {
          if (!termos.length) return true;
          const hay = `${u.username||''} ${u.id||''} ${(u.roles||[]).join(' ')}`.toLowerCase();
          return termos.every(t => hay.includes(t));
        })
        .forEach(u => {
          const li = document.createElement('li');
          li.style.display = 'grid';
          li.style.gridTemplateColumns = '200px 120px 1fr 120px';
          li.style.gap = '8px';
          li.style.alignItems = 'center';
          li.style.padding = '6px 0';
          li.innerHTML = `
            <div class="col-username" title="${(u.username||'')}">${(u.username||'')}</div>
            <div class="col-id"       title="${(u.id||'')}">${(u.id||'')}</div>
            <div class="col-roles"    title="${(u.roles||[]).join(', ')}">${(u.roles||[]).join(', ')}</div>
            <div class="acao" style="text-align:center">
              <button type="button" class="content-button status-button ver-detalhes" data-username="${(u.username||'')}">
                Detalhes
              </button>
            </div>
          `;
          ul.appendChild(li);
        });

      if (ul.children.length <= 1) ul.innerHTML += '<li>Nenhum usuário encontrado.</li>';
    };

    render();

    // filtro & recarregar
    filtro.oninput = render;
    btnRel.onclick = async () => {
      // reconsulta do servidor
      const r = await fetch(`/api/users`, { credentials:'include' });
      const j = r.ok ? await r.json() : [];
      const arr = Array.isArray(j) ? j : (j.users || j.data || j.items || []);
      users.splice(0, users.length, ...arr);
      render();
    };

    // ——— clique em DETALHES (abre modal) ———
    ul.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.ver-detalhes');
      if (!btn) return;

      const username = btn.dataset.username;
      const user = users.find(u => String(u.username) === String(username));
      if (!user) return;

      _openUserDetailsModal(user, {
        isAdmin,
        onSaved: ({ roles }) => {
          // se alterou roles, reflete na linha
          if (roles) {
            const row = btn.closest('li');
            if (row) row.querySelector('.col-roles').textContent = roles.join(', ');
            // também atualiza o objeto em memória para o filtro refletir
            const target = users.find(u => u.username === user.username);
            if (target) target.roles = roles;
          }
        }
      });
    });

  } catch (err) {
    console.error('[Colaboradores] erro:', err);
    ul.innerHTML = `<li>Erro ao carregar: ${err.message||err}</li>`;
  }
}


  // injeta estilos do modal (uma vez)
function _ensureColabModalStyles() {
  if (document.getElementById('colab-modal-styles')) return;
  const css = document.createElement('style');
  css.id = 'colab-modal-styles';
  css.textContent = `
    .colab-modal-backdrop{
      position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:8000;
      display:none; align-items:center; justify-content:center; padding:24px;
    }
    .colab-modal{
      width:520px; max-width:100%; background:#1f2430; color:#eaeaea; border-radius:14px;
      box-shadow:0 12px 36px rgba(0,0,0,.35); overflow:hidden;
      border:1px solid rgba(255,255,255,.08);
    }
    .colab-modal header{
      padding:14px 18px; font-weight:600; background:#232938; border-bottom:1px solid rgba(255,255,255,.06);
    }
    .colab-modal .body{ padding:16px 18px; display:grid; gap:12px; }
    .colab-modal .row{ display:grid; grid-template-columns:140px 1fr; gap:10px; align-items:center; }
    .colab-modal .row input[type="text"],
    .colab-modal .row input[type="password"]{
      background:#131722; border:1px solid rgba(255,255,255,.12); color:#eaeaea; border-radius:10px; padding:8px 10px;
    }
    .colab-modal .roles { display:flex; gap:10px; flex-wrap:wrap; }
    .colab-modal footer{ padding:12px 18px; display:flex; gap:10px; justify-content:flex-end; background:#232938; border-top:1px solid rgba(255,255,255,.06); }
    .btn{ padding:8px 14px; border-radius:10px; border:0; cursor:pointer }
    .btn.primary{ background:#3b82f6; color:#fff; }
    .btn.ghost{ background:transparent; color:#eaeaea; border:1px solid rgba(255,255,255,.18); }
  `;
  document.head.appendChild(css);
}

function _openUserDetailsModal(user, { isAdmin, onSaved } = {}) {
  _ensureColabModalStyles();

  let backdrop = document.getElementById('colabModal');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'colabModal';
    backdrop.className = 'colab-modal-backdrop';
    document.body.appendChild(backdrop);
  }

  backdrop.innerHTML = `
    <div class="colab-modal" role="dialog" aria-modal="true">
      <header>Detalhes do usuário</header>
      <div class="body">

        <!-- VIEW: DETALHES -->
        <div class="view view-details">
          <div class="row"><div>Usuário</div><input id="cm-username" type="text" readonly></div>
          <div class="row"><div>ID</div><input id="cm-id" type="text" readonly></div>

          <div class="row"><div>Setor</div>
            <div style="display:flex; gap:6px; align-items:center;">
              <select id="cm-setor" class="cm-select"></select>
              <button class="btn" id="cm-setor-add" title="Adicionar setor">+</button>
            </div>
          </div>

          <div class="row"><div>Função</div>
            <div style="display:flex; gap:6px; align-items:center;">
              <select id="cm-funcao" class="cm-select"></select>
              <button class="btn" id="cm-funcao-add" title="Adicionar função">+</button>
            </div>
          </div>

          <div class="row"><div>Perfis (roles)</div>
            <div class="roles">
              <label><input id="cm-role-admin"  type="checkbox" value="admin"> admin</label>
              <label><input id="cm-role-editor" type="checkbox" value="editor"> editor</label>
            </div>
          </div>

          <div class="row"><div>Nova senha</div><input id="cm-pass" type="password" placeholder="deixe vazio para não alterar"></div>

          <div class="row"><div>Permissões</div>
            <button class="btn ghost" id="cm-perms">Permissões…</button>
          </div>
        </div>

        <!-- VIEW: PERMISSÕES -->
        <div class="view view-perms" style="display:none">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
            <div style="font-weight:600">Permissões</div>
            <div>
              <button class="btn ghost" id="cm-perm-back">Voltar</button>
              <button class="btn primary" id="cm-perm-save">Salvar permissões</button>
            </div>
          </div>
          <div id="permTree" style="max-height:52vh; overflow:auto; padding:6px 2px;"></div>
        </div>

      </div>
      <footer>
        <button class="btn ghost" id="cm-cancel">Fechar</button>
        <button class="btn primary" id="cm-save">Salvar</button>
      </footer>
    </div>
  `;

  // CSS extra p/ separadores
  if (!document.getElementById('perm-style')) {
    const st = document.createElement('style');
    st.id = 'perm-style';
    st.textContent = `
      .colab-modal .perm-sep { border:0; border-top:1px solid #ddd; margin:10px 0; }
      .colab-modal .perm-group-title { font-weight:600; opacity:.8; margin:6px 0 4px; }
    `;
    document.head.appendChild(st);
  }

  const $ = (q) => backdrop.querySelector(q);
  const viewDetails = backdrop.querySelector('.view-details');
  const viewPerms   = backdrop.querySelector('.view-perms');
  const footerSaveBtn = $('#cm-save');

  function showDetails(){
    viewDetails.style.display = '';
    viewPerms.style.display   = 'none';
    footerSaveBtn.style.display = ''; // exibe "Salvar"
  }
  function showPerms(){
    viewDetails.style.display = 'none';
    viewPerms.style.display   = '';
    footerSaveBtn.style.display = 'none'; // esconde "Salvar" da view de detalhes
  }

  // Preenche campos fixos
  $('#cm-username').value = user.username || '';
  $('#cm-id').value = String(user.id || '');

  // Roles
  const chkAdmin  = $('#cm-role-admin');
  const chkEditor = $('#cm-role-editor');
  const rolesSet = new Set((user.roles || []).map(String));
  chkAdmin.checked  = rolesSet.has('admin');
  chkEditor.checked = rolesSet.has('editor');
  chkAdmin.disabled = chkEditor.disabled = !isAdmin;

  const passInput = $('#cm-pass');

  // Lookups & perfil (cache local p/ não perder ao alternar)
  let cacheLookups = null;
  let cacheProfile = null;

  (async () => {
    try {
      const [lk, pf] = await Promise.all([
        fetch('/api/users/lookups', { credentials:'include' }).then(r=>r.json()),
        fetch(`/api/users/${user.id}/profile`, { credentials:'include' }).then(r=>r.json())
      ]);
      cacheLookups = lk;
      cacheProfile = pf;

      const setorSel  = $('#cm-setor');
      const funcaoSel = $('#cm-funcao');
      function fillSelect(sel, opts, current) {
        sel.innerHTML = `<option value="">(não informado)</option>` +
          (opts||[]).map(o => `<option value="${o.name}">${o.name}</option>`).join('');
        if (current) sel.value = current;
      }
      fillSelect(setorSel,  lk.setores, pf?.setor);
      fillSelect(funcaoSel, lk.funcoes, pf?.funcao);

      const me = window.__sessionUser;
      const isSelf = me && String(me.id) === String(user.id);
      const canEditProfile = isAdmin || isSelf;
      setorSel.disabled  = !canEditProfile;
      funcaoSel.disabled = !canEditProfile;

      // botões "+" (somente admin)
      $('#cm-setor-add').disabled  = !isAdmin;
      $('#cm-funcao-add').disabled = !isAdmin;

      $('#cm-setor-add').onclick = async () => {
        const name = prompt('Nome do novo setor:')?.trim();
        if (!name) return;
        const r = await fetch('/api/users/lookups/sector', {
          method:'POST', headers:{'Content-Type':'application/json'},
          credentials:'include', body: JSON.stringify({ name })
        });
        if (!r.ok) return alert('Falha ao criar setor.');
        const data = await r.json();
        cacheLookups.setores = data.setores;
        fillSelect(setorSel, data.setores, name);
      };

      $('#cm-funcao-add').onclick = async () => {
        const name = prompt('Nome da nova função:')?.trim();
        if (!name) return;
        const r = await fetch('/api/users/lookups/funcao', {
          method:'POST', headers:{'Content-Type':'application/json'},
          credentials:'include', body: JSON.stringify({ name })
        });
        if (!r.ok) return alert('Falha ao criar função.');
        const data = await r.json();
        cacheLookups.funcoes = data.funcoes;
        fillSelect(funcaoSel, data.funcoes, name);
      };

    } catch (e) {
      console.warn('[modal] lookups/profile falhou', e);
    }
  })();

  // Salvar (DETALHES)
  footerSaveBtn.onclick = async () => {
    try {
      const payloadUser = {};
      const newRoles = [];
      if (chkAdmin.checked)  newRoles.push('admin');
      if (chkEditor.checked) newRoles.push('editor');
      if (isAdmin) payloadUser.roles = newRoles;
      const newPass = passInput.value.trim();
      if (newPass) payloadUser.password = newPass;

      if (Object.keys(payloadUser).length) {
        const r = await fetch(`/api/users/${user.id}`, {
          method:'PUT', headers:{'Content-Type':'application/json'},
          credentials:'include', body: JSON.stringify(payloadUser)
        });
        if (!r.ok) throw new Error(await r.text());
      }

      const setorSel  = $('#cm-setor');
      const funcaoSel = $('#cm-funcao');
      if (setorSel || funcaoSel) {
        const setor  = setorSel ? (setorSel.value || null) : null;
        const funcao = funcaoSel ? (funcaoSel.value || null) : null;
        if (setor !== null || funcao !== null) {
          const r2 = await fetch(`/api/users/${user.id}/profile`, {
            method:'PUT', headers:{'Content-Type':'application/json'},
            credentials:'include', body: JSON.stringify({ setor, funcao })
          });
          if (!r2.ok) throw new Error(await r2.text());
        }
      }

      onSaved?.({ roles: (isAdmin ? newRoles : user.roles) });
      alert('Alterações salvas.');
      backdrop.style.display = 'none';
    } catch (err) {
      alert(err.message || 'Erro ao salvar.');
      console.error('[modal save]', err);
    }
  };

  // --- PERMISSÕES ---
  let permTreeLoaded = false;

  $('#cm-perms').onclick = async () => {
    showPerms();
    try {
      if (permTreeLoaded) return; // constroi só 1x
      const data = await fetch(`/api/users/${user.id}/permissions/tree`, { credentials:'include' })
        .then(r => r.json());
      const container = $('#permTree');

      // agrupar por parent
      const byParent = {};
      for (const n of data.nodes) {
        const pid = n.parent_id || 0;
        (byParent[pid] ||= []).push(n);
      }
      Object.values(byParent).forEach(arr => arr.sort((a,b) => (a.sort-b.sort) || a.id-b.id));

      const roots = (byParent[0] || []);
      roots.forEach((root, idx) => {
        const groupTitle = document.createElement('div');
        groupTitle.className = 'perm-group-title';
        groupTitle.textContent = `${root.label} (${root.key})`;
        container.appendChild(groupTitle);

        renderNode(root, 0);

        if (idx < roots.length - 1) {
          const hr = document.createElement('hr');
          hr.className = 'perm-sep';
          container.appendChild(hr);
        }
      });

      function renderNode(n, depth) {
        const pad = 12*depth;
        const id  = `perm_${n.id}`;
        const row = document.createElement('div');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '28px 1fr';
        row.style.alignItems = 'center';
        row.style.padding = '4px 6px';
        row.innerHTML = `
          <div style="padding-left:${pad}px">
            <input type="checkbox" id="${id}"
                   ${n.allowed ? 'checked':''}
                   data-key="${n.key}"
                   data-allowed="${n.allowed ? '1':'0'}"
                   data-override="${n.user_override ? '1':'0'}">
          </div>
          <label for="${id}" style="user-select:none">${n.label} <span style="opacity:.6;font-size:.9em">(${n.key})</span></label>
        `;
        container.appendChild(row);
        const children = byParent[n.id] || [];
        children.forEach(c => renderNode(c, depth+1));
      }

      permTreeLoaded = true;
    } catch (e) {
      alert('Falha ao carregar permissões.');
      console.error('[perms]', e);
      showDetails(); // volta se falhar
    }
  };

  $('#cm-perm-back').onclick = () => {
    showDetails(); // sem recriar HTML => valores intactos
  };

  $('#cm-perm-save').onclick = async () => {
    try {
      const container = $('#permTree');
      const inputs = container.querySelectorAll('input[type="checkbox"][data-key]');
      const overrides = {};
      inputs.forEach(inp => {
        const key   = inp.dataset.key;
        const was   = inp.dataset.allowed === '1';
        const hadOv = inp.dataset.override === '1';
        const now   = inp.checked;

        if (hadOv) {
          if (now === was) overrides[key] = null;
          else overrides[key] = now;
        } else {
          if (now !== was) overrides[key] = now;
        }
      });

      const r = await fetch(`/api/users/${user.id}/permissions/overrides`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        credentials:'include',
        body: JSON.stringify({ overrides })
      });
      if (!r.ok) {
        const t = await r.text().catch(()=> '');
        throw new Error(t || 'Falha ao salvar permissões');
      }

      alert('Permissões atualizadas.');

      // Se for o usuário logado, aplica imediatamente na UI
      const me = window.__sessionUser;
      if (me && String(me.id) === String(user.id) && typeof window.applyCurrentUserPermissionsToUI === 'function') {
        window.applyCurrentUserPermissionsToUI();
      }

      showDetails();
    } catch (e) {
      alert('Falha ao salvar permissões.');
      console.error('[perms-save]', e);
    }
  };

  // fechar modal
  $('#cm-cancel').onclick = () => { backdrop.style.display = 'none'; };
  backdrop.onclick = (ev) => { if (ev.target === backdrop) backdrop.style.display = 'none'; };

  // garante CSS p/ esconder coisas sem permissão
  (function ensurePermCss(){
    if (document.getElementById('perm-hide-style')) return;
    const st = document.createElement('style');
    st.id = 'perm-hide-style';
    st.textContent = `.perm-hidden{display:none !important;}`;
    document.head.appendChild(st);
  })();

  backdrop.style.display = 'flex';
}





function openColaboradores() {
  COLAB_LOG('open: acionado');

  // 1) Descobre a raiz onde ficam as abas principais
  const root = findTabsRoot();

  // 2) Garante que a aba de colaboradores existe e está no container certo
  const pane = ensurePane(root);

  // 3) Esconde TAMBÉM o painel de Início (ele não é irmão do root)
  const home = document.getElementById('paginaInicio');
  if (home) {
    home.style.display = 'none';
    home.classList.remove('active');
    COLAB_LOG('open: ocultando #paginaInicio');
  }

  // 4) Esconde as abas irmãs dentro da raiz principal
  hideSiblings(root, pane);

  // 5) Mostra a aba de colaboradores com força total (contra CSS teimoso)
  pane.classList.add('active');
  pane.style.display   = 'block';
  pane.style.flex      = '1 1 auto';
  pane.style.width     = '100%';
  pane.style.minHeight = '40vh';
  pane.style.overflow  = 'auto';
  pane.style.zIndex    = '1';

  // 6) Carrega a lista
  carregarLista(pane);

  // 7) Conveniência visual e diagnóstico
  try { pane.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
  const r = pane.getBoundingClientRect();
  COLAB_LOG('pane bbox:', r);
}


  // modo “ferramenta” para testar pelo console
  window.openColaboradores = openColaboradores;
  COLAB_LOG('init: pronto. Use openColaboradores() no console para testar.');
}

// auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDadosColaboradoresUI);
} else {
  initDadosColaboradoresUI();
}
