// kanban_base.js
import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

/**
 * Mapeia nomes de coluna para os IDs das <ul>.
 */
const COLUMN_MAP = {
  "Pedido aprovado":       "coluna-comercial",
  "Separação logística":   "coluna-pcp-aprovado",
  "Fila de produção":      "coluna-pcp-op"
};

let placeholder = null;
let ulListenersInitialized = false;
let draggedIndex = null;
let draggedFromColumn = null;

// No início do arquivo, adicione:
function showSpinnerOnCard(card) {
  if (!card) return;
  card.innerHTML = '<i class="fas fa-spinner fa-spin kanban-spinner"></i>';
}

function restoreCardContent(card, originalContent) {
  if (!card || !originalContent) return;
  card.textContent = originalContent;
  card.setAttribute('draggable', 'true');
}


function getUlIdByColumn(columnName) {
  return COLUMN_MAP[columnName] || COLUMN_MAP["Pedido aprovado"];
}

function createPlaceholder() {
  const li = document.createElement('li');
  li.classList.add('placeholder');
  return li;
}

function removePlaceholder() {
  if (placeholder && placeholder.parentElement) {
    placeholder.parentElement.removeChild(placeholder);
  }
}

export function renderKanbanDesdeJSON(itemsKanban) {
  Object.values(COLUMN_MAP).forEach(ulId => {
    const ul = document.getElementById(ulId);
    if (ul) ul.innerHTML = '';
  });

  itemsKanban.forEach((item, index) => {
    const counts = item.local.reduce((acc, raw) => {
  const col = raw.split(',')[0];       // pega tudo antes da vírgula
  acc[col] = (acc[col]||0) + 1;
  return acc;
}, {})

    Object.entries(counts).forEach(([columnName, count]) => {
      const ulId = getUlIdByColumn(columnName);
      const ul = document.getElementById(ulId);
      if (!ul) return;

      const li = document.createElement('li');
      let text = `${item.pedido} – ${item.codigo} (${count})`;
      if (columnName === "Pedido aprovado") {
        text += ` | Estoque: ${item.estoque}`;
      }
      li.textContent = text;
      li.classList.add('kanban-card');
      li.setAttribute('draggable', 'true');
      li.dataset.index = index;
      li.dataset.column = columnName;

      ul.appendChild(li);
    });
  });
}

export async function carregarKanbanLocal() {
  try {
    const resp = await fetch('/api/kanban');
    if (!resp.ok) {
      console.warn('GET /api/kanban retornou status', resp.status);
      return [];
    }
    const json = await resp.json();
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.error('Erro ao carregar kanban.json local:', err);
    return [];
  }
}

export async function salvarKanbanLocal(itemsKanban) {
  try {
    const resp = await fetch('/api/kanban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(itemsKanban, null, 2)
    });
    if (!resp.ok) {
      console.error('Falha ao salvar kanban.json:', await resp.text());
    } else {
      console.log('kanban.json atualizado com sucesso (rota /api/kanban).');
    }
  } catch (err) {
    console.error('Erro ao chamar POST /api/kanban:', err);
  }
}

export function enableDragAndDrop(itemsKanban) {
  document.querySelectorAll('.kanban-card').forEach(li => {
    li.addEventListener('dragstart', e => {
      removePlaceholder();
      placeholder = createPlaceholder();
      draggedIndex = parseInt(e.target.dataset.index, 10);
      draggedFromColumn = e.target.dataset.column;
      e.dataTransfer.setData('text/plain', '');
      e.dataTransfer.effectAllowed = 'move';
    });

    li.addEventListener('dragend', () => {
      removePlaceholder();
      draggedIndex = null;
      draggedFromColumn = null;
    });
  });

  if (!ulListenersInitialized) {
    Object.values(COLUMN_MAP).forEach(ulId => {
      const ul = document.getElementById(ulId);
      if (!ul) return;

      ul.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!ul.contains(placeholder)) ul.appendChild(placeholder);
      });

      ul.addEventListener('dragenter', e => {
        e.preventDefault();
        if (!ul.contains(placeholder)) ul.appendChild(placeholder);
      });

      ul.addEventListener('dragleave', e => {
        if (e.target === ul) removePlaceholder();
      });

ul.addEventListener('drop', async e => {
  console.log('[DROP] evento drop em', e.currentTarget.id,
              'indice=', draggedIndex);
  e.preventDefault();
  removePlaceholder();

  if (draggedIndex === null || !draggedFromColumn) {
    console.log('[DROP] drag não iniciado corretamente');
    return;
  }

  const destinationUlId = e.currentTarget.id;
  const newColumn = Object.entries(COLUMN_MAP)
    .find(([, id]) => id === destinationUlId)?.[0];
  if (!newColumn) {
    console.log('[DROP] coluna destino inválida:', destinationUlId);
    return;
  }

  const originColumn = draggedFromColumn;
  const item = itemsKanban[draggedIndex];
  
  // 1. Encontra todos os cards com este índice (pode haver múltiplos se o mesmo item está em várias colunas)
  const cards = document.querySelectorAll(`.kanban-card[data-index="${draggedIndex}"]`);
  
  // 2. Encontra o card específico que está sendo movido (na coluna de origem)
  const movedCard = Array.from(cards).find(card => card.dataset.column === originColumn);
  
  if (!movedCard) {
    console.log('[DROP] card não encontrado');
    return;
  }

  // 3. Salva o conteúdo original e mostra o spinner imediatamente
  const originalContent = movedCard.innerHTML;
  if (newColumn === "Separação logística") {
    movedCard.innerHTML = '<i class="fas fa-spinner fa-spin kanban-spinner"></i>';
    movedCard.style.pointerEvents = 'none'; // Impede interação durante o processamento
  }

  // 4. Atualiza o modelo de dados
  const idx = item.local.findIndex(c => c === originColumn);
  if (idx !== -1) item.local[idx] = newColumn;

  try {
    // 5. Processa a criação da OP (se aplicável)
    const respProd = await fetch(
      `/api/produtos/detalhes/${encodeURIComponent(item.codigo)}`
    );
    const prodData = await respProd.json();
    console.log('[OP] detalhes:', prodData);

    const tipoItem = prodData.tipoItem ?? prodData.tipo_item;
    
    if (
      originColumn === 'Pedido aprovado' &&
      newColumn === 'Separação logística' &&
      (tipoItem === '04' || parseInt(tipoItem, 10) === 4)
    ) {
      console.log('[OP] condição satisfeita, incluindo OP');

      // Gera código OP
      const prefix = item.codigo[0];
      const now = new Date();
      const mm = String(now.getMonth()+1).padStart(2,'0');
      const yy = String(now.getFullYear()).slice(-2);
      const seqKey = 'kanban_op_seq';
      const last = parseInt(localStorage.getItem(seqKey),10)||0;
      const seq = last + 1;
      localStorage.setItem(seqKey, seq);
      const seqStr = String(seq).padStart(4,'0');
      const cCodIntOP = `${prefix}${mm}${yy}${seqStr}`;

      const tom = new Date(now.getTime() + 24*60*60*1000);
      const d = String(tom.getDate()).padStart(2,'0');
      const m2 = String(tom.getMonth()+1).padStart(2,'0');
      const y2 = tom.getFullYear();
      const dDtPrevisao = `${d}/${m2}/${y2}`;

      const payloadOP = {
        call: 'IncluirOrdemProducao',
        param: [{ identificacao: { cCodIntOP, dDtPrevisao, nCodProduto: item._codigoProd, nQtde: 1 }}],
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET
      };

      // 6. Chama API para criar OP
      const respOP = await fetch('/api/omie/produtos/op', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payloadOP)
      });
      const dataOP = await respOP.json();

      if (!dataOP.faultstring && !dataOP.error) {
        const arr = item.local;
        const colunaLimpa = newColumn;
        const idxMov = arr.findIndex(s => s === colunaLimpa);
        if (idxMov !== -1) {
          arr[idxMov] = `${colunaLimpa},${cCodIntOP}`;

          // 7. Gera etiqueta
          try {
            await fetch('/api/etiquetas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ numeroOP: cCodIntOP })
            });
          } catch (err) {
            console.error('[ETIQUETA] falha ao chamar /api/etiquetas:', err);
          }
        }
      }
    }
  } catch (err) {
    console.error('[OP] erro inclusão OP:', err);
    
    // 8. Em caso de erro, restaura o conteúdo original
    movedCard.innerHTML = originalContent;
    movedCard.style.pointerEvents = '';
    
    // Atualiza a interface sem salvar as mudanças
    renderKanbanDesdeJSON(itemsKanban);
    enableDragAndDrop(itemsKanban);
    return;
  }

  // 9. Atualiza a interface com os novos dados
  renderKanbanDesdeJSON(itemsKanban);
  enableDragAndDrop(itemsKanban);
  await salvarKanbanLocal(itemsKanban);

  draggedIndex = null;
  draggedFromColumn = null;
});
    });
    ulListenersInitialized = true;
  }
}
