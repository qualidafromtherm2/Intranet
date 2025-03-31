/*******Producao/Posto_trabalho.js*********************
 * Carrega CSV e separa dados de Posto de Trabalho
 * Espera um CSV no formato:
 *   M,Montagem
 *   T,Teste01
 *   M,Higienização
 *   M,Teste final
 *   P,Base
 *   P,Painel
 *   P,motor ventilador
 *   P,Teste
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

    // Percorre cada linha do CSV
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

    // Função auxiliar para criar a lista de botões para cada grupo
    function criarListaBotao(arr, letra, cor) {
      const ul = document.createElement("ul");
      ul.classList.add("sub-tabs-linha", "grupo-" + letra);
      arr.forEach((nome, index) => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.classList.add("round-button");
        button.dataset.color = cor;
        button.innerHTML = `<span>${letra + (index + 1)}</span>`;
        button.title = nome;
        const span = button.querySelector('span');
        span.style.fontSize = '25.6px';
        span.style.fontWeight = 'bold';
        button.style.border = '2px solid #000';
        li.appendChild(button);
        ul.appendChild(li);
      });
      return ul;
    }

    // Cria as ULs para M, T e P
    const ulM = criarListaBotao(arrM, "M", "green");
    const ulT = criarListaBotao(arrT, "T", "orange");
    const ulP = criarListaBotao(arrP, "P", "blue");

    // Insere no container
    const container = document.getElementById("postoTrabalhoLinhas");
    if (!container) {
      console.warn("Elemento #postoTrabalhoLinhas não encontrado.");
      return;
    }
    container.innerHTML = "";
    container.appendChild(ulM);
    container.appendChild(ulT);
    container.appendChild(ulP);

    // Inicialmente, exibe apenas grupo P
    ulM.style.display = "none";
    ulT.style.display = "none";
    ulP.style.display = "flex";
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

  // Aguarda um pouco para garantir que o modal esteja no DOM
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
 * Exemplo de função chamada ao clicar nos botões
 ************************************************/
function carregarResultadoTeste() {
  console.log("Função carregarResultadoTeste foi chamada.");

  // 1) Fetch do CSV de resultados
  fetch('csv/Resultado_teste.csv')  // Ajuste o nome/pasta caso diferente
    .then(response => {
      if (!response.ok) {
        throw new Error("Erro ao buscar Resultado_teste.csv: " + response.statusText);
      }
      return response.text();
    })
    .then(csvText => {
      // 2) Usar PapaParse para converter CSV em array
      return new Promise((resolve) => {
        Papa.parse(csvText, {
          skipEmptyLines: true,
          complete: (results) => {
            resolve(results.data);
          }
        });
      });
    })
    .then((linhas) => {
      if (!linhas || linhas.length === 0) {
        console.warn("Resultado_teste.csv está vazio ou não foi encontrado.");
        return;
      }
      // 3) Montar uma tabela simples
      let html = '<table border="1" style="border-collapse: collapse; width:100%;">';
      for (let row of linhas) {
        html += '<tr>';
        for (let cell of row) {
          html += `<td style="padding:4px 8px;">${cell}</td>`;
        }
        html += '</tr>';
      }
      html += '</table>';

      // 4) Exibir no modalProducao.html (ou onde desejar)
      //     Exemplo: existe <div id="resultadoContainer"><form id="resultadoForm"></form></div>?
      const container = document.getElementById('resultadoContainer');
      const form = document.getElementById('resultadoForm');
      if (container && form) {
        container.style.display = 'block';  // Torna visível
        form.innerHTML = html;              // Insere tabela
      } else {
        console.warn("Não encontrei #resultadoContainer / #resultadoForm no DOM. Ajuste para seu layout!");
      }
    })
    .catch(err => {
      console.error("Erro ao carregar dados de Resultado_teste.csv:", err);
    });
}

/************************************************
 * Caso seja 'Teste01'
 ************************************************/
document.addEventListener('click', function(e) {
  const botao = e.target.closest('.round-button');
  if (botao && botao.closest('#postoTrabalhoLinhas') && botao.title === 'Teste01') {
    console.log("Botão Teste01 clicado");
    const circle = document.querySelector('.main-slider-circle');
    if (circle) {
      circle.style.display = 'none';
    }
    carregarResultadoTeste();
  }
});

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

  // Listener para cliques na área principal (.main-tabs-wrapper)
  wrapper.addEventListener("click", (event) => {
    const target = event.target.closest(".round-button");
    if (!target) return;

    // Posiciona o círculo
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
    void mainSliderCircle.offsetWidth; // reflow
    mainSliderCircle.classList.add("animate-jello");

    // Atualiza cor do círculo (se quiser usar seu obj 'colors')
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

    // Se o botão tiver data-group, troca as ULs
    const group = target.dataset.group;
    if (group) {
      const container = document.getElementById("postoTrabalhoLinhas");
      if (container) {
        container.querySelectorAll("ul.sub-tabs-linha").forEach(ul => {
          ul.style.display = "none";
        });
        const targetUL = container.querySelector(`ul.sub-tabs-linha.grupo-${group}`);
        if (targetUL) {
          targetUL.style.display = "flex";
        }
      }
    }

    // Se tiver classe "gallery", exiba filters
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
  // 1) Carrega o modalProducao.html e insere no #modalProducaoContainer
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

        // Depois de injetar o HTML do modalProducao.html:
        const scriptTag = document.createElement('script');
        scriptTag.src = 'Producao/modalProducao.js';
        scriptTag.onload = function() {
          if (typeof initModalProducao === 'function') {
            initModalProducao();
          }
        };
        document.body.appendChild(scriptTag);

        // 2) Configure o botão OP (id="btnOP"), que está dentro do modalProducao.html
        const btnOP = document.getElementById('btnOP');
        if (btnOP) {
          btnOP.addEventListener('click', function(e) {
            e.preventDefault();
            console.log("Botão OP clicado!");
            // Fechamos o modal
            fecharProducaoModal();
            // Agora carregamos a página abertura_op.html dentro do IFRAME
            const ifr = document.querySelector('iframe[name="conteudo"]');
            if (ifr) {
              ifr.src = 'abertura_op/abertura_op.html';
            } else {
              console.warn("Não achei <iframe name='conteudo'> no index.html!");
            }
          });
        }
        // Se o botão não existe no modal, não faz nada — removemos o warning.
      } else {
        console.error("Container 'modalProducaoContainer' não encontrado.");
      }
    })
    .catch(error => console.error("Erro ao carregar o modal:", error));

  // 3) Configura o listener para o botão "Produção" (id="btnProducao" no index.html)
  const btnProducao = document.getElementById('btnProducao');
  if (btnProducao) {
    btnProducao.addEventListener('click', (e) => {
      e.preventDefault();
      console.log("Botão 'btnProducao' clicado.");
      abrirProducaoModal();
    });
    console.log("Evento de clique configurado para btnProducao.");
  } else {
    console.error("Botão 'btnProducao' não encontrado no index.html.");
  }
});
