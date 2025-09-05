// login/login.js
import config from '../config.client.js';

// opção A (recomendada): sempre a mesma origem
const API_BASE = '';

    
document.addEventListener('DOMContentLoaded', async () => {
  // base da API (se não existir API_BASE, usa vazio e chama no mesmo origin)
  const BASE = typeof window.API_BASE === 'string' ? window.API_BASE : '';

  // 1) Pega o container onde injetaremos o HTML do login
  const overlay = document.getElementById('authOverlay');

  // 2) Carrega e injeta o HTML do formulário
  const html = await fetch('login/login.html', { credentials: 'include' }).then(r => r.text());
  overlay.innerHTML = html;

  // 3) Agora sim podemos selecionar os elementos do form
  const form        = overlay.querySelector('#formSignIn');

  // painéis “logado” / “deslogado”
  const divNotLogged      = overlay.querySelector('#overlayNotLoggedIn');
  const divLogged         = overlay.querySelector('#overlayLoggedIn');
  const nomeUsuarioSpan   = overlay.querySelector('#nomeUsuarioOverlay');

  const inpUser     = overlay.querySelector('#signInEmail');
  const inpPass     = overlay.querySelector('#signInPassword');
  const chkRemember = overlay.querySelector('#rememberMe');
  const loggedContainer = overlay.querySelector('#loggedInContainer');

  // onde cada bloco RESIDE no HTML original
  const signInPane        = overlay.querySelector('.sign-in-container'); // cinza
  const overlayRight      = overlay.querySelector('#overlayLoggedIn');   // roxo
  const overlayRightPanel = overlayRight?.parentElement;

  /* ---------------- mover blocos ---------------- */
  function moverDadosParaDireita () {
    if (overlayRightPanel && loggedContainer) {
      overlayRightPanel.appendChild(loggedContainer);
      loggedContainer.classList.add('on-overlay');
      loggedContainer.style.display = 'block';
    }
    if (signInPane && divLogged) {
      signInPane.classList.add('centered');
      signInPane.appendChild(divLogged); // mensagem → cinza
    }
  }

  function moverDadosParaEsquerda () {
    if (signInPane && loggedContainer) {
      signInPane.appendChild(loggedContainer);
      loggedContainer.classList.remove('on-overlay');
      loggedContainer.style.display = 'none';
    }
    if (overlayRightPanel && divLogged) {
      overlayRightPanel.appendChild(divLogged); // mensagem → roxo
    }
    if (signInPane) {
      signInPane.classList.remove('centered');
    }
  }

  // placeholders (p/ quando migrarmos o perfil pro SQL)
  const uiCargo        = overlay.querySelector('#uiCargo');
  const uiEndereco     = overlay.querySelector('#uiEndereco');
  const uiCel          = overlay.querySelector('#uiCel');
  const uiNomeCompleto = overlay.querySelector('#uiNomeCompleto');
  const uiDtNasc       = overlay.querySelector('#uiDtNasc');
  const uiEmail        = overlay.querySelector('#uiEmail');
  const uiObs          = overlay.querySelector('#uiObs');
  const uiNCod         = overlay.querySelector('#uiNCod');
  const uiNCodConta    = overlay.querySelector('#uiNCodConta');
  const uiNCodVend     = overlay.querySelector('#uiNCodVend');

  /* =========================================================
   *  Carrega dados do colaborador (dummy por enquanto)
   * ========================================================= */
  async function loadUserInfo(username) {
    try {
      // mostra painel “logado”
      divNotLogged.style.display = 'none';
      divLogged.style.display    = 'block';
      nomeUsuarioSpan.textContent = username || '';

      // apenas consulta status (mantém coerência visual)
      const stResp = await fetch(`${BASE}/api/auth/status`, { credentials: 'include' });
      const js     = stResp.ok ? await stResp.json() : { loggedIn:false };
      // (campos de perfil ficam vazios até migrarmos 100% pro SQL)

    } catch (err) {
      console.warn('[loadUserInfo]', err);
    }
  }

  // 4) Pré-preenche com localStorage
  const savedU = localStorage.getItem('user');
  const savedP = localStorage.getItem('password');
  if (savedU) inpUser.value = savedU;
  if (savedP) inpPass.value = savedP;
  if (savedU && savedP && chkRemember) chkRemember.checked = true;

  // 8) Ao abrir a página, checa sessão e configura a UI
  const st = await fetch(`${BASE}/api/auth/status`, { credentials: 'include' })
    .then(r => r.json())
    .catch(() => ({ loggedIn:false }));

  // deixa disponível p/ o resto da UI (menus etc)
  window.__sessionUser = st.loggedIn ? st.user : null;

  const savedPass = localStorage.getItem('password');

  if (st.loggedIn && savedPass && savedPass !== '123') {
    form.style.display = 'none';
    try { await updateMessageCount?.(); } catch {}
    await loadUserInfo(st.user.id);
    moverDadosParaDireita();
    divNotLogged.style.display = 'none';
    divLogged.style.display    = 'block';
    nomeUsuarioSpan.textContent = st.user.id;
  } else {
    divNotLogged.style.display = 'block';
    divLogged.style.display    = 'none';
    moverDadosParaEsquerda();
  }

  // 9) Abrir/fechar modal (usa sua função existente)
  bindAuthModal(
    overlay,
    divNotLogged,
    divLogged,
    nomeUsuarioSpan,
    moverDadosParaDireita,
    moverDadosParaEsquerda,
    loadUserInfo
  );

  // 10) Logout
  const btnLogout = overlay.querySelector('#btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await fetch(`${BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      } catch {}
      // limpa localStorage (caso "lembrar-me")
      localStorage.removeItem('user');
      localStorage.removeItem('password');

      // volta a exibir o form e esconder o painel de boas-vindas
      form.style.display            = '';
      loggedContainer && (loggedContainer.style.display = 'none');
      divNotLogged.style.display    = 'block';
      divLogged.style.display       = 'none';
      moverDadosParaEsquerda();

      window.__sessionUser = null;
      window.dispatchEvent(new Event('auth:changed'));

      overlay.querySelector('#container')?.classList.remove('right-panel-active');
    });
  }

  // mesmo handler para o botão do painel direito (se existir)
  const btnOverlayLogout = overlay.querySelector('#btnOverlayLogout');
  if (btnOverlayLogout) {
    btnOverlayLogout.addEventListener('click', (e) => {
      e.preventDefault();
      btnLogout?.click();
    });
  }

  // força todo mundo (menus, botões, abas) a reavaliar visibilidade
  window.dispatchEvent(new Event('auth:changed'));
});




// ➡ recebe as referências como parâmetros
function bindAuthModal(
  overlay,
  divNotLogged,
  divLogged,
  nomeUsuarioSpan,
  moverDadosParaDireita,
  moverDadosParaEsquerda,
  loadUserInfo
) {
  const profileArea = document.getElementById('profile-icon');
  const closeBtn    = overlay.querySelector('.close-auth');
  const formSignIn  = overlay.querySelector('#formSignIn');
  const container   = overlay.querySelector('#container');

  // abre modal ao clicar no ícone de perfil
  profileArea?.addEventListener('click', () => overlay.classList.add('is-active'));
  window.openLoginModal = () => overlay.classList.add('is-active');

  // fechar modal
  closeBtn?.addEventListener('click', () => overlay.classList.remove('is-active'));
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('is-active');
  });

  // alterna para painel de login
  overlay.querySelector('#signIn')?.addEventListener('click', () => {
    container?.classList.remove('right-panel-active');
  });

  // “Solicitar” (pedido de reset para admins)
  overlay.querySelector('#signUp')?.addEventListener('click', async () => {
    const username = overlay.querySelector('#signInEmail')?.value.trim();
    if (!username) return alert('Preencha o usuário antes de solicitar.');
    try {
      const res = await fetch('/api/users/request-reset', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(err.error || 'Falha ao registrar o pedido.');
      }
      alert('Pedido enviado! Um administrador fará a troca da sua senha.');
    } catch (e) {
      alert('Falha ao enviar o pedido.');
    }
  });

  // guarda id do usuário logado (para o fluxo “criar nova senha”)
  let loggedUserId = null;

  // === SUBMIT DE LOGIN (único) ===
formSignIn?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const userEl   = overlay.querySelector('#signInEmail');
  const passEl   = overlay.querySelector('#signInPassword');
  const remember = overlay.querySelector('#rememberMe');

  const username = (userEl?.value || '').trim();
  const password = (passEl?.value || '');

  if (!username || !password) {
    alert('Preencha usuário e senha.');
    return;
  }

  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: username, senha: password })
    });
    const data = await resp.json();

    if (!resp.ok || !data.ok) {
      alert(data.error || 'Usuário ou senha inválidos');
      return;
    }

    // lembrar credenciais (opcional)
    if (remember?.checked) {
      localStorage.setItem('user', username);
      localStorage.setItem('password', password);
    } else {
      localStorage.removeItem('user');
      localStorage.removeItem('password');
    }

    // guarda o usuário de sessão para os outros módulos
    window.__sessionUser = data.user;

    // 👉 NOVO: sincroniza os nós de navegação com o SQL **antes** de avisar a UI
    try { await window.syncNavNodes?.(); } catch (e) { console.warn('[nav-sync pós-login]', e); }

    // fecha modal + ajusta painéis
    overlay.classList.remove('is-active');
    formSignIn.reset();

    divNotLogged.style.display = 'none';
    divLogged.style.display    = 'block';
    if (nomeUsuarioSpan) {
      nomeUsuarioSpan.textContent = data.user.username || data.user.id || username;
    }
    if (typeof moverDadosParaDireita === 'function') moverDadosParaDireita();

    // avisa a aplicação (menus, abas e botões com permissão se atualizam)
    window.dispatchEvent(new Event('auth:changed'));
  } catch (err) {
    console.error('[login] falha', err);
    alert('Falha no login. Tente novamente.');
  }
});


  // === SUBMIT: criar/alterar senha inicial ===
  const formCriar = overlay.querySelector('#formCriarConta');
  formCriar?.addEventListener('submit', async e => {
    e.preventDefault();
    const newPass     = overlay.querySelector('#newPassword')?.value.trim();
    const confirmPass = overlay.querySelector('#confirmPassword')?.value.trim();
    if (!newPass || newPass !== confirmPass) return alert('As senhas não conferem');

    // 1) grava nova senha
    const ok = await fetch(`/api/users/${loggedUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type':'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password: newPass })
    }).then(r => r.ok);
    if (!ok) return alert('Erro ao atualizar a senha');

    // 2) encerra sessão temporária
    await fetch('/api/auth/logout', { method:'POST', credentials:'include' });

    // 3) volta para o painel de login
    container?.classList.remove('right-panel-active');
    overlay.querySelector('.sign-up-container')?.style && (overlay.querySelector('.sign-up-container').style.display = 'none');
    overlay.querySelector('.sign-in-container')?.style && (overlay.querySelector('.sign-in-container').style.display = 'block');
    const passField = overlay.querySelector('#signInPassword');
    if (passField) { passField.value = ''; passField.focus(); }

    localStorage.removeItem('password');
    alert('Senha alterada! Entre novamente com seu usuário e a nova senha.');
  });
}


function ativarInicioAposLogin() {
  // esconde a aba de colaboradores se existir
  const colab = document.getElementById('dadosColaboradores');
  if (colab) {
    colab.style.display = 'none';
    colab.classList.remove('active');
  }
  // ativa o painel de Início
  const home = document.getElementById('paginaInicio');
  if (home) {
    const root =
      home.parentElement ||
      document.querySelector('.main-container .tab-content') ||
      document.querySelector('.tab-content');

    if (root) {
      root.querySelectorAll(':scope > .tab-pane').forEach(p => {
        const ativa = (p === home);
        p.style.display = ativa ? 'block' : 'none';
        p.classList.toggle('active', ativa);
      });
    }
    try { home.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
  }
  try { history.replaceState(null, '', '#inicio'); } catch {}
}

async function updateMessageCount() {
  const badge = document.querySelector('.notification-number');
  if (!badge) return;

  const res = await fetch(`${API_BASE}/api/users/me/messages`, {
    credentials: 'include'
  });
  if (!res.ok) {
    badge.style.display = 'none';
    return;
  }
  const { count } = await res.json();
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

async function openNotificacoes() {

  const ul = document.getElementById('listaNotificacoes');

  const res = await fetch(`${API_BASE}/api/users/me/messages`, { credentials: 'include' });
  if (!res.ok) {
    ul.innerHTML = '<li>Erro ao carregar mensagens.</li>';
    return;
  }
  const { messages } = await res.json();

  ul.innerHTML = messages.length
  ? messages.map((m, i) => `
      <li data-idx="${i}" data-raw="${encodeURIComponent(m)}">
        <span>${m}</span>
        <div class="button-wrapper">
          <button class="content-button status-button btn-reset">
            Reset
          </button>
          <button class="content-button status-button btn-del">
            Excluir
          </button>
        </div>
      </li>`).join('')
  : '<li>Nenhuma notificação.</li>';


  const showTab = window.showMainTab || function(id){
    document.querySelectorAll('.tab-pane')
            .forEach(p => p.style.display = (p.id === id ? 'block' : 'none'));
  };

  // destaca o link principal da aba
  const link = document.getElementById('menu-notificacoes');
  if (link) {
    document.querySelectorAll('.header .header-menu > .menu-link')
            .forEach(a => a.classList.remove('is-active'));
    link.classList.add('is-active');
  }

  showTab('notificacoes');
    
  updateMessageCount();
}
window.openNotificacoes = openNotificacoes;   // torna global imediatamente

// Botões Reset / Excluir dentro da lista
document.getElementById('listaNotificacoes')
        .addEventListener('click', async e => {
  const li = e.target.closest('li[data-idx]');
  if (!li) return;
  const idx = Number(li.dataset.idx);   // garante número

  /* RESET ------------------------------------------------------- */
  if (e.target.classList.contains('btn-reset')) {
    const raw = decodeURIComponent(li.dataset.raw);     // "Recuperar … \"user\""
    const m   = /"([^"]+)"/.exec(raw);
    if (!m) return alert('Formato inválido.');
    const username = m[1];

    const ok = await fetch(`${API_BASE}/api/users/reset-password`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body: JSON.stringify({ username })
    }).then(r => r.ok);

    if (!ok) return alert('Falha ao resetar senha.');

    await fetch(`${API_BASE}/api/users/me/messages/delete`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body: JSON.stringify({ index: idx })   // idx já é Number
    });
  }                                          // ← fecha btn-reset


  /* EXCLUIR ----------------------------------------------------- */
  if (e.target.classList.contains('btn-del')) {
    const ok = await fetch(`${API_BASE}/api/users/me/messages/delete`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body: JSON.stringify({ index: idx })
    }).then(r => r.ok);

    if (!ok) return alert('Erro ao excluir mensagem.');
  }

  // recarrega lista e badge
  openNotificacoes();
});


// Clique no sininho  →  abre / fecha o painel Notificações
// sininho vira atalho para a aba Notificações
document.querySelector('.notification')
        .addEventListener('click', e => {
  e.stopPropagation();        // não deixa abrir o modal login
  openNotificacoes();
});



// Fecha o painel Notificações se clicar fora dele ou fora do sininho
document.addEventListener('click', e => {
  const clicouSino   = e.target.closest('.notification');
  const clicouPainel = e.target.closest('#notificacoes');

  if (!clicouSino && !clicouPainel) {
    const painel  = document.getElementById('notificacoes');
    const acessos = document.getElementById('acessos');
    painel?.classList.remove('visible');
    acessos?.classList.remove('hidden');
  }
});

// LOGOUT — ADICIONE ESTE BLOCO (mapeia #btn-logout ou qualquer [data-logout])
(function bindLogoutButton(){
  function handler(btn){
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch {}
      window.__sessionUser = null;
      window.dispatchEvent(new Event('auth:changed'));
    });
  }
  const tryBind = () => {
    const btn = document.querySelector('#btn-logout, [data-logout]');
    if (btn) handler(btn);
  };
  document.addEventListener('DOMContentLoaded', tryBind);
})();
