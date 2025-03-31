// Define a URL base da API conforme o ambiente
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:5001'
  : 'https://intranet-fromtherm.onrender.com';

// ---------------------- BOTÕES PARA ALTERNAR PAINEL ----------------------
const signUpButton = document.getElementById('signUp');
const signInButton = document.getElementById('signIn');
const container = document.getElementById('container');

if (signUpButton) {
  signUpButton.addEventListener('click', () => {
    if (container) container.classList.add("right-panel-active");
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
      const response = await fetch(`${API_URL}/api/login/register`, {
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
      const response = await fetch(`${API_URL}/api/login/login`, {
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
      const response = await fetch(`${API_URL}/api/login/logout`, {
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
      const response = await fetch('/api/login/logout', {
        method: 'POST',
        credentials: 'include'
      });
      const result = await response.json();
      if (result.success) {
        // Tornar o form visível novamente
        formSignIn.style.visibility = 'visible';

        // Restaura overlay para "não logado"
        document.getElementById('overlayNotLoggedIn').style.display = 'block';
        document.getElementById('overlayLoggedIn').style.display = 'none';

        // Remove a classe que desloca o painel
        container.classList.remove('right-panel-active');

        // Limpa campos
        document.getElementById('signInEmail').value = '';
        document.getElementById('signInPassword').value = '';
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
    const response = await fetch('/api/login/profile', {
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

  // Limpa campos
  signInEmail.value = '';
  signInPassword.value = '';

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

// Seleciona elementos do modal
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
// Fecha o modal ao clicar fora dele
window.addEventListener('click', (event) => {
  if (event.target == modalPermissoes) {
    modalPermissoes.style.display = 'none';
  }
});


async function carregarUsuarios() {
    try {
      const response = await fetch('/api/users'); // Suponha que este endpoint retorne os usuários
      const data = await response.json();
      const usersList = document.getElementById('usersList');
      usersList.innerHTML = ''; // Limpa a lista
  
      data.forEach(user => {
        const option = document.createElement('option');
        option.value = user.user; // ou user.nome, conforme seu campo
        usersList.appendChild(option);
      });
    } catch (error) {
      console.error("Erro ao carregar usuários:", error);
    }
  }
  
  // Chame essa função ao abrir o modal, por exemplo:
  // abrirModalPermissoes() { carregarUsuarios(); ... }

  
  const btnSalvarPermissoes = document.getElementById('btnSalvarPermissoes');

btnSalvarPermissoes.addEventListener('click', async () => {
  const userSelecionado = document.getElementById('userSelect').value.trim();
  // Seleciona todos os checkboxes de permissão
  const checkboxes = document.querySelectorAll('.permissao-checkbox');
  const permissoesSelecionadas = [];
  
  checkboxes.forEach(checkbox => {
    if (checkbox.checked) {
      permissoesSelecionadas.push(checkbox.value);
    }
  });
  
  // Validação básica
  if (!userSelecionado) {
    alert('Por favor, selecione um usuário.');
    return;
  }
  
  // Exemplo de payload para o back-end:
  const payload = {
    user: userSelecionado,
    permissoes: permissoesSelecionadas // array de strings
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
      modalPermissoes.style.display = 'none';
    } else {
      alert("Erro ao atualizar permissões: " + result.message);
    }
  } catch (error) {
    console.error('Erro na atualização de permissões:', error);
    alert("Ocorreu um erro ao atualizar as permissões.");
  }
});

document.addEventListener("DOMContentLoaded", function() {
    const btnConfigurarPermissoes = document.getElementById('btnConfigurarPermissoes');
    if (btnConfigurarPermissoes) {
      btnConfigurarPermissoes.addEventListener('click', function(e) {
        e.preventDefault();
        if (typeof abrirModalPermissoes === "function") {
          abrirModalPermissoes();
        } else {
          console.error("Função abrirModalPermissoes não encontrada.");
        }
      });
    }
  });
  
  