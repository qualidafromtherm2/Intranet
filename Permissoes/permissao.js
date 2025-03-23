// Permissoes/permissao.js
document.addEventListener("DOMContentLoaded", function() {
    const modalPermissoes = document.getElementById("modalPermissoes");
    const closeModal = document.getElementById("closeModal");
    const btnSalvarPermissoes = document.getElementById("btnSalvarPermissoes");
  
    // Função para abrir o modal
    function abrirModalPermissoes() {
        console.log("abrirModalPermissoes chamada");
        const modal = document.getElementById("modalPermissoes");
        if (modal) {
          modal.style.display = "block";
        }
      }
      window.abrirModalPermissoes = abrirModalPermissoes;
      
      
  
    // Função para fechar o modal
    function fecharModalPermissoes() {
      modalPermissoes.style.display = "none";
    }
  
    // Fecha o modal ao clicar no "X"
    if (closeModal) {
      closeModal.addEventListener("click", fecharModalPermissoes);
    }
  
    // Fecha o modal ao clicar fora dele
    window.addEventListener("click", function(event) {
      if (event.target === modalPermissoes) {
        fecharModalPermissoes();
      }
    });
  
    // Salvar permissões
    btnSalvarPermissoes.addEventListener("click", async function() {
      const userSelecionado = document.getElementById("userSelect").value.trim();
      const checkboxes = document.querySelectorAll(".permissao-checkbox");
      const permissoesSelecionadas = [];
      
      checkboxes.forEach(function(checkbox) {
        if (checkbox.checked) {
          permissoesSelecionadas.push(checkbox.value);
        }
      });
      
      if (!userSelecionado) {
        alert("Por favor, selecione um usuário.");
        return;
      }
      
      const payload = {
        user: userSelecionado,
        permissoes: permissoesSelecionadas // array de strings
      };
      
      try {
        const response = await fetch("/api/login/atualizar-permissoes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (response.ok && result.success) {
          alert("Permissões atualizadas com sucesso!");
          fecharModalPermissoes();
        } else {
          alert("Erro ao atualizar permissões: " + result.message);
        }
      } catch (error) {
        console.error("Erro na atualização de permissões:", error);
        alert("Ocorreu um erro ao atualizar as permissões.");
      }
    });
  
    // Expor a função para ser chamada de fora (caso precise)
    window.abrirModalPermissoes = abrirModalPermissoes;
  });
  

  // Permissoes/permissao.js

function initModalPermissoes() {
    const modalPermissoes = document.getElementById("modalPermissoes");
    const closeModal = document.getElementById("closeModal");
    const btnSalvarPermissoes = document.getElementById("btnSalvarPermissoes");
  
    // Função para abrir o modal
    function abrirModalPermissoes() {
      console.log("abrirModalPermissoes chamada");
      const modal = document.getElementById("modalPermissoes");
      if (modal) {
        modal.style.display = "block";
      }
    }
    // Expor a função para o global
    window.abrirModalPermissoes = abrirModalPermissoes;
  
    // Função para fechar o modal
    function fecharModalPermissoes() {
      if (modalPermissoes) {
        modalPermissoes.style.display = "none";
      }
    }
  
    // Fecha o modal ao clicar no "X"
    if (closeModal) {
      closeModal.addEventListener("click", fecharModalPermissoes);
    }
  
    // Fecha o modal ao clicar fora dele
    window.addEventListener("click", function(event) {
      if (event.target === modalPermissoes) {
        fecharModalPermissoes();
      }
    });
  
    // Salvar permissões
    if (btnSalvarPermissoes) {
      btnSalvarPermissoes.addEventListener("click", async function() {
        const userSelecionado = document.getElementById("userSelect").value.trim();
        const checkboxes = document.querySelectorAll(".permissao-checkbox");
        const permissoesSelecionadas = [];
  
        checkboxes.forEach(function(checkbox) {
          if (checkbox.checked) {
            permissoesSelecionadas.push(checkbox.value);
          }
        });
  
        if (!userSelecionado) {
          alert("Por favor, selecione um usuário.");
          return;
        }
  
        const payload = {
          user: userSelecionado,
          permissoes: permissoesSelecionadas // array de strings
        };
  
        try {
          const response = await fetch("/api/login/atualizar-permissoes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const result = await response.json();
          if (response.ok && result.success) {
            alert("Permissões atualizadas com sucesso!");
            fecharModalPermissoes();
          } else {
            alert("Erro ao atualizar permissões: " + result.message);
          }
        } catch (error) {
          console.error("Erro na atualização de permissões:", error);
          alert("Ocorreu um erro ao atualizar as permissões.");
        }
      });
    }
  }
  
  // Se o DOM já estiver pronto, inicialize imediatamente; caso contrário, aguarde.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initModalPermissoes);
  } else {
    initModalPermissoes();
  }
  