// editFields.js
export function toggleEditMode(cardClone) {
    const isCurrentlyEditing = (cardClone.querySelector('.card-info p[contentEditable="true"]') !== null);
    const willEdit = !isCurrentlyEditing;
  
    const saveIcon = cardClone.querySelector('#saveIcon');
    if (saveIcon) {
      saveIcon.style.display = willEdit ? 'inline-block' : 'none';
    }
  
    const paragraphs = cardClone.querySelectorAll('.card-info p');
    paragraphs.forEach(p => {
      if (p.closest('table')) return; // ignora os que estão na tabela
      const text = p.innerText.trim();
      // Campos fixos de estoque não devem ser editáveis
      if (
        text.startsWith("Valor Unitário:") ||
        text.startsWith("Saldo:") ||
        text.startsWith("Reservado:") ||
        text.startsWith("Físico:")
      ) {
        return;
      }
      if (text.startsWith("Data de inclusão:") || text.startsWith("Data da última alteração:")) {
        return;
      }
      if (p.dataset.field === 'unidade') {
        if (willEdit) {
          enableSelectUnidade(p);
        } else {
          disableSelectUnidade(p);
        }
        return;
      }
      if (p.dataset.field === 'bloqueado' || p.dataset.field === 'inativo') {
        if (willEdit) {
          enableSelectSN(p);
        } else {
          disableSelectSN(p);
        }
        return;
      }
      p.contentEditable = willEdit ? 'true' : 'false';
      if (willEdit) {
        p.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
        p.style.outline = '1px dashed #ccc';
      } else {
        p.style.backgroundColor = '';
        p.style.outline = '';
      }
    });
  }
  
  export function enableSelectUnidade(p) {
    const textContent = p.innerText;
    let currentValue = textContent.split(':')[1]?.trim() || '';
    if (currentValue.includes('\n')) {
      currentValue = currentValue.split('\n')[0].trim();
    }
    p.innerHTML = '';
    const strongLabel = document.createElement('strong');
    strongLabel.textContent = "Unidade:";
    p.appendChild(strongLabel);
    p.appendChild(document.createTextNode(' '));
    const select = document.createElement('select');
    ["UN", "KG", "MT"].forEach(optVal => {
      const opt = document.createElement('option');
      opt.value = optVal;
      opt.text = optVal;
      select.appendChild(opt);
    });
    if (["UN", "KG", "MT"].includes(currentValue)) {
      select.value = currentValue;
    }
    select.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
    select.style.outline = '1px dashed #ccc';
    p.appendChild(select);
  }
  
  export function disableSelectUnidade(p) {
    const strong = p.querySelector('strong');
    const select = p.querySelector('select');
    if (!strong || !select) return;
    const finalValue = select.value;
    p.innerHTML = `${strong.outerHTML} ${finalValue}`;
  }
  
  export function enableSelectSN(p) {
    const textContent = p.innerText;
    let currentValue = textContent.split(':')[1]?.trim() || '';
    if (currentValue !== 'S' && currentValue !== 'N') {
      currentValue = '';
    }
    p.innerHTML = '';
    const strongLabel = document.createElement('strong');
    strongLabel.textContent = textContent.split(':')[0] + ':';
    p.appendChild(strongLabel);
    p.appendChild(document.createTextNode(' '));
    const select = document.createElement('select');
    const optionS = document.createElement('option');
    optionS.value = 'S';
    optionS.text = 'S';
    const optionN = document.createElement('option');
    optionN.value = 'N';
    optionN.text = 'N';
    select.appendChild(optionS);
    select.appendChild(optionN);
    if (currentValue === 'S') select.value = 'S';
    else if (currentValue === 'N') select.value = 'N';
    select.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
    select.style.outline = '1px dashed #ccc';
    p.appendChild(select);
  }
  
  export function disableSelectSN(p) {
    const strong = p.querySelector('strong');
    const select = p.querySelector('select');
    if (!strong || !select) return;
    const finalValue = select.value;
    p.innerHTML = `${strong.outerHTML} ${finalValue}`;
  }
  