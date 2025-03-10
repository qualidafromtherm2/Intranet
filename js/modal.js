// modal.js
import { OMIE_APP_KEY, OMIE_APP_SECRET } from '../config.js';
import { toggleEditMode } from './editFields.js';
import { toggleCharacteristicsTableEdit, enableSelectCaracteristica } from './editCharacteristics.js';
import { fetchPosicaoEstoque, getTextOfField } from './utils.js';
import { collectEditsFromCard } from './editCard.js';

/* --------------------------------------------------------------------------
   Função: createFloatingButtonMenu
   Cria e configura o menu flutuante, sem dependências de outros elementos.
-------------------------------------------------------------------------- */
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
}

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
      const caractTable = document.createElement('table');
      caractTable.style.borderCollapse = 'collapse';
      caractTable.style.marginTop = '10px';
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
  
      const tbody = document.createElement('tbody');
      omieData.caracteristicas.forEach(c => {
        const row = createCharacteristicRow(c);
        tbody.appendChild(row);
      });
      caractTable.appendChild(tbody);
      clonedCardInfo.appendChild(caractTable);
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
        try {
          const omieResponse = await fetch('/api/produtos/alterar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(camposEdicao)
          });
          const omieData = await omieResponse.json();
          if (omieData.success) {
            alert("Produto atualizado na OMIE com sucesso!");
          } else {
            alert("Erro ao atualizar na OMIE: " + omieData.error);
          }
          const csvResponse = await fetch('/api/produtos/alterarNoCSV', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              codigo: camposEdicao.codigo,
              descr_detalhada: camposEdicao.descr_detalhada,
              descricao: camposEdicao.descricao
            })
          });
          const csvData = await csvResponse.json();
          if (csvData.success) {
            console.log('CSV atualizado com sucesso!');
          } else {
            console.error('Erro ao atualizar CSV:', csvData.error);
            alert('Erro ao atualizar CSV: ' + csvData.error);
          }
          if (clone.querySelector('.card-info p[contentEditable="true"]')) {
            toggleEditMode(clone);
          }
          clone.dataset.characteristicsEditing = "false";
        } catch (error) {
          console.error("Erro geral ao salvar:", error);
          alert("Erro ao salvar alterações");
        }
      });
    }
  
    // Adiciona o menu flutuante
    const floatingMenu = createFloatingButtonMenu();
    container.appendChild(floatingMenu);
  
    const editButton = floatingMenu.querySelector('#editBtn');
    if (editButton) {
      editButton.addEventListener('click', (e) => {
        e.preventDefault();
        toggleEditMode(clone);
      });
    }
  
    const chatsButton = floatingMenu.querySelector('.nav-item.nav-count-3');
    if (chatsButton) {
      chatsButton.addEventListener('click', async (e) => {
        e.preventDefault();
        const isEditing = clone.dataset.characteristicsEditing === "true";
        const editing = !isEditing;
        clone.dataset.characteristicsEditing = editing.toString();
        await toggleCharacteristicsTableEdit(clone);
        let caractTable = clone.querySelector('.card-info table');
        if (caractTable) {
          updateDeleteIcons(caractTable, editing);
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
              let caractTable = clone.querySelector('.card-info table');
              if (!caractTable) {
                caractTable = document.createElement('table');
                caractTable.style.borderCollapse = 'collapse';
                caractTable.style.marginTop = '10px';
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
                const tbody = document.createElement('tbody');
                caractTable.appendChild(tbody);
                clonedCardInfo.appendChild(caractTable);
              }
              const tbody = caractTable.querySelector('tbody');
              const newRow = document.createElement('tr');
              newRow.dataset.new = "true";
              const newCell1 = document.createElement('td');
              await enableSelectCaracteristica(newCell1);
              const newCell2 = document.createElement('td');
              newCell2.textContent = "";
              newCell2.contentEditable = "true";
              newCell2.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
              newCell2.style.outline = '1px dashed #ccc';
              const createSelectCell = (defaultValue = "N") => {
                const cell = document.createElement('td');
                cell.innerHTML = "";
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
              newRow.appendChild(newCell1);
              newRow.appendChild(newCell2);
              newRow.appendChild(newCell3);
              newRow.appendChild(newCell4);
              newRow.appendChild(newCell5);
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
                const newRow = tbody.lastElementChild;
                if (newRow) {
                  const cells = newRow.querySelectorAll('td');
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
  
                  const payload = {
                    param: [{
                      cCodIntProd: omieData.codigo,
                      cCodIntCaract: cCodIntCaract,
                      cConteudo: cConteudo,
                      cExibirItemNF: cExibirItemNF,
                      cExibirItemPedido: cExibirItemPedido,
                      cExibirOrdemProd: cExibirOrdemProd
                    }]
                  };
  
                  console.log("Payload enviado para IncluirCaractProduto:", JSON.stringify(payload, null, 2));
  
                  try {
                    const response = await fetch('/api/prodcaract', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload)
                    });
                    const data = await response.json();
                    console.log("Resposta da API:", data);
                    if (!data.error) {
                      alert('Característica incluída com sucesso!');
                      clone.dataset.characteristicsEditing = "false";
                      const addRowContainer = clone.querySelector('.add-row-container');
                      if (addRowContainer) addRowContainer.remove();
                      await toggleCharacteristicsTableEdit(clone);
                    } else {
                      alert('Erro ao incluir característica: ' + JSON.stringify(data));
                    }
                  } catch (err) {
                    console.error("Erro ao enviar requisição:", err);
                    alert('Erro ao incluir característica.');
                  }
                }
              }
            });
  
            const iconContainer = document.createElement('div');
            iconContainer.classList.add('add-row-container');
            iconContainer.style.display = 'flex';
            iconContainer.style.alignItems = 'center';
            iconContainer.style.marginTop = '10px';
            iconContainer.appendChild(newAddRowIcon);
            iconContainer.appendChild(saveNewIcon);
  
            const clonedCardInfo = clone.querySelector('.card-info');
            const table = clonedCardInfo.querySelector('table');
            if (table) {
              table.parentNode.insertBefore(iconContainer, table.nextSibling);
            } else {
              clonedCardInfo.appendChild(iconContainer);
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
    modal.style.display = "flex";
  }
  
  document.querySelector('.card-modal-close').addEventListener('click', () => {
    document.getElementById('cardModal').style.display = "none";
  });
  document.getElementById('cardModal').addEventListener('click', function(e) {
    if (e.target === this) this.style.display = "none";
  });
  
  // Injeta o HTML do carrossel na área .card-top do clone
// Injeta o HTML do slider na área .card-top do clone
// Injeta o HTML do slider na área .card-top do clone
const cardTop = clone.querySelector('.card-top');
if (cardTop) {
  cardTop.style.position = 'relative';
  // Obtém o link da imagem a partir do card original (do CSV)
  const csvImg = cardElement.querySelector('img')?.src || 'img/logo.png';
  // Se houver múltiplos links separados por vírgula, separe-os; caso contrário, use somente o único link
  let slides = [];
  if (csvImg.includes(',')) {
    slides = csvImg.split(',');
  } else {
    slides.push(csvImg);
  }
  // Se houver menos de 6 links, preenche com "img/logo.png"
  while (slides.length < 6) {
    slides.push('img/logo.png');
  }
  
  // Monta o HTML do slider com 6 slides
  cardTop.innerHTML = `
    <div class="container">
      <!-- BUTTONS (inputs e labels) -->
      <input type="radio" name="slider" id="slide-1-trigger" class="trigger" checked>
      <label class="btn" for="slide-1-trigger"></label>
      <input type="radio" name="slider" id="slide-2-trigger" class="trigger">
      <label class="btn" for="slide-2-trigger"></label>
      <input type="radio" name="slider" id="slide-3-trigger" class="trigger">
      <label class="btn" for="slide-3-trigger"></label>
      <input type="radio" name="slider" id="slide-4-trigger" class="trigger">
      <label class="btn" for="slide-4-trigger"></label>
      <input type="radio" name="slider" id="slide-5-trigger" class="trigger">
      <label class="btn" for="slide-5-trigger"></label>
      <input type="radio" name="slider" id="slide-6-trigger" class="trigger">
      <label class="btn" for="slide-6-trigger"></label>

      <!-- SLIDES -->
      <div class="slide-wrapper">
          <div id="slide-role">
              <div class="slide slide-1" style="background-image: url('${slides[0].trim()}');"></div>
              <div class="slide slide-2" style="background-image: url('${slides[1].trim()}');"></div>
              <div class="slide slide-3" style="background-image: url('${slides[2].trim()}');"></div>
              <div class="slide slide-4" style="background-image: url('${slides[3].trim()}');"></div>
              <div class="slide slide-5" style="background-image: url('${slides[4].trim()}');"></div>
              <div class="slide slide-6" style="background-image: url('${slides[5].trim()}');"></div>
          </div>
      </div>
    </div>
  `;
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
