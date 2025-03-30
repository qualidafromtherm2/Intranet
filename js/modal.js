// modal.js
import { toggleEditMode } from './editFields.js';
import { toggleCharacteristicsTableEdit, enableSelectCaracteristica } from './editCharacteristics.js';
import { fetchPosicaoEstoque, getTextOfField } from './utils.js';
import { collectEditsFromCard } from './editCard.js';


function createAccordionMenu() {
  const accordion = document.createElement('ul');
  accordion.id = "accordion";
  accordion.className = "accordion";
  accordion.innerHTML = `
    <li>
      <div class="link"><i class="fa fa-database"></i>Web Design<i class="fa fa-chevron-down"></i></div>
      <ul class="submenu">
        <li><a href="#">Photoshop</a></li>
        <li><a href="#">HTML</a></li>
        <li><a href="#">CSS</a></li>
      </ul>
    </li>
    <li>
      <div class="link"><i class="fa fa-code"></i>Coding<i class="fa fa-chevron-down"></i></div>
      <ul class="submenu">
        <li><a href="#">Javascript</a></li>
        <li><a href="#">jQuery</a></li>
        <li><a href="#">Ruby</a></li>
      </ul>
    </li>
    <li>
      <div class="link"><i class="fa fa-mobile"></i>Devices<i class="fa fa-chevron-down"></i></div>
      <ul class="submenu">
        <li><a href="#">Tablet</a></li>
        <li><a href="#">Mobile</a></li>
        <li><a href="#">Desktop</a></li>
      </ul>
    </li>
    <li>
      <div class="link"><i class="fa fa-globe"></i>Global<i class="fa fa-chevron-down"></i></div>
      <ul class="submenu">
        <li><a href="#">Google</a></li>
        <li><a href="#">Bing</a></li>
        <li><a href="#">Yahoo</a></li>
      </ul>
    </li>
  `;
  return accordion;
}

/* --------------------------------------------------------------------------
   Função: createFloatingButtonMenu
   Cria e configura o menu flutuante, sem dependências de outros elementos.
-------------------------------------------------------------------------- 
export function createFloatingButtonMenu() {
  const navDiv = document.createElement('div');
  navDiv.className = 'nav';
  navDiv.innerHTML = `
    <a href="#profile" class="nav-item nav-count-1" title="Perfil">
      <i class="ion-ios-person-outline"></i>
    </a>
    <a href="#edit" class="nav-item nav-count-2" id="editBtn" title="Editar produto">
      <i class="fa fa-edit"></i>
    </a>
    <a href="#chats" class="nav-item nav-count-3" title="Editar característica">
      <i class="fa fa-tags"></i>
    </a>
    <a href="#alarm" class="nav-item nav-count-4" title="Alarme">
      <i class="ion-ios-alarm-outline"></i>
    </a>
    <a href="#toggle" class="mask" title="Mais opções">
      <i class="ion-ios-plus-empty"></i>
    </a>
  `;

  // Configura o botão "mask"
  const maskBtn = navDiv.querySelector('.mask');
  if (maskBtn) {
    maskBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log("Clique no mask");
      navDiv.classList.toggle('active');
    });
  }

  // Fecha o menu ao clicar nos outros itens
  const navItems = navDiv.querySelectorAll('a.nav-item:not(.mask)');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navDiv.classList.remove('active');
    });
  });

  return navDiv;
}*/

/* --------------------------------------------------------------------------
   Função: updateDeleteIcons
   Atualiza ou remove os ícones de exclusão na tabela de características.
-------------------------------------------------------------------------- */
function updateDeleteIcons(table, enable) {
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    const hasDeleteCell = (cells.length === 6);
    if (enable && !hasDeleteCell) {
      const tdExcluir = document.createElement('td');
      tdExcluir.innerHTML = `<i class="fa fa-trash" title="Excluir característica" style="cursor: pointer; color: red;"></i>`;
      tdExcluir.style.border = '1px solid #ccc';
      tdExcluir.style.padding = '5px';

      tdExcluir.addEventListener('click', async () => {
        if (confirm("Deseja realmente excluir esta característica?")) {
          const cCodIntCaract = cells[0].querySelector('select')
            ? cells[0].querySelector('select').value
            : cells[0].innerText.trim();
          const container = row.closest('.expanded-card-container');
          const cardClone = container?.firstElementChild;
          const prodCodigo = container?.querySelector('.card-info h2')?.innerText.trim();

          if (!prodCodigo) {
            alert("Não foi possível obter o código do produto.");
            return;
          }

          // LOGA O CÓDIGO ANTES DE EXCLUIR
          try {
            await fetch('/api/log-codigo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ codigo: prodCodigo })
            });
          } catch (err) {
            console.error("Falha ao logar código:", err);
          }

          const payload = {
            cCodIntProd: prodCodigo,
            cCodIntCaract: cCodIntCaract
          };

          try {
            const response = await fetch('/api/excluir-caracteristica', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (!data.error) {
              alert("Característica excluída com sucesso!");
              row.remove();
              if (cardClone) {
                cardClone.dataset.characteristicsEditing = "false";
                const addRowContainer = cardClone.querySelector('.add-row-container');
                if (addRowContainer) addRowContainer.remove();
                const editableCells = cardClone.querySelectorAll('.card-info td');
                editableCells.forEach(cell => {
                  cell.style.backgroundColor = "";
                  cell.style.outline = "";
                  cell.contentEditable = "false";
                });
                await toggleCharacteristicsTableEdit(cardClone);
                updateDeleteIcons(table, false);
              }
            } else {
              let errorMsg = "Erro ao excluir característica.";
              if (data.cDesStatus) errorMsg += " " + data.cDesStatus;
              if (data.faultcode) errorMsg += " Fault Code: " + data.faultcode;
              if (data.faultstring) errorMsg += " Fault String: " + data.faultstring;
              alert(errorMsg);
            }
          } catch (err) {
            console.error("Erro ao enviar requisição de exclusão:", err);
            alert("Erro ao excluir característica.");
          }
        }
      });
      row.appendChild(tdExcluir);
    } else if (!enable && hasDeleteCell) {
      row.lastElementChild.remove();
    }
  });
}
export { updateDeleteIcons };



async function loadAccordionMenu() {
  try {
    // Ajuste o caminho se necessário
    const response = await fetch('menu_produto.html');
    if (!response.ok) {
      throw new Error('Não foi possível carregar o menu.');
    }
    const html = await response.text();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    // Retorna o elemento com id "accordion"
    return wrapper.querySelector('#accordion');
  } catch (err) {
    console.error("Erro ao carregar o menu:", err);
    return null;
  }
}





/* --------------------------------------------------------------------------
   Função: showCardModal
   Exibe o modal com o card expandido, preenche com dados do produto e injeta o carrossel.
-------------------------------------------------------------------------- */
export async function showCardModal(cardElement, omieData) {
  const modal = document.getElementById('cardModal');
  const modalBody = document.getElementById('cardModalBody');
  modalBody.innerHTML = "";

  const container = document.createElement('div');
  container.className = 'expanded-card-container';

  // Clona o card original e desativa a edição de características
  const clone = cardElement.cloneNode(true);
  
  clone.dataset.characteristicsEditing = "false";

  const clonedCardInfo = clone.querySelector('.card-info');
  if (!clonedCardInfo) {
    container.appendChild(clone);
    modalBody.appendChild(container);
    modal.style.display = "flex";
    return;
  }

  
  const h2title = clonedCardInfo.querySelector('h2');

  // Remove todos os elementos de .card-info, exceto o <h2>
  [...clonedCardInfo.children].forEach(child => {
    if (child !== h2title) child.remove();
  });

  // Preenche com os dados do produto obtidos da Omie
  if (omieData) {
    const descEl = document.createElement('p');
    descEl.innerHTML = `<strong>Descrição:</strong> ${omieData.descricao || ''}`;
    clonedCardInfo.appendChild(descEl);

    const detalhadaEl = document.createElement('p');
    detalhadaEl.innerHTML = `<strong>Descrição detalhada:</strong> ${omieData.descr_detalhada || ''}`;
    clonedCardInfo.appendChild(detalhadaEl);

    const columnsContainer = document.createElement('div');
    columnsContainer.className = 'modal-columns';
    columnsContainer.style.display = 'flex';
    columnsContainer.style.gap = '20px';
    columnsContainer.style.marginTop = '10px';

    // Coluna esquerda com dados
    const leftCol = document.createElement('div');
    leftCol.className = 'modal-column left';
    leftCol.style.flex = '1';
    const ncmEl = document.createElement('p');
    ncmEl.innerHTML = `<strong>NCM:</strong> ${omieData.ncm || ''}`;
    leftCol.appendChild(ncmEl);
    const eanEl = document.createElement('p');
    eanEl.innerHTML = `<strong>EAN:</strong> ${omieData.ean || ''}`;
    leftCol.appendChild(eanEl);
    const tipoItemEl = document.createElement('p');
    tipoItemEl.innerHTML = `<strong>Tipo Item:</strong> ${omieData.tipoItem || ''}`;
    leftCol.appendChild(tipoItemEl);
    const familiaEl = document.createElement('p');
    familiaEl.innerHTML = `<strong>Descrição da família:</strong> ${omieData.descricao_familia || ''}`;
    leftCol.appendChild(familiaEl);
    const unidadeEl = document.createElement('p');
    unidadeEl.dataset.field = 'unidade';
    unidadeEl.innerHTML = `<strong>Unidade:</strong> ${omieData.unidade || ''}`;
    leftCol.appendChild(unidadeEl);
    const bloqueadoEl = document.createElement('p');
    bloqueadoEl.dataset.field = 'bloqueado';
    bloqueadoEl.innerHTML = `<strong>Bloqueado:</strong> ${omieData.bloqueado || ''}`;
    leftCol.appendChild(bloqueadoEl);
    const inativoEl = document.createElement('p');
    inativoEl.dataset.field = 'inativo';
    inativoEl.innerHTML = `<strong>Inativo:</strong> ${omieData.inativo || ''}`;
    leftCol.appendChild(inativoEl);

    // Coluna direita com dados do estoque
    const rightCol = document.createElement('div');
    rightCol.className = 'modal-column right';
    rightCol.style.flex = '1';
    try {
      const hoje = new Date();
      const dia = String(hoje.getDate()).padStart(2, '0');
      const mes = String(hoje.getMonth() + 1).padStart(2, '0');
      const ano = hoje.getFullYear();
      const dataFormato = `${dia}/${mes}/${ano}`;
      const codigoProd = omieData.codigo;
      const estoqueData = await fetchPosicaoEstoque(codigoProd, dataFormato);
      if (estoqueData && estoqueData.codigo_status === '0') {
        const { cmc, saldo, reservado, fisico } = estoqueData;
        const valorFormatado = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cmc ?? 0);
        const valorEstoqueEl = document.createElement('p');
        valorEstoqueEl.innerHTML = `<strong>Valor Unitário:</strong> ${valorFormatado}`;
        rightCol.appendChild(valorEstoqueEl);
        const saldoEl = document.createElement('p');
        saldoEl.innerHTML = `<strong>Saldo:</strong> ${saldo ?? 0}`;
        rightCol.appendChild(saldoEl);
        const reservadoEl = document.createElement('p');
        reservadoEl.innerHTML = `<strong>Reservado:</strong> ${reservado ?? 0}`;
        rightCol.appendChild(reservadoEl);
        const fisicoEl = document.createElement('p');
        fisicoEl.innerHTML = `<strong>Físico:</strong> ${fisico ?? 0}`;
        rightCol.appendChild(fisicoEl);
      } else {
        const valorEstoqueEl = document.createElement('p');
        valorEstoqueEl.innerHTML = `<strong>Valor Unitário:</strong> (não encontrado)`;
        rightCol.appendChild(valorEstoqueEl);
      }
      const dataInclEl = document.createElement('p');
      dataInclEl.innerHTML = `<strong>Data de inclusão:</strong> ${omieData?.info?.dInc || ''}`;
      rightCol.appendChild(dataInclEl);
      const dataAltEl = document.createElement('p');
      dataAltEl.innerHTML = `<strong>Data da última alteração:</strong> ${omieData?.info?.dAlt || ''}`;
      rightCol.appendChild(dataAltEl);
    } catch (err) {
      console.error("Erro ao buscar posição de estoque:", err);
      const valorEstoqueEl = document.createElement('p');
      valorEstoqueEl.innerHTML = `<strong>Valor Unitário:</strong> (erro ao buscar)`;
      rightCol.appendChild(valorEstoqueEl);
    }
    columnsContainer.appendChild(leftCol);
    columnsContainer.appendChild(rightCol);
    clonedCardInfo.appendChild(columnsContainer);

    // Cria a tabela de características, se houver
    if (Array.isArray(omieData.caracteristicas) && omieData.caracteristicas.length > 0) {
      // 1) Cria um contêiner para a rolagem
      const tableContainer = document.createElement('div');
      tableContainer.className = 'table-scroll'; // classe que usaremos no CSS
    
      // 2) Cria a tabela
      const caractTable = document.createElement('table');
      caractTable.style.borderCollapse = 'collapse';
      caractTable.style.marginTop = '10px';
    
      // 3) Cria o thead com as colunas
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      const headers = ['Característica', 'Conteúdo', 'Exibir Item NF', 'Exibir Item Pedido', 'Exibir Ordem Prod'];
      headers.forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        th.style.border = '1px solid #ccc';
        th.style.padding = '5px';
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      caractTable.appendChild(thead);
    
      // 4) Cria o tbody com as linhas
      const tbody = document.createElement('tbody');
      omieData.caracteristicas.forEach(c => {
        const row = createCharacteristicRow(c);
        tbody.appendChild(row);
      });
      caractTable.appendChild(tbody);
    
      // 5) Adiciona a tabela dentro do contêiner
      tableContainer.appendChild(caractTable);
    
      // 6) Adiciona o contêiner no clonedCardInfo
      clonedCardInfo.appendChild(tableContainer);
    }
    
    // Ícone para salvar produto
    if (h2title) {
      const saveIcon = document.createElement('span');
      saveIcon.id = 'saveIcon';
      saveIcon.style.cursor = 'pointer';
      saveIcon.style.marginLeft = '10px';
      saveIcon.innerHTML = `<i class="fa fa-save"></i>`;
      saveIcon.style.display = 'none';
      h2title.appendChild(saveIcon);

      saveIcon.addEventListener('click', async () => {
        const camposEdicao = collectEditsFromCard(clone);

        // LOGA O CÓDIGO ANTES DE SALVAR
        try {
          await fetch('/api/log-codigo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo: camposEdicao.codigo })
          });
        } catch (err) {
          console.error("Falha ao logar código:", err);
        }

        try {
          const response = await fetch('/api/produtos/alterar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(camposEdicao)
          });
          const data = await response.json();
          if (data.success) {
            alert("Produto atualizado com sucesso!");
          } else {
            alert("Erro: " + data.error);
          }
        } catch (error) {
          console.error("Erro ao salvar alterações:", error);
          alert("Erro ao salvar alterações");
        }

  

        const existingIconContainer = clone.querySelector('.add-row-container');
        if (editing) {
          if (!existingIconContainer) {
            const newAddRowIcon = document.createElement('span');
            newAddRowIcon.style.cursor = 'pointer';
            newAddRowIcon.style.marginTop = '10px';
            newAddRowIcon.style.textAlign = 'left';
            newAddRowIcon.innerHTML = `<i class="fa fa-plus-circle fa-2x" title="Adicionar nova característica"></i>`;
            newAddRowIcon.addEventListener('click', async () => {
              // 1. Localize a tabela dentro do card, considerando que ela está em um container com a classe 'table-scroll'
              const tableContainer = clone.querySelector('.card-info .table-scroll');
              if (!tableContainer) {
                alert("Tabela de características não encontrada!");
                return;
              }
            
              // 2. Busque a estrutura da tabela dentro do container
              const caractTable = tableContainer.querySelector('table');
              if (!caractTable) {
                alert("Estrutura da tabela não encontrada!");
                return;
              }
            
              // 3. Busque o <tbody> da tabela para inserção
              const tbody = caractTable.querySelector('tbody');
              if (!tbody) {
                alert("Corpo da tabela (tbody) não encontrado!");
                return;
              }
            
              // 4. Crie a nova linha (tr) e marque-a como nova
              const newRow = document.createElement('tr');
              newRow.dataset.new = "true";
            
              // 5. Crie as células (td) para cada coluna:
              const newCell1 = document.createElement('td');
              await enableSelectCaracteristica(newCell1);
            
              const newCell2 = document.createElement('td');
              newCell2.textContent = "";
              newCell2.contentEditable = "true";
              newCell2.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
              newCell2.style.outline = '1px dashed #ccc';
            
              // Função para criar células com select (para as colunas 3 a 5)
              const createSelectCell = (defaultValue = "N") => {
                const cell = document.createElement('td');
                const select = document.createElement('select');
                const optionS = document.createElement('option');
                optionS.value = 'S';
                optionS.text = 'S';
                const optionN = document.createElement('option');
                optionN.value = 'N';
                optionN.text = 'N';
                select.appendChild(optionS);
                select.appendChild(optionN);
                select.value = defaultValue;
                select.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
                select.style.outline = '1px dashed #ccc';
                cell.appendChild(select);
                return cell;
              };
            
              const newCell3 = createSelectCell();
              const newCell4 = createSelectCell();
              const newCell5 = createSelectCell();
            
              // 6. Anexe as células à nova linha
              newRow.appendChild(newCell1);
              newRow.appendChild(newCell2);
              newRow.appendChild(newCell3);
              newRow.appendChild(newCell4);
              newRow.appendChild(newCell5);
            
              // 7. Insira a nova linha no final do <tbody>
              tbody.appendChild(newRow);
            });
  
            const saveNewIcon = document.createElement('span');
            saveNewIcon.classList.add('save-new-icon');
            saveNewIcon.style.cursor = 'pointer';
            saveNewIcon.style.marginTop = '10px';
            saveNewIcon.style.marginLeft = '10px';
            saveNewIcon.innerHTML = `<i class="fa fa-check-circle fa-2x" title="Salvar nova característica"></i>`;
            saveNewIcon.addEventListener('click', async () => {
              let caractTable = clone.querySelector('.card-info table');
              if (caractTable) {
                const tbody = caractTable.querySelector('tbody');
                const targetRow = tbody.lastElementChild;
                if (targetRow) {
                  // Verifica se a linha é nova (inclusão) ou se é edição (alteração)
                  const isNew = targetRow.dataset.new === "true";
                  
                  const cells = targetRow.querySelectorAll('td');
                  const cCodIntCaract = cells[0].querySelector('select')
                    ? cells[0].querySelector('select').value
                    : cells[0].innerText.trim();
                  const cConteudo = cells[1].textContent.trim();
                  const cExibirItemNF = cells[2].querySelector('select')
                    ? cells[2].querySelector('select').value
                    : cells[2].innerText.trim();
                  const cExibirItemPedido = cells[3].querySelector('select')
                    ? cells[3].querySelector('select').value
                    : cells[3].innerText.trim();
                  const cExibirOrdemProd = cells[4].querySelector('select')
                    ? cells[4].querySelector('select').value
                    : cells[4].innerText.trim();
            
                  // Monta o payload com a chamada correta
                  const payload = {
                    call: isNew ? "IncluirCaractProduto" : "AlterarCaractProduto",
                    param: [{
                      cCodIntProd: omieData.codigo,
                      cCodIntCaract: cCodIntCaract,
                      cConteudo: cConteudo,
                      cExibirItemNF: cExibirItemNF,
                      cExibirItemPedido: cExibirItemPedido,
                      cExibirOrdemProd: cExibirOrdemProd
                    }]
                  };

                  // LOGA O CÓDIGO ANTES DE SALVAR A CARACTERÍSTICA
                  try {
                    await fetch('/api/log-codigo', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ codigo: omieData.codigo })
                    });
                  } catch (err) {
                    console.error("Falha ao logar o código:", err);
                  }
            
                  console.log("Payload enviado:", JSON.stringify(payload, null, 2));
            
                  try {
                    const response = await fetch('/api/prodcaract', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload)
                    });
                    const data = await response.json();
                    if (!data.error) {
                      alert(isNew ? 'Característica incluída com sucesso!' : 'Característica alterada com sucesso!');
                      clone.dataset.characteristicsEditing = "false";
                      const addRowContainer = clone.querySelector('.add-row-container');
                      if (addRowContainer) addRowContainer.remove();
                      await toggleCharacteristicsTableEdit(clone);
                    } else {
                      alert('Erro ao salvar característica: ' + JSON.stringify(data));
                    }
                  } catch (err) {
                    console.error("Erro ao enviar requisição:", err);
                    alert('Erro ao salvar característica.');
                  }
                }
              }
            });
            
// Supondo que "clone" seja o card expandido e "modalBody" seja o container do modal
// Primeiro, remova qualquer iconContainer já existente
const existingIconContainer = modalBody.querySelector('.add-row-container');
if (existingIconContainer) {
  existingIconContainer.remove();
}

// Cria o iconContainer (o mesmo código que você já tem)
const iconContainer = document.createElement('div');
iconContainer.classList.add('add-row-container');
iconContainer.style.display = 'flex';
iconContainer.style.alignItems = 'center';
iconContainer.style.marginTop = '1px';
iconContainer.appendChild(newAddRowIcon);
iconContainer.appendChild(saveNewIcon);

// Insere o container fora da área rolável da tabela
// Por exemplo, insira-o como filho de modalBody, logo após o container principal do card:
modalBody.appendChild(iconContainer);

  
            const clonedCardInfo = clone.querySelector('.card-info');
            const tableScroll = clonedCardInfo.querySelector('.table-scroll');
            
            if (tableScroll) {
              // Cria um elemento de separação (pode ser um <br> ou uma <div> com margem)
              const separator = document.createElement('div');
              separator.style.height = '10px'; // ajuste a altura se necessário
              separator.style.width = '100%';
              // Insere o separador e, em seguida, os controles diretamente dentro de .card-info, fora do container de scroll
              clonedCardInfo.appendChild(separator);
              clonedCardInfo.appendChild(iconContainer);
            } else {
              // Se não houver container de scroll, insere normalmente
              const table = clonedCardInfo.querySelector('table');
              if (table) {
                table.parentNode.insertBefore(iconContainer, table.nextSibling);
              } else {
                clonedCardInfo.appendChild(iconContainer);
              }
            }
            
            
          }
        } else {
          const existingIconContainer = clone.querySelector('.add-row-container');
          if (existingIconContainer) {
            existingIconContainer.remove();
          }
        }
      });
    }
  
    container.appendChild(clone);
    modalBody.appendChild(container);

// --- Carrega o menu via fetch ---
// Após carregar o accordionMenu
const accordionMenu = await loadAccordionMenu();
if (accordionMenu) {
  accordionMenu.id = "accordionMenu"; // opcional
  // Posiciona o menu conforme já faz
  const modalRect = modal.getBoundingClientRect();
  accordionMenu.style.position = "fixed";
  accordionMenu.style.top = (modalRect.top + 450) + "px";
  accordionMenu.style.left = (modalRect.right + 1210) + "px";
  accordionMenu.style.width = "180px";
  accordionMenu.style.zIndex = "11000";
  document.body.appendChild(accordionMenu);

  // Aplique as permissões ao accordion apenas dentro desse container:
  const permissoes = JSON.parse(localStorage.getItem('userPermissoes')) || [];
  aplicarPermissoesNoContainer(permissoes, accordionMenu);

  // Inicialize o accordion (como você já faz)
  var Accordion = function(el, multiple) {
    this.el = el || {};
    this.multiple = multiple || false;
    var links = this.el.find('.link');
    links.on('click', { el: this.el, multiple: this.multiple }, this.dropdown);
  };

  Accordion.prototype.dropdown = function(e) {
    var $el = e.data.el;
    var $this = $(this),
        $next = $this.next();
    $next.slideToggle();
    $this.parent().toggleClass('open');
    if (!e.data.multiple) {
      $el.find('.submenu').not($next).slideUp().parent().removeClass('open');
    }
  };

  var accordionObj = new Accordion($(accordionMenu), false);
}




  // Exibe o modal
  modal.style.display = "flex";

  // Configura os eventos do accordion para repassar as funções do botão flutuante
const accordion = document.getElementById('accordionMenu');
if (accordion) {
  const editProdutoLink = accordion.querySelector('#editarProduto');
  const editCaracteristicaLink = accordion.querySelector('#editarCaracteristica');

  if (editProdutoLink) {
    editProdutoLink.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('Editar produto clicado.');
      toggleEditMode(clone);
    });
  }

  if (editCaracteristicaLink) {
    editCaracteristicaLink.addEventListener('click', async (e) => {
      e.preventDefault();
      console.log('Editar característica clicado.');
      const isEditing = clone.dataset.characteristicsEditing === "true";
      const editing = !isEditing;
      clone.dataset.characteristicsEditing = editing.toString();
      await toggleCharacteristicsTableEdit(clone);
      const caractTable = clone.querySelector('.card-info table');
      if (caractTable) {
        updateDeleteIcons(caractTable, editing);
      }
      
      // Se estiver ativando o modo edição, adicione os botões de "+" e "✓"
      if (editing) {
        // Verifica se já não existe o container dos ícones
        const existingIconContainer = clone.querySelector('.add-row-container');
        if (!existingIconContainer) {
          // Cria o ícone de adicionar nova característica
          const newAddRowIcon = document.createElement('span');
          newAddRowIcon.style.cursor = 'pointer';
          newAddRowIcon.style.marginTop = '10px';
          newAddRowIcon.style.textAlign = 'left';
          newAddRowIcon.innerHTML = `<i class="fa fa-plus-circle fa-2x" title="Adicionar nova característica"></i>`;
          newAddRowIcon.addEventListener('click', async () => {
            // Procura a tabela de características no card
            const tableContainer = clone.querySelector('.card-info .table-scroll');
            if (!tableContainer) {
              alert("Tabela de características não encontrada!");
              return;
            }
            const caractTable = tableContainer.querySelector('table');
            if (!caractTable) {
              alert("Estrutura da tabela não encontrada!");
              return;
            }
            const tbody = caractTable.querySelector('tbody');
            if (!tbody) {
              alert("Corpo da tabela (tbody) não encontrado!");
              return;
            }
            // Cria uma nova linha marcada como nova
            const newRow = document.createElement('tr');
            newRow.dataset.new = "true";
            
            // Cria as células
            const newCell1 = document.createElement('td');
            await enableSelectCaracteristica(newCell1);
            
            const newCell2 = document.createElement('td');
            newCell2.textContent = "";
            newCell2.contentEditable = "true";
            newCell2.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
            newCell2.style.outline = '1px dashed #ccc';
            
            // Função auxiliar para criar células com select
            const createSelectCell = (defaultValue = "N") => {
              const cell = document.createElement('td');
              const select = document.createElement('select');
              const optionS = document.createElement('option');
              optionS.value = 'S';
              optionS.text = 'S';
              const optionN = document.createElement('option');
              optionN.value = 'N';
              optionN.text = 'N';
              select.appendChild(optionS);
              select.appendChild(optionN);
              select.value = defaultValue;
              select.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
              select.style.outline = '1px dashed #ccc';
              cell.appendChild(select);
              return cell;
            };
            
            const newCell3 = createSelectCell();
            const newCell4 = createSelectCell();
            const newCell5 = createSelectCell();
            
            // Anexa as células à nova linha
            newRow.appendChild(newCell1);
            newRow.appendChild(newCell2);
            newRow.appendChild(newCell3);
            newRow.appendChild(newCell4);
            newRow.appendChild(newCell5);
            
            // Insere a nova linha no final do tbody
            tbody.appendChild(newRow);
          });
          
          // Cria o ícone de confirmação (salvar a nova característica)
          const saveNewIcon = document.createElement('span');
          saveNewIcon.classList.add('save-new-icon');
          saveNewIcon.style.cursor = 'pointer';
          saveNewIcon.style.marginTop = '10px';
          saveNewIcon.style.marginLeft = '10px';
          saveNewIcon.innerHTML = `<i class="fa fa-check-circle fa-2x" title="Salvar nova característica"></i>`;
          saveNewIcon.addEventListener('click', async () => {
            const caractTable = clone.querySelector('.card-info table');
            if (caractTable) {
              const tbody = caractTable.querySelector('tbody');
              const targetRow = tbody.lastElementChild;
              if (targetRow) {
                // Verifica se a linha é nova (inclusão) ou edição
                const isNew = targetRow.dataset.new === "true";
                const cells = targetRow.querySelectorAll('td');
                const cCodIntCaract = cells[0].querySelector('select')
                  ? cells[0].querySelector('select').value
                  : cells[0].innerText.trim();
                const cConteudo = cells[1].textContent.trim();
                const cExibirItemNF = cells[2].querySelector('select')
                  ? cells[2].querySelector('select').value
                  : cells[2].innerText.trim();
                const cExibirItemPedido = cells[3].querySelector('select')
                  ? cells[3].querySelector('select').value
                  : cells[3].innerText.trim();
                const cExibirOrdemProd = cells[4].querySelector('select')
                  ? cells[4].querySelector('select').value
                  : cells[4].innerText.trim();
                
                // Monta o payload
                const payload = {
                  call: isNew ? "IncluirCaractProduto" : "AlterarCaractProduto",
                  param: [{
                    cCodIntProd: omieData.codigo,
                    cCodIntCaract: cCodIntCaract,
                    cConteudo: cConteudo,
                    cExibirItemNF: cExibirItemNF,
                    cExibirItemPedido: cExibirItemPedido,
                    cExibirOrdemProd: cExibirOrdemProd
                  }]
                };
                
                // LOGA O CÓDIGO ANTES DE SALVAR A CARACTERÍSTICA
                try {
                  await fetch('/api/log-codigo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ codigo: omieData.codigo })
                  });
                } catch (err) {
                  console.error("Falha ao logar o código:", err);
                }
                
                console.log("Payload enviado:", JSON.stringify(payload, null, 2));
                
                try {
                  const response = await fetch('/api/prodcaract', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  });
                  const data = await response.json();
                  if (!data.error) {
                    alert(isNew ? 'Característica incluída com sucesso!' : 'Característica alterada com sucesso!');
                    clone.dataset.characteristicsEditing = "false";
                    const addRowContainer = clone.querySelector('.add-row-container');
                    if (addRowContainer) addRowContainer.remove();
                    await toggleCharacteristicsTableEdit(clone);
                  } else {
                    alert('Erro ao salvar característica: ' + JSON.stringify(data));
                  }
                } catch (err) {
                  console.error("Erro ao enviar requisição:", err);
                  alert('Erro ao salvar característica.');
                }
              }
            }
          });
          
          // Cria o container para os ícones
          const iconContainer = document.createElement('div');
          iconContainer.classList.add('add-row-container');
          iconContainer.style.display = 'flex';
          iconContainer.style.alignItems = 'center';
          iconContainer.style.marginTop = '10px';
          iconContainer.appendChild(newAddRowIcon);
          iconContainer.appendChild(saveNewIcon);
          
          // Insere o container no clone, logo após a tabela (se existir)
          const clonedCardInfo = clone.querySelector('.card-info');
          const table = clonedCardInfo.querySelector('table');
          if (table) {
            table.parentNode.insertBefore(iconContainer, table.nextSibling);
          } else {
            clonedCardInfo.appendChild(iconContainer);
          }
        }
      } else {
        // Se estiver desativando o modo edição, remova os controles, se existirem
        const existingIconContainer = clone.querySelector('.add-row-container');
        if (existingIconContainer) {
          existingIconContainer.remove();
        }
      }
    });
  }}}  


  
  
// (No modal.js) - É importante ter referência ou meio de chamar a função do main.js.
// Dado que "reloadLockedCodesAndRefreshCards" está em main.js, podemos expor globalmente ou importá-la.
// Vou supor que você pode chamar via "window.reloadLockedCodesAndRefreshCards" se tiver exportado.

document.querySelector('.card-modal-close').addEventListener('click', async () => {
  // Fecha o modal
  document.getElementById('cardModal').style.display = "none";

  // Remove o menu que foi adicionado ao body, se existir
  const menu = document.getElementById('accordionMenu');
  if (menu) {
    menu.parentNode.removeChild(menu);
  }

  try {
    // Chama a rota de limpeza
    await fetch('/api/log-codigo/cleanup', { method: 'POST' });

    // Agora, recarrega a lista e atualiza os cards
    if (window.reloadLockedCodesAndRefreshCards) {
      await reloadLockedCodesAndRefreshCards();
    }
  } catch (err) {
    console.error("Erro ao fazer cleanup e atualizar cards:", err);
  }

  // Após fechar o modal, foca o campo de busca e seleciona o texto
  const searchInput = document.getElementById('inpt_search');
  if (searchInput) {
    searchInput.focus();
    searchInput.select();
  }
});


  
  
  // Após injetar o HTML do slider na área .card-top:
  const cardTop = clone.querySelector('.card-top');
  if (cardTop) {
    cardTop.style.position = 'relative';

    // Extrai os links das imagens de omieData (ou usa fallback)
    let slides = [];
    if (omieData && Array.isArray(omieData.imagens) && omieData.imagens.length > 0) {
      slides = omieData.imagens.map(item => item.url_imagem);
    }
    if (slides.length === 0) {
      const fallbackImg = cardElement.querySelector('img')?.src || 'img/logo.png';
      slides.push(fallbackImg);
    }
    while (slides.length < 6) {
      slides.push('img/logo.png');
    }

    // Cria um array temporário que pode ser atualizado (opcional)
    let slidesTemp = [...slides];

    // Monta o HTML do slider sem o botão "Salvar Foto"
    cardTop.innerHTML = `
      <div class="container">
        <!-- INPUTS ocultos para o slider -->
        <input type="radio" name="slider" id="slide-1-trigger" class="trigger" checked>
        <label class="btn" for="slide-1-trigger" title="Produto"></label>
        <input type="radio" name="slider" id="slide-2-trigger" class="trigger">
        <label class="btn" for="slide-2-trigger" title="Foto 2"></label>
        <input type="radio" name="slider" id="slide-3-trigger" class="trigger">
        <label class="btn" for="slide-3-trigger" title="Foto 3"></label>
        <input type="radio" name="slider" id="slide-4-trigger" class="trigger">
        <label class="btn" for="slide-4-trigger" title="Foto 4"></label>
        <input type="radio" name="slider" id="slide-5-trigger" class="trigger">
        <label class="btn" for="slide-5-trigger" title="Foto 5"></label>
        <input type="radio" name="slider" id="slide-6-trigger" class="trigger">
        <label class="btn" for="slide-6-trigger" title="Foto 6"></label>
        
        <!-- SLIDES -->
        <div class="slide-wrapper">
          <div id="slide-role">
            ${[0,1,2,3,4,5].map(i => `
              <div class="slide slide-${i+1}" style="background-image: url('${slides[i].trim()}'); position: relative;">
                <button class="update-slide-btn" data-index="${i}" 
                        style="position: absolute; bottom: 5px; right: 5px; z-index: 10; 
                               font-size: 24px; padding: 8px; background: rgba(255,255,255,0.8);
                               border: none; border-radius: 50%; cursor: pointer;">
                  <i class="ion-ios-camera-outline" style="font-size: 24px;"></i>
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // Re-seleciona os botões atualizados
    const updateBtns = cardTop.querySelectorAll('.update-slide-btn');

    // Atualiza o listener para os botões "update-slide-btn"
    updateBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();

        // LOGA O CÓDIGO AO CLICAR NO ÍCONE DE FOTO
        try {
          fetch('/api/log-codigo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo: omieData?.codigo || '' })
          }).catch(err => console.error('Falha ao logar o código:', err));
        } catch (err) {
          console.error('Falha ao logar o código:', err);
        }

        const index = btn.getAttribute('data-index');
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        // Permite somente imagens JPEG e PNG
        fileInput.accept = '.jpeg,.jpg,.png';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', async (event) => {
          const file = event.target.files[0];
          if (file) {
            // Localiza o slide correspondente e insere o spinner
            const slideDiv = cardTop.querySelector(`.slide.slide-${parseInt(index) + 1}`);
            const spinner = document.createElement('div');
            spinner.className = 'triple-spinner';
            spinner.style.position = 'absolute';
            spinner.style.top = '50%';
            spinner.style.left = '50%';
            spinner.style.transform = 'translate(-50%, -50%)';
            spinner.style.zIndex = '1000';
            slideDiv.appendChild(spinner);
            
            const reader = new FileReader();
            reader.onloadend = async () => {
              const base64data = reader.result.split(',')[1];
              try {
                // Ajusta o nome do arquivo: substitui espaços, parênteses e converte .jpg para .jpeg
                let fileName = file.name.replace(/\s+/g, '_').replace(/[()]/g, '');
                if (fileName.toLowerCase().endsWith('.jpg')) {
                  fileName = fileName.slice(0, -4) + '.jpeg';
                }
                
                // Envia a imagem para o GitHub
                const response = await fetch('/api/uploadImage', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    fileName,
                    content: base64data
                  })
                });
                const data = await response.json();
                if (data.success && data.url) {
                  // Atualiza o slide com a nova imagem
                  slideDiv.style.backgroundImage = `url('${data.url}')`;
                  slidesTemp[index] = data.url;
                  
                  // Cria o payload para enviar a atualização para a Omie
                  const payload = {
                    codigo: omieData.codigo,
                    imagens: slidesTemp.map(url => ({ url_imagem: url.trim() }))
                  };
                  
                  const resposta = await fetch('/api/produtos/alterar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  });
                  const dataOmie = await resposta.json();
                  if (dataOmie.success) {
                    alert("Foto atualizada e produto enviado para Omie com sucesso!");
                  } else {
                    alert("Erro ao atualizar produto na Omie: " + dataOmie.error);
                  }
                } else {
                  alert("Erro no upload da imagem: " + data.error);
                }
              } catch (err) {
                console.error("Erro ao enviar imagem:", err);
                alert("Erro ao enviar imagem.");
              } finally {
                // Remove o spinner após o processo
                slideDiv.removeChild(spinner);
              }
            };
            reader.readAsDataURL(file);
          }
        });
        fileInput.click();
      });
    });
  }
}

/* --------------------------------------------------------------------------
   Função: createCharacteristicRow
   Cria uma linha da tabela de características com os dados do objeto c.
-------------------------------------------------------------------------- */
function createCharacteristicRow(c) {
  const row = document.createElement('tr');

  const tdCaract = document.createElement('td');
  tdCaract.textContent = c.cNomeCaract || '';
  tdCaract.style.border = '1px solid #ccc';
  tdCaract.style.padding = '5px';
  row.appendChild(tdCaract);

  const tdConteudo = document.createElement('td');
  tdConteudo.textContent = c.cConteudo || '';
  tdConteudo.style.border = '1px solid #ccc';
  tdConteudo.style.padding = '5px';
  row.appendChild(tdConteudo);

  const tdExibirItemNF = document.createElement('td');
  tdExibirItemNF.textContent = c.cExibirItemNF || 'N';
  tdExibirItemNF.style.border = '1px solid #ccc';
  tdExibirItemNF.style.padding = '5px';
  row.appendChild(tdExibirItemNF);

  const tdExibirItemPedido = document.createElement('td');
  tdExibirItemPedido.textContent = c.cExibirItemPedido || 'N';
  tdExibirItemPedido.style.border = '1px solid #ccc';
  tdExibirItemPedido.style.padding = '5px';
  row.appendChild(tdExibirItemPedido);

  const tdExibirOrdemProd = document.createElement('td');
  tdExibirOrdemProd.textContent = c.cExibirOrdemProd || 'N';
  tdExibirOrdemProd.style.border = '1px solid #ccc';
  tdExibirOrdemProd.style.padding = '5px';
  row.appendChild(tdExibirOrdemProd);

  return row;
}


function aplicarPermissoesNoContainer(permissoes, containerElement) {
  const permissoesUpper = permissoes.map(p => p.toUpperCase());
  // Seleciona apenas os elementos dentro do container passado
  const elementos = containerElement.querySelectorAll('[data-permissao]');
  elementos.forEach(el => {
    const perm = el.getAttribute('data-permissao').trim().toUpperCase();
    // Exibe sempre "Início" e "Usuário"
    if (perm === 'INÍCIO' || perm === 'USUÁRIO') {
      el.style.setProperty('display', 'block', 'important');
    } else {
      el.style.setProperty('display', permissoesUpper.includes(perm) ? 'block' : 'none', 'important');
    }
  });
}
