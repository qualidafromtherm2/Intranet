// editCharacteristics.js
import { fetchCaracteristicas } from './utils.js';
import { OMIE_APP_KEY, OMIE_APP_SECRET } from '../config.js';


async function populateDatalist() {
  try {
    const list = await fetchCaracteristicas();
    return list;
  } catch (error) {
    console.error("Erro ao buscar características:", error);
    return [];
  }
}

export async function enableSelectCaracteristica(cell) {
  const currentValue = cell.textContent.trim();
  cell.innerHTML = "";
  const select = document.createElement("select");

  // Se existir um valor atual, adiciona-o como opção; senão, adiciona um placeholder
  if (currentValue !== "") {
    const optionCurrent = document.createElement("option");
    optionCurrent.value = currentValue;
    optionCurrent.text = currentValue;
    select.appendChild(optionCurrent);
    select.value = currentValue;
  } else {
    // Adiciona uma opção placeholder não selecionável
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.text = "Selecione";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
  }
  
  // Adiciona a opção "Incluir" como a primeira opção (logo após o placeholder, se houver)
  const incluirOption = document.createElement("option");
  incluirOption.value = "incluir";
  incluirOption.text = "Incluir";
  // Se houver placeholder, insere após ele; caso contrário, insere no início
  if (select.firstChild && select.firstChild.disabled) {
    select.insertBefore(incluirOption, select.children[1] || null);
  } else {
    select.insertBefore(incluirOption, select.firstChild);
  }
  
  // Em seguida, adicione as demais opções da lista (exceto o valor atual, se houver)
  const list = await populateDatalist();
  list.forEach(item => {
    if (item.cNomeCaract.startsWith('*') && item.cNomeCaract !== currentValue) {
      const option = document.createElement("option");
      option.value = item.cNomeCaract;
      option.text = item.cNomeCaract;
      select.appendChild(option);
    }
  });
  
  select.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
  select.style.outline = '1px dashed #ccc';
  cell.appendChild(select);

  // Se o usuário selecionar "incluir", trocamos o select por um input para digitar a nova característica
  select.addEventListener('change', () => {
    if (select.value === "incluir") {
      cell.innerHTML = "";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Nova característica";
      input.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
      input.style.outline = '1px dashed #ccc';
      cell.appendChild(input);
      input.focus();

      input.addEventListener('blur', async () => {
        const newValue = input.value.trim();
        if (newValue) {
          if (confirm(`Deseja salvar a nova característica "${newValue}"?`)) {
            const spinner = document.createElement("div");
            spinner.className = "triple-spinner";
            spinner.style.position = "absolute";
            spinner.style.top = "50%";
            spinner.style.left = "50%";
            spinner.style.transform = "translate(-50%, -50%)";
            spinner.style.zIndex = "1000";
            cell.appendChild(spinner);

            const charValue = "*" + newValue;
            const payload = {
              call: "IncluirCaracteristica",
              param: [{
                cCodIntCaract: charValue,
                cNomeCaract: charValue
              }],
              app_key: OMIE_APP_KEY,
              app_secret: OMIE_APP_SECRET
            };

            
            try {
              const response = await fetch("/api/incluir-caracteristica", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              });
              const data = await response.json();
              cell.removeChild(spinner);
              if (data && data.cDesStatus) {
                alert(`Característica incluída: ${data.cDesStatus}`);
                cell.innerHTML = "";
                cell.textContent = charValue;
              } else {
                alert('Erro ao incluir nova característica.');
                cell.innerHTML = "";
                enableSelectCaracteristica(cell);
              }
            } catch (error) {
              cell.removeChild(spinner);
              alert("Erro ao incluir nova característica.");
              cell.innerHTML = "";
              enableSelectCaracteristica(cell);
            }
          } else {
            cell.innerHTML = "";
            enableSelectCaracteristica(cell);
          }
        } else {
          cell.innerHTML = "";
          enableSelectCaracteristica(cell);
        }
      });
    }
  });
}


export function disableSelectCaracteristica(cell) {
  const select = cell.querySelector("select");
  if (select) {
    const value = select.value;
    cell.innerHTML = value;
  }
  cell.style.backgroundColor = '';
  cell.style.outline = '';
}

/**
 * Agora, em vez de "detectar" se está editando por meio de <select>,
 * nós FORÇAMOS o estado de edição usando cardClone.dataset.characteristicsEditing.
 */
export async function toggleCharacteristicsTableEdit(cardClone) {
  const table = cardClone.querySelector('.card-info table');
  if (!table) return;
  
  // Use exclusivamente a flag para determinar o modo de edição
  const editing = (cardClone.dataset.characteristicsEditing === "true");

  const tbodyRows = table.querySelectorAll('tbody tr');
  tbodyRows.forEach(row => {
    const cells = row.querySelectorAll('td');
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index];
      if (editing) {
        // Se estiver em modo edição:
        if (index === 0) {
          // Coluna "Característica": só permite edição se for uma nova linha
          if (row.dataset.new === "true") {
            // Se não houver select, cria-o
            if (!cell.querySelector('select')) {
              enableSelectCaracteristica(cell);
            }
          } else {
            // Para linhas existentes, mantém o texto fixo
            disableSelectCaracteristica(cell);
          }
        } else if (index === 1) {
          // Segunda coluna: torna o conteúdo editável
          cell.contentEditable = "true";
          cell.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
          cell.style.outline = '1px dashed #ccc';
        } else {
          // Colunas 3 a 5: se não tiver select, cria-o; caso contrário, mantém
          if (!cell.querySelector('select')) {
            const currentValue = cell.textContent.trim() || "N";
            cell.innerHTML = "";
            const select = document.createElement("select");
            const optionS = document.createElement("option");
            optionS.value = "S";
            optionS.text = "S";
            const optionN = document.createElement("option");
            optionN.value = "N";
            optionN.text = "N";
            select.appendChild(optionS);
            select.appendChild(optionN);
            select.value = (currentValue === "S" ? "S" : "N");
            select.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
            select.style.outline = '1px dashed #ccc';
            cell.appendChild(select);
          }
        }
      } else {
        // Modo não edição: desabilita a edição, remove os selects e limpa os estilos
        cell.contentEditable = "false";
        cell.style.backgroundColor = "";
        cell.style.outline = "";
        const select = cell.querySelector("select");
        if (select) {
          // Substitui o conteúdo do cell pelo valor do select
          cell.innerHTML = select.value;
        }
      }
    }
  });
}

export function collectCharacteristicsEdits(cardClone) {
  let caracteristicas = [];
  const caractTable = cardClone.querySelector('.card-info table');
  if (caractTable) {
    const rows = caractTable.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 5) {
        const cNomeCaract = cells[0].querySelector('select')
          ? cells[0].querySelector('select').value
          : cells[0].innerText.trim();
        const cConteudo = cells[1].innerText.trim();
        const cExibirItemNF = cells[2].querySelector('select')
          ? cells[2].querySelector('select').value
          : cells[2].innerText.trim();
        const cExibirItemPedido = cells[3].querySelector('select')
          ? cells[3].querySelector('select').value
          : cells[3].innerText.trim();
        const cExibirOrdemProd = cells[4].querySelector('select')
          ? cells[4].querySelector('select').value
          : cells[4].innerText.trim();
        caracteristicas.push({ cNomeCaract, cConteudo, cExibirItemNF, cExibirItemPedido, cExibirOrdemProd });
      }
    });
  }
  return caracteristicas;
}
