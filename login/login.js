// login/login.js
import config from '../config.client.js';

const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : window.location.origin;      // Render ou outro domínio
    
document.addEventListener('DOMContentLoaded', async () => {
  // 1) Pega o container onde injetaremos o HTML do login
  const overlay = document.getElementById('authOverlay');

  // 2) Carrega e injeta o HTML do formulário
  const html = await fetch('login/login.html').then(r => r.text());
  overlay.innerHTML = html;

  // 3) Agora sim podemos selecionar os elementos do form
// 3) Agora sim podemos selecionar os elementos do form
const form        = overlay.querySelector('#formSignIn');

// 🔻 NOVO – painéis “logado” / “deslogado”
const divNotLogged      = overlay.querySelector('#overlayNotLoggedIn');
const divLogged         = overlay.querySelector('#overlayLoggedIn');
const nomeUsuarioSpan   = overlay.querySelector('#nomeUsuarioOverlay');

  
  const inpUser     = overlay.querySelector('#signInEmail');
  const inpPass     = overlay.querySelector('#signInPassword');
  const chkRemember = overlay.querySelector('#rememberMe');
  const loggedContainer = overlay.querySelector('#loggedInContainer');

  // 🔻 NOVO – onde cada bloco RESIDE no HTML original
  const signInPane   = overlay.querySelector('.sign-in-container'); // cinza
  const overlayRight = overlay.querySelector('#overlayLoggedIn');  // roxo
  const overlayRightPanel = overlayRight.parentElement;            // 🔻 NOVO

  


/* ---------------- mover blocos ---------------- */
function moverDadosParaDireita () {
  overlayRightPanel.appendChild(loggedContainer);
  loggedContainer.classList.add('on-overlay');
  
  signInPane.classList.add('centered');        // 🔻 NOVO
  

  loggedContainer.classList.add('on-overlay');   // 🆕
  loggedContainer.style.display = 'block';

  signInPane.appendChild(divLogged);             // mensagem → cinza
}

function moverDadosParaEsquerda () {
  signInPane.appendChild(loggedContainer);
  loggedContainer.classList.remove('on-overlay'); // 🆕
  loggedContainer.style.display = 'none';

  overlayRightPanel.appendChild(divLogged);  // mensagem → roxo
  signInPane.classList.remove('centered');   // 🔻 NOVO
  
}



// 🔻 NOVO – placeholders que receberão dados da Omie
const uiCargo    = overlay.querySelector('#uiCargo');
const uiEndereco = overlay.querySelector('#uiEndereco');
const uiCel      = overlay.querySelector('#uiCel');
const uiNomeCompleto = overlay.querySelector('#uiNomeCompleto');
const uiDtNasc       = overlay.querySelector('#uiDtNasc');
const uiEmail        = overlay.querySelector('#uiEmail');
const uiObs          = overlay.querySelector('#uiObs');
const uiNCod         = overlay.querySelector('#uiNCod');
const uiNCodConta    = overlay.querySelector('#uiNCodConta');
const uiNCodVend     = overlay.querySelector('#uiNCodVend');


/* =========================================================
 *  Carrega dados do colaborador na Omie
 * ========================================================= */
async function loadUserInfo(username) {
  try {


    /* ➕ NOVO — loga quem estamos procurando */
console.log('[loadUserInfo] username →', username);

/* monta payload só para logar */
const payload = { pagina:1, registros_por_pagina:50 };
console.log('[loadUserInfo] payload  →', payload);

const res = await fetch(`${API_BASE}/api/omie/login/contatos`, {
  method : 'POST',
  headers: { 'Content-Type':'application/json' },
  body   : JSON.stringify(payload)
});

/* ➕ NOVO — loga status & body bruto */
console.log('[loadUserInfo] status   →', res.status);

const data = await res.json();
console.log('[loadUserInfo] resposta →', data);


    if (!data.cadastros) throw new Error('Lista vazia');

    const contato = data.cadastros.find(c =>
           c.identificacao?.cCodInt?.toLowerCase() === username.toLowerCase() ||
           c.identificacao?.cNome?.toLowerCase()   === username.toLowerCase());

    if (!contato) throw new Error('Usuário não encontrado');

// ► Nome completo + data de nascimento
uiNomeCompleto.textContent =
  `${contato.identificacao.cNome} ${contato.identificacao.cSobrenome}`;
uiDtNasc.textContent = contato.identificacao.dDtNasc;

// ► Demais campos na ordem solicitada
uiCargo.textContent  = contato.identificacao.cCargo;
uiCel.textContent    =
  `(${contato.telefone_email.cDDDCel1}) ${contato.telefone_email.cNumCel1}`;
uiEmail.textContent  = contato.telefone_email.cEmail || '-';

uiEndereco.textContent =
  `${contato.endereco.cEndereco} ${contato.endereco.cCompl || ''} – ` +
  `${contato.endereco.cBairro}, ${contato.endereco.cCidade} – ` +
  `${contato.endereco.cUF} ${contato.endereco.cCEP}`;

uiObs.textContent       = contato.cObs || '-';
uiNCod.textContent      = contato.identificacao.nCod;
uiNCodConta.textContent = contato.identificacao.nCodConta;
uiNCodVend.textContent  = contato.identificacao.nCodVend;

/* ➕ NOVO – personaliza a saudação */
const hBemVindo = divLogged.querySelector('h1');         // pega o <h1>
if (hBemVindo) {
  hBemVindo.textContent =
    `Olá ${contato.identificacao.cNome}, seja bem vindo`;
}

    loggedContainer.style.display = 'block';
  } catch (err) {
    console.error('[loadUserInfo] ', err.message);
  }
}

  // 4) Pré-preenche com localStorage
  const savedU = localStorage.getItem('user');
  const savedP = localStorage.getItem('password');
  if (savedU) inpUser.value = savedU;
  if (savedP) inpPass.value = savedP;

  // 8) Ao abrir a página, verifica se já está logado
  const status = await fetch(`${API_BASE}/api/auth/status`).then(r => r.json());
  // só conta como “já logado” se a senha salva NÃO for a padrão
  const savedPass = localStorage.getItem('password');
  if (status.loggedIn && savedPass && savedPass !== '123') {
    form.style.display            = 'none';
    updateMessageCount();
    
    loadUserInfo(status.user.id);
    moverDadosParaDireita();               // 🔻 NOVO
    
  
    // 🔻 NOVO
    divNotLogged.style.display = 'none';
    divLogged.style.display    = 'block';
    nomeUsuarioSpan.textContent = status.user.id;
  } else {
    // 🔻 NOVO – garante que o painel correto apareça deslogado
    divNotLogged.style.display = 'block';
    divLogged.style.display    = 'none';
  }
  
  

  // 9) Resto do seu código de abrir/fechar modal
// 9) Resto do seu código de abrir/fechar modal
// ➡  agora enviamos as três divs para dentro da função
bindAuthModal(
  overlay,
  divNotLogged,
  divLogged,
  nomeUsuarioSpan,
  moverDadosParaDireita,
  moverDadosParaEsquerda,
  loadUserInfo            // 🔻 NOVO
);



  
  // 9) Liga o logout para limpar a sessão e mostrar o form de novo
const btnLogout = overlay.querySelector('#btnLogout');
btnLogout.addEventListener('click', async () => {
  // chama o endpoint que você já tem em routes/auth.js
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });

  // limpa localStorage (caso tenha marcado "Lembrar-me")
  localStorage.removeItem('user');
  localStorage.removeItem('password');
  
  // volta a exibir o form e esconder o painel de boas-vindas
  form.style.display           = '';
  loggedContainer.style.display = 'none';

  // 🔻 NOVO – volta a exibir o bloco de não logado
  divNotLogged.style.display = 'block';
  divLogged.style.display    = 'none';
  moverDadosParaEsquerda();           // 🔻 NOVO

  
  // se você tiver a “troca de painel” Sign Up / Sign In, volte pra Sign In:
  overlay.querySelector('#container')
         .classList.remove('right-panel-active');
});

// 🔻 NOVO – mesmo handler para o botão do painel direito
const btnOverlayLogout = overlay.querySelector('#btnOverlayLogout');
btnOverlayLogout.addEventListener('click', () => btnLogout.click());  
  
  
  ;



});



// ➡  recebe as três referências como parâmetros
function bindAuthModal(
  overlay,
  divNotLogged,
  divLogged,
  nomeUsuarioSpan,
  moverDadosParaDireita,
  moverDadosParaEsquerda,
  loadUserInfo            // 🔻 NOVO
) {



  const profileArea = document.getElementById('profile-icon');
  const closeBtn    = overlay.querySelector('.close-auth');
  const formSignIn  = overlay.querySelector('#formSignIn');

  // abre modal ao clicar no perfil
  profileArea.addEventListener('click', e => {
    overlay.classList.add('is-active');
  });
  
  window.openLoginModal = () => overlay.classList.add('is-active');

  // fecha modal
  closeBtn.addEventListener('click', () => {
    overlay.classList.remove('is-active');
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('is-active');
  });

  // Alterna entre Sign Up / Sign In (já existente)
// Solicitar – grava pedido de reset para os administradores
overlay.querySelector('#signUp').addEventListener('click', async () => {
  const username = overlay.querySelector('#signInEmail').value.trim();
  if (!username) {
    alert('Preencha o campo usuário antes de solicitar.');
    return;
  }

  // envia o pedido para que os admins vejam em users.json
  const res = await fetch(`${API_BASE}/api/users/request-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || 'Falha ao registrar o pedido.');
    return;
  }

  alert('Pedido enviado! Um administrador fará a troca da sua senha.');
  // permanece na tela de login — não muda de painel
});


  overlay.querySelector('#signIn').addEventListener('click', () => {
    overlay.querySelector('#container').classList.remove('right-panel-active');
  });

// 0) guarda o id do usuário logado
let loggedUserId = null;

formSignIn.addEventListener('submit', async e => {
  e.preventDefault();
  const username = overlay.querySelector('#signInEmail').value.trim();
  const password = overlay.querySelector('#signInPassword').value.trim();
  const remember = overlay.querySelector('#rememberMe').checked;

  if (password === '123') {
    // confirma que o usuário ainda está com senha 123
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ user: username, senha: '123' })
    });
    if (!res.ok) {
      return alert('Usuário não encontrado ou a senha já foi alterada.');
    }
  
    const { user: userData } = await res.json();
    loggedUserId = userData.id;   // mantém sessão ativa
  
    overlay.querySelector('#container').classList.add('right-panel-active');
    overlay.querySelector('#formCriarConta input[name="user"]').value = username;
    return; // não continua para o login normal
  }
  

  // 2) fluxo normal de login
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: username, senha: password }),
    credentials: 'include'
  });
  if (!res.ok) {
    const err = await res.json();
    return alert(err.error || 'Usuário ou senha inválidos');
  }
  const { user: userData } = await res.json();

  // grava ou limpa localStorage
  if (remember) {
    localStorage.setItem('user', username);
    localStorage.setItem('password', password);
  } else {
    localStorage.removeItem('user');
    localStorage.removeItem('password');
  }

  // mostra painel de boas-vindas e fecha modal
  overlay.querySelector('#formSignIn').style.display        = 'none';
  await updateMessageCount();
  overlay.classList.remove('is-active');
  
  // 🔻 NOVO – oculta bloco “Olá colaborador” e mostra o painel logado
  divNotLogged.style.display = 'none';
  divLogged.style.display    = 'block';
  nomeUsuarioSpan.textContent = userData.id;
  loadUserInfo(userData.id);             // 🔻 NOVO
  moverDadosParaDireita();               // 🔻 NOVO


});



// 3) listener para salvar a nova senha
const formCriar = overlay.querySelector('#formCriarConta');
// listener do  formCriarConta
formCriar.addEventListener('submit', async e => {
  e.preventDefault();
  const newPass     = overlay.querySelector('#newPassword').value.trim();
  const confirmPass = overlay.querySelector('#confirmPassword').value.trim();
  if (newPass !== confirmPass) return alert('As senhas não conferem');

  /* 1. PUT  /api/users/:id  – grava a nova senha ------------------- */
  const ok = await fetch(`/api/users/${loggedUserId}`, {
    method: 'PUT',
    headers: { 'Content-Type':'application/json' },
    credentials: 'include',
    body: JSON.stringify({ password: newPass })
  }).then(r => r.ok);
  if (!ok) return alert('Erro ao atualizar a senha');


  /* 2. NOVO fluxo -------------------------------------------------- */
  // encerra a sessão temporária (senha 123)
  await fetch(`${API_BASE}/api/auth/logout`, { method:'POST', credentials:'include' });

  // volta para o painel de login
  overlay.querySelector('#container').classList.remove('right-panel-active');
  overlay.querySelector('.sign-up-container').style.display  = 'none';
  overlay.querySelector('.sign-in-container').style.display  = 'block';
  overlay.querySelector('#signInPassword').value = '';        // limpa campo
  overlay.querySelector('#signInPassword').focus();           // cursor

  // NÃO grava nova senha no localStorage
  localStorage.removeItem('password');

  alert('Senha alterada! Entre novamente com seu usuário e a nova senha.');
}); 
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
