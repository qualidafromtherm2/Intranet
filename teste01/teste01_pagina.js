/******************************************************
 * abertura_op/abertura_op.js
 * Script que controla a lógica do Kanban (drag/drop etc.)
 ******************************************************/
// Modo padrão: 'production' ou 'pcp'
let activeMode = 'production';

// Função auxiliar para acessar elementos
function elem(id) {
  return document.getElementById(id);
}

// Funções stub (implemente se necessário)
function changeTask() {
  countTask();
}
function countTask() {
  const allTasks = document.querySelectorAll('.section li');
  const total = allTasks.length;
  const qtdBtn = document.getElementById('totalTask');
  if (qtdBtn) {
    qtdBtn.textContent = total;
  }
}

// Funções globais de reordenação
function upListener(e) {
  e.preventDefault();
  const li = this.parentNode;
  const prev = li.previousElementSibling;
  if (prev) {
    li.parentNode.insertBefore(li, prev);
  }
}
function downListener(e) {
  e.preventDefault();
  const li = this.parentNode;
  const next = li.nextElementSibling;
  if (next) {
    li.parentNode.insertBefore(next, li);
  }
}
function calcUpDown() {
  const ulPanels = document.querySelectorAll(".section");
  for (let x = 0; x < ulPanels.length; x++) {
    const upLink = ulPanels[x].querySelectorAll(".up");
    for (let i = 0; i < upLink.length; i++) {
      upLink[i].removeEventListener('click', upListener);
      upLink[i].addEventListener('click', upListener);
    }
    const downLink = ulPanels[x].querySelectorAll(".down");
    for (let i = 0; i < downLink.length; i++) {
      downLink[i].removeEventListener('click', downListener);
      downLink[i].addEventListener('click', downListener);
    }
  }
}

// Função para salvar o estado do Kanban no localStorage
window.saveBoards = function saveBoards() {
  const toDoBoard = elem('ul-todo').innerHTML;
  const workingBoard = elem('ul-working').innerHTML;
  const doneBoard = elem('ul-done').innerHTML;
  localStorage.setItem('listToDo', toDoBoard);
  localStorage.setItem('listWorking', workingBoard);
  localStorage.setItem('listDone', doneBoard);
  const urgentUl = document.getElementById('ul-urgent');
  if (urgentUl) {
    localStorage.setItem('listUrgent', urgentUl.innerHTML);
  } else {
    localStorage.removeItem('listUrgent');
  }
};

// Função para carregar tasks a partir do CSV
async function loadTasksFromCSV() {
  try {
    const response = await fetch('/api/plano-op/ler-csv', { method: 'GET' });
    const csvText = await response.text();
    console.log("CSV carregado:", csvText);
    const parsed = Papa.parse(csvText, { 
      header: true, 
      skipEmptyLines: true,
      transformHeader: header => header.trim()
    });
    const rows = parsed.data;
    
    // Limpa somente o container do kanban (ul-todo)
    const todoElem = document.getElementById('ul-todo');
    if (todoElem) {
      todoElem.innerHTML = '';
    } else {
      console.error("Elemento 'ul-todo' não encontrado.");
    }
    
    // Itera pelos registros do CSV e adiciona apenas os itens com status "T1"
    rows.forEach(row => {
      if (
        row.Pedido &&
        row.produto &&
        row.status &&
        row.status.trim() === "T1"
      ) {
        addTaskToKanban(row);
      }
    });
    
    // Atualiza os contadores do kanban com o nome dinâmico
    await updateHeaderCounts();
    countAllItems();
  } catch (error) {
    console.error("Erro ao carregar CSV:", error);
  }
}


function updateHeaderCounts() {
  const todoElem = document.getElementById('ul-todo');
  let count = todoElem ? todoElem.childElementCount : 0;
  const h3Todo = document.querySelector('#to-do h3');
  if (h3Todo) {
    h3Todo.textContent = `T1 (${count})`;
  } else {
    console.warn("Cabeçalho para T1 não encontrado.");
  }
}


// Função para obter o nome do kanban a partir de Posto_trabalho.csv
async function getKanbanNameFromPostoTrabalho() {
  try {
    // Atualize o caminho para subir um nível e acessar a pasta csv na raiz
    const response = await fetch('../csv/Posto_trabalho.csv');
    let csvText = await response.text();
    // Remove BOM se existir
    if (csvText.charCodeAt(0) === 0xFEFF) {
      csvText = csvText.slice(1);
    }
    const parsed = Papa.parse(csvText, {
      skipEmptyLines: true
    });
    const rows = parsed.data;
    // Percorre as linhas para encontrar a primeira com "T" na primeira coluna
    for (const row of rows) {
      if (row[0] && row[0].trim() === "T" && row[1]) {
        return row[1].trim();
      }
    }
    // Caso não encontre, retorna um valor padrão
    return "T1";
  } catch (error) {
    console.error("Erro ao carregar Posto_trabalho.csv:", error);
    return "T1";
  }
}

// Função para atualizar o cabeçalho do kanban com o nome dinâmico e a contagem de itens
async function updateHeaderCounts() {
  const kanbanName = await getKanbanNameFromPostoTrabalho();
  const todoElem = document.getElementById('ul-todo');
  let count = todoElem ? todoElem.childElementCount : 0;
  const h3Todo = document.querySelector('#to-do h3');
  if (h3Todo) {
    h3Todo.textContent = `${kanbanName} (${count})`;
  } else {
    console.warn("Cabeçalho para o kanban não encontrado.");
  }
}




// Atualização em preencherKanban:
function preencherKanban(data, tipo) {
  console.log("Preenchendo kanban para tipo:", tipo);

  if (!data || !data.pedido_venda_produto || data.pedido_venda_produto.length === 0) {
    console.log("Nenhum pedido retornado para o tipo", tipo);
    return;
  }

  let container;
  if (tipo === 'comercial') {
    container = document.getElementById('ul-working');
  } else if (tipo === 'pcp') {
    container = document.getElementById('ul-done');
  }
  if (!container) {
    console.error("Container não encontrado para o tipo:", tipo);
    return;
  }
  container.innerHTML = "";

  data.pedido_venda_produto.forEach(pedido => {
    // Ignora pedidos cancelados ou encerrados
    if (
      (pedido.infoCadastro && pedido.infoCadastro.cancelado === "S") ||
      (pedido.cabecalho && pedido.cabecalho.encerrado === "S")
    ) {
      return;
    }

    const numeroPedido = pedido.cabecalho.numero_pedido;
    const dataPrevisao = pedido.cabecalho.data_previsao || "N/A";
    const obsVenda = (pedido.observacoes && pedido.observacoes.obs_venda) || "";

    // Cria o container do grupo
    const groupDiv = document.createElement('div');
    groupDiv.className = 'pedido-group';
    groupDiv.setAttribute('data-date-previsao', dataPrevisao);

    const groupHeader = document.createElement('div');
    groupHeader.className = 'pedido-group-header';
    groupHeader.innerHTML = `<strong>Pedido: ${numeroPedido}</strong><hr>`;
    groupDiv.appendChild(groupHeader);

    // Variável para indicar se algum item foi válido
    let temItensValidos = false;

    if (pedido.det && Array.isArray(pedido.det)) {
      pedido.det.forEach(item => {
        if (item.cancelado === "S" || item.encerrado === "S") {
          return;
        }

        if (item.produto && item.produto.codigo) {
          const codigo = item.produto.codigo;
          const descricao = item.produto.descricao || "";
          const dadosAdicionais = (item.inf_adic && item.inf_adic.dados_adicionais_item) || "";

          // Aplica o filtro para PCP/Comercial:
          if ((tipo === 'pcp' || tipo === 'comercial') &&
              codigo.startsWith("FTI") &&
              !codigo.endsWith("BR")) {
            // Se iniciar com FTI e não terminar com BR, ignora o item
            return;
          }

          let quantidade = parseInt(item.produto.quantidade) || 1;

          for (let i = 0; i < quantidade; i++) {
            // Se chegar aqui, quer dizer que o item passou nos filtros
            temItensValidos = true;

            const cardDiv = document.createElement('div');
            cardDiv.className = 'pedido-card draggable';
            cardDiv.setAttribute('draggable', true);
            cardDiv.setAttribute('ondragstart', 'drag(event)');
            cardDiv.setAttribute('data-previsao', dataPrevisao);
            cardDiv.id = `li-${numeroPedido}-${codigo}-${i}`;

            cardDiv.innerHTML = `
              <div class="pedido-header">
                <strong>Pedido: ${numeroPedido}</strong>
              </div>
              <div class="pedido-info">
                <p class="produto">Produto: ${codigo}</p>
                <p class="descricao">Descrição: ${descricao}</p>
                <p class="dados-adicionais-item">Dados Adicionais: ${dadosAdicionais}</p>
                <p class="obs_venda">Obs Venda: ${obsVenda}</p>
              </div>
              <div class="data-previsao">
                <p>Data Previsão: ${dataPrevisao}</p>
              </div>
              <hr>
            `;

            // Se o item já estiver no CSV, pinta o card de laranja
            let key = numeroPedido + "|" + codigo;
            if (window.csvData && window.csvData[key] && window.csvData[key] > 0) {
              cardDiv.style.backgroundColor = "orange";
              window.csvData[key]--;
            }

            // Adiciona o evento de clique para abrir o modal de detalhes
            cardDiv.addEventListener('click', () => abrirModalDetalhes(cardDiv));

            groupDiv.appendChild(cardDiv);
          }
        }
      });
    }

    // Se ao final do loop, temItensValidos == true, então adiciona o groupDiv
    if (temItensValidos) {
      container.appendChild(groupDiv);
    }
  });
  console.log("Preenchimento do kanban para", tipo, "finalizado.");
}





// Função para criar os cards a partir do CSV (mantida para produção)
function addTaskToKanban(taskData) {
  // Neste cenário, ignoramos o status e adicionamos tudo em ul-todo
  const containerId = 'ul-todo';
  let container = document.getElementById(containerId);
  if (!container) {
    console.error("Contêiner não encontrado para", containerId);
    return;
  }
  
  const li = document.createElement('li');
  li.className = 'sample';
  li.draggable = true;
  li.id = 'li-' + taskData.Pedido + '-' + taskData.produto;
  li.setAttribute('ondragstart', 'drag(event)');
  li.setAttribute('ontouchstart', 'drag(event)');

  // Exemplo simples de conteúdo – adapte conforme necessário
  const obsVenda = taskData["observação"] || "";
  li.innerHTML = `
    <span class="txt">${obsVenda}</span>
    <div class="task-details">
      <span class="op">${taskData.OP || ""}</span>
      <span class="pedido">Pedido: ${taskData.Pedido}</span>
      <span class="produto">Produto: ${taskData.produto}</span>
    </div>
  `;
  li.addEventListener('click', () => abrirModalDetalhes(li));

  container.appendChild(li);
  calcUpDown();
  changeTask();
  countTask();
}





function formatObservacao(obs) {
  return obs.replace(/\|\|/g, '<br><br>').replace(/\|/g, '<br>');
}



const myLists = document.getElementById('myLists');
if (!myLists.classList.contains('fourCol')) {
  myLists.classList.add('fourCol');
}

function toggleUrgentColumn() {
  let urgentContainer = document.getElementById('ur-gent');
  if (!urgentContainer) {
    urgentContainer = document.createElement('div');
    urgentContainer.id = 'ur-gent';
    urgentContainer.innerHTML = `
      <h3>URGENTE <span></span></h3>
      <ul id="ul-urgent" class="section"
          ondrop="drop(event, this)"
          ondragover="allowDrop(event)"
          ondragenter="dragEnter(event)"
          ondragleave="dragLeave(event)">
      </ul>
    `;
    const doNe = document.getElementById('do-ne');
    doNe.parentNode.insertBefore(urgentContainer, doNe.nextSibling);
  } else {
    urgentContainer.style.display = (urgentContainer.style.display === 'none') ? 'block' : 'none';
  }
}

// Função para atualizar o listbox com os códigos de produto
function updateProductCodesListbox() {
  const filterContainer = document.getElementById('pcp-filter-container');
  const selectElem = document.getElementById('filterListbox');

  // Se não estiver no modo PCP, oculta o contêiner e sai
  if (activeMode !== 'pcp') {
    if (filterContainer) filterContainer.style.display = 'none';
    return;
  } else {
    if (filterContainer) filterContainer.style.display = 'block';
  }

  if (!selectElem) {
    console.log("Elemento select para filtro não encontrado.");
    return;
  }

  // Coleta apenas os cards da coluna PCP (ul-done)
  const doneCards = document.querySelectorAll('#ul-done .pedido-card');
  const productMap = new Map();

  doneCards.forEach(card => {
    const productText = card.querySelector('.produto')?.textContent || "";
    // Supondo que o texto seja "Produto: FT180F40T"
    const code = productText.replace("Produto:", "").trim();
    if (code) {
      productMap.set(code, (productMap.get(code) || 0) + 1);
    }
  });

  // Converte o Map para um array e ordena de forma decrescente pela quantidade
  let productsArray = Array.from(productMap.entries());
  productsArray.sort((a, b) => b[1] - a[1]);

  // Atualiza o listbox
  selectElem.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = "";
  allOption.textContent = "Todos";
  selectElem.appendChild(allOption);

  productsArray.forEach(([code, qty]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = `${code} (${qty})`;
    selectElem.appendChild(option);
  });
  
  console.log("Listbox atualizado com produtos (apenas PCP):", productsArray);
}






  function handleListboxFilterChange() {
    const selectElem = document.getElementById('filterListbox');
    const selectedCode = selectElem.value.toLowerCase();
    
    // Se nenhum código for selecionado, mostra todos os cards da coluna PCP
    if (selectedCode === "") {
      const allCards = document.querySelectorAll('#ul-done .pedido-card');
      allCards.forEach(card => card.style.display = '');
      return;
    }
    
    // Filtra apenas os cards da coluna PCP (ul-done)
    const allCards = document.querySelectorAll('#ul-done .pedido-card');
    allCards.forEach(card => {
      const productText = card.querySelector('.produto')?.textContent.toLowerCase() || "";
      const code = productText.replace("produto:", "").trim();
      card.style.display = (code === selectedCode) ? '' : 'none';
    });
  }
  



document.addEventListener('DOMContentLoaded', function() {
  const selectElem = document.getElementById('filterListbox');
  if (selectElem) {
    selectElem.addEventListener('change', handleListboxFilterChange);
  }
});

// Eventos e inicialização da página
document.addEventListener('DOMContentLoaded', function() {
  const toDoButton = elem('addToDo');
  toDoButton.addEventListener('click', function() {
    elem('taskText').value = 'New Task';
    elem('modalOverlay').style.display = 'block';
    elem('modalBox').style.display = 'block';
  });
  document.getElementById('taskButton').addEventListener('click', function() {
    const pedido = document.getElementById('pedidoField').value.trim();
    const observacao = document.getElementById('taskText').value.trim();
    if (!pedido) {
      alert("Campo Pedido está vazio.");
      return;
    }
 else {
      const prodButtons = document.querySelectorAll('#produtosSelecionadosContainer .produto-selecionado-btn');
      if (prodButtons.length === 0) {
        alert("Nenhum produto foi selecionado.");
        return;
      }
      const localInicial = "LIDER DE PRODUÇÃO";
      const statusInicial = "L0";
      const dataAtual = formatDate(new Date());
      const userVal = "";
      const dados = Array.from(prodButtons).map(btn => ({
        pedido: pedido,
        produto: btn.getAttribute('data-codigo'),
        local: localInicial,
        status: statusInicial,
        data: dataAtual,
        user: userVal,
        observacao: observacao
      }));
      console.log("Enviando ao CSV:", dados);
      fetch('/api/plano-op', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dados: dados })
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          alert("Dados enviados com sucesso!");
          loadTasksFromCSV();
          fecharModal();
        } else {
          alert("Erro ao enviar os dados.");
        }
      })
      .catch(error => {
        console.error("Erro no fetch:", error);
        alert("Erro ao enviar os dados.");
      });
    }
  });
  const closeBtn = elem('modalClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', fecharModal);
  } else {
    console.error("Botão Cancel não encontrado");
  }
  const overlay = document.getElementById('modalOverlay');
  if (overlay) {
    overlay.addEventListener('click', fecharModal);
  }
  calcUpDown();
  changeTask();
  countTask();
});

// Funções de Drag & Drop
function allowDrop(ev) {
  ev.preventDefault();
}
function drag(ev) {
  ev.dataTransfer.setData("text", ev.target.id);
}
function drop(ev, el) {
  ev.preventDefault();
  const draggedItemId = ev.dataTransfer.getData("text");
  console.log("Drop event: item arrastado:", draggedItemId, "destino:", el.id);
  if (activeMode === 'pcp' && el.id !== "ul-todo") {
    console.log("Modo PCP: drop permitido somente na coluna LIDER DE PRODUÇÃO (ul-todo).");
    return;
  }
  const item = document.getElementById(draggedItemId);
  if (!item) {
    console.error("Item não encontrado com o id:", draggedItemId);
    return;
  }
  if (activeMode === 'pcp' && el.id === "ul-todo") {
    el.appendChild(item);
    changeTask();
    calcUpDown();
    const parts = item.id.split('-');
    const pedido = parts[1];
    const produto = parts.slice(2, parts.length - 1).join('-');
    
    // Use o elemento .txt para obs_venda
    const obsVenda = item.querySelector('.txt') ? item.querySelector('.txt').textContent.trim() : "";
    const descricaoElem = item.querySelector('.descricao');
    const descricao = descricaoElem ? descricaoElem.textContent.replace("Descrição: ", "") : "";
    const dadosAdicionaisElem = item.querySelector('.dados-adicionais-item');
    const caracteristica = dadosAdicionaisElem ? dadosAdicionaisElem.textContent.replace("Dados Adicionais: ", "") : "";
    
    const dataAtual = formatDate(new Date());
    const dataPrevisao = item.getAttribute('data-previsao') || "";
    
    const newData = {
      pedido: pedido,
      produto: produto,
      local: "LIDER DE PRODUÇÃO",
      status: "L0",
      data: dataAtual,
      user: "",
      observacao: obsVenda,
      data_previsao: dataPrevisao,
      descricao: descricao,
      caracteristica: caracteristica
    };
    console.log("Inserindo nova linha no CSV (modo PCP):", newData);
    fetch('/api/plano-op', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dados: [newData] })
    })
    .then(response => response.json())
    .then(result => {
      console.log("Nova linha inserida no CSV:", result);
    })
    .catch(error => {
      console.error("Erro ao inserir nova linha no CSV:", error);
    });
  }
  
  
  
   else {
    el.appendChild(item);
    changeTask();
    calcUpDown();
    let newStatus = "L0";
    if (el.id === "ul-todo") newStatus = "L0";
    else if (el.id === "ul-working") newStatus = "L1";
    else if (el.id === "ul-done") newStatus = "L2";
    else if (el.id === "ul-urgent") newStatus = "LU3";
    let newLocal;
    if (activeMode === 'pcp') {
      switch (newStatus) {
        case "L1":
          newLocal = "COMERCIAL";
          break;
        case "L2":
          newLocal = "PCP";
          break;
        case "LU3":
          newLocal = "URGENTE";
          break;
        case "L0":
        default:
          newLocal = "LIDER DE PRODUÇÃO";
      }
    } else {
      switch (newStatus) {
        case "L1":
          newLocal = "LOGISTICA";
          break;
        case "L2":
          newLocal = "EM PRODUÇÃO";
          break;
        case "LU3":
          newLocal = "URGENTE";
          break;
        case "L0":
        default:
          newLocal = "LIDER DE PRODUÇÃO";
      }
    }
    const parts = item.id.split('-');
    const pedido = parts[1];
    const produto = parts.slice(2).join('-');
    fetch('/api/plano-op/atualizar-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedido, produto, local: newLocal, status: newStatus })
    })
    .then(response => response.json())
    .then(result => {
      console.log("Status/local atualizado no CSV:", result);
    })
    .catch(error => {
      console.error("Erro ao atualizar status no CSV:", error);
    });
  }
  el.classList.remove('drag-enter');
}
function dragEnter(ev) {
  ev.preventDefault();
  ev.target.classList.add('drag-enter');
}
function dragLeave(ev) {
  ev.target.classList.remove('drag-enter');
}
// Função para remover task (opcional)
function delTask(event, li) {
  event.preventDefault();
  if (!li) return;
  // Lógica de confirmação, se necessário
}
// Pedidos (Omie)
async function fetchPedidosCards() {
  console.log("fetchPedidosCards chamada");
  try {
    const response = await fetch('/api/abertura-op/listar-pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    const container = document.getElementById('cardsContainer');
    container.innerHTML = '';
    if (data.pedido_venda_produto && data.pedido_venda_produto.length) {
      data.pedido_venda_produto.forEach(pedido => {
        const numeroPedido = pedido.cabecalho.numero_pedido;
        const obsVenda = (pedido.observacoes && pedido.observacoes.obs_venda) || '';
        const produtosArray = [];
        let produtosHTML = '';
        (pedido.det || []).forEach(item => {
          const codigo = item.produto.codigo;
          const quantidade = Number(item.produto.quantidade) || 0;
          produtosArray.push({ codigo, quantidade });
          for (let i = 0; i < quantidade; i++) {
            produtosHTML += `<button class="produto-button" data-codigo="${codigo}" data-pedido="${numeroPedido}">${codigo}</button>`;
          }
        });
        const card = document.createElement('div');
        card.className = 'pedido-card';
        card.innerHTML = `
          <h3 class="pedido-header">
            <button class="pedido-order-btn" data-pedido="${numeroPedido}" data-obs="${obsVenda}" data-produtos='${JSON.stringify(produtosArray)}'>
              Pedido: ${numeroPedido}
            </button>
          </h3>
          <div class="produtos-container">
            ${produtosHTML}
          </div>
        `;
        container.appendChild(card);
      });
      addPedidoButtonsEvents();
      addProdutoButtonsEvents();
    } else {
      container.innerHTML = '<p>Nenhum pedido encontrado.</p>';
    }
  } catch (error) {
    console.error("Erro ao buscar pedidos:", error);
  }
}
function addPedidoButtonsEvents() {
  document.querySelectorAll('.pedido-order-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.getElementById('cardsContainer').style.display = 'none';
      const pedido = this.getAttribute('data-pedido');
      const obs = this.getAttribute('data-obs');
      const produtosArray = JSON.parse(this.getAttribute('data-produtos'));
      document.getElementById('pedidoField').value = pedido;

      const prodContainer = document.getElementById('produtosSelecionadosContainer');
      prodContainer.innerHTML = '';
      produtosArray.forEach(prod => {
        for (let i = 0; i < prod.quantidade; i++) {
          prodContainer.innerHTML += `<button class="produto-selecionado-btn" data-codigo="${prod.codigo}">${prod.codigo}</button>`;
        }
      });
    });
  });
}
function addProdutoButtonsEvents() {
  document.querySelectorAll('.produto-button').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const codigo = this.getAttribute('data-codigo');
      const card = this.closest('.pedido-card');
      const orderBtn = card.querySelector('.pedido-order-btn');
      const pedido = orderBtn.getAttribute('data-pedido');
      const obs = orderBtn.getAttribute('data-obs');
      const count = card.querySelectorAll(`.produto-button[data-codigo="${codigo}"]`).length;
      document.getElementById('cardsContainer').style.display = 'none';
      document.getElementById('pedidoField').value = pedido;

      const prodContainer = document.getElementById('produtosSelecionadosContainer');
      prodContainer.innerHTML = '';
      if (count <= 1) {
        prodContainer.innerHTML = `<button class="produto-selecionado-btn" data-codigo="${codigo}">${codigo}</button>`;
      } else {
        const enviarTodos = confirm(`Deseja enviar todos os produtos "${codigo}" deste pedido ou somente um? Clique em OK para todos ou Cancel para somente um.`);
        if (enviarTodos) {
          for (let i = 0; i < count; i++) {
            prodContainer.innerHTML += `<button class="produto-selecionado-btn" data-codigo="${codigo}">${codigo}</button>`;
          }
        } else {
          prodContainer.innerHTML += `<button class="produto-selecionado-btn" data-codigo="${codigo}">${codigo}</button>`;
        }
      }
    });
  });
}
document.getElementById('addToDo').addEventListener('click', function() {
  document.getElementById('taskText').value = 'New Task';


  fetchPedidosCards();
});
document.getElementById('btnGerarCards').addEventListener('click', function() {
  console.log("Clicou em Mostrar Pedidos");
  document.getElementById('pedidoField').value = '';
  document.getElementById('taskText').value = '';
  document.getElementById('produtosSelecionadosContainer').innerHTML = '';
  const cardsContainer = document.getElementById('cardsContainer');
  cardsContainer.style.setProperty("display", "grid", "important");
  fetchPedidosCards();
});
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('modalClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', fecharModal);
  } else {
    console.error("Botão Cancel não encontrado");
  }
});
document.addEventListener('DOMContentLoaded', function() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) {
    overlay.addEventListener('click', fecharModal);
  }
});
function fecharModal() {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalBox');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
}
function setElementStyles(element, styles) {
  for (const property in styles) {
    if (styles.hasOwnProperty(property)) {
      element.style[property] = styles[property];
    }
  }
}
document.addEventListener('DOMContentLoaded', async function() {
  await loadTasksFromCSV();
  calcUpDown();
  changeTask();
  countTask();
});
function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}
const btnPCP = document.getElementById('btnPCP');
if (btnPCP) {
  btnPCP.addEventListener('click', async function() {
    console.log("Botão PCP clicado - iniciando fluxo PCP");
    activeMode = 'pcp';
    // ... restante da lógica
  });
} else {
  console.warn("Elemento 'btnPCP' não encontrado; listener não adicionado.");
}




document.getElementById('btnProducao').addEventListener('click', function() {
  activeMode = 'production';
  
  const myLists = document.getElementById('myLists');
  // Em vez de pegar 'ul-todo', pegue 'to-do'
  const toDoDiv = document.getElementById('to-do');
  
  // Insira a div to-do como a primeira coluna
  myLists.insertBefore(toDoDiv, myLists.firstChild);

  const workIn = document.getElementById('work-in');
  if (workIn) {
    const h3WorkIn = workIn.querySelector('h3');
    if (h3WorkIn) {
      h3WorkIn.innerText = 'LOGISTICA';
    }
    workIn.style.backgroundColor = '';
  }

  const doNe = document.getElementById('do-ne');
  if (doNe) {
    const h3DoNe = document.getElementById('doNeHeader');
    if (h3DoNe) {
      h3DoNe.textContent = "EM PRODUÇÃO";
    }
    doNe.style.backgroundColor = '';
  }

  // Se existir o contêiner urgente (ou criar se necessário) e tiver itens, insira-o entre workIn e doNe
  let urgentContainer = document.getElementById('ur-gent');
  if (!urgentContainer) {
    // Cria o contêiner urgente, se não existir
    urgentContainer = document.createElement('div');
    urgentContainer.id = 'ur-gent';
    urgentContainer.innerHTML = `
      <h3>URGENTE <span></span></h3>
      <ul id="ul-urgent" class="section"
          ondrop="drop(event, this)"
          ondragover="allowDrop(event)"
          ondragenter="dragEnter(event)"
          ondragleave="dragLeave(event)">
      </ul>
    `;
  }
  myLists.insertBefore(urgentContainer, doNe);

  // Oculta se estiver vazio
  const ulUrgent = document.getElementById('ul-urgent');
  if (ulUrgent && ulUrgent.childElementCount === 0) {
    urgentContainer.style.display = 'none';
  } else {
    urgentContainer.style.display = 'block';
  }

  // Oculta o filtro do modo PCP, se estiver visível
  const filterContainer = document.getElementById('pcp-filter-container');
  if (filterContainer) {
    filterContainer.style.display = 'none';
  }

  loadTasksFromCSV();
});



async function fetchPedidosByEtapa(etapa) {
  console.log("Iniciando requisição para etapa:", etapa);
  try {
    const payload = { etapa: etapa };
    const response = await fetch('/api/abertura-op/listar-pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    console.log("Resposta recebida para etapa", etapa, ":", data);
    return data;
  } catch (error) {
    console.error("Erro ao buscar pedidos para etapa " + etapa + ":", error);
    return null;
  }
}



// Atualização em countAllItems:
// Em modo PCP, não considera a coluna LIDER DE PRODUÇÃO (ul-todo)
function countAllItems() {
  let total = 0;
  const todo = document.getElementById('ul-todo');
  if (todo) {
    total += todo.childElementCount;
  }
  // Se existir uma coluna urgente e você quiser mantê-la, pode incluir
  const urgent = document.getElementById('ul-urgent');
  if (urgent) {
    total += urgent.childElementCount;
  }
  const qtdBtn = document.getElementById('totalTask');
  if (qtdBtn) {
    qtdBtn.textContent = total;
  }
  console.log("Total de itens no Kanban =", total);
}





// Variável global para alternar a ordem (true = ascendente, false = descendente)
// (2) Crie a função para ordenar os grupos por data_previsao
let sortAsc = true;

function sortGroupsByDataPrevisao(containerId) {
  const container = document.getElementById(containerId);
  // Seleciona todos os grupos de pedido (.pedido-group) dentro do container
  const groups = Array.from(container.querySelectorAll('.pedido-group'));

  // Função auxiliar para converter data do formato dd/mm/aaaa em objeto Date
  function parseDate(str) {
    const parts = str.split('/');
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }

  // Ordena os grupos sempre em ordem ascendente (dateA - dateB)
  groups.sort((a, b) => {
    const dateAString = a.getAttribute('data-date-previsao') || "01/01/1970";
    const dateBString = b.getAttribute('data-date-previsao') || "01/01/1970";
    const dateA = parseDate(dateAString);
    const dateB = parseDate(dateBString);
    return dateA - dateB; // sempre crescente
  });

  // Reanexa os grupos no container na nova ordem
  container.innerHTML = "";
  groups.forEach(grupo => container.appendChild(grupo));

  console.log(`Grupos no container '${containerId}' ordenados em ordem crescente.`);
}




function abrirModalDetalhes(elemento) {
  const pedido = elemento.querySelector('.pedido')?.textContent.replace("Pedido:", "").trim() || "";
  const produto = elemento.querySelector('.produto')?.textContent.replace("Produto:", "").trim() || "";
  const dataPrev = elemento.getAttribute('data-previsao') || "";
  const descricao = elemento.querySelector('.descricao')?.textContent.replace("Descrição:", "").trim() || "";
  const caracteristica = elemento.querySelector('.caracteristica, .dados-adicionais-item')?.textContent
                         .replace(/(Característica|Dados Adicionais):/, "")
                         .trim() || "";
  // Obter o texto original da observação e substituir delimitadores
  const observacaoRaw = elemento.querySelector('.txt')?.textContent.trim() || 
                          elemento.querySelector('.obs_venda')?.textContent.replace("Obs Venda:", "").trim() || "";
  // Substitui "||" por duas quebras de linha e "|" por uma quebra de linha
  const observacao = observacaoRaw.replace(/\|\|/g, "\n\n").replace(/\|/g, "\n");
  const op = elemento.querySelector('.op')?.textContent || null;

  const modal = document.getElementById('modalBox');
  modal.innerHTML = `
    <div class="modal-header">
      <h2 style="margin: 0;">Detalhes do Item</h2>
      <span class="close-modal" onclick="fecharModal()">×</span>
    </div>

    <div class="modal-body">
      <div class="modal-field">
        <label>Pedido:</label>
        <input type="text" value="${pedido}" readonly>
      </div>
      ${op ? `
      <div class="modal-field">
        <label>OP:</label>
        <input type="text" value="${op}" readonly>
      </div>
      ` : ""}
      <div class="modal-field">
        <label>Produto:</label>
        <input type="text" value="${produto}" readonly>
      </div>
      <div class="modal-field">
        <label>Data Previsão:</label>
        <input type="text" value="${dataPrev}" readonly>
      </div>
      <div class="modal-field">
        <label>Descrição:</label>
        <textarea readonly rows="3">${descricao}</textarea>
      </div>
      <div class="modal-field">
        <label>Característica:</label>
        <textarea readonly rows="3">${caracteristica}</textarea>
      </div>
      <div class="modal-field">
        <label>Observação:</label>
        <textarea readonly rows="7">${observacao}</textarea>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn-fechar" onclick="fecharModal()">Fechar</button>
    </div>
  `;

  document.getElementById('modalOverlay').style.display = 'block';
  modal.style.display = 'block';
}

