/************************************************
 * Carrega CSV e separa os dados de Posto de Trabalho
 * Espera um CSV no formato:
 * M,Montagem
 * T,Teste01
 * M,Higienização
 * M,Teste final
 * P,Base
 * P,Painel
 * P,motor ventilador
 * P,Teste
 ************************************************/
function carregarPostoTrabalho() {
  return fetch('csv/Posto_trabalho.csv')
    .then(resp => resp.text())
    .then(csvText => {
      // Remove BOM (Byte Order Mark) se existir
      if (csvText.charCodeAt(0) === 0xFEFF) {
        csvText = csvText.slice(1);
      }
      return new Promise((resolve) => {
        Papa.parse(csvText, {
          skipEmptyLines: true, // Ignora linhas vazias
          complete: (results) => {
            resolve(results.data);
          }
        });
      });
    });
}

/************************************************
 * Cria as linhas (M, T e P) de ícones (M1, T1, P1, etc.)
 ************************************************/
function criarLinhasMP() {
  return carregarPostoTrabalho().then((linhas) => {
    const arrM = [];
    const arrT = [];
    const arrP = [];

    // Percorre cada linha do CSV: row[0] = "M", "T" ou "P"; row[1] = nome do posto
    for (const row of linhas) {
      const tipo = row[0] ? row[0].trim() : "";
      const nome = row[1] ? row[1].trim() : "";
      if (!tipo || !nome) continue;

      if (tipo === "M") {
        arrM.push(nome);
      } else if (tipo === "T") {
        arrT.push(nome);
      } else if (tipo === "P") {
        arrP.push(nome);
      }
    }

    // Função auxiliar para criar a lista de botões para cada grupo,
    // adicionando uma classe extra para identificação (grupo-X)
    function criarListaBotao(arr, letra, cor) {
      const ul = document.createElement("ul");
      ul.classList.add("sub-tabs-linha", "grupo-" + letra);
      arr.forEach((nome, index) => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.classList.add("round-button");
        button.dataset.color = cor;
        // Define o rótulo do botão (ex: "M1", "T1", "P1", etc.)
        button.innerHTML = `<span>${letra + (index + 1)}</span>`;
        // Define o title para exibir o nome do posto ao passar o mouse
        button.title = nome;
        // Ajusta os estilos do <span>
        const span = button.querySelector('span');
        span.style.fontSize = '25.6px';
        span.style.fontWeight = 'bold';
        // Define um contorno circular
        button.style.border = '2px solid #000';
        li.appendChild(button);
        ul.appendChild(li);
      });
      return ul;
    }

    // Cria as três ULs para M, T e P
    const ulM = criarListaBotao(arrM, "M", "green");
    const ulT = criarListaBotao(arrT, "T", "orange");
    const ulP = criarListaBotao(arrP, "P", "blue");

    // Insere todas as ULs no container, mas vamos mostrar só uma por vez
    const container = document.getElementById("postoTrabalhoLinhas");
    if (!container) {
      console.warn("Elemento #postoTrabalhoLinhas não encontrado.");
      return;
    }
    container.innerHTML = "";
    container.appendChild(ulM);
    container.appendChild(ulT);
    container.appendChild(ulP);

    // Inicialmente, exibe apenas o grupo "P" (Preparação)
    ulM.style.display = "none";
    ulT.style.display = "none";
    ulP.style.display = "flex";

    return;
  });
}

/************************************************
 * Funções para abrir e fechar o modal de Produção
 ************************************************/
function abrirProducaoModal() {
  const modal = document.getElementById('modalProducao');
  if (!modal) {
    console.error("Elemento do modal (modalProducao) não encontrado.");
    return;
  }
  modal.style.display = 'flex'; // Exibe o modal

  // Aguarda um breve tempo para garantir que o modal esteja no DOM
  setTimeout(() => {
    initAmazingTabs();
    criarLinhasMP().then(() => {
      // Posiciona o círculo no primeiro botão principal (Preparação)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const mainButtons = document.querySelectorAll(".main-tabs .round-button");
          if (mainButtons.length > 0) {
            mainButtons[0].click();
          } else {
            console.warn("Nenhum botão principal encontrado para posicionar o círculo.");
          }
        });
      });
    });
  }, 100);
}

function fecharProducaoModal() {
  const modal = document.getElementById('modalProducao');
  if (modal) {
    modal.style.display = 'none';
  }
}

/************************************************
 * Lógica das Amazing Tabs e controle dos grupos
 ************************************************/
function initAmazingTabs() {
  const mainTabs = document.querySelector(".main-tabs");
  const filterTabs = document.querySelector(".filter-tabs");
  const mainSliderCircle = document.querySelector(".main-slider-circle");
  const wrapper = document.querySelector(".main-tabs-wrapper");

  if (!mainTabs || !mainSliderCircle || !wrapper) {
    console.warn("Estrutura das amazing-tabs não encontrada.");
    return;
  }
  console.log("Estrutura das amazing-tabs encontrada. Iniciando eventos...");

  const roundButtons = document.querySelectorAll(".round-button");
  const filterButtons = document.querySelectorAll(".filter-button");

  function handleActiveTab(tabs, target, className) {
    tabs.forEach(tab => tab.classList.remove(className));
    target.classList.add(className);
  }

  // Listener para cliques na área principal (.main-tabs-wrapper) – posiciona o círculo e realiza a troca de grupos
  wrapper.addEventListener("click", (event) => {
    const target = event.target.closest(".round-button");
    if (!target) return;

    // Posiciona o círculo animado
    mainSliderCircle.style.display = "block";
    const buttonRect = target.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const circleRect = mainSliderCircle.getBoundingClientRect();
    const buttonCenterX = buttonRect.left + buttonRect.width / 2;
    const buttonCenterY = buttonRect.top + buttonRect.height / 2;
    const offsetX = buttonCenterX - wrapperRect.left;
    const offsetY = buttonCenterY - wrapperRect.top;
    const circleRadius = circleRect.width / 2;
    const finalLeft = offsetX - circleRadius;
    const finalTop = offsetY - circleRadius;
    mainSliderCircle.style.left = `${finalLeft}px`;
    mainSliderCircle.style.top = `${finalTop}px`;
    mainSliderCircle.classList.remove("animate-jello");
    void mainSliderCircle.offsetWidth; // força reflow
    mainSliderCircle.classList.add("animate-jello");

    // Atualiza a cor do círculo (exemplo)
    const root = document.documentElement;
    const targetColor = target.dataset.color;
    if (typeof colors !== "undefined" && colors[targetColor]) {
      root.style.setProperty("--main-slider-color", colors[targetColor]["50"]);
      root.style.setProperty("--background-color", colors[targetColor]["100"]);
    } else {
      root.style.setProperty("--main-slider-color", "#fff3e0");
      root.style.setProperty("--background-color", "#ffe0b2");
    }

    handleActiveTab(roundButtons, target, "active");

    // Lógica de troca dos grupos:
    // Os botões principais devem ter um atributo data-group: 
    // Preparação → data-group="P", Inspeção → data-group="T", Montagem → data-group="M"
    const group = target.dataset.group;
    if (group) {
      const container = document.getElementById("postoTrabalhoLinhas");
      if (container) {
        // Esconde todas as ULs
        container.querySelectorAll("ul.sub-tabs-linha").forEach(ul => {
          ul.style.display = "none";
        });
        // Mostra a UL correspondente
        const targetUL = container.querySelector("ul.sub-tabs-linha.grupo-" + group);
        if (targetUL) {
          targetUL.style.display = "flex";
        }
      }
    }

    if (target.classList.contains("gallery")) {
      root.style.setProperty("--filters-container-height", "3.8rem");
      root.style.setProperty("--filters-wrapper-opacity", "1");
    } else {
      root.style.setProperty("--filters-container-height", "0");
      root.style.setProperty("--filters-wrapper-opacity", "0");
    }
  });

  if (filterTabs) {
    filterTabs.addEventListener("click", (event) => {
      const root = document.documentElement;
      const target = event.target.closest(".filter-button");
      if (!target) return;
      const targetTranslateValue = target.dataset.translateValue;
      root.style.setProperty("--translate-filters-slider", targetTranslateValue);
      handleActiveTab(filterButtons, target, "filter-active");
    });
  }
}

/************************************************
 * Carrega o modal via fetch e configura o gatilho
 ************************************************/
document.addEventListener('DOMContentLoaded', () => {
  // Carrega o modal de Produção e insere no container "modalContainer"
  fetch('Producao/modalProducao.html')
    .then(response => {
      if (!response.ok) {
        throw new Error("Erro no fetch: " + response.statusText);
      }
      return response.text();
    })
    .then(html => {
      const container = document.getElementById('modalProducaoContainer');

      if (container) {
        container.innerHTML = html;
        console.log("Modal de Produção carregado no container.");
        // Opcional: configure listeners específicos aqui se necessário
      } else {
        console.error("Container 'modalContainer' não encontrado.");
      }
    })
    .catch(error => console.error("Erro ao carregar o modal:", error));

  // Configura o listener para o botão "Produção"
  const btnProducao = document.getElementById('btnProducao');
  if (btnProducao) {
    btnProducao.addEventListener('click', (e) => {
      e.preventDefault();
      console.log("Botão 'btnProducao' clicado.");
      abrirProducaoModal();
    });
    console.log("Evento de clique configurado para btnProducao.");
  } else {
    console.error("Botão 'btnProducao' não encontrado.");
  }
});
