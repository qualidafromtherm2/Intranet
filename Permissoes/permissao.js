(function(){
  // Variável global para armazenar os dados do CSV
  let loginData = [];

  function carregarUsuarios() {
    const userSelect = document.getElementById("userSelect");
    if (!userSelect) return;
    
    fetch("csv/Login.csv")
      .then(response => {
        if (!response.ok) {
          throw new Error("Erro ao tentar carregar Login.csv: " + response.status);
        }
        return response.text();
      })
      .then(csvText => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: function(results) {
            loginData = results.data; // armazena os dados globalmente
            // Limpa as opções existentes, mantendo o placeholder se existir
            const placeholder = userSelect.querySelector("option[value='']");
            userSelect.innerHTML = "";
            if (placeholder) {
              userSelect.appendChild(placeholder);
            }
            // Adiciona cada usuário (coluna "User") ao <select>
            loginData.forEach(row => {
              if (row.User && row.User.trim() !== "") {
                const option = document.createElement("option");
                option.value = row.User.trim();
                option.textContent = row.User.trim();
                userSelect.appendChild(option);
              }
            });
          }
        });
      })
      .catch(error => {
        console.error("Erro ao carregar Login.csv:", error);
      });
    
    // Adiciona o listener para quando um usuário for selecionado
    userSelect.addEventListener('change', function() {
      const selectedUser = this.value.trim();
      if (!selectedUser) return;
      // Procura o usuário no CSV
      const userData = loginData.find(row => row.User.trim() === selectedUser);
      if (userData && userData.Permissoes) {
        // Divide a string de permissões e remove espaços extras
        const permissoes = userData.Permissoes.split(';').map(item => item.trim());
        // Percorre todos os checkboxes e marca aqueles cujos valores estão na lista
        const checkboxes = document.querySelectorAll(".menu-item-checkbox");
        checkboxes.forEach(checkbox => {
          checkbox.checked = permissoes.includes(checkbox.value);
        });
      }
    });
  }

  function initModalPermissoes() {
    const modalPermissoes = document.getElementById("modalPermissoes");
    const closeModal = document.getElementById("closeModal");
    const btnSalvarPermissoes = document.getElementById("btnSalvarPermissoes");

    // Carrega os usuários do CSV e adiciona o listener
    carregarUsuarios();

    // Função auxiliar para criar um item da lista com texto à esquerda e checkbox à direita
    function createMenuItem(text, value) {
      const li = document.createElement("li");
      li.classList.add("menu-item");
      
      const spanText = document.createElement("span");
      spanText.classList.add("menu-item-label");
      spanText.textContent = text;
      
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.classList.add("menu-item-checkbox");
      checkbox.value = value;
      
      li.appendChild(spanText);
      li.appendChild(checkbox);
      return li;
    }

    // Função para listar os botões dos menus (index.html e menu_produto.html)
    function listarBotoesMenu() {
      const container = document.getElementById("listaBotoesMenu");
      if (container) {
        container.innerHTML = "";

        // Seção para o menu principal (index.html)
        const mainMenuHeader = document.createElement("h4");
        mainMenuHeader.textContent = "index.html";
        mainMenuHeader.classList.add("menu-section-title");
        container.appendChild(mainMenuHeader);

        const ulMain = document.createElement("ul");
        const mainButtons = document.querySelectorAll("nav.main-menu ul li a");
        mainButtons.forEach((botao) => {
          const text = botao.textContent.trim();
          const value = botao.getAttribute("data-permissao") || text;
          ulMain.appendChild(createMenuItem(text, value));
        });
        container.appendChild(ulMain);

        // Linha divisória entre os menus
        const divider = document.createElement("hr");
        divider.classList.add("divider");
        container.appendChild(divider);

        // Seção para o Menu Produto (menu_produto.html)
        const produtoHeader = document.createElement("h4");
        produtoHeader.textContent = "menu_produto.html";
        produtoHeader.classList.add("menu-section-title");
        container.appendChild(produtoHeader);

        const ulProduto = document.createElement("ul");
        fetch("menu_produto.html")
          .then(response => {
            if (!response.ok) {
              throw new Error("Erro ao tentar carregar menu_produto.html: " + response.status);
            }
            return response.text();
          })
          .then(htmlText => {
            let parser = new DOMParser();
            let doc = parser.parseFromString(htmlText, "text/html");
            let produtoButtons = doc.querySelectorAll("ul.accordion li ul.submenu li a");
            produtoButtons.forEach((btn) => {
              const text = btn.textContent.trim();
              const value = btn.getAttribute("data-permissao") || text;
              ulProduto.appendChild(createMenuItem(text, value));
            });
            container.appendChild(ulProduto);
          })
          .catch(error => {
            console.error("Erro ao carregar menu_produto.html:", error);
          });
      }
    }

    function abrirModalPermissoes() {
      if (modalPermissoes) {
        modalPermissoes.style.display = "block";
        listarBotoesMenu();
      }
    }
    window.abrirModalPermissoes = abrirModalPermissoes;

    function fecharModalPermissoes() {
      if (modalPermissoes) {
        modalPermissoes.style.display = "none";
      }
    }

    if (closeModal) {
      closeModal.addEventListener("click", fecharModalPermissoes);
    }
    window.addEventListener("click", function(event) {
      if (event.target === modalPermissoes) {
        fecharModalPermissoes();
      }
    });

    if (btnSalvarPermissoes) {
      btnSalvarPermissoes.addEventListener("click", async function() {
        const userSelecionado = document.getElementById("userSelect").value.trim();
        const menuCheckboxes = document.querySelectorAll(".menu-item-checkbox");
        const permissoesSelecionadas = [];
        
        menuCheckboxes.forEach(function(checkbox) {
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
          permissoes: permissoesSelecionadas
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

  if (document.readyState !== "loading") {
    initModalPermissoes();
  } else {
    document.addEventListener("DOMContentLoaded", initModalPermissoes);
  }
})();
