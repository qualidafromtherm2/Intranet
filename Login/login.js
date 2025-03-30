// Login/login.js

// ---------------------- BOTÕES PARA ALTERNAR PAINEL ----------------------
const signUpButton = document.getElementById('signUp');
const signInButton = document.getElementById('signIn');
const container = document.getElementById('container');

if (signUpButton) {
  signUpButton.addEventListener('click', () => {
    if (container) container.classList.add("right-panel-active");
  });
}

if (signInButton) {
  signInButton.addEventListener('click', () => {
    if (container) container.classList.remove("right-panel-active");
  });
}

// ---------------------- CRIAR CONTA ----------------------
const formCriarConta = document.getElementById('formCriarConta');
if (formCriarConta) {
  formCriarConta.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = formCriarConta.user.value.trim();
    const email = formCriarConta.email.value.trim();
    const password = formCriarConta.password.value.trim();

    try {
      const response = await fetch('/api/login/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, email, password })
      });
      const result = await response.json();

      if (result.success) {
        alert(result.message);
        if (signInButton) signInButton.click();
      } else {
        alert("Erro: " + result.message);
        if (result.message.includes("já está cadastrado")) {
          const signInEmail = document.getElementById('signInEmail');
          const signInPassword = document.getElementById('signInPassword');
          if (signInEmail) signInEmail.value = email;
          if (signInPassword) signInPassword.value = password;
          if (signInButton) signInButton.click();
        }
      }
    } catch (error) {
      console.error('Erro na requisição:', error);
      alert("Ocorreu um erro ao cadastrar. Tente novamente.");
    }
  });
}

// ---------------------- ENTRAR (LOGIN) ----------------------
const formSignIn = document.getElementById('formSignIn');
const loggedInContainer = document.getElementById('loggedInContainer');
const btnLogout = document.getElementById('btnLogout');

if (formSignIn) {
  formSignIn.addEventListener('submit', async (event) => {
    event.preventDefault();
    const signInEmailElem = document.getElementById('signInEmail');
    const signInPasswordElem = document.getElementById('signInPassword');
    const email = signInEmailElem ? signInEmailElem.value.trim() : '';
    const password = signInPasswordElem ? signInPasswordElem.value.trim() : '';
    try {
      const response = await fetch('http://localhost:5001/api/login/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        // Salva as permissões no localStorage
        localStorage.setItem('userPermissoes', JSON.stringify(result.user.permissoes));
        // Atualiza a interface e recarrega a página pai para que todas as páginas atualizem os botões
        if (formSignIn) formSignIn.style.visibility = 'hidden';
        const overlayNotLoggedIn = document.getElementById('overlayNotLoggedIn');
        const overlayLoggedIn = document.getElementById('overlayLoggedIn');
        if (overlayNotLoggedIn) overlayNotLoggedIn.style.display = 'none';
        if (overlayLoggedIn) overlayLoggedIn.style.display = 'block';
        const nomeUsuarioOverlay = document.getElementById('nomeUsuarioOverlay');
        if (result.user && result.user.user && nomeUsuarioOverlay) {
          nomeUsuarioOverlay.textContent = result.user.user;
        }
        setTimeout(() => {
          window.top.location.reload();
        }, 500);
      } else {
        alert("Erro: " + result.message);
      }
      
    } catch (error) {
      console.error('Erro na requisição de login:', error);
      alert("Ocorreu um erro ao fazer login. Tente novamente.");
    }
  });
}

// ---------------------- LOGOUT (DENTRO DO FORM "ENTRAR") ----------------------
if (btnLogout) {
  btnLogout.addEventListener('click', async () => {
    try {
      const response = await fetch('http://localhost:5001/api/login/logout', {
        method: 'POST',
        credentials: 'include'
      });
      const result = await response.json();
      if (result.success) {
        // Recarrega a página pai para bloquear os botões, mantendo apenas "Início" e "Usuário"
        setTimeout(() => {
          window.top.location.reload();
        }, 500);
      }
    } catch (error) {
      console.error('Erro no logout:', error);
      alert("Ocorreu um erro ao deslogar.");
    }
  });
}

// ---------------------- LOGOUT (NO OVERLAY) ----------------------
const btnOverlayLogout = document.getElementById('btnOverlayLogout');
if (btnOverlayLogout) {
  btnOverlayLogout.addEventListener('click', async () => {
    try {
      const response = await fetch('http://localhost:5001/api/login/logout', {
        method: 'POST',
        credentials: 'include'
      });
      const result = await response.json();
      if (result.success) {
        setTimeout(() => {
          window.top.location.reload();
        }, 500);


      }
    } catch (error) {
      console.error('Erro no logout:', error);
      alert("Ocorreu um erro ao deslogar.");
    }
  });
}

// ---------------------- CHECK LOGIN STATUS (PERSISTÊNCIA) ----------------------
async function checkLoginStatus() {
  try {
    const response = await fetch('http://localhost:5001/api/login/profile', {
      method: 'GET',
      credentials: 'include'
    });
    const data = await response.json();
    if (response.ok && data.success) {
      ajustarTelaLogado(data.user);
    } else {
      ajustarTelaDeslogado();
    }
  } catch (err) {
    console.log("Erro ao checar login:", err);
    ajustarTelaDeslogado();
  }
}

function ajustarTelaLogado(user) {
  if (formSignIn) formSignIn.style.visibility = 'hidden';
  const overlayNotLoggedIn = document.getElementById('overlayNotLoggedIn');
  if (overlayNotLoggedIn) overlayNotLoggedIn.style.display = 'none';
  const overlayLoggedIn = document.getElementById('overlayLoggedIn');
  if (overlayLoggedIn) overlayLoggedIn.style.display = 'block';
  const nomeUsuarioOverlay = document.getElementById('nomeUsuarioOverlay');
  if (user && user.user && nomeUsuarioOverlay) {
    nomeUsuarioOverlay.textContent = user.user;
  }
  if (user && Array.isArray(user.permissoes)) {
    aplicarPermissoes(user.permissoes);
  }
}

function ajustarTelaDeslogado() {
  if (formSignIn) formSignIn.style.visibility = 'visible';
  const overlayNotLoggedIn = document.getElementById('overlayNotLoggedIn');
  if (overlayNotLoggedIn) overlayNotLoggedIn.style.display = 'block';
  const overlayLoggedIn = document.getElementById('overlayLoggedIn');
  if (overlayLoggedIn) overlayLoggedIn.style.display = 'none';

  // Obtém os elementos de login localmente
  const signInEmail = document.getElementById('signInEmail');
  const signInPassword = document.getElementById('signInPassword');
  if (signInEmail) signInEmail.value = '';
  if (signInPassword) signInPassword.value = '';

  if (container) container.classList.remove('right-panel-active');
  const signInDiv = document.querySelector('.sign-in-container');
  if (signInDiv) signInDiv.style.transform = '';
  const signUpDiv = document.querySelector('.sign-up-container');
  if (signUpDiv) signUpDiv.style.transform = '';
  
  aplicarPermissoes([]);
}

// Verifica o status de login assim que o DOM estiver carregado
document.addEventListener("DOMContentLoaded", function() {
  checkLoginStatus();
});

// ---------------------- PERMISSÕES NO MENU ----------------------
function aplicarPermissoes(permissoes) {
  const permissoesUpper = permissoes.map(p => p.toUpperCase());
  const elementos = document.querySelectorAll('[data-permissao]');
  elementos.forEach(el => {
    const perm = el.getAttribute('data-permissao').trim().toUpperCase();
    if (perm === 'INÍCIO' || perm === 'USUÁRIO') {
      el.style.setProperty('display', 'block', 'important');
    } else {
      el.style.setProperty('display', permissoesUpper.includes(perm) ? 'block' : 'none', 'important');
    }
  });
}




document.addEventListener("DOMContentLoaded", function() {
  const permissoes = JSON.parse(localStorage.getItem('userPermissoes')) || [];
  console.log("LocalStorage userPermissoes:", permissoes);
  aplicarPermissoes(permissoes);
});



// ---------------------- MODAL DE PERMISSÕES ----------------------
const modalPermissoes = document.getElementById('modalPermissoes');
const closeModal = document.getElementById('closeModal');
if (closeModal) {
  closeModal.addEventListener('click', () => {
    if (modalPermissoes) modalPermissoes.style.display = 'none';
  });
}
window.addEventListener('click', (event) => {
  if (modalPermissoes && event.target === modalPermissoes) {
    modalPermissoes.style.display = 'none';
  }
});
function abrirModalPermissoes() {
  if (modalPermissoes) modalPermissoes.style.display = 'block';
}
const btnConfigurarPermissoes = document.getElementById('btnConfigurarPermissoes');
if (btnConfigurarPermissoes) {
  btnConfigurarPermissoes.addEventListener('click', (e) => {
    e.preventDefault();
    abrirModalPermissoes();
  });
}

// ---------------------- ATUALIZAÇÃO DE PERMISSÕES (MODAL) ----------------------
const btnSalvarPermissoes = document.getElementById('btnSalvarPermissoes');
if (btnSalvarPermissoes) {
  btnSalvarPermissoes.addEventListener('click', async () => {
    const userSelectElem = document.getElementById('userSelect');
    const userSelecionado = userSelectElem ? userSelectElem.value.trim() : '';
    const checkboxes = document.querySelectorAll('.permissao-checkbox');
    const permissoesSelecionadas = [];
    checkboxes.forEach(checkbox => {
      if (checkbox.checked) {
        permissoesSelecionadas.push(checkbox.value);
      }
    });
    if (!userSelecionado) {
      alert('Por favor, selecione um usuário.');
      return;
    }
    const payload = {
      user: userSelecionado,
      permissoes: permissoesSelecionadas
    };
    try {
      const response = await fetch('/api/login/atualizar-permissoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (response.ok && result.success) {
        alert('Permissões atualizadas com sucesso!');
        if (modalPermissoes) modalPermissoes.style.display = 'none';
      } else {
        alert("Erro ao atualizar permissões: " + result.message);
      }
    } catch (error) {
      console.error('Erro na atualização de permissões:', error);
      alert("Ocorreu um erro ao atualizar as permissões.");
    }
  });
}
