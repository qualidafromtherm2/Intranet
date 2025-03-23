// Login/login.js

// ---------------------- BOTÕES PARA ALTERNAR PAINEL ----------------------
const signUpButton = document.getElementById('signUp');
const signInButton = document.getElementById('signIn');
const container = document.getElementById('container');

// Se clicar em "Inscrever-se" no overlay, desloca painel
if (signUpButton) {
  signUpButton.addEventListener('click', () => {
    container.classList.add("right-panel-active");
  });
}

// Se clicar em "Entrar" no overlay, volta painel
if (signInButton) {
  signInButton.addEventListener('click', () => {
    container.classList.remove("right-panel-active");
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
        // Ex: "Usuário cadastrado com sucesso" ou "Senha cadastrada..."
        alert(result.message);

        // Muda para a aba Entrar (painel de login)
        signInButton.click();

        // Se quiser preencher automaticamente (caso cadastro novo), pode fazer:
        // document.getElementById('signInEmail').value = email;
        // document.getElementById('signInPassword').value = password;

      } else {
        // Erro (ex.: já existe)
        alert("Erro: " + result.message);

        // Se a mensagem indicar "usuário já está cadastrado", faça:
        if (result.message.includes("já está cadastrado")) {
          // 1) Preenche primeiro
          document.getElementById('signInEmail').value = email;
          document.getElementById('signInPassword').value = password;
          // 2) Em seguida, força a aba "Entrar"
          signInButton.click();
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
const welcomeMsg = document.getElementById('welcomeMsg');
const btnLogout = document.getElementById('btnLogout');

if (formSignIn) {
  formSignIn.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('signInEmail').value.trim();
    const password = document.getElementById('signInPassword').value.trim();

    try {
      const response = await fetch('http://localhost:5001/api/login/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      const result = await response.json();

      if (response.ok && result.success) {
        // Ao logar, vamos apenas esconder o formulário (sem alert)
        formSignIn.style.visibility = 'hidden';

        // Troca overlay: não logado -> logado
        document.getElementById('overlayNotLoggedIn').style.display = 'none';
        document.getElementById('overlayLoggedIn').style.display = 'block';

        // Seta o nome do usuário no p (ex.: result.user.user)
        if (result.user && result.user.user) {
          document.getElementById('nomeUsuarioOverlay').textContent = result.user.user;
        }

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
        // Se desejar, exiba mensagem de logout
        // alert("Você saiu da conta.");

        // Restaura a tela de login
        formSignIn.style.visibility = 'visible';
        loggedInContainer.style.display = 'none';

        // Restaura overlay para "não logado"
        document.getElementById('overlayNotLoggedIn').style.display = 'block';
        document.getElementById('overlayLoggedIn').style.display = 'none';

        // Remove a classe que move os painéis
        container.classList.remove('right-panel-active');

        // Limpa transforms diretos, se existirem
        const signInDiv = document.querySelector('.sign-in-container');
        const signUpDiv = document.querySelector('.sign-up-container');
        if (signInDiv) signInDiv.style.transform = '';
        if (signUpDiv) signUpDiv.style.transform = '';

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

// ---------------------- LOGOUT (SE USAR NO OVERLAY) ----------------------
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
      credentials: 'include' // para enviar o cookie da sessão
    });
    const data = await response.json();
    if (response.ok && data.success) {
      // Usuário está logado => Ajustar a tela
      console.log("Usuário logado:", data.user);
      ajustarTelaLogado(data.user);
    } else {
      // Não está logado ou erro 401
      console.log("Não está logado");
      ajustarTelaDeslogado();
    }
  } catch (err) {
    console.log("Erro ao checar login:", err);
    ajustarTelaDeslogado();
  }
}

function ajustarTelaLogado(user) {
  // user.permissoes é ex: ["MENU_INICIO","MENU_MENSAGENS","MENU_SINCRONIZAR"]
  formSignIn.style.visibility = 'hidden';
  document.getElementById('overlayNotLoggedIn').style.display = 'none';
  document.getElementById('overlayLoggedIn').style.display = 'block';

  if (user && user.user) {
    document.getElementById('nomeUsuarioOverlay').textContent = user.user;
  }

  // Se o usuário tiver permissões definidas, aplicamos
  if (user && Array.isArray(user.permissoes)) {
    aplicarPermissoes(user.permissoes);
  }
}

function ajustarTelaDeslogado() {
  // Deixa o form visível
  formSignIn.style.visibility = 'visible';

  // Overlay => exibe “Não logado”, oculta “Logado”
  document.getElementById('overlayNotLoggedIn').style.display = 'block';
  document.getElementById('overlayLoggedIn').style.display = 'none';

  // Limpa campos
  signInEmail.value = '';
  signInPassword.value = '';

  // Remove classes transform
  container.classList.remove('right-panel-active');
  const signInDiv = document.querySelector('.sign-in-container');
  const signUpDiv = document.querySelector('.sign-up-container');
  if (signInDiv) signInDiv.style.transform = '';
  if (signUpDiv) signUpDiv.style.transform = '';
  
  // Aplica permissão vazia (tudo bloqueado)
  aplicarPermissoes([]);
}

// Executa ao carregar a página
checkLoginStatus();

// ---------------------- PERMISSÕES NO MENU ----------------------
function aplicarPermissoes(permissoes) {
  // permissoes é um array, ex: ["MENU_INICIO","MENU_MENSAGENS"]
  // Cada botão do menu deve ter class="menu-btn" e data-permissao="MENU_INICIO"

  const botoes = document.querySelectorAll('.menu-btn');
  botoes.forEach(btn => {
    const perm = btn.getAttribute('data-permissao');

    // Se 'perm' existir no array permissoes, liberamos
    if (permissoes.includes(perm)) {
      btn.style.pointerEvents = 'auto'; // Clicável
      btn.style.opacity = '1';         // Visual normal
    } else {
      // Caso contrário, bloqueia
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.5';
    }
  });
}


// Seleciona elementos do modal
const modalPermissoes = document.getElementById('modalPermissoes');
const closeModal = document.getElementById('closeModal');
if (closeModal) {
  closeModal.addEventListener('click', () => {
    document.getElementById('modalPermissoes').style.display = 'none';
  });
}

// Também pode fechar o modal ao clicar fora dele:
window.addEventListener('click', (event) => {
  const modalPermissoes = document.getElementById('modalPermissoes');
  if (event.target === modalPermissoes) {
    modalPermissoes.style.display = 'none';
  }
});


// Função para abrir o modal (você pode chamar essa função via um botão no menu, por exemplo)
function abrirModalPermissoes() {
  modalPermissoes.style.display = 'block';
  // Se desejar, carregue a lista de usuários via AJAX
}

// Fecha o modal ao clicar no X
closeModal.addEventListener('click', () => {
  modalPermissoes.style.display = 'none';
});

// Vincula o clique do botão à função
const btnConfigurarPermissoes = document.getElementById('btnConfigurarPermissoes');
if (btnConfigurarPermissoes) {
  btnConfigurarPermissoes.addEventListener('click', (e) => {
    e.preventDefault(); // Impede o comportamento padrão do link
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
  
  