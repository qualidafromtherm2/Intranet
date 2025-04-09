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
    const response = await fetch('http://127.0.0.1:5001/api/plano-op/ler-csv', { method: 'GET' });
    const csvText = await response.text();

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: header => header.trim()
    });

    const rows = parsed.data;
    // Limpa os containers dos kanbans
    const todoElem = document.getElementById('ul-todo');
    const productionElem = document.getElementById('ul-production');
    if (todoElem) { todoElem.innerHTML = ''; }
    if (productionElem) { productionElem.innerHTML = ''; }

    rows.forEach(row => {
      if (row.Pedido && row.produto && row.status) {
        // Divide a string de status pelos separadores ";"
        const statuses = row.status.split(";").map(s => s.trim());
        if (statuses.includes("P1P")) {
          addTaskToSecondKanban(row);
        } else if (statuses.includes("P1")) {
          addTaskToKanban(row);
        }
      }
    });

    updateHeaderCounts();
    countAllItems();
    updateCardColors();  // Atualiza as cores conforme o status

  } catch (error) {
    console.error("Erro ao carregar CSV:", error);
  }
}

function addTaskToSecondKanban(taskData) {
  const container = document.getElementById('ul-production');
  if (!container) {
    console.error("Contêiner 'ul-production' não encontrado.");
    return;
  }
  const li = document.createElement('li');
  li.className = 'sample';
  li.id = 'li-' + taskData.Pedido + '-' + taskData.produto;
  
  li.dataset.status = taskData.status;
  li.dataset.local = taskData.local || "";
  li.dataset.dataPrevisao = taskData["data_previsao"] || "";
  li.dataset.descricao = taskData["descricao"] || "";
  li.dataset.caracteristica = taskData["caracteristica"] || "";
  li.dataset.observacao = taskData["observação"] || "";
  
  li.innerHTML = `
    <span class="txt">${taskData["observação"] || ""}</span>
    <div class="task-details">
      <span class="op">${taskData.OP || ""}</span>
      <span class="pedido">Pedido: ${taskData.Pedido}</span>
      <span class="produto">Produto: ${taskData.produto}</span>
    </div>
  `;
  li.addEventListener('dragstart', drag);
  li.addEventListener('click', () => abrirModalDetalhes(li));
  li.draggable = true;
  container.appendChild(li);
  changeTask();
  countTask();
}

// Atualize a função updateHeaderCounts para definir um nome fixo para o kanban
function updateHeaderCounts() {
  const todoElem = document.getElementById('ul-todo');
  let count = todoElem ? todoElem.childElementCount : 0;
  const h3Todo = document.querySelector('#to-do h3');
  if (h3Todo) {
    // Nome fixo "Posto 01" seguido da contagem de itens
    h3Todo.textContent = `Posto 01 (${count})`;
  } else {
    console.warn("Cabeçalho do kanban não encontrado.");
  }
}

// Função para obter o nome do kanban a partir de Posto_trabalho.csv
async function getKanbanNameFromPostoTrabalho() {
  try {
    // Ajuste o caminho para subir um nível e acessar a pasta csv na raiz
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
    return "L1";
  } catch (error) {
    console.error("Erro ao carregar Posto_trabalho.csv:", error);
    return "L1";
  }
}

// Função para preencher Kanban (PCP/Comercial) – se você usar
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

          // Filtro para PCP/Comercial (exemplo)
          if ((tipo === 'pcp' || tipo === 'comercial') &&
              codigo.startsWith("FTI") &&
              !codigo.endsWith("BR")) {
            // Se iniciar com FTI e não terminar com BR, ignora o item
            return;
          }

          let quantidade = parseInt(item.produto.quantidade) || 1;

          for (let i = 0; i < quantidade; i++) {
            // Se chegar aqui, o item passou nos filtros
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

            // Adiciona evento de clique para abrir modal
            cardDiv.addEventListener('click', () => abrirModalDetalhes(cardDiv));
            groupDiv.appendChild(cardDiv);
          }
        }
      });
    }

    // Se temItensValidos, adiciona o groupDiv
    if (temItensValidos) {
      container.appendChild(groupDiv);
    }
  });
  console.log("Preenchimento do kanban para", tipo, "finalizado.");
}

// Função para criar os cards a partir do CSV (mantida para produção)
function addTaskToKanban(taskData) {
  const container = document.getElementById('ul-todo');
  if (!container) {
    console.error("Contêiner não encontrado para ul-todo");
    return;
  }
  
  const li = document.createElement('li');
  li.className = 'sample';
  li.id = 'li-' + taskData.Pedido + '-' + taskData.produto;
  li.draggable = true;
  
  // Armazena os dados do CSV no dataset
  li.dataset.status = taskData.status;
  li.dataset.local = taskData.local || "";
  li.dataset.dataPrevisao = taskData["data_previsao"] || "";
  li.dataset.descricao = taskData["descricao"] || "";
  li.dataset.caracteristica = taskData["caracteristica"] || "";
  li.dataset.observacao = taskData["observação"] || "";
  
  li.innerHTML = `
    <span class="txt">${taskData["observação"] || ""}</span>
    <div class="task-details">
      <span class="op">${taskData.OP || ""}</span>
      <span class="pedido">Pedido: ${taskData.Pedido}</span>
      <span class="produto">Produto: ${taskData.produto}</span>
    </div>
  `;
  li.addEventListener('dragstart', drag);
  li.addEventListener('click', () => abrirModalDetalhes(li));
  
  container.appendChild(li);
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

// Filtra cards no PCP
function updateProductCodesListbox() {
  const filterContainer = document.getElementById('pcp-filter-container');
  const selectElem = document.getElementById('filterListbox');

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

  const doneCards = document.querySelectorAll('#ul-done .pedido-card');
  const productMap = new Map();

  doneCards.forEach(card => {
    const productText = card.querySelector('.produto')?.textContent || "";
    const code = productText.replace("Produto:", "").trim();
    if (code) {
      productMap.set(code, (productMap.get(code) || 0) + 1);
    }
  });

  let productsArray = Array.from(productMap.entries());
  productsArray.sort((a, b) => b[1] - a[1]);

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
  
  if (selectedCode === "") {
    const allCards = document.querySelectorAll('#ul-done .pedido-card');
    allCards.forEach(card => card.style.display = '');
    return;
  }
  
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
    } else {
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
  const li = ev.target.closest('li');
  if (!li) {
    console.error("Elemento LI não encontrado no dragstart");
    return;
  }
  const id = li.id.trim();
  console.log("dragstart – id:", id);
  ev.dataTransfer.setData("text/plain", id);
}
function drop(ev, el) {
  ev.preventDefault();
  const draggedItemId = ev.dataTransfer.getData("text").trim();
  console.log("Drop event: item arrastado:", draggedItemId, "destino:", el.id);
  const item = document.getElementById(draggedItemId);
  if (!item) {
    console.error("Item não encontrado com o id:", draggedItemId);
    return;
  }

  // Adiciona o item no container de destino
  el.appendChild(item);
  changeTask();
  calcUpDown();

  let newStatus;
  let newLocal;
  if (el.id === "ul-todo") {
    let currentStatus = item.dataset.status || "";
    if (currentStatus.includes("P1P")) {
      newStatus = currentStatus.replace(/\bP1P\b/, "P1");
    } else {
      newStatus = "L0";
    }
  } else if (el.id === "ul-working") {
    newStatus = "L1";
  } else if (el.id === "ul-production") {
    let currentStatus = item.dataset.status || "";
    if (currentStatus.includes("P1")) {
      newStatus = currentStatus.replace(/\bP1\b/, "P1P");
    } else {
      newStatus = currentStatus || "P1P";
    }
  } else if (el.id === "ul-done") {
    newStatus = "L2";
  } else if (el.id === "ul-urgent") {
    newStatus = "LU3";
  } else {
    newStatus = "L0";
  }

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
        newLocal = "LIDER DE PRODUÇÃO";
        break;
      default:
        if (el.id === "ul-production") {
          newLocal = "EM PRODUÇÃO";
        } else {
          newLocal = "LIDER DE PRODUÇÃO";
        }
    }
  }
  
  item.dataset.status = newStatus;

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
  const toDoDiv = document.getElementById('to-do');
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
  }
  myLists.insertBefore(urgentContainer, doNe);

  const ulUrgent = document.getElementById('ul-urgent');
  if (ulUrgent && ulUrgent.childElementCount === 0) {
    urgentContainer.style.display = 'none';
  } else {
    urgentContainer.style.display = 'block';
  }

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
function countAllItems() {
  let total = 0;
  const todo = document.getElementById('ul-todo');
  if (todo) {
    total += todo.childElementCount;
  }
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

let sortAsc = true;

function sortGroupsByDataPrevisao(containerId) {
  const container = document.getElementById(containerId);
  const groups = Array.from(container.querySelectorAll('.pedido-group'));
  function parseDate(str) {
    const parts = str.split('/');
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }
  groups.sort((a, b) => {
    const dateAString = a.getAttribute('data-date-previsao') || "01/01/1970";
    const dateBString = b.getAttribute('data-date-previsao') || "01/01/1970";
    const dateA = parseDate(dateAString);
    const dateB = parseDate(dateBString);
    return dateA - dateB;
  });
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
  const observacaoRaw = elemento.querySelector('.txt')?.textContent.trim() ||
                          elemento.querySelector('.obs_venda')?.textContent.replace("Obs Venda:", "").trim() || "";
  const observacao = observacaoRaw.replace(/\|\|/g, "\n\n").replace(/\|/g, "\n");
  const op = elemento.querySelector('.op')?.textContent.trim() || "";
  
  // Armazena os dados do item para uso posterior
  window.currentItemData = {
    pedido,
    produto,
    local: elemento.dataset.local || "",
    status: elemento.dataset.status || "",
    op,
    dataPrev,
    descricao,
    caracteristica,
    observacao,
    cardId: elemento.id
  };

  console.log("Dados do item:", window.currentItemData);
  
  // Define o texto e a ação do botão principal (Pausar/Retomar) com base no status
  const statusVal = window.currentItemData.status;
  const parts = statusVal.split(";");
  let actionBtnText = "Pausar";
  let actionOnClick = "pausarItem()";
  if (parts.length >= 3 && parts[2].trim() === "=") {
    actionBtnText = "Retomar";
    actionOnClick = "retomarItem()";
  }
  
  // Monta o HTML do modal
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
      <!-- O container para o gráfico permanece opcional e inicialmente oculto -->
    </div>
    <div class="modal-footer">
      <div class="footer-row" style="display: flex; justify-content: space-around; flex-wrap: nowrap; gap: 10px;">
        <button class="btn-fechar" onclick="${actionOnClick}">${actionBtnText}</button>
        <button class="btn-fechar" onclick="riItem()">RI</button>
        <button class="btn-fechar" onclick="listaPecas()">Lista de peças</button>
        <button class="btn-fechar" onclick="instrucaoItem()">Instrução</button>
        <button class="btn-fechar" onclick="GraficoItem()">Grafico</button>
      </div>
    </div>
  `;
  
  // Exibe o modal principal e seu overlay
  document.getElementById('modalOverlay').style.display = 'block';
  modal.style.display = 'block';
}

function mostrarGraficoParadas() {
  let container = document.getElementById('graficoParadas');
  if (!container) {
    console.error("Container 'graficoParadas' não encontrado. Criando-o dinamicamente.");
    container = document.createElement('div');
    container.id = 'graficoParadas';
    container.style.display = 'block';
    container.style.width = '100%';
    container.style.height = '300px';
    container.style.marginTop = '10px';
    const modalBody = document.querySelector('#modalBox .modal-body');
    if (modalBody) {
      modalBody.appendChild(container);
    } else {
      console.error("Elemento .modal-body não encontrado.");
      return;
    }
  } else {
    container.style.display = 'block';
  }
  // Chama a função para gerar gráfico
  gerarGraficoParadas();
}

function fecharModalGrafico() {
  const overlay = document.getElementById('modalGraficoOverlay');
  const modalGrafico = document.getElementById('modalGrafico');
  if (overlay) overlay.style.display = 'none';
  if (modalGrafico) modalGrafico.style.display = 'none';
}

function updateCardColors() {
  const cards = document.querySelectorAll('li.sample');
  cards.forEach(card => {
    const status = card.dataset.status || "";
    const parts = status.split(";");
    if (parts.length >= 3 && parts[2].trim() === "=") {
      card.style.backgroundColor = "yellow";
    }
  });
}

function retomarItem() {
  // Extraia op do window.currentItemData
  const { pedido, produto, local, status, cardId, op } = window.currentItemData || {};
  if (!pedido || !produto || !op) {
    console.error("Dados do item não encontrados.");
    return;
  }
  
  // Remove o "=" do terceiro campo do status
  let parts = status.split(";");
  if (parts.length >= 3 && parts[2].trim() === "=") {
    parts[2] = "";
  }
  // Reconstroi o status filtrando os campos vazios
  const newStatus = parts.filter(p => p.trim() !== "").join(";");
  
  // Obtém a hora atual (formato hh:mm) para preencher o h_fim
  const now = new Date();
  const horas = String(now.getHours()).padStart(2, '0');
  const minutos = String(now.getMinutes()).padStart(2, '0');
  const h_fim = `${horas}:${minutos}`;
  
  // Atualiza o status do item no plano_op.csv
  fetch('/api/plano-op/atualizar-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pedido,
      produto,
      local: local,
      status: newStatus
    })
  })
  .then(response => response.json())
  .then(result => {
    console.log("Status atualizado (retomar):", result);
    // Atualiza o h_fim no Paradas.csv usando o campo op como chave
    return fetch('/api/paradas/atualizar-hfim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        OP: op,
        h_fim: h_fim
      })
    });
  })
  .then(response => response.json())
  .then(result => {
    console.log("Registro em Paradas.csv atualizado com h_fim:", result);
    const card = document.getElementById(cardId);
    if (card) {
      card.style.backgroundColor = ""; // Restaura a cor original
      card.dataset.status = newStatus;
    }
    alert("Item retomado com sucesso!");
    fecharModal();
  })
  .catch(error => {
    console.error("Erro ao retomar o item:", error);
    alert("Erro ao retomar o item.");
  });
}

function calcularIntervaloEmMinutos(h_inicio, h_fim) {
  const [horaInicio, minInicio] = h_inicio.split(':').map(Number);
  const [horaFim, minFim] = h_fim.split(':').map(Number);
  let inicioTotal = horaInicio * 60 + minInicio;
  let fimTotal = horaFim * 60 + minFim;
  
  if (fimTotal < inicioTotal) {
    fimTotal += 24 * 60;
  }
  return fimTotal - inicioTotal;
}

// Agora, a função é realmente 'async' e o bloco 'try/catch' com 'await' fica aqui dentro
async function gerarGraficoParadas() {
  // Pega a OP do item atual (currentItemData.op)
  const { op } = window.currentItemData || {};
  if (!op) {
    console.error("OP do item não encontrada.");
    return;
  }
  try {
    // Ajuste o caminho conforme necessário – ex.: '../csv/Paradas.csv'
    const response = await fetch('../csv/Paradas.csv');
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true
    });
    
    // Filtrar registros da OP atual que possuem h_inicio e h_fim preenchidos
    const registrosFiltrados = parsed.data.filter(reg => {
      return reg.OP && reg.OP.trim() === op.trim() && reg.h_inicio && reg.h_fim;
    });
    
    // Agrupar por motivo e somar os intervalos (em minutos)
    const agrupamento = {};
    registrosFiltrados.forEach(reg => {
      const motivo = reg.motivo ? reg.motivo.trim() : "Sem motivo";
      const intervalo = calcularIntervaloEmMinutos(reg.h_inicio.trim(), reg.h_fim.trim());
      if (agrupamento[motivo]) {
        agrupamento[motivo] += intervalo;
      } else {
        agrupamento[motivo] = intervalo;
      }
    });
    
    const motivos = Object.keys(agrupamento);
    const intervalos = motivos.map(m => agrupamento[m]);
    
    const data = [{
      x: motivos,
      y: intervalos,
      type: 'bar',
      marker: {
        color: 'rgba(255, 165, 0, 0.7)'
      }
    }];
    
    const layout = {
      title: 'Tempo de Parada por Motivo',
      xaxis: { title: 'Motivo' },
      yaxis: { title: 'Tempo de Parada (minutos)' },
      margin: { t: 40, b: 40 }
    };
    
    Plotly.newPlot('graficoParadas', data, layout);
    
  } catch (error) {
    console.error("Erro ao gerar gráfico de paradas:", error);
  }
}

function GraficoItem() {
  mostrarGraficoModal();
}

function instrucaoItem() {
  alert("Botão instrução clicado!");
}

function mostrarGraficoModal() {
  let overlay = document.getElementById('modalGraficoOverlay');
  let modalGrafico = document.getElementById('modalGrafico');

  // Se não existir, cria na hora:
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modalGraficoOverlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    overlay.style.zIndex = '1100';
    document.body.appendChild(overlay);
  }

  if (!modalGrafico) {
    modalGrafico = document.createElement('div');
    modalGrafico.id = 'modalGrafico';
    modalGrafico.style.position = 'fixed';
    modalGrafico.style.top = '50%';
    modalGrafico.style.left = '50%';
    modalGrafico.style.transform = 'translate(-50%, -50%)';
    modalGrafico.style.width = '80%';
    modalGrafico.style.maxWidth = '800px';
    modalGrafico.style.backgroundColor = '#fff';
    modalGrafico.style.padding = '20px';
    modalGrafico.style.borderRadius = '8px';
    modalGrafico.style.boxShadow = '0 5px 15px rgba(0,0,0,0.3)';
    modalGrafico.style.zIndex = '1200';
    modalGrafico.innerHTML = `
      <div style="text-align: right;">
        <button onclick="fecharModalGrafico()" 
                style="background: #2a92bf; color: #fff; border: none; border-radius: 4px; padding: 0.5em 1em; cursor: pointer;">
          Fechar
        </button>
      </div>
      <div id="graficoParadas" style="width: 100%; height: 300px; margin-top: 10px;"></div>
    `;
    document.body.appendChild(modalGrafico);
  }

  // Exibe o overlay e o modal
  overlay.style.display = 'block';
  modalGrafico.style.display = 'block';

  // Gera o gráfico de paradas (ou qualquer gráfico que desejar)
  gerarGraficoParadas();
}
