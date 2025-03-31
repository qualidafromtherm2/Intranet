/******************************************************
 * abertura_op/abertura_op.js
 * Script que controla a lógica do Kanban (drag/drop etc.)
 ******************************************************/

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

    // Limpa as listas padrão
    document.getElementById('ul-todo').innerHTML = '';
    document.getElementById('ul-working').innerHTML = '';
    document.getElementById('ul-done').innerHTML = '';

    // Verifica se existe a coluna URGENTE
    let urgentContainer = document.getElementById('ur-gent');
    if (urgentContainer) {
      document.getElementById('ul-urgent').innerHTML = '';
    }

    // Filtra registros com status "LU3" para ver se precisamos mostrar a coluna URGENTE
    const urgentRows = rows.filter(row => row.status && row.status.trim() === "LU3");
    if (urgentRows.length > 0) {
      // Se não existe a coluna URGENTE, cria
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
        // Insere a coluna urgente depois de #do-ne
        const doNe = document.getElementById('do-ne');
        doNe.parentNode.insertBefore(urgentContainer, doNe.nextSibling);
      }
    } else {
      // Se não houver tasks urgentes, remove a coluna se existir
      if (urgentContainer) {
        urgentContainer.remove();
      }
    }

    // Processa cada linha do CSV e adiciona no Kanban
    rows.forEach(row => {
      // Precisamos, em especial, de:
      // row.status => "L0", "L1", "L2", "LU3"
      // row.observação => para .txt
      // row.Pedido, row.produto => para ID e detalhes
      // row.local => se quiser exibir no card

      if (row.Pedido && row.produto && row["observação"] && row.status) {
        addTaskToKanban(row);
      } else {
        console.warn("Linha ignorada ou com campos incompletos:", row);
      }
    });
  } catch (error) {
    console.error("Erro ao carregar CSV:", error);
  }
}

function addTaskToKanban(taskData) {
  // Define o container com base no status (L0 => #ul-todo, etc.)
  let containerId = '';
  const status = taskData.status ? taskData.status.trim() : "";

  if (status === "L0") {
    containerId = 'ul-todo';
  } else if (status === "L1") {
    containerId = 'ul-working';
  } else if (status === "L2") {
    containerId = 'ul-done';
  } else if (status === "LU3") {
    containerId = 'ul-urgent';
  } else {
    // Se for algo fora do esperado, coloca no L0
    containerId = 'ul-todo';
  }

  const container = document.getElementById(containerId);
  if (!container) {
    console.error("Contêiner não encontrado para o status:", status);
    return;
  }

  const li = document.createElement('li');
  li.className = 'sample';
  li.draggable = true;

  // Monta um ID único (por exemplo, li-<pedido>-<produto>)
  li.id = 'li-' + taskData.Pedido + '-' + taskData.produto;
  li.setAttribute('ondragstart', 'drag(event)');
  li.setAttribute('ontouchstart', 'drag(event)');

  // Observação
  const obs = taskData["observação"] || "";
  // Local textual (ex.: "LIDER DE PRODUÇÃO", "LOGISTICA", etc.)
  const localText = taskData.local || "";

  // Cria o HTML interno
  li.innerHTML = `
    <span class="txt">${obs}</span>
    <div class="task-details">
      <span class="op">${taskData.OP || ""}</span>
      <span class="pedido">Pedido: ${taskData.Pedido}</span>
      <span class="produto">Produto: ${taskData.produto}</span>
      <span class="localText">${localText}</span>
    </div>
    <a class="up" href="#"></a>
    <a class="down" href="#"></a>
  `;

  // Adiciona listener para abrir modal de edição ao clicar
  li.addEventListener('click', function(e) {
    // Se clicou em up/down, não abre modal
    if (e.target.classList.contains('up') || e.target.classList.contains('down')) {
      return;
    }
    editTask(e, li);
  });

  container.appendChild(li);
  calcUpDown();
  changeTask();
  countTask();
}

function editTask(event, li) {
  event.stopPropagation();

  const txtElem = li.querySelector('.txt');
  if (!txtElem) {
    console.error("Elemento .txt não encontrado na task:", li.id);
    return;
  }
  const obs = txtElem.textContent;

  const pedidoElem = li.querySelector('.task-details .pedido');
  if (!pedidoElem) {
    console.error("Elemento .pedido não encontrado na task:", li.id);
    return;
  }
  const pedido = pedidoElem.textContent.replace("Pedido:", "").trim();

  const opElem = li.querySelector('.task-details .op');
  const op = opElem ? opElem.textContent.trim() : "";
  const prodElem = li.querySelector('.task-details .produto');
  const produto = prodElem ? prodElem.textContent.replace("Produto:", "").trim() : "";

  // Armazena o ID da task em edição
  window.currentEditingTaskId = li.id;

  // Preenche os campos do modal
  document.getElementById('pedidoField').value = pedido;
  document.getElementById('taskText').value = obs;

  // Abre o modal
  document.getElementById('modalOverlay').style.display = 'block';
  document.getElementById('modalBox').style.display = 'block';
}

const myLists = document.getElementById('myLists');
if (!myLists.classList.contains('fourCol')) {
  myLists.classList.add('fourCol');
}

function toggleUrgentColumn() {
  let urgentContainer = document.getElementById('ur-gent');
  if (!urgentContainer) {
    // Cria a coluna urgente
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
    // Toggle exibir/ocultar
    urgentContainer.style.display = (urgentContainer.style.display === 'none') ? 'block' : 'none';
  }
}

// Eventos e inicialização da página
document.addEventListener('DOMContentLoaded', function() {
  // Botão “+” para abrir o modal
  const toDoButton = elem('addToDo');
  toDoButton.addEventListener('click', function() {
    elem('taskText').value = 'New Task';
    elem('modalOverlay').style.display = 'block';
    elem('modalBox').style.display = 'block';
  });

  // Botão “Ok” do modal: envia dados e recarrega tasks do CSV
  document.getElementById('taskButton').addEventListener('click', function() {
    const pedido = document.getElementById('pedidoField').value.trim();
    const observacao = document.getElementById('taskText').value.trim();

    if (!pedido) {
      alert("Campo Pedido está vazio.");
      return;
    }

    // Se está editando (tem currentEditingTaskId)
    if (window.currentEditingTaskId) {
      // Atualiza a observação no CSV
      const parts = window.currentEditingTaskId.split('-');
      const pedidoEdit = parts[1];
      const produtoEdit = parts.slice(2).join('-');

      fetch('/api/plano-op/atualizar-observacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedido: pedidoEdit, produto: produtoEdit, observacao: observacao })
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          alert("Task atualizada com sucesso!");
          loadTasksFromCSV();
          fecharModal();
          window.currentEditingTaskId = null;
        } else {
          alert("Erro ao atualizar a task.");
        }
      })
      .catch(error => {
        console.error("Erro ao atualizar observação:", error);
        alert("Erro ao atualizar a task.");
      });
    } else {

// Se não for edição, insere novo item no CSV
const prodButtons = document.querySelectorAll('#produtosSelecionadosContainer .produto-selecionado-btn');
if (prodButtons.length === 0) {
  alert("Nenhum produto foi selecionado.");
  return;
}

// Define local e status inicial
const localInicial = "LIDER DE PRODUÇÃO";
const statusInicial = "L0";
// Data de hoje formatada como dd/mm/yy
const dataAtual = formatDate(new Date());
const userVal = ""; // por enquanto vazio

// Monta o array de dados para o CSV
const dados = Array.from(prodButtons).map(btn => ({
  pedido: pedido,
  produto: btn.getAttribute('data-codigo'),
  local: localInicial,
  status: statusInicial,
  data: dataAtual,
  user: userVal,
  observacao: observacao
}));

      console.log("Enviando ao CSV:", dados); // DEBUG

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

  // Botão “Cancel” do modal
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
  const data = ev.dataTransfer.getData("text");
  if (data) {
    const item = document.getElementById(data);
    el.appendChild(item);
    changeTask();
    calcUpDown();

    // Define o novo status com base no container de destino
    let newStatus = "L0";
    if (el.id === "ul-todo") {
      newStatus = "L0";
    } else if (el.id === "ul-working") {
      newStatus = "L1";
    } else if (el.id === "ul-done") {
      newStatus = "L2";
    } else if (el.id === "ul-urgent") {
      newStatus = "LU3";
    }

    // Define o novo local textual
    let newLocal = "LIDER DE PRODUÇÃO";
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

    // Extrai os dados da task a partir do id do <li>
    const parts = item.id.split('-');
    const pedido = parts[1];
    const produto = parts.slice(2).join('-');

    // Atualiza no CSV chamando o endpoint de atualização (local e status)
    fetch('/api/plano-op/atualizar-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedido, produto, local: newLocal, status: newStatus })
    })
    .then(response => response.json())
    .then(data => {
      console.log("Status/local atualizado no CSV:", data);
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
  // Caso tenha lógica de confirmação, etc.
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
      document.getElementById('taskText').value = obs;

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
      document.getElementById('taskText').value = obs;

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
  document.getElementById('modalOverlay').style.display = 'block';
  document.getElementById('modalBox').style.display = 'block';
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


// Função para formatar a data no padrão dd/mm/yy
function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}