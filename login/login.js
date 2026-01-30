// login/login.js
import config from '../config.client.js';

// opção A (recomendada): sempre a mesma origem
const API_BASE = '';

// === HELPERS GLOBAIS: ficam visíveis para qualquer handler/IIFE ===
window.goToInicio = window.goToInicio || function () {
  // 1) Se existir função de roteamento do app:
  if (typeof window.navigateTo === 'function') { try { window.navigateTo('inicio'); return; } catch {} }
  if (typeof window.goInicio === 'function')    { try { window.goInicio();         return; } catch {} }

  // 2) Simula clique em "Início"
  const btnInicio =
    document.querySelector('[data-nav-key="side:inicio"]') ||
    document.querySelector('#nav-inicio, #btn-inicio') ||
    document.querySelector('a[href$="#inicio"], a[href*="#home"]');
  if (btnInicio) { btnInicio.click(); }

  // 3) Fecha modais/drawers/overlays
  document.querySelectorAll('.modal.open,.modal.show,.drawer.open,.offcanvas.show,.overlay.open')
    .forEach(el => { el.classList.remove('open','show'); el.style.display = 'none'; });

  document.querySelectorAll('[data-open="true"]').forEach(el => el.setAttribute('data-open','false'));

  // 4) Reativa a aba/painel default
  const defaultTab    = document.querySelector('[data-tab][data-default="true"]') || document.querySelector('[data-tab]');
  const allTabs       = document.querySelectorAll('[data-tab]');
  const allTabPanels  = document.querySelectorAll('[data-tab-panel]');
  const defaultPanel  = document.querySelector('[data-tab-panel][data-default="true"]') || allTabPanels[0];

  if (allTabs.length && defaultTab) {
    allTabs.forEach(t => t.classList.remove('active'));
    defaultTab.classList.add('active');
  }
  if (allTabPanels.length) {
    allTabPanels.forEach(p => p.style.display = 'none');
    if (defaultPanel) defaultPanel.style.display = '';
  }

  // 5) Fallback duro de URL
  if (!location.pathname.endsWith('/menu_produto.html')) {
    location.href = '/menu_produto.html#';
  } else {
    if (!location.hash || location.hash === '#login' || location.hash === '#!login') {
      location.hash = '#';
    }
  }
};

window.enforceLoggedOutHome = function () {
  try {
    // Fecha modais/drawers/overlays
    document.querySelectorAll('.modal.open,.modal.show,.drawer.open,.offcanvas.show,.overlay.open')
      .forEach(el => { el.classList.remove('open','show'); el.style.display = 'none'; });

    document.querySelectorAll('[data-open="true"]').forEach(el => el.setAttribute('data-open','false'));

    // Desmarca itens de menu e marca "Início"
    document.querySelectorAll('.header .header-menu > .menu-link')
      .forEach(a => a.classList.remove('is-active'));
    (document.getElementById('menu-inicio')
      || document.querySelector('#nav-inicio,#btn-inicio,[data-nav-key="side:inicio"]'))
      ?.classList.add('is-active');

    // Esconde todas as abas/painéis e mostra só a Home (#paginaInicio), se existir
    const home  = document.getElementById('paginaInicio');
    const panes = document.querySelectorAll('[data-tab-panel], .tab-pane');
    if (panes.length) {
      panes.forEach(p => {
        const mostrar = (home && p === home);
        p.style.display = mostrar ? 'block' : 'none';
        p.classList.toggle('active', mostrar);
      });
    }

    // Normaliza hash para evitar “voltar” para rota protegida
    try { history.replaceState(null, '', '#inicio'); } catch {}
  } catch (e) {
    console.warn('[enforceLoggedOutHome] fallback', e);
  }

  // Por fim, aciona a navegação de "Início"
  window.goToInicio();
};



document.addEventListener('DOMContentLoaded', async () => {
  // base da API (se não existir API_BASE, usa vazio e chama no mesmo origin)
  const BASE = typeof window.API_BASE === 'string' ? window.API_BASE : '';

  // 1) Pega o container onde injetaremos o HTML do login
  const overlay = document.getElementById('authOverlay');
  
  // ⚡ OTIMIZAÇÃO: Habilita o botão profile-icon IMEDIATAMENTE
  const profileArea = document.getElementById('profile-icon');
  if (profileArea && !profileArea.__loginBound) {
    profileArea.__loginBound = true;
    profileArea.style.cursor = 'pointer';
    profileArea.addEventListener('click', () => {
      overlay.classList.add('is-active');
    });
    // Disponibiliza globalmente para outros módulos
    window.openLoginModal = () => overlay.classList.add('is-active');
  }
  
  // 📸 Monitor ATIVO para atualizar foto do profile-icon E do modal
  const defaultImage = 'https://pxhbginkisinegzupqcy.supabase.co/storage/v1/object/public/compras-anexos/profile-photos/Captura%20de%20tela%20de%202026-01-29%2015-12-33.png';
  
  let lastPhotoUrl = null;
  
  function updateAllProfilePhotos() {
    const profileIcon = document.getElementById('profile-icon');
    const profilePhoto = document.getElementById('profilePhoto');
    const profilePhotoPlaceholder = document.getElementById('profilePhotoPlaceholder');
    
    const currentPhotoUrl = window.__sessionUser?.foto_perfil_url || null;
    
    // Só atualiza se a foto mudou
    if (currentPhotoUrl !== lastPhotoUrl) {
      console.log('[updateAllProfilePhotos] Foto mudou de', lastPhotoUrl, 'para', currentPhotoUrl);
      lastPhotoUrl = currentPhotoUrl;
      
      if (currentPhotoUrl) {
        console.log('[updateAllProfilePhotos] Aplicando foto do usuário:', currentPhotoUrl);
        
        // Atualiza o ícone do header
        if (profileIcon) {
          profileIcon.src = currentPhotoUrl;
        }
        
        // Atualiza a foto no modal de login
        if (profilePhoto) {
          profilePhoto.src = currentPhotoUrl;
          profilePhoto.style.display = 'block';
        }
        if (profilePhotoPlaceholder) {
          profilePhotoPlaceholder.style.display = 'none';
        }
      } else {
        console.log('[updateAllProfilePhotos] Aplicando imagem padrão');
        
        // Atualiza o ícone do header com imagem padrão
        if (profileIcon) {
          profileIcon.src = defaultImage;
        }
        
        // Mostra placeholder no modal
        if (profilePhoto) {
          profilePhoto.style.display = 'none';
        }
        if (profilePhotoPlaceholder) {
          profilePhotoPlaceholder.style.display = 'flex';
        }
      }
    }
  }
  
  // Monitor constante (verifica a cada 500ms)
  setInterval(updateAllProfilePhotos, 500);
  
  // Também escuta o evento auth:changed
  window.addEventListener('auth:changed', updateAllProfilePhotos);
  
  // Checa imediatamente
  updateAllProfilePhotos();

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
  
  // Elementos da foto de perfil
  const profilePhotoContainer = overlay.querySelector('#profilePhotoContainer');
  const profilePhoto = overlay.querySelector('#profilePhoto');
  const profilePhotoPlaceholder = overlay.querySelector('#profilePhotoPlaceholder');
  const profilePhotoInput = overlay.querySelector('#profilePhotoInput');
  const profilePhotoStatus = overlay.querySelector('#profilePhotoStatus');

  /* =========================================================
   *  Carrega dados do colaborador (incluindo foto de perfil)
   * ========================================================= */
  async function loadUserInfo(userOrId) {
    try {
      // mostra painel "logado"
      divNotLogged.style.display = 'none';
      divLogged.style.display    = 'block';
      
      // Se recebeu um objeto user completo, usa o username/id dele
      const username = typeof userOrId === 'object' ? (userOrId.username || userOrId.id) : userOrId;
      nomeUsuarioSpan.textContent = username || '';

      // consulta status e foto de perfil
      const stResp = await fetch(`${BASE}/api/auth/status`, { credentials: 'include' });
      const js     = stResp.ok ? await stResp.json() : { loggedIn:false };
      
      console.log('[loadUserInfo] Dados do usuário:', js.user);
      
      // Carrega foto de perfil se disponível
      if (js.loggedIn && js.user) {
        loadProfilePhoto(js.user.id);
        // Atualiza também o profile-icon do header usando o foto_perfil_url do objeto
        updateHeaderProfileIconFromUser(js.user);
      }

    } catch (err) {
      console.warn('[loadUserInfo]', err);
    }
  }
  
  /* =========================================================
   *  Carrega e exibe foto de perfil do usuário
   * ========================================================= */
  async function loadProfilePhoto(userId) {
    try {
      const resp = await fetch(`${BASE}/api/users/${userId}/foto-perfil`, { credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json();
        if (data.foto_perfil_url) {
          profilePhoto.src = data.foto_perfil_url;
          profilePhoto.style.display = 'block';
          profilePhotoPlaceholder.style.display = 'none';
        } else {
          // Sem foto, mostra placeholder
          profilePhoto.style.display = 'none';
          profilePhotoPlaceholder.style.display = 'flex';
        }
      }
    } catch (err) {
      console.warn('[loadProfilePhoto]', err);
      // Em caso de erro, mantém placeholder
      profilePhoto.style.display = 'none';
      profilePhotoPlaceholder.style.display = 'flex';
    }
  }
  
  /* =========================================================
   *  Atualiza foto do profile-icon no header DIRETAMENTE do objeto user
   * ========================================================= */
  function updateHeaderProfileIconFromUser(user) {
    const profileIcon = document.getElementById('profile-icon');
    if (!profileIcon) {
      console.warn('[updateHeaderProfileIconFromUser] profile-icon não encontrado');
      return;
    }
    
    const defaultImage = 'https://pxhbginkisinegzupqcy.supabase.co/storage/v1/object/public/compras-anexos/profile-photos/Captura%20de%20tela%20de%202026-01-29%2015-12-33.png';
    
    console.log('[updateHeaderProfileIconFromUser] User:', user);
    console.log('[updateHeaderProfileIconFromUser] foto_perfil_url:', user?.foto_perfil_url);
    
    // Se tem foto, usa a foto do usuário; senão usa a imagem padrão
    const fotoUrl = user?.foto_perfil_url || defaultImage;
    console.log('[updateHeaderProfileIconFromUser] Setando imagem no header:', fotoUrl);
    profileIcon.src = fotoUrl;
  }
  
  /* =========================================================
   *  Atualiza foto do profile-icon no header (versão com API)
   * ========================================================= */
  async function updateHeaderProfileIcon(userId) {
    const profileIcon = document.getElementById('profile-icon');
    if (!profileIcon) {
      console.warn('[updateHeaderProfileIcon] profile-icon não encontrado');
      return;
    }
    
    const defaultImage = 'https://pxhbginkisinegzupqcy.supabase.co/storage/v1/object/public/compras-anexos/profile-photos/Captura%20de%20tela%20de%202026-01-29%2015-12-33.png';
    
    console.log('[updateHeaderProfileIcon] Buscando foto para userId:', userId);
    
    try {
      const resp = await fetch(`${BASE}/api/users/${userId}/foto-perfil`, { credentials: 'include' });
      console.log('[updateHeaderProfileIcon] Resposta da API:', resp.status, resp.ok);
      
      if (resp.ok) {
        const data = await resp.json();
        console.log('[updateHeaderProfileIcon] Dados recebidos:', data);
        
        // Se tem foto, usa a foto do usuário; senão usa a imagem padrão
        const fotoUrl = data.foto_perfil_url || defaultImage;
        console.log('[updateHeaderProfileIcon] Setando imagem:', fotoUrl);
        profileIcon.src = fotoUrl;
      } else {
        console.warn('[updateHeaderProfileIcon] Erro na API, usando imagem padrão');
        // Se erro na API, usa imagem padrão
        profileIcon.src = defaultImage;
      }
    } catch (err) {
      console.error('[updateHeaderProfileIcon] Erro:', err);
      // Em caso de erro, usa imagem padrão
      profileIcon.src = defaultImage;
    }
  }
  
  /* =========================================================
   *  Upload de foto de perfil para Supabase
   * ========================================================= */
  async function uploadProfilePhoto(file) {
    try {
      profilePhotoStatus.textContent = 'Enviando foto...';
      profilePhotoStatus.style.color = '#667eea';
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', `profile-photos/${Date.now()}_${file.name}`);
      
      const uploadResp = await fetch(`${BASE}/api/upload/supabase`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      
      if (!uploadResp.ok) {
        throw new Error('Falha ao fazer upload da foto');
      }
      
      const uploadData = await uploadResp.json();
      
      if (!uploadData.url) {
        throw new Error('URL da foto não retornada');
      }
      
      // Salva URL no banco de dados
      const userId = window.__sessionUser?.id;
      if (!userId) {
        throw new Error('Usuário não identificado');
      }
      
      const saveResp = await fetch(`${BASE}/api/users/${userId}/foto-perfil`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto_perfil_url: uploadData.url })
      });
      
      if (!saveResp.ok) {
        throw new Error('Falha ao salvar URL da foto');
      }
      
      // Atualiza imagem na interface
      profilePhoto.src = uploadData.url;
      profilePhoto.style.display = 'block';
      profilePhotoPlaceholder.style.display = 'none';
      
      // Atualiza também o profile-icon do header
      const profileIcon = document.getElementById('profile-icon');
      if (profileIcon) {
        profileIcon.src = uploadData.url;
      }
      
      profilePhotoStatus.textContent = 'Foto atualizada!';
      profilePhotoStatus.style.color = '#10b981';
      
      setTimeout(() => {
        profilePhotoStatus.textContent = '';
      }, 3000);
      
    } catch (err) {
      console.error('[uploadProfilePhoto]', err);
      profilePhotoStatus.textContent = 'Erro ao enviar foto';
      profilePhotoStatus.style.color = '#ef4444';
      
      setTimeout(() => {
        profilePhotoStatus.textContent = '';
      }, 3000);
    }
  }

  // 4) Pré-preenche com localStorage
  const savedU = localStorage.getItem('user');
  const savedP = localStorage.getItem('password');
  if (savedU) inpUser.value = savedU;
  if (savedP) inpPass.value = savedP;
  if (savedU && savedP && chkRemember) chkRemember.checked = true;
  
  // 5) Event listeners para foto de perfil
  if (profilePhotoContainer && profilePhotoInput) {
    // Abre seletor de arquivo ao clicar no container
    profilePhotoContainer.addEventListener('click', () => {
      profilePhotoInput.click();
    });
    
    // Processa arquivo selecionado
    profilePhotoInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        // Valida tipo de arquivo
        if (!file.type.startsWith('image/')) {
          alert('Por favor, selecione uma imagem válida');
          return;
        }
        
        // Valida tamanho (máx 5MB)
        if (file.size > 5 * 1024 * 1024) {
          alert('A imagem deve ter no máximo 5MB');
          return;
        }
        
        await uploadProfilePhoto(file);
      }
      
      // Limpa input para permitir selecionar o mesmo arquivo novamente
      e.target.value = '';
    });
  }

  // 8) Ao abrir a página, checa sessão e configura a UI
  const st = await fetch(`${BASE}/api/auth/status`, { credentials: 'include' })
    .then(r => r.json())
    .catch(() => ({ loggedIn:false }));

  // deixa disponível p/ o resto da UI (menus etc)
  window.__sessionUser = st.loggedIn ? st.user : null;

  const savedPass = localStorage.getItem('password');
if (st.loggedIn && st.user) {
    form.style.display = 'none';
    try { await updateMessageCount?.(); } catch {}
    // Passa o objeto user completo para poder usar foto_perfil_url
    await loadUserInfo(st.user);
    moverDadosParaDireita();
    divNotLogged.style.display = 'none';
    divLogged.style.display    = 'block';
    nomeUsuarioSpan.textContent = st.user.nome || st.user.username || st.user.id || '';
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
const btnLogout1 = overlay.querySelector('#btnLogout');
const btnLogout2 = overlay.querySelector('#btnOverlayLogout');

// login/login.js — substituir a função inteira
// --- Helper: leva para a página inicial e fecha tudo que estiver aberto ---
function goToInicio() {
  // 1) Se existir alguma função global do seu app pra ir ao início, use
  if (typeof window.goInicio === 'function') { try { window.goInicio(); return; } catch {} }
  if (typeof window.navigateTo === 'function') { try { window.navigateTo('inicio'); return; } catch {} }

  // 2) Tenta clicar em um botão/link "Início" do menu lateral/topo
  const btnInicio =
    document.querySelector('[data-nav-key="side:inicio"]') ||
    document.querySelector('#nav-inicio, #btn-inicio') ||
    document.querySelector('a[href$="#inicio"], a[href*="#home"]');
  if (btnInicio) { btnInicio.click(); }

  // 3) Fecha modais, drawers, overlays, e desmarca abas ativas
  document.querySelectorAll('.modal.open,.modal.show,.drawer.open,.offcanvas.show,.overlay.open')
    .forEach(el => { el.classList.remove('open','show'); el.style.display = 'none'; });

  // Fecha quaisquer elementos com [data-open="true"]
  document.querySelectorAll('[data-open="true"]').forEach(el => el.setAttribute('data-open', 'false'));

  // Fecha abas deixando só a primeira (ou a que tiver [data-default])
  const defaultTab = document.querySelector('[data-tab][data-default="true"]') || document.querySelector('[data-tab]');
  if (defaultTab) {
    const allTabs = document.querySelectorAll('[data-tab]');
    allTabs.forEach(t => t.classList.remove('active'));
    defaultTab.classList.add('active');
  }
  const allTabPanels = document.querySelectorAll('[data-tab-panel]');
  const defaultPanel = document.querySelector('[data-tab-panel][data-default="true"]') || allTabPanels[0];
  if (allTabPanels.length) {
    allTabPanels.forEach(p => p.style.display = 'none');
    if (defaultPanel) defaultPanel.style.display = '';
  }

  // 4) Como fallback final, força navegação para a home do app
  //    (ajuste se sua rota inicial for diferente)
  if (!location.pathname.endsWith('/menu_produto.html')) {
    location.href = '/menu_produto.html#';
  } else {
    // Se já está em menu_produto, garante o hash "início"
    if (!location.hash || location.hash === '#login' || location.hash === '#!login') {
      location.hash = '#';
    }
  }
}

// Força estado "deslogado" + navega pra Início, em qualquer lugar do app
// === Fecha tudo e garante "Início" visível mesmo sem auth ===
function enforceLoggedOutHome() {
  try {
    // Fecha modais/drawers/overlays comuns
    document.querySelectorAll('.modal.open,.modal.show,.drawer.open,.offcanvas.show,.overlay.open')
      .forEach(el => { el.classList.remove('open','show'); el.style.display = 'none'; });

    // Qualquer componente com "data-open"
    document.querySelectorAll('[data-open="true"]').forEach(el => el.setAttribute('data-open','false'));

    // Desmarca itens ativos de menu e marca "Início", se existir
    document.querySelectorAll('.header .header-menu > .menu-link')
      .forEach(a => a.classList.remove('is-active'));
    (document.getElementById('menu-inicio')
      || document.querySelector('#nav-inicio,#btn-inicio,[data-nav-key="side:inicio"]'))
      ?.classList.add('is-active');

    // Esconde todas as abas/painéis e mostra apenas a Home (#paginaInicio) se existir
    const home = document.getElementById('paginaInicio');
    const panes = document.querySelectorAll('[data-tab-panel], .tab-pane');
    if (panes.length) {
      panes.forEach(p => {
        const mostrar = (home && p === home);
        p.style.display = mostrar ? 'block' : 'none';
        p.classList.toggle('active', mostrar);
      });
    }

    // Normaliza a URL/hash para "Início" (evita voltar à rota protegida)
    try { history.replaceState(null, '', '#inicio'); } catch {}
  } catch (e) {
    console.warn('[enforceLoggedOutHome] fallback', e);
  }

  // Aciona o mesmo comportamento do botão "Início"
  goToInicio();
}


// --- Substituir a função inteira ---
function bindLogout(btn) {
  if (!btn) return;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await fetch(`${BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {}

    // limpa credenciais locais
    try { localStorage.removeItem('user'); localStorage.removeItem('password'); } catch {}

    // === Reset visual do overlay de login ===
    form.style.display = '';
    if (loggedContainer) loggedContainer.style.display = 'none';
    divNotLogged.style.display = 'block';
    divLogged.style.display = 'none';
    moverDadosParaEsquerda();

    // garante que o botão "Entrar" esteja normal (sem spinner e habilitado)
    const btnEntrar = overlay.querySelector('#btnEntrar');
    if (btnEntrar) {
      btnEntrar.disabled = false;
      const btnText = btnEntrar.querySelector('.btn-text');
      const spinner  = btnEntrar.querySelector('.spinner');
      if (btnText) btnText.style.display = '';
      if (spinner) spinner.style.display = 'none';
    }

    // limpa e habilita campos
    const usr = overlay.querySelector('#signInEmail');
    const pwd = overlay.querySelector('#signInPassword');
    const chk = overlay.querySelector('#rememberMe');
    if (usr) { usr.readOnly = false; usr.value = ''; }
    if (pwd) { pwd.readOnly = false; pwd.value = ''; }
    if (chk) { chk.checked = false; }

    // Reset da foto de perfil para imagem padrão
    const profileIcon = document.getElementById('profile-icon');
    const defaultImage = 'https://pxhbginkisinegzupqcy.supabase.co/storage/v1/object/public/compras-anexos/profile-photos/Captura%20de%20tela%20de%202026-01-29%2015-12-33.png';
    if (profileIcon) {
      profileIcon.src = defaultImage;
    }

    // estado global + evento
    window.__sessionUser = null;
    window.dispatchEvent(new Event('auth:changed'));

    // remove classe do painel
    overlay.querySelector('#container')?.classList.remove('right-panel-active');

    // **Força HOME e fecha tudo**
    enforceLoggedOutHome();
  });
}




bindLogout(btnLogout1);
bindLogout(btnLogout2);


  // [removed] overlay logout duplicate handler
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
  const btnVoltarLogin = overlay.querySelector('#btnVoltarLogin');
btnVoltarLogin?.addEventListener('click', () => {
  container?.classList.remove('right-panel-active');
  overlay.querySelector('#signInPassword')?.focus();
});


  // abre modal ao clicar no ícone de perfil (já foi configurado no DOMContentLoaded)
  // Apenas garante que a função global existe
  if (!window.openLoginModal) {
    window.openLoginModal = () => overlay.classList.add('is-active');
  }

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

  // === CURTO-CIRCUITO: senha inicial "123" abre o painel de nova senha ===
  if (password === '123') {
    window.__pendingResetUsername = username; // guardamos quem vai trocar
    overlay.querySelector('#container')?.classList.add('right-panel-active'); // efeito CodePen
    const hint = overlay.querySelector('#changePassHint');
    if (hint) hint.textContent = `Usuário: ${username}`;
    // foco no campo nova senha
    setTimeout(() => overlay.querySelector('#newPassword')?.focus(), 0);
    return; // não tenta logar com 123
  }

  // --- INÍCIO: Mostra spinner e oculta texto ---
  const btnEntrar = overlay.querySelector('#btnEntrar');
  if (btnEntrar) {
    btnEntrar.disabled = true;
    const btnText = btnEntrar.querySelector('.btn-text');
    const spinner = btnEntrar.querySelector('.spinner');
    if (btnText) btnText.style.display = 'none';
    if (spinner) spinner.style.display = 'inline-block';
  }
  // --- FIM: Mostra spinner e oculta texto ---

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
      // --- Reabilita botão e restaura texto/spinner ---
      if (btnEntrar) {
        btnEntrar.disabled = false;
        const btnText = btnEntrar.querySelector('.btn-text');
        const spinner = btnEntrar.querySelector('.spinner');
        if (btnText) btnText.style.display = '';
        if (spinner) spinner.style.display = 'none';
      }
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

    window.__sessionUser = data.user;

    try {
      if (typeof window.syncNavNodes === 'function') {
        await window.syncNavNodes();
      }
    } catch (e) {
      console.warn('[login] syncNavNodes falhou', e);
    }

    window.dispatchEvent(new Event('auth:changed'));
    try { await window.syncNavNodes?.(); } catch (e) { console.warn('[nav-sync pós-login]', e); }

    // fecha modal + ajusta painéis
    overlay.classList.remove('is-active');
    formSignIn.reset();

    divNotLogged.style.display = 'none';
    divLogged.style.display    = 'block';
    if (nomeUsuarioSpan) {
      nomeUsuarioSpan.textContent = data.user.nome || data.user.username || data.user.id || username;
    }
    if (typeof moverDadosParaDireita === 'function') moverDadosParaDireita();
    if (formSignIn) formSignIn.style.display = 'none';

    window.dispatchEvent(new Event('auth:changed'));
    // --- O spinner some junto com o modal, não precisa restaurar aqui ---
  } catch (err) {
    console.error('[login] falha', err);
    alert('Falha no login. Tente novamente.');
    // --- Reabilita botão e restaura texto/spinner ---
    if (btnEntrar) {
      btnEntrar.disabled = false;
      const btnText = btnEntrar.querySelector('.btn-text');
      const spinner = btnEntrar.querySelector('.spinner');
      if (btnText) btnText.style.display = '';
      if (spinner) spinner.style.display = 'none';
    }
  }
});



  // === SUBMIT: criar/alterar senha inicial ===
const formCriar = overlay.querySelector('#formCriarConta');
formCriar?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username    = (window.__pendingResetUsername || overlay.querySelector('#signInEmail')?.value || '').trim();
  const newPass     = overlay.querySelector('#newPassword')?.value.trim();
  const confirmPass = overlay.querySelector('#confirmPassword')?.value.trim();

  if (!username) return alert('Usuário não identificado.');
  if (!newPass || newPass !== confirmPass) return alert('As senhas não conferem');

  const btn = overlay.querySelector('#btnCriarConta');
  if (btn) {
    btn.disabled = true;
    const t = btn.querySelector('.btn-text');
    const s = btn.querySelector('.spinner');
    if (t) t.style.display = 'none';
    if (s) s.style.display = 'inline-block';
  }

  try {
    // 1) Troca a senha inicial (rota pública controlada)
    const up = await fetch('/api/auth/first-password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, newPassword: newPass })
    });
    const upJs = await up.json().catch(() => ({}));
    if (!up.ok || upJs?.ok === false) {
      throw new Error(upJs.error || 'Erro ao atualizar a senha');
    }

    // 2) Auto-login com a nova senha
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: username, senha: newPass })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || 'Falha ao entrar com a nova senha');

    // 3) Estado/UX
    localStorage.setItem('user', username);
    localStorage.setItem('password', newPass);
    window.__sessionUser = data.user;
    try { await window.syncNavNodes?.(); } catch {}
    window.dispatchEvent(new Event('auth:changed'));

    overlay.querySelector('#container')?.classList.remove('right-panel-active'); // volta pro painel de login
    overlay.classList.remove('is-active'); // fecha modal

    const divNotLogged = overlay.querySelector('#overlayNotLoggedIn');
    const divLogged    = overlay.querySelector('#overlayLoggedIn');
    const nomeUsuario  = overlay.querySelector('#nomeUsuarioOverlay');
    if (divNotLogged && divLogged) {
      divNotLogged.style.display = 'none';
      divLogged.style.display    = 'block';
    }
    if (nomeUsuario) nomeUsuario.textContent = data.user?.nome || data.user?.username || username;

    overlay.querySelector('#formSignIn')?.reset();
    window.__pendingResetUsername = null;

  } catch (err) {
    console.error('[nova-senha]', err);
    alert(err.message || 'Falha ao trocar senha.');
  } finally {
    if (btn) {
      btn.disabled = false;
      const t = btn.querySelector('.btn-text');
      const s = btn.querySelector('.spinner');
      if (t) t.style.display = '';
      if (s) s.style.display = 'none';
    }
  }
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

// Atualiza contador de mensagens - só executa se usuário estiver logado
async function updateMessageCount() {
  // Verifica se está logado antes de fazer requisição
  if (!window.__sessionUser) {
    const badge = document.querySelector('.notification-number');
    if (badge) badge.style.display = 'none';
    return;
  }
  
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
  // Verifica se está logado antes de abrir notificações
  if (!window.__sessionUser) {
    console.warn('[openNotificacoes] Usuário não logado - ignorando abertura');
    return;
  }
  
  console.warn('[openNotificacoes] Função DESABILITADA - usando chat ao invés de notificações');
  
  // Se o chat existe, redireciona para ele
  if (typeof window.openChat === 'function') {
    window.openChat();
    return;
  }
  
  // Se não existe, apenas loga o erro sem tentar acessar elementos inexistentes
  console.error('[openNotificacoes] Sistema de chat não disponível');
}
window.openNotificacoes = openNotificacoes;   // torna global imediatamente

// LOGOUT (header/side): usa helpers globais
(function bindLogoutButton(){
  const tryBind = () => {
    const btn = document.querySelector('#btn-logout, [data-logout]');
    if (!btn || btn.__logoutBound) return;
    btn.__logoutBound = true;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
      try { localStorage.removeItem('user'); localStorage.removeItem('password'); } catch {}
      window.__sessionUser = null;
      window.dispatchEvent(new Event('auth:changed'));
      // <- agora existe no escopo global:
      window.enforceLoggedOutHome();
    });
  };
  document.addEventListener('DOMContentLoaded', tryBind);
  new MutationObserver(tryBind).observe(document.documentElement, { childList: true, subtree: true });
})();




function bindNotificationBell() {
  const bell = document.querySelector('.notification');
  if (!bell) return; // página sem sininho → não binda

  bell.addEventListener('click', (e) => {
    e.stopPropagation(); // evita interações colaterais (ex.: abrir login)
    e.preventDefault();
    try {
      // Chama o chat se existir (prioridade para sistema novo)
      if (typeof window.openChat === 'function') {
        window.openChat();
        return;
      }
      
      // Fallback para notificações antigas (se o chat não carregou)
      console.warn('[bindNotificationBell] openChat não disponível, usando fallback');
      if (typeof window.openNotificacoes === 'function') {
        window.openNotificacoes();
      }
    } catch (err) {
      console.error('[bindNotificationBell] erro ao abrir chat/notificações', err);
    }
  });

  // fechar painel se clicar fora
  document.addEventListener('click', (e) => {
    const clicouSino   = e.target.closest('.notification');
    const clicouPainel = e.target.closest('#notificacoes');
    if (!clicouSino && !clicouPainel) {
      const painel  = document.getElementById('notificacoes');
      const acessos = document.getElementById('acessos');
      painel?.classList.remove('visible');
      acessos?.classList.remove('hidden');
    }
  });
}


function bindNotificacoesListClicks() {
  const ul = document.getElementById('listaNotificacoes');
  if (!ul) return; // página sem lista → não binda

  ul.addEventListener('click', async (e) => {
    const li  = e.target.closest('li[data-idx]');
    if (!li) return;
    const idx = Number(li.dataset.idx);

    // RESET
    if (e.target.classList.contains('btn-reset')) {
      const raw = decodeURIComponent(li.dataset.raw || '');
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
        body: JSON.stringify({ index: idx })
      });
    }

    // EXCLUIR
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
    try { 
      if (typeof window.openNotificacoes === 'function') window.openNotificacoes();
    } catch {}
  });
}


function bindNotificationsUI() {
  try { bindNotificationBell(); } catch (e) { console.warn('[bindNotificationsUI] bell', e); }
  try { bindNotificacoesListClicks(); } catch (e) { console.warn('[bindNotificationsUI] list', e); }
}

// Se perder sessão em qualquer ponto, garante HOME
window.addEventListener('auth:changed', () => {
  if (!window.__sessionUser) window.enforceLoggedOutHome();
});




window.openNotificacoes = openNotificacoes;   // torna global imediatamente

bindNotificationsUI();
